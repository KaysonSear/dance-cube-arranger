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
        # Clean up Next CLI descendants on failed starts, too.
        try { & taskkill.exe /PID $processId /T /F 2>$null | Out-Null } catch {}
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
}
