param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("start", "stop", "status")]
    [string]$Mode
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot "editor_server_ports.ps1")
. (Join-Path $PSScriptRoot "editor_server_processes.ps1")
. (Join-Path $PSScriptRoot "editor_server_state.ps1")
. (Join-Path $PSScriptRoot "editor_server_lock.ps1")

$RepoRoot = Split-Path -Parent $PSScriptRoot
$UiDir = Join-Path $RepoRoot "arranger-ui"
$ServerJs = Join-Path $RepoRoot "server\server.js"
$IsStandalone = (Test-Path -LiteralPath $ServerJs -PathType Leaf) -and (-not (Test-Path -LiteralPath $UiDir -PathType Container))
$StateDir = Join-Path $RepoRoot "artifacts\arranger"
$PidFile = Join-Path $StateDir "editor-server.pid"
$PortFile = Join-Path $StateDir "editor-server.port"
$StdoutLog = Join-Path $StateDir "editor-server.stdout.log"
$StderrLog = Join-Path $StateDir "editor-server.stderr.log"

function Get-ListenerPid(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 65535)]
    [int]$Port
) {
    try {
        # Node 26 on Windows exposes its listening socket with a null State in
        # Get-NetTCPConnection, so filtering with -State Listen misses it even
        # though the port answers HTTP. Accept those rows explicitly.
        $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction Stop
        foreach ($connection in $connections) {
            if (Test-EditorListenerConnection $connection) {
                return [int]$connection.OwningProcess
            }
        }
    } catch {
        return $null
    }
    return $null
}

function Get-RecordedPid {
    if (-not (Test-Path -LiteralPath $PidFile -PathType Leaf)) {
        return $null
    }
    $value = 0
    if ([int]::TryParse((Get-Content -LiteralPath $PidFile -Raw).Trim(), [ref]$value)) {
        return $value
    }
    return $null
}

function Get-RecordedPort {
    return Get-RecordedEditorPort -Path $PortFile -DefaultPort 3000
}

function Test-EditorProcess([int]$ProcessId) {
    try {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
        if ($null -eq $process -or [string]::IsNullOrWhiteSpace($process.CommandLine)) {
            return $false
        }
        if ($IsStandalone) {
            return $process.CommandLine.ToLowerInvariant().Contains("server.js")
        }
        $expected = (Join-Path $UiDir "node_modules\next").ToLowerInvariant()
        return $process.CommandLine.ToLowerInvariant().Contains($expected)
    } catch {
        return $false
    }
}

function Get-NextDevServerInfo {
    if ($IsStandalone) {
        return $null
    }
    $lockPath = Join-Path $UiDir ".next\dev\lock"
    if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) {
        return $null
    }
    $stream = $null
    $reader = $null
    try {
        # Next.js holds the lock open with delete sharing; a plain Get-Content
        # fails with a sharing violation, so request the same share mode.
        $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
        $stream = [System.IO.File]::Open(
            $lockPath,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            $share
        )
        $reader = [System.IO.StreamReader]::new($stream)
        $info = $reader.ReadToEnd() | ConvertFrom-Json
    } catch {
        return $null
    } finally {
        if ($null -ne $reader) {
            $reader.Dispose()
        } elseif ($null -ne $stream) {
            $stream.Dispose()
        }
    }
    if ($null -eq $info) {
        return $null
    }
    $serverPid = 0
    $serverPort = 0
    if (-not [int]::TryParse([string]$info.pid, [ref]$serverPid)) {
        return $null
    }
    if (-not [int]::TryParse([string]$info.port, [ref]$serverPort)) {
        return $null
    }
    if ($serverPid -le 0 -or $serverPort -lt 1 -or $serverPort -gt 65535) {
        return $null
    }
    $appUrl = [string]$info.appUrl
    if ([string]::IsNullOrWhiteSpace($appUrl)) {
        $appUrl = "http://localhost:$serverPort"
    }
    return [pscustomobject]@{
        ProcessId = $serverPid
        Port = $serverPort
        AppUrl = $appUrl
    }
}

function Test-EditorHttp {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,

        [ValidateRange(1, 60)]
        [int]$TimeoutSec = 5
    )
    try {
        $null = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
        return $true
    } catch {
        # Any HTTP status response means the server process is alive.
        return ($null -ne $_.Exception.Response)
    }
}

function Get-LiveEditorServer {
    $recorded = Get-RecordedPid
    if ($null -ne $recorded -and (Test-EditorProcess $recorded)) {
        $recordedPort = Get-RecordedPort
        $recordedUrl = "http://localhost:$recordedPort"
        if (
            (Get-ListenerPid $recordedPort) -eq $recorded -or
            (Test-EditorHttp -Url $recordedUrl -TimeoutSec 2)
        ) {
            return [pscustomobject]@{
                ProcessId = $recorded
                Port = $recordedPort
                AppUrl = $recordedUrl
            }
        }
    }
    # State files can be missing after a crash or a manual `npm run dev`.
    # Next's dev lockfile still identifies the process serving this project.
    $nextServer = Get-NextDevServerInfo
    if ($null -ne $nextServer -and (Test-EditorProcess $nextServer.ProcessId)) {
        return $nextServer
    }
    return $null
}

