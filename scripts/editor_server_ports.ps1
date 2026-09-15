function Test-EditorPortBindable {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateRange(1, 65535)]
        [int]$Port
    )

    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new(
            [System.Net.IPAddress]::Any,
            $Port
        )
        $listener.Server.ExclusiveAddressUse = $true
        $listener.Start()
        return $true
    } catch [System.Net.Sockets.SocketException] {
        return $false
    } finally {
        if ($null -ne $listener) {
            $listener.Stop()
        }
    }
}

function Get-EditorPortCandidates {
    return @(
        3000
        3210..3299
    )
}

function Find-AvailableEditorPort {
    param(
        [Parameter(Mandatory = $true)]
        [int[]]$Candidates
    )

    foreach ($candidate in $Candidates) {
        if (Test-EditorPortBindable -Port $candidate) {
            return [int]$candidate
        }
    }
    return $null
}

function Get-RecordedEditorPort {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [ValidateRange(1, 65535)]
        [int]$DefaultPort
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $DefaultPort
    }

    try {
        $value = 0
        $text = (Get-Content -LiteralPath $Path -Raw).Trim()
        if (
            [int]::TryParse($text, [ref]$value) -and
            $value -ge 1 -and
            $value -le 65535
        ) {
            return $value
        }
    } catch {
        # Invalid or unreadable state uses the legacy default port.
    }
    return $DefaultPort
}
