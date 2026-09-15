param(
    [switch]$SkipBuild = $false,
    [switch]$Zip = $false
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$UiDir = Join-Path $RepoRoot "arranger-ui"
$DistRoot = Join-Path $RepoRoot "dist"
$PackageDir = Join-Path $DistRoot "dance-cube-arranger"

Write-Host "================================================="
Write-Host " 舞立方谱面编辑器 (Dance Cube Arranger) 打包工具"
Write-Host " 版本: 260915 | 方案 A: 绿色解压便携版"
Write-Host "================================================="

# 1. 运行 Next.js 生产环境构建
if (-not $SkipBuild) {
    Write-Host "`n[1/5] 正在执行 Next.js 生产构建 (npm run build)..."
    Push-Location $UiDir
    try {
        & npm run build
        if ($LASTEXITCODE -ne 0) {
            throw "npm run build 失败，退出码: $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "`n[1/5] 跳过 Next.js 构建，直接使用现有 .next 产物..."
}

# 2. 准备输出目录
Write-Host "`n[2/5] 清理并创建发布目录: $PackageDir"
if (Test-Path -LiteralPath $PackageDir) {
    $ResolvedPackage = (Resolve-Path -LiteralPath $PackageDir).Path
    $ExpectedPackage = [IO.Path]::GetFullPath((Join-Path $DistRoot "dance-cube-arranger"))
    if ($ResolvedPackage -ne $ExpectedPackage) { throw "发布目录越界，拒绝清理: $ResolvedPackage" }
    Remove-Item -LiteralPath $PackageDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $PackageDir | Out-Null

$ServerDir = Join-Path $PackageDir "server"
New-Item -ItemType Directory -Force -Path $ServerDir | Out-Null

# 3. 复制 Standalone 运行时与静态资源
Write-Host "`n[3/5] 复制 Standalone 服务端与静态资源..."
$StandaloneDir = Join-Path $UiDir ".next\standalone"
if (-not (Test-Path -LiteralPath $StandaloneDir)) {
    throw "未找到 Standalone 产物目录: $StandaloneDir"
}

# Next.js standalone 通常包含 package.json / server.js / node_modules 等
# 如果 standalone 下嵌套了 arranger-ui 目录，提取其内容
$NestedDir = Join-Path $StandaloneDir "arranger-ui"
$SourceBase = if (Test-Path -LiteralPath $NestedDir) { $NestedDir } else { $StandaloneDir }

Copy-Item -Path (Join-Path $SourceBase "*") -Destination $ServerDir -Recurse -Force

# 复制 .next/static 到 server/.next/static
$StaticSrc = Join-Path $UiDir ".next\static"
$StaticDest = Join-Path $ServerDir ".next\static"
if (Test-Path -LiteralPath $StaticSrc) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $StaticDest) | Out-Null
    Copy-Item -Path $StaticSrc -Destination $StaticDest -Recurse -Force
}

# 复制 public 到 server/public
$PublicSrc = Join-Path $UiDir "public"
$PublicDest = Join-Path $ServerDir "public"
if (Test-Path -LiteralPath $PublicSrc) {
    Copy-Item -Path $PublicSrc -Destination $PublicDest -Recurse -Force
}

# 4. 复制配置、脚本与工程素材
Write-Host "`n[4/5] 复制依赖项 (configs, scripts, WDA 示例素材)..."
Copy-Item -Path (Join-Path $RepoRoot "configs") -Destination (Join-Path $PackageDir "configs") -Recurse -Force
Copy-Item -Path (Join-Path $RepoRoot "scripts") -Destination (Join-Path $PackageDir "scripts") -Recurse -Force
Copy-Item -Path (Join-Path $RepoRoot "WDA") -Destination (Join-Path $PackageDir "WDA") -Recurse -Force

# 创建持久化数据目录 artifacts/arranger
$ArtifactsDir = Join-Path $PackageDir "artifacts\arranger"
New-Item -ItemType Directory -Force -Path $ArtifactsDir | Out-Null

# 创建 bin 目录并自动装配 100% 零依赖便携运行环境
$BinDir = Join-Path $PackageDir "bin"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

Write-Host "`n[4.5/5] 装配 100% 零依赖便携环境 (Node.js / ffmpeg / Python)..."

# 1. 复制 Node.js 运行时
$NodeDest = Join-Path $BinDir "node.exe"
$NodeCandidate = @(
    "C:\nvm4w\nodejs\node.exe",
    (Get-Command "node.exe" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
) | Where-Object { $_ -and (Test-Path $_ -PathType Leaf) } | Select-Object -First 1

if ($NodeCandidate) {
    Write-Host "  -> 复制便携 Node.js: $NodeCandidate -> bin\node.exe"
    Copy-Item -Path $NodeCandidate -Destination $NodeDest -Force
} else {
    Write-Warning "未找到本地 node.exe，跳过内置 Node.js 运行时。"
}

# 2. 复制 ffmpeg 与 ffprobe
$FfmpegCandidate = @(
    "C:\Users\kayso\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1-full_build\bin\ffmpeg.exe",
    "C:\Users\kayso\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe",
    (Get-Command "ffmpeg.exe" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
) | Where-Object { $_ -and (Test-Path $_ -PathType Leaf) } | Select-Object -First 1

$FfprobeCandidate = @(
    "C:\Users\kayso\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1-full_build\bin\ffprobe.exe",
    "C:\Users\kayso\AppData\Local\Microsoft\WinGet\Links\ffprobe.exe",
    (Get-Command "ffprobe.exe" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
) | Where-Object { $_ -and (Test-Path $_ -PathType Leaf) } | Select-Object -First 1

if ($FfmpegCandidate) {
    $item = Get-Item -LiteralPath $FfmpegCandidate
    $resolvedFfmpeg = if ($item.LinkType -and $item.Target) { $item.Target } else { $item.FullName }
    Write-Host "  -> 复制 ffmpeg: $resolvedFfmpeg -> bin\ffmpeg.exe"
    Copy-Item -LiteralPath $resolvedFfmpeg -Destination (Join-Path $BinDir "ffmpeg.exe") -Force
}
if ($FfprobeCandidate) {
    $item = Get-Item -LiteralPath $FfprobeCandidate
    $resolvedFfprobe = if ($item.LinkType -and $item.Target) { $item.Target } else { $item.FullName }
    Write-Host "  -> 复制 ffprobe: $resolvedFfprobe -> bin\ffprobe.exe"
    Copy-Item -LiteralPath $resolvedFfprobe -Destination (Join-Path $BinDir "ffprobe.exe") -Force
}

# 3. 准备并配置 Windows 官方 Embeddable Python
$PyDestDir = Join-Path $BinDir "python"
New-Item -ItemType Directory -Force -Path $PyDestDir | Out-Null
$CacheDir = Join-Path $DistRoot ".cache"
New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
$PyZip = Join-Path $CacheDir "python-3.12.8-embed-amd64.zip"

if (-not (Test-Path $PyZip -PathType Leaf)) {
    Write-Host "  -> 下载官方 Embeddable Python 3.12 (约 11MB)..."
    $pyUrl = "https://www.python.org/ftp/python/3.12.8/python-3.12.8-embed-amd64.zip"
    & curl.exe -s -L $pyUrl -o $PyZip
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $PyZip)) {
        throw "Python 运行时下载失败！"
    }
}
Write-Host "  -> 解压 Embeddable Python 到: bin\python"
Expand-Archive -Path $PyZip -DestinationPath $PyDestDir -Force

$PthFile = Join-Path $PyDestDir "python312._pth"
if (Test-Path $PthFile) {
    $pthContent = Get-Content $PthFile -Raw
    if ($pthContent -notmatch "import site") {
        $pthContent += "`r`nimport site`r`n"
    } else {
        $pthContent = $pthContent -replace "#import site", "import site"
    }
    Set-Content -Path $PthFile -Value $pthContent -Encoding UTF8
}

$BinReadme = @"
[Dance Cube Arranger 便携二进制目录]

本目录已内置 100% 独立运行所需的全套自包含便携环境：
1. node.exe - 便携独立 Node.js 运行时，提供 Next.js 服务端引擎；
2. ffmpeg.exe / ffprobe.exe - 静态编译版多媒体转码与流分析工具；
3. python/ - 官方轻量 Embeddable Python 运行时，驱动谱面导入与导出脚本。

启动器在启动时会自动将本目录加入 PATH 与环境变量，无需用户电脑预先安装任何依赖。
"@
Set-Content -Path (Join-Path $BinDir "README.txt") -Value $BinReadme -Encoding UTF8

# 复制 README 与批处理脚本
Copy-Item -Path (Join-Path $RepoRoot "README.md") -Destination (Join-Path $PackageDir "README.md") -Force
Copy-Item -Path (Join-Path $RepoRoot "启动编辑器.bat") -Destination (Join-Path $PackageDir "启动编辑器.bat") -Force
Copy-Item -Path (Join-Path $RepoRoot "停止编辑器.bat") -Destination (Join-Path $PackageDir "停止编辑器.bat") -Force

# 5. 编译原生 .exe 启动器与停止器
Write-Host "`n[5/5] 编译原生 Windows 启动器 (启动编辑器.exe / 停止编辑器.exe)..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "compile_launcher.ps1") -OutDir $PackageDir
if ($LASTEXITCODE -ne 0) {
    throw "启动器编译失败！"
}

# 创建版本标识文件
$VersionInfo = @"
舞立方谱面编辑器 (Dance Cube Arranger)
版本: 260915
打包时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
运行模式: Standalone 独立绿色便携版
"@
Set-Content -Path (Join-Path $PackageDir "VERSION.txt") -Value $VersionInfo -Encoding UTF8

Write-Host "`n================================================="
Write-Host " 打包成功！绿色版位于: $PackageDir"
Write-Host " 启动方式: 双击 $PackageDir\启动编辑器.exe 或 启动编辑器.bat"
Write-Host "================================================="

if ($Zip) {
    $ZipPath = Join-Path $DistRoot "dance-cube-arranger-portable-260915.zip"
    Write-Host "`n正在创建便携压缩包: $ZipPath ..."
    & (Join-Path $PSScriptRoot "create_portable_zip.ps1") -PackageDir $PackageDir -ZipPath $ZipPath
}
