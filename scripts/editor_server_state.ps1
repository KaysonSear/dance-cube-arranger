function Set-EditorServerState {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PidPath,

        [Parameter(Mandatory = $true)]
        [string]$PortPath,

        [Parameter(Mandatory = $true)]
        [ValidateRange(1, [int]::MaxValue)]
        [int]$ProcessId,

        [Parameter(Mandatory = $true)]
        [ValidateRange(1, 65535)]
        [int]$Port
    )

    Set-Content -LiteralPath $PortPath -Value $Port -Encoding Ascii
    Set-Content -LiteralPath $PidPath -Value $ProcessId -Encoding Ascii
}

function Remove-EditorServerState {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PidPath,

        [Parameter(Mandatory = $true)]
        [string]$PortPath
    )

    foreach ($path in @($PidPath, $PortPath)) {
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath $path -Force -ErrorAction Stop
        }
        if (Test-Path -LiteralPath $path) {
            throw "Failed to remove editor server state file: $path"
        }
    }
}
