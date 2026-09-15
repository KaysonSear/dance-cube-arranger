param(
    [string]$Token = $env:GITHUB_TOKEN,
    [string]$Repo = "KaysonSear/dance-cube-arranger",
    [string]$Tag = "v260915",
    [string]$ZipPath = "dist/dance-cube-arranger-260915.zip"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Token)) {
    throw "缺少 GitHub Token，请通过 -Token 传参或设置 GITHUB_TOKEN 环境变量。"
}

$headers = @{
    "Authorization" = "Bearer $Token"
    "Accept"        = "application/vnd.github.v3+json"
    "User-Agent"    = "Antigravity-Agent"
}

# 1. 检查或创建 Release
$releaseUrl = "https://api.github.com/repos/$Repo/releases"
Write-Host "检查是否存在已发布的 Release ($Tag)..."
$existingRelease = $null
try {
    $existingRelease = Invoke-RestMethod -Method Get -Uri "$releaseUrl/tags/$Tag" -Headers $headers
} catch {
    # 未找到，继续创建
}

$release = $null
if ($existingRelease) {
    Write-Host "已找到现有 Release: ID = $($existingRelease.id)"
    $release = $existingRelease
} else {
    Write-Host "创建新 Release: $Tag ..."
    $bodyObj = @{
        tag_name         = $Tag
        target_commitish = "main"
        name             = "舞立方谱面编辑器 $Tag (绿色免安装版)"
        body             = @"
## 舞立方谱面编辑器 (Dance Cube Arranger) $Tag

### 📦 资产下载说明
- **dance-cube-arranger-260915.zip**：免安装独立绿色便携版。
- **100% 零依赖开箱即用**：压缩包内已完整内置便携 Node.js 运行时、官方 Embeddable Python 3.12 及静态编译版 ffmpeg/ffprobe 工具，解压后双击 `启动编辑器.exe` 或 `启动编辑器.bat` 即可直接运行，无需预装任何开发环境！

### ✨ 主要功能
- 专为 Dance Cube（Malody V 6 键立方体模式）设计的可视化排键编辑器；
- 支持 Tap / Hold / 多押排键、时间轴吸附对齐、区间剪贴板复制粘贴与镜像翻转；
- 智能长条重叠与双手负荷冲突诊断；
- 内置手元键盘模拟器试玩；
- 默认搭载 WDA 示例谱面与媒体素材；
- 支持 Malody V .mcz 整合包一键导入与导出。
"@
        draft            = $false
        prerelease       = $false
    }
    $bodyJson = $bodyObj | ConvertTo-Json -Depth 5
    $release = Invoke-RestMethod -Method Post -Uri $releaseUrl -Headers $headers -Body ([System.Text.Encoding]::UTF8.GetBytes($bodyJson)) -ContentType "application/json; charset=utf-8"
    Write-Host "Release 创建成功: ID = $($release.id), URL = $($release.html_url)"
}

# 2. 检查 Release 中是否已存在同名资产
$assetName = [System.IO.Path]::GetFileName($ZipPath)
$existingAsset = $release.assets | Where-Object { $_.name -eq $assetName }
if ($existingAsset) {
    Write-Host "检测到已存在同名资产 $($existingAsset.name)，正在删除旧资产 (ID: $($existingAsset.id))..."
    Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/$Repo/releases/assets/$($existingAsset.id)" -Headers $headers
}

# 3. 上传 zip 文件
$fullZip = (Resolve-Path $ZipPath).Path
$zipSize = (Get-Item $fullZip).Length
Write-Host "开始上传资产: $assetName ($([math]::Round($zipSize / 1MB, 2)) MB)..."

$uploadUri = "https://uploads.github.com/repos/$Repo/releases/$($release.id)/assets?name=$assetName"
& curl.exe -s -S -X POST `
    -H "Authorization: Bearer $Token" `
    -H "Content-Type: application/zip" `
    -H "Accept: application/vnd.github.v3+json" `
    --data-binary "@$fullZip" `
    $uploadUri

Write-Host "`n[OK] 资产上传完成！"
Write-Host "Release 地址: $($release.html_url)"
