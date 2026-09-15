param(
    [Parameter(Mandatory = $true)][string]$PackageDir,
    [Parameter(Mandatory = $true)][string]$ZipPath
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$PackageDir = (Resolve-Path -LiteralPath $PackageDir).Path
$ZipPath = [IO.Path]::GetFullPath($ZipPath)
$HintPath = Join-Path $PSScriptRoot "解压此文件夹.txt"
if (-not (Test-Path -LiteralPath $HintPath -PathType Leaf)) {
    throw "未找到解压提示: $HintPath"
}
if ($ZipPath.StartsWith($PackageDir.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "压缩包必须位于项目文件夹之外"
}
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($ZipPath)) | Out-Null
$TempZip = $ZipPath + "." + [guid]::NewGuid().ToString("N") + ".tmp"
try {
    # Include the project folder itself, hidden .next files and empty data folders.
    [IO.Compression.ZipFile]::CreateFromDirectory(
        $PackageDir, $TempZip, [IO.Compression.CompressionLevel]::Optimal, $true
    )
    $Archive = [IO.Compression.ZipFile]::Open($TempZip, [IO.Compression.ZipArchiveMode]::Update)
    try {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $Archive, $HintPath, "解压此文件夹.txt", [IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    } finally {
        $Archive.Dispose()
    }
    Move-Item -LiteralPath $TempZip -Destination $ZipPath -Force
} finally {
    if (Test-Path -LiteralPath $TempZip) {
        Remove-Item -LiteralPath $TempZip -Force
    }
}
Write-Host "已生成便携压缩包: $ZipPath"
