function Stop-EditorProcessTree {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateRange(1, [int]::MaxValue)]
        [int]$LauncherPid,

        [ValidateRange(0, [int]::MaxValue)]
        [int]$ListenerPid = 0
    )

    $processIds = @()
    if ($ListenerPid -gt 0) {
        $processIds += $ListenerPid
    }
    $processIds += $LauncherPid

    foreach ($processId in ($processIds | Select-Object -Unique)) {
        # /T also terminates npm.cmd -> next CLI -> server descendants, so a
        # failed readiness check cannot leave an orphan holding Next's lock.
        try {
            & taskkill.exe /PID $processId /T /F 2>$null | Out-Null
        } catch {
            # Fall back to terminating the single process below.
        }
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
}
