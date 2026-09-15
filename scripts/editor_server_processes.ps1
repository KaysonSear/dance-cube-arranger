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
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
}
