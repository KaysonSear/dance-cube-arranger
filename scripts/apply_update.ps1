$ErrorActionPreference = "Stop"
$job = Get-Content -LiteralPath $env:ARRANGER_UPDATE_JOB -Raw -Encoding UTF8 | ConvertFrom-Json
$root = [IO.Path]::GetFullPath($job.root).TrimEnd('\')
$tempRoot = [IO.Path]::GetFullPath($job.tempDir).TrimEnd('\')
$source = [IO.Path]::GetFullPath($job.source).TrimEnd('\')
if ($source -ne (Join-Path $tempRoot 'unpacked\dance-cube-arranger')) { throw 'Unexpected update source' }
$stateDir = Join-Path $root "artifacts\arranger"
$log = Join-Path $stateDir "editor-update.log"
$status = Join-Path $stateDir "editor-update.status.json"
$psExe = Join-Path ([Environment]::SystemDirectory) "WindowsPowerShell\v1.0\powershell.exe"
$launcher = Join-Path $root "scripts\editor_server.ps1"
$backup = Join-Path $tempRoot "backup"
$changed = New-Object System.Collections.Generic.List[object]
$previousExited = $false
$started = $false

function Write-UpdateLog([string]$Message) {
    Add-Content -LiteralPath $log -Value "[$($job.diagnosticId)] $Message" -Encoding UTF8
}

function Set-UpdateError([string]$Code, [string]$Message) {
    $json = @{ stage="error"; percent=0; message="自动更新失败"; code=$Code; error=$Message; diagnosticId=$job.diagnosticId } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($status, $json, [Text.UTF8Encoding]::new($false))
}

$checkedPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
function Assert-Regular([string]$Path, [string]$Parent) {
    for ($cursor = $Path; $cursor -and $cursor -ne $Parent; $cursor = [IO.Path]::GetDirectoryName($cursor)) {
        if (-not $checkedPaths.Add($cursor)) { break }
        try { $attributes = [IO.File]::GetAttributes($cursor) }
        catch [IO.FileNotFoundException] { continue }
        catch [IO.DirectoryNotFoundException] { continue }
        if ($attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse point in update path: $cursor" }
    }
}

function Invoke-Editor([string]$Mode) {
    $stdout = Join-Path $tempRoot "launcher-$Mode.stdout"
    $stderr = Join-Path $tempRoot "launcher-$Mode.stderr"
    $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $launcher +
        '" -Mode ' + $Mode + ' -PreferredPort ' + [int]$job.port + ' -NoBrowser'
    # Redirect to files so the detached server cannot keep the worker's pipeline open.
    $process = Start-Process -FilePath $psExe -ArgumentList $arguments -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    try {
        $null = $process.Handle
        if (-not $process.WaitForExit(180000)) {
            $process.Kill()
            throw "Editor $Mode did not finish"
        }
        $exitCode = $process.ExitCode
        foreach ($file in @($stdout, $stderr)) {
            Get-Content -LiteralPath $file -Encoding UTF8 | ForEach-Object { Write-UpdateLog $_ }
        }
        return $exitCode
    } finally { $process.Dispose() }
}

try {
    $files = @(Get-ChildItem -LiteralPath $source -File -Recurse -Force | Where-Object {
        $_.FullName.Substring($source.Length + 1) -match '^(server|scripts|configs|bin|WDA)\\|^(README\.md|VERSION\.txt|启动编辑器\.(exe|bat)|停止编辑器\.(exe|bat))$'
    })
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($source.Length + 1)
        Assert-Regular $file.FullName $source
        $destination = Join-Path $root $relative
        Assert-Regular $destination $root
        if (Test-Path -LiteralPath $destination -PathType Container) { throw "A directory conflicts with $relative" }
    }
    Write-UpdateLog "Ready to apply $($job.version)"
    if (Test-Path -LiteralPath $status) { Remove-Item -LiteralPath $status -Force }
    [IO.File]::WriteAllText((Join-Path $tempRoot "accepted"), "")
    $previous = Get-Process -Id ([int]$job.pid) -ErrorAction SilentlyContinue
    if ($previous -and -not $previous.WaitForExit(30000)) { throw 'Previous editor failed to exit' }
    $previousExited = $true

    foreach ($file in $files) {
        $relative = $file.FullName.Substring($source.Length + 1)
        $destination = Join-Path $root $relative
        $saved = $null
        if (Test-Path -LiteralPath $destination -PathType Leaf) {
            $saved = Join-Path $backup $relative
            [void][IO.Directory]::CreateDirectory((Split-Path -Parent $saved))
            [IO.File]::Copy($destination, $saved)
        }
        $parent = Split-Path -Parent $destination
        [void][IO.Directory]::CreateDirectory($parent)
        $staged = Join-Path $parent (".dca-update-" + [Guid]::NewGuid().ToString("N") + ".tmp")
        try {
            [IO.File]::Copy($file.FullName, $staged)
            if ($saved) { [IO.File]::Replace($staged, $destination, [NullString]::Value) }
            else { [IO.File]::Move($staged, $destination) }
            $changed.Add(@{ Path=$destination; Saved=$saved })
        } finally {
            if (Test-Path -LiteralPath $staged -PathType Leaf) { Remove-Item -LiteralPath $staged -Force }
        }
    }

    $started = $true
    if ((Invoke-Editor "start") -ne 0) { throw 'Updated editor failed to start' }
    $activePort = [int](Get-Content -LiteralPath (Join-Path $stateDir "editor-server.port") -Raw)
    $health = (Invoke-WebRequest -Uri "http://127.0.0.1:$activePort/api/health" -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json
    if ($health.version -ne $job.version) { throw 'Updated editor reported an unexpected version' }
    Write-UpdateLog "Applied $($job.version) on port $activePort"
    if ($activePort -ne $job.port) { Start-Process "http://127.0.0.1:$activePort/?resume=1" }
} catch {
    Write-UpdateLog "Apply failed: $($_.Exception.Message)"
    if ($started) { [void](Invoke-Editor "stop") }
    $rollbackFailed = $false
    for ($i = $changed.Count - 1; $i -ge 0; $i--) {
        $entry = $changed[$i]
        try {
            if ($entry.Saved) { [IO.File]::Copy($entry.Saved, $entry.Path, $true) }
            elseif (Test-Path -LiteralPath $entry.Path -PathType Leaf) { Remove-Item -LiteralPath $entry.Path -Force }
        } catch { $rollbackFailed = $true; Write-UpdateLog "Rollback failed: $($_.Exception.Message)" }
    }
    if ($rollbackFailed) {
        Set-UpdateError "UPDATE_ROLLBACK_FAILED" "无法完整恢复程序文件，请查看 editor-update.log 并手动更新。"
        Write-UpdateLog "Backup retained at $backup"
        exit 1
    }
    Set-UpdateError "UPDATE_APPLY_FAILED" "更新未完成，已保留或恢复原版。请查看 editor-update.log。"
    if ($previousExited) { [void](Invoke-Editor "start") }
    exit 1
} finally {
    if (-not $rollbackFailed -and
        (Split-Path -Parent $tempRoot) -eq [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') -and
        (Split-Path -Leaf $tempRoot) -like "dca-update-*") {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
