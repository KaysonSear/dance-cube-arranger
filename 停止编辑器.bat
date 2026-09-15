@echo off
setlocal enableextensions
title 停止舞立方谱面编辑器
cd /d "%~dp0"

if exist "停止编辑器.exe" (
    start "" /wait "停止编辑器.exe"
    exit /b 0
)

echo 正在停止舞立方谱面编辑器...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\editor_server.ps1" -Mode stop
set "_RC=%errorlevel%"

echo.
if "%_RC%"=="0" (
  echo [OK] 服务已成功停止并释放端口。
) else (
  echo [FAILED] 退出码 %_RC%。服务可能未在运行或状态文件缺失。
)
echo.
timeout /t 2 /nobreak >nul 2>&1
exit /b 0
