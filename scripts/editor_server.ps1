param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("start", "stop", "status")]
    [string]$Mode
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "editor_server_ports.ps1")
. (Join-Path $PSScriptRoot "editor_server_processes.ps1")
. (Join-Path $PSScriptRoot "editor_server_state.ps1")

$RepoRoot = Split-Path -Parent $PSScriptRoot
$UiDir = Join-Path $RepoRoot "arranger-ui"
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
        $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
            Select-Object -First 1
        if ($null -ne $listener) {
            return [int]$listener.OwningProcess
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
        $expected = (Join-Path $UiDir "node_modules\next").ToLowerInvariant()
        return $process.CommandLine.ToLowerInvariant().Contains($expected)
    } catch {
        return $false
    }
}

function Test-ManagedServer {
    $recorded = Get-RecordedPid
    $recordedPort = Get-RecordedPort
    $listener = Get-ListenerPid $recordedPort
    return (
        $null -ne $recorded -and
        $recorded -eq $listener -and
        (Test-EditorProcess $recorded)
    )
}

if ($Mode -eq "status") {
    if (Test-ManagedServer) {
        Write-Output "RUNNING"
    } else {
        Write-Output "STOPPED"
    }
    exit 0
}

if ($Mode -eq "stop") {
    if (-not (Test-ManagedServer)) {
        Write-Host "No managed editor server is running."
        exit 0
    }
    $serverPid = Get-RecordedPid
    Stop-Process -Id $serverPid -Force
    Remove-EditorServerState -PidPath $PidFile -PortPath $PortFile
    Write-Host "Cube Chart Editor stopped (PID $serverPid)."
    exit 0
}

if (-not (Test-Path -LiteralPath $UiDir -PathType Container)) {
    throw "Editor directory not found: $UiDir"
}
$npm = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
if ($null -eq $npm) {
    throw "npm.cmd was not found. Install Node.js and ensure npm is on PATH."
}

if (Test-ManagedServer) {
    $recordedPort = Get-RecordedPort
    $recordedUrl = "http://localhost:$recordedPort"
    $recordedLaunchUrl = "$recordedUrl/?resume=1"
    Start-Process $recordedLaunchUrl
    Write-Host "Cube Chart Editor is already running at $recordedUrl"
    exit 0
}

# First run or missing deps: auto npm install (matches arranger-ui/start.sh).
# The `next` module is the dev server entry point; without it the server cannot start,
# so its directory is used as a readiness probe.
if (-not (Test-Path -LiteralPath (Join-Path $UiDir "node_modules\next") -PathType Container)) {
    Write-Host "First run: installing dependencies (this may take a few minutes)..."
    $install = Start-Process -FilePath $npm.Source `
        -ArgumentList @("install", "--no-audit", "--no-fund") `
        -WorkingDirectory $UiDir -Wait -NoNewWindow -PassThru
    if ($install.ExitCode -ne 0) {
        throw "npm install failed (exit $($install.ExitCode)). Check your network/Node environment and retry."
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
$launcher = Start-Process `
    -FilePath $npm.Source `
    -ArgumentList @("run", "dev", "--", "--port", "$Port") `
    -WorkingDirectory $UiDir `
    -RedirectStandardOutput $StdoutLog `
    -RedirectStandardError $StderrLog `
    -WindowStyle Hidden `
    -PassThru

Write-Host "Starting Cube Chart Editor..."
for ($attempt = 0; $attempt -lt 120; $attempt++) {
    if ($launcher.HasExited) {
        break
    }
    $listenerPid = Get-ListenerPid $Port
    if ($null -ne $listenerPid -and (Test-EditorProcess $listenerPid)) {
        try {
            $null = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            Set-EditorServerState `
                -PidPath $PidFile `
                -PortPath $PortFile `
                -ProcessId $listenerPid `
                -Port $Port
            Start-Process $LaunchUrl
            Write-Host "Cube Chart Editor is ready at $Url"
            exit 0
        } catch {
            # The port is open while Next.js is still compiling; keep polling.
        }
    }
    Start-Sleep -Seconds 1
}

$exitedEarly = $launcher.HasExited
$exitCode = $null
if ($exitedEarly) {
    $exitCode = $launcher.ExitCode
} else {
    $listenerPid = Get-ListenerPid $Port
    if ($null -eq $listenerPid -or -not (Test-EditorProcess $listenerPid)) {
        $listenerPid = 0
    }
    Stop-EditorProcessTree -LauncherPid $launcher.Id -ListenerPid $listenerPid
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
