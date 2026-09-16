@echo off
@chcp 65001 >nul 2>&1
setlocal enableextensions
title 舞立方谱面编辑器
cd /d "%~dp0"

if exist "启动编辑器.exe" (
    start "" "启动编辑器.exe"
    exit /b 0
)

echo 正在启动舞立方谱面编辑器...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\editor_server.ps1" -Mode start
set "_RC=%errorlevel%"

echo.
if "%_RC%"=="0" (
    echo [OK] 编辑器已在后台静默运行，并在浏览器中打开。
    echo 本终端窗口将在 2 秒后自动关闭（服务继续在后台保持运行）。
    timeout /t 2 /nobreak >nul 2>&1
    exit /b 0
) else (
    echo [FAILED] 启动失败，退出码 %_RC%。
    echo 常见原因：未安装 Node.js / 端口冲突 / 依赖环境缺失。
    echo 请查看上方错误输出。
    pause
)
endlocal
