function Test-EditorListenerConnection {
    param($Connection)
    return (
        $null -ne $Connection -and
        $Connection.OwningProcess -gt 0 -and
        (
            $Connection.State -eq "Listen" -or
            ($null -eq $Connection.State -and $Connection.RemotePort -eq 0)
        )
    )
}

function Get-EditorListeningPorts {
    param([int]$Port = 0)

    # Node 26 listeners are missing from GetActiveTcpListeners() and expose a
    # null State in Get-NetTCPConnection, so read the TCP table directly.
    # Each Get-NetTCPConnection call costs about a second, so port scans take
    # one snapshot instead of querying every candidate.
    $ports = New-Object 'System.Collections.Generic.HashSet[int]'
    try {
        $connections = if ($Port -gt 0) {
            Get-NetTCPConnection -LocalPort $Port -ErrorAction Stop
        } else {
            Get-NetTCPConnection -ErrorAction Stop
        }
        foreach ($connection in $connections) {
            if (Test-EditorListenerConnection $connection) { [void]$ports.Add([int]$connection.LocalPort) }
        }
    } catch {
        # No matching socket; the bindability probe still runs.
    }
    try {
        $properties = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties()
        foreach ($endpoint in $properties.GetActiveTcpListeners()) {
            [void]$ports.Add($endpoint.Port)
        }
    } catch {
        # The exclusive bind still checks availability if listener enumeration fails.
    }
    return ,$ports
}

function Test-EditorPortBindable {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateRange(1, 65535)]
        [int]$Port,

        # Snapshot from Get-EditorListeningPorts; omitted means query this port only.
        [System.Collections.Generic.HashSet[int]]$ListeningPorts = $null
    )

    if ($null -eq $ListeningPorts) { $ListeningPorts = Get-EditorListeningPorts -Port $Port }
    if ($ListeningPorts.Contains($Port)) { return $false }

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

    $listening = Get-EditorListeningPorts
    foreach ($candidate in $Candidates) {
        if (Test-EditorPortBindable -Port $candidate -ListeningPorts $listening) {
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
