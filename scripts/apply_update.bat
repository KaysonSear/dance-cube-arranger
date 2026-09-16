@echo off
setlocal enableextensions enabledelayedexpansion
title Dance Cube Arranger Auto Updater
chcp 65001 >nul 2>&1

:: 参数: %1 = 临时解压后的新版本目录, %2 = 目标程序安装根目录
set "SRC_DIR=%~1"
set "DEST_DIR=%~2"

if "%SRC_DIR%"=="" (
    echo [ERROR] 缺少源目录参数
    exit /b 1
)
if "%DEST_DIR%"=="" (
    echo [ERROR] 缺少目标目录参数
    exit /b 1
)

:: 1. 检查新版本是否包含子文件夹（例如 zip 内第一层是 dance-cube-arranger）
if exist "%SRC_DIR%\dance-cube-arranger\server" (
    set "SRC_DIR=%SRC_DIR%\dance-cube-arranger"
)

:: 2. 等待旧的 Node.js 进程完全退出并释放文件句柄 (等待 2 秒)
echo [1/4] 等待旧服务完全释放文件占用...
timeout /t 2 /nobreak >nul

:: 3. 覆盖文件：强制排除 artifacts 目录，保护用户所有工程、快照与数据
echo [2/4] 正在安全覆盖更新文件 (保护 artifacts 目录)...
robocopy "%SRC_DIR%" "%DEST_DIR%" /E /XD "%SRC_DIR%\artifacts" /XF "*.pid" "*.port" "editor-server.*.log" /R:3 /W:1 /NJH /NJS /NDL /NC /NS >nul 2>&1
set "ROBO_RC=%errorlevel%"

:: robocopy 退出码 0-7 均代表成功 (0:无变更, 1:复制成功, 2:多余文件已清理, 3:复制并更新成功)
if %ROBO_RC% GEQ 8 (
    echo [WARNING] robocopy 退出码 %ROBO_RC%，尝试 xcopy 容错覆盖...
    xcopy "%SRC_DIR%\*" "%DEST_DIR%\" /E /Y /Q /EXCLUDE:%~dp0xcopy_exclude.txt >nul 2>&1
)

:: 4. 重新拉起启动编辑器
echo [3/4] 正在重新启动舞立方编辑器...
if exist "%DEST_DIR%\启动编辑器.exe" (
    start "" "%DEST_DIR%\启动编辑器.exe"
) else if exist "%DEST_DIR%\启动编辑器.bat" (
    start "" "%DEST_DIR%\启动编辑器.bat"
)

:: 5. 延迟 3 秒后清理临时更新文件夹
echo [4/4] 清理更新临时文件...
timeout /t 3 /nobreak >nul
if exist "%~1" (
    rmdir /s /q "%~1" >nul 2>&1
)

echo [OK] 更新完成！
exit 0
