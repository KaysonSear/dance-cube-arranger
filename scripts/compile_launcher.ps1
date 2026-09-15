param(
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = $RepoRoot
}

$CscPaths = @(
    "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)

$csc = $null
foreach ($p in $CscPaths) {
    if (Test-Path -LiteralPath $p) {
        $csc = $p
        break
    }
}

if ($null -eq $csc) {
    throw "未找到系统内置的 C# 编译器 csc.exe。"
}

$LauncherSrc = Join-Path $PSScriptRoot "launcher\Launcher.cs"
$StopperSrc = Join-Path $PSScriptRoot "launcher\Stopper.cs"

$LauncherOut = Join-Path $OutDir "启动编辑器.exe"
$StopperOut = Join-Path $OutDir "停止编辑器.exe"

Write-Host "使用系统 C# 编译器: $csc"
Write-Host "编译启动器 -> $LauncherOut"
& $csc /nologo /target:winexe /optimize+ "/out:$LauncherOut" /reference:System.Windows.Forms.dll,System.dll,System.Drawing.dll "$LauncherSrc"
if ($LASTEXITCODE -ne 0) {
    throw "启动器编译失败，退出码 $LASTEXITCODE"
}

Write-Host "编译停止器 -> $StopperOut"
& $csc /nologo /target:winexe /optimize+ "/out:$StopperOut" /reference:System.Windows.Forms.dll,System.dll "$StopperSrc"
if ($LASTEXITCODE -ne 0) {
    throw "停止器编译失败，退出码 $LASTEXITCODE"
}

Write-Host "[OK] 原生可执行文件编译成功！"
