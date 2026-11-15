param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("start", "stop", "status")]
    [string]$Mode,
    [int]$PreferredPort = 0,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot "editor_server_ports.ps1")
. (Join-Path $PSScriptRoot "editor_server_processes.ps1")
. (Join-Path $PSScriptRoot "editor_server_state.ps1")
$RepoRoot = Split-Path -Parent $PSScriptRoot
$UiDir = Join-Path $RepoRoot "arranger-ui"
$ServerJs = Join-Path $RepoRoot "server\server.js"
$Standalone = Test-Path -LiteralPath $ServerJs -PathType Leaf
$StateDir = Join-Path $RepoRoot "artifacts\arranger"
$PidFile = Join-Path $StateDir "editor-server.pid"
$PortFile = Join-Path $StateDir "editor-server.port"
$StartupLog = Join-Path $StateDir "editor-startup.log"
$StdoutLog = Join-Path $StateDir "editor-server.stdout.log"
$StderrLog = Join-Path $StateDir "editor-server.stderr.log"

function Get-EditorHealth([int]$Port) {
    $script:healthStatus = $null
    try {
        $request = [Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/api/health")
        $request.Proxy = $null
        $request.Timeout = 2000
        $request.ReadWriteTimeout = 2000
        $response = $request.GetResponse()
        try {
            $reader = [IO.StreamReader]::new($response.GetResponseStream())
            try { return $reader.ReadToEnd() | ConvertFrom-Json }
            finally { $reader.Dispose() }
        } finally { $response.Dispose() }
    } catch {
        $script:healthFailure = $_.Exception.Message
        $cause = $_.Exception.GetBaseException()
        if ($cause -is [Net.WebException] -and $cause.Response -is [Net.HttpWebResponse]) {
            $script:healthStatus = [int]$cause.Response.StatusCode
            $cause.Response.Dispose()
        }
        return $null
    }
}

function Test-EditorProcess([int]$ProcessId) {
    try {
        $info = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
        if ($null -eq $info -or $info.Name -ne "node.exe" -or -not $info.CommandLine) { return $false }
        $expected = if ($Standalone) { $ServerJs } else { Join-Path $UiDir "node_modules\next" }
        return $info.CommandLine.IndexOf($expected, [StringComparison]::OrdinalIgnoreCase) -ge 0
    } catch { return $false }
}

function Open-Editor([int]$Port) {
    $url = "http://127.0.0.1:$Port/?resume=1"
    if (-not $NoBrowser) {
        try { Start-Process $url }
        catch { Write-Host "[BROWSER_OPEN_FAILED] 请手动打开 $url" }
    }
    Write-Host "Cube Chart Editor is ready at $url"
}

$guard = $null
try {
    if ($Mode -eq "start") {
        try { [void][IO.Directory]::CreateDirectory($StateDir) }
        catch { throw "[START_DIR_NOT_WRITABLE] 无法写入安装目录。请将编辑器解压到可写的本地文件夹。" }
    }
    if (-not (Test-Path -LiteralPath $StateDir -PathType Container)) {
        if ($Mode -eq "status") { Write-Output "STOPPED" }
        exit 0
    }
    if ($Mode -ne "status") {
        $lockPath = Join-Path $StateDir "editor-server.lock"
        for ($attempt = 0; $attempt -lt 120 -and -not $guard; $attempt++) {
            try { $guard = [IO.File]::Open($lockPath, "OpenOrCreate", "ReadWrite", "None") }
            catch [UnauthorizedAccessException] { throw "[START_DIR_NOT_WRITABLE] 安装目录不可写，请完整解压到可写目录。" }
            catch [IO.IOException] { Start-Sleep -Seconds 1 }
        }
        if (-not $guard) { throw "[START_LOCKED] 另一个启动或停止操作正在进行。" }
    }

    $recordedId = 0
    if (Test-Path -LiteralPath $PidFile -PathType Leaf) {
        [void][int]::TryParse((Get-Content -LiteralPath $PidFile -Raw).Trim(), [ref]$recordedId)
    }
    $recordedPort = Get-RecordedEditorPort -Path $PortFile -DefaultPort 3000
    $existing = $recordedId -gt 0 -and (Test-EditorProcess $recordedId) -and (Get-EditorHealth $recordedPort).pid -eq $recordedId
    if ($Mode -eq "status") {
        if ($existing) { Write-Output "RUNNING" } else { Write-Output "STOPPED" }
        exit 0
    }
    if ($Mode -eq "stop") {
        if ($existing) { Stop-Process -Id $recordedId -Force -ErrorAction Stop }
        Remove-EditorServerState -PidPath $PidFile -PortPath $PortFile
        exit 0
    }
    if ($existing) { Open-Editor $recordedPort; exit 0 }
    if ($recordedId) { Add-Content -LiteralPath $StartupLog -Value "[STALE_SERVER_STATE] Ignoring PID $recordedId port $recordedPort." }
    Remove-EditorServerState -PidPath $PidFile -PortPath $PortFile

    $bin = Join-Path $RepoRoot "bin"
    $python = Join-Path $bin "python"
    $pathNode = (Get-Command "node.exe" -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    $bundledNode = Join-Path $bin "node.exe"
    $nodes = if ($Standalone -and $env:ARRANGER_USE_SYSTEM_RUNTIME -ne "1") { @($bundledNode, $pathNode) } else { @($pathNode) }
    $node = $null
    foreach ($candidate in $nodes) {
        if (-not $candidate -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        try {
            $output = @(& $candidate --version 2>&1)
            $exit = $LASTEXITCODE
            $version = ([string]$output[0]).TrimStart('v')
            if ($exit -eq 0 -and [version]$version -ge [version]"20.9.0") {
                $node = $candidate
                break
            }
        } catch { Add-Content -LiteralPath $StartupLog -Value "[NODE_PROBE_FAILED] $($_.Exception.Message)" }
    }
    if (-not $node) { throw "[NODE_RUNTIME_UNAVAILABLE] 需要可运行的 Node.js 20.9.0 或更高版本。请完整解压免安装包或检查系统 PATH。" }

    if (-not $Standalone) {
        if (-not (Test-Path -LiteralPath $UiDir -PathType Container)) {
            throw "[SERVER_ENTRY_MISSING] 未找到 server/server.js 或 arranger-ui，请完整解压。"
        }
        $npm = Get-Command "npm.cmd" -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $npm) { throw "[NPM_UNAVAILABLE] 源码启动需要系统 PATH 中的 npm。" }
        if (-not (Test-Path -LiteralPath (Join-Path $UiDir "node_modules\next") -PathType Container)) {
            Push-Location -LiteralPath $UiDir
            try {
                & $npm.Source install --no-audit --no-fund *> $StdoutLog
                if ($LASTEXITCODE -ne 0) { throw "[NPM_INSTALL_FAILED] 依赖安装失败，请查看启动日志。" }
            } finally { Pop-Location }
        }
    }

    $candidates = @(Get-EditorPortCandidates | Where-Object { $_ -ne 3000 }) + @(3000)
    if ($PreferredPort -ge 1 -and $PreferredPort -le 65535) {
        $candidates = @($PreferredPort) + @($candidates | Where-Object { $_ -ne $PreferredPort })
    }
    $env:HOSTNAME = "0.0.0.0"
    if ($Standalone -and $env:ARRANGER_USE_SYSTEM_RUNTIME -ne "1") {
        $env:PATH = "$bin;$python;$env:PATH"
    }
    if ($Standalone) {
        $env:NODE_ENV = "production"
        $entry = $ServerJs
        $working = Split-Path -Parent $ServerJs
    } else {
        $entry = Join-Path $UiDir "node_modules\next\dist\bin\next"
        $working = $UiDir
    }
    foreach ($port in $candidates) {
        if (-not (Test-EditorPortBindable -Port $port)) { continue }
        $env:PORT = "$port"
        $arguments = '"' + $entry + '"'
        if (-not $Standalone) { $arguments += " dev --webpack --port $port" }
        Add-Content -LiteralPath $StartupLog -Value "[STARTING] Port $port; Node $version"
        $launcher = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $working -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog -WindowStyle Hidden -PassThru
        $deadline = [DateTime]::UtcNow.AddSeconds(120)
        $lastHealth = ""
        $otherService = $false
        while ([DateTime]::UtcNow -lt $deadline -and -not $launcher.HasExited) {
            $health = Get-EditorHealth $port
            if ($health.ok -and ($health.pid -eq $launcher.Id -or (-not $Standalone -and (Test-EditorProcess $health.pid)))) {
                Set-EditorServerState -PidPath $PidFile -PortPath $PortFile -ProcessId $health.pid -Port $port
                Add-Content -LiteralPath $StartupLog -Value "[READY] Port $port; PID $($health.pid); Version $($health.version)"
                Open-Editor $port
                exit 0
            }
            $healthDetail = if ($health) { "Expected PID $($launcher.Id); received PID $($health.pid)" } else { $script:healthFailure }
            if ($healthDetail -and $healthDetail -ne $lastHealth) {
                Add-Content -LiteralPath $StartupLog -Value "[START_PROBE] $healthDetail"
                $lastHealth = $healthDetail
            }
            if ($Standalone -and ($health -or $script:healthStatus -eq 404)) {
                $otherService = $true
                break
            }
            Start-Sleep -Milliseconds 500
        }
        if ($otherService) {
            Stop-EditorProcessTree -LauncherPid $launcher.Id
            Add-Content -LiteralPath $StartupLog -Value "[START_PORT_WRONG_SERVICE] Skipping port $port."
            continue
        }
        if ($launcher.HasExited) { throw "[SERVER_EXITED] 编辑器服务启动失败，退出码 $($launcher.ExitCode)。" }
        Stop-EditorProcessTree -LauncherPid $launcher.Id
        throw "[SERVER_START_TIMEOUT] 编辑器服务在 120 秒内未就绪。"
    }
    throw "[START_NO_PORT] 无法使用 3210 至 3299 或 3000 端口。"
} catch {
    $message = $_.Exception.Message
    try { Add-Content -LiteralPath $StartupLog -Value $message } catch {}
    [Console]::Error.WriteLine("$message`r`n日志目录：$StateDir")
    exit 1
} finally {
    if ($guard) { $guard.Dispose() }
}