if ($Mode -eq "status") {
    if ($null -ne (Get-LiveEditorServer)) {
        Write-Output "RUNNING"
    } else {
        Write-Output "STOPPED"
    }
    exit 0
}

if ($Mode -eq "stop") {
    $server = Get-LiveEditorServer
    if ($null -eq $server) {
        Write-Host "No managed editor server is running."
        exit 0
    }
    Stop-EditorProcessTree -LauncherPid $server.ProcessId
    Remove-EditorServerState -PidPath $PidFile -PortPath $PortFile
    Write-Host "Cube Chart Editor stopped (PID $($server.ProcessId))."
    exit 0
}

function Start-EditorServer {
    $nodeCmd = $null
    $npm = $null

    if (-not $IsStandalone) {
        if (-not (Test-Path -LiteralPath $UiDir -PathType Container)) {
            throw "Editor directory not found: $UiDir"
        }
        $npm = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
        if ($null -eq $npm) {
            throw "npm.cmd was not found. Install Node.js and ensure npm is on PATH."
        }
    } else {
        $binNode = Join-Path $RepoRoot "bin\node.exe"
        if (Test-Path -LiteralPath $binNode -PathType Leaf) {
            $nodeCmd = $binNode
        } else {
            $nodeCmd = (Get-Command "node.exe" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
        }
        if ($null -eq $nodeCmd) {
            throw "node.exe was not found. Please ensure bin\node.exe exists or Node.js is on PATH."
        }
    }

    $liveServer = Get-LiveEditorServer
    if ($null -ne $liveServer) {
        $liveUrl = $liveServer.AppUrl.TrimEnd("/")
        # A lock-discovered server may still be binding; wait briefly so the
        # browser does not open before the port answers.
        $deadline = (Get-Date).AddSeconds(30)
        while (
            (Get-Date) -lt $deadline -and
            (Get-ListenerPid $liveServer.Port) -ne $liveServer.ProcessId -and
            -not (Test-EditorHttp -Url $liveUrl -TimeoutSec 2)
        ) {
            if (-not (Test-EditorProcess $liveServer.ProcessId)) {
                $liveServer = $null
                break
            }
            Start-Sleep -Seconds 1
        }
        if ($null -ne $liveServer) {
            Set-EditorServerState `
                -PidPath $PidFile `
                -PortPath $PortFile `
                -ProcessId $liveServer.ProcessId `
                -Port $liveServer.Port
            $liveLaunchUrl = "$liveUrl/?resume=1"
            try {
                Start-Process $liveLaunchUrl
            } catch {
                Write-Warning "Server is running; open $liveLaunchUrl manually. $($_.Exception.Message)"
            }
            Write-Host "Cube Chart Editor is already running at $liveUrl"
            return
        }
    }

    # First run or missing deps (Dev mode only): auto npm install (matches arranger-ui/start.sh).
    if (-not $IsStandalone) {
        if (-not (Test-Path -LiteralPath (Join-Path $UiDir "node_modules\next") -PathType Container)) {
            Write-Host "First run: installing dependencies (this may take a few minutes)..."
            $install = Start-Process -FilePath $npm.Source `
                -ArgumentList @("install", "--no-audit", "--no-fund") `
                -WorkingDirectory $UiDir -Wait -NoNewWindow -PassThru
            if ($install.ExitCode -ne 0) {
                throw "npm install failed (exit $($install.ExitCode)). Check your network/Node environment and retry."
            }
        }
    }

    $portCandidates = Get-EditorPortCandidates
    $Port = Find-AvailableEditorPort -Candidates $portCandidates
    if ($null -eq $Port) {
        throw (
            "No usable editor port was found. Tried 3000 and 3210-3299; " +
            "each port is occupied, reserved, or denied by Windows."
        )
    }
    $Url = "http://localhost:$Port"
    $LaunchUrl = "$Url/?resume=1"

    New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

    if ($IsStandalone) {
        $binDir = Join-Path $RepoRoot "bin"
        $pyDir = Join-Path $binDir "python"
        $env:PORT = "$Port"
        $env:HOSTNAME = "127.0.0.1"
        $env:NODE_ENV = "production"
        if (Test-Path (Join-Path $pyDir "python.exe")) {
            $env:PYTHON_EXECUTABLE = Join-Path $pyDir "python.exe"
        } elseif (Test-Path (Join-Path $binDir "python.exe")) {
            $env:PYTHON_EXECUTABLE = Join-Path $binDir "python.exe"
        }
        if (Test-Path $binDir) {
            $env:PATH = "$binDir;$pyDir;" + $env:PATH
        }

        $launcher = Start-Process `
            -FilePath $nodeCmd `
            -ArgumentList @("server.js") `
            -WorkingDirectory (Join-Path $RepoRoot "server") `
            -RedirectStandardOutput $StdoutLog `
            -RedirectStandardError $StderrLog `
            -WindowStyle Hidden `
            -PassThru
    } else {
        $launcher = Start-Process `
            -FilePath $npm.Source `
            -ArgumentList @("run", "dev", "--", "--port", "$Port") `
            -WorkingDirectory $UiDir `
            -RedirectStandardOutput $StdoutLog `
            -RedirectStandardError $StderrLog `
            -WindowStyle Hidden `
            -PassThru
    }

    # Cache the process handle while it is alive; Windows PowerShell otherwise may lose ExitCode.
    $null = $launcher.Handle
    Write-Host "Starting Cube Chart Editor..."
    $ready = $false
    $deadline = (Get-Date).AddSeconds(120)
    while ((Get-Date) -lt $deadline) {
        if ($launcher.HasExited) {
            break
        }
        if (Test-EditorHttp -Url $Url -TimeoutSec 5) {
            $ready = $true
            break
        }
        Start-Sleep -Seconds 1
    }

    if ($ready) {
        $serverPid = $null
        if (-not $IsStandalone) {
            $nextServer = Get-NextDevServerInfo
            if (
                $null -ne $nextServer -and
                $nextServer.Port -eq $Port -and
                (Test-EditorProcess $nextServer.ProcessId)
            ) {
                $serverPid = $nextServer.ProcessId
            }
        }
        if ($null -eq $serverPid) {
            $listenerPid = Get-ListenerPid $Port
            if ($null -ne $listenerPid -and (Test-EditorProcess $listenerPid)) {
                $serverPid = $listenerPid
            }
        }
        if ($null -eq $serverPid -and $IsStandalone) {
            $serverPid = $launcher.Id
        }
        if ($null -ne $serverPid) {
            Set-EditorServerState `
                -PidPath $PidFile `
                -PortPath $PortFile `
                -ProcessId $serverPid `
                -Port $Port
            try {
                Start-Process $LaunchUrl
            } catch {
                Write-Warning "Server is ready; open $LaunchUrl manually. $($_.Exception.Message)"
            }
            Write-Host "Cube Chart Editor is ready at $Url"
            return
        }
        Write-Warning "The editor responded at $Url, but its process could not be identified; cleaning up."
    }

    $exitedEarly = $launcher.HasExited
    $exitCode = $null
    if ($exitedEarly) {
        $launcher.WaitForExit()
        $exitCode = $launcher.ExitCode
    } else {
        Stop-EditorProcessTree -LauncherPid $launcher.Id
    }

    # A manual `npm run dev` may have taken Next's lock between our check and
    # the launch. Reuse it instead of reporting a startup failure.
    $liveServer = Get-LiveEditorServer
    if ($null -ne $liveServer) {
        $liveUrl = $liveServer.AppUrl.TrimEnd("/")
        Set-EditorServerState `
            -PidPath $PidFile `
            -PortPath $PortFile `
            -ProcessId $liveServer.ProcessId `
            -Port $liveServer.Port
        try {
            Start-Process "$liveUrl/?resume=1"
        } catch {
            Write-Warning "Server is running; open $liveUrl/?resume=1 manually. $($_.Exception.Message)"
        }
        Write-Host "Cube Chart Editor is already running at $liveUrl"
        return
    }

    Write-Host "Editor startup failed. Recent log output:"
    if (Test-Path -LiteralPath $StdoutLog) {
        Get-Content -LiteralPath $StdoutLog -Tail 20
    }
    if (Test-Path -LiteralPath $StderrLog) {
        Get-Content -LiteralPath $StderrLog -Tail 20
    }
    if ($exitedEarly) {
        throw "Cube Chart Editor exited before becoming ready (exit code $exitCode)."
    }
    throw "Cube Chart Editor did not become ready at $Url within 120 seconds."
}

$startupMutex = [System.Threading.Mutex]::new($false, (Get-EditorStartupMutexName $RepoRoot))
$ownsStartupMutex = $false
$transcribing = $false
try {
    $ownsStartupMutex = Enter-EditorStartupMutex $startupMutex
    if (-not $ownsStartupMutex) {
        Write-Output "Editor startup is already in progress; the first launcher will open the browser."
        exit 0
    }
    # Only the lock owner may touch shared logs/state or start a service.
    New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
    $startupLog = Join-Path $StateDir "editor-startup.log"
    Start-Transcript -LiteralPath $startupLog -Force | Out-Null
    $transcribing = $true
    Start-EditorServer
    Write-Output "Editor startup exit code: 0"
    exit 0
} catch {
    Write-Host ("Editor startup error: " + ($_ | Out-String))
    Write-Host "Editor startup exit code: 1"
    exit 1
} finally {
    if ($transcribing) { Stop-Transcript -ErrorAction SilentlyContinue | Out-Null }
    if ($ownsStartupMutex) { $startupMutex.ReleaseMutex() }
    $startupMutex.Dispose()
}
