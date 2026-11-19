# Shared with Launcher.cs: normalize the project directory, then SHA-256 its UTF-8 bytes.
function Get-EditorStartupMutexName([string]$ProjectRoot) {
    $canonical = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\', '/').ToLowerInvariant()
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $digest = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($canonical))
        return 'Local\DanceCubeArranger.Start.' + ([BitConverter]::ToString($digest).Replace('-', '').ToLowerInvariant())
    } finally {
        $sha.Dispose()
    }
}

function Enter-EditorStartupMutex([System.Threading.Mutex]$Mutex) {
    try {
        return $Mutex.WaitOne(0)
    } catch [System.Threading.AbandonedMutexException] {
        # The previous launcher crashed; this thread now owns the abandoned mutex.
        return $true
    }
}
