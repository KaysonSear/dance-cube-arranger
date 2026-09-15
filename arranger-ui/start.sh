#!/usr/bin/env bash
# 一键启动排键器(WSL 侧)。由仓库根的「启动排键器.bat」调用,也可直接 ./start.sh 运行。
#
# 做三件傻瓜式的事:
#   1. 已在运行 → 直接复用,不再开第二个(避免端口冲突 / 测到旧代码);
#   2. 首次运行 → 自动 npm install;
#   3. 前台启动 dev server(关闭窗口即停止),drvfs 下开启轮询以保证热更新生效。
set -u

cd "$(dirname "$0")" || exit 1
PORT="${PORT:-3000}"
URL="http://localhost:${PORT}"

echo "舞立方排键器 —— 启动中…"
echo

# 1) 已在运行?复用即可
if curl -s -o /dev/null --max-time 2 "$URL" 2>/dev/null; then
  echo "✅ 服务器已经在运行:${URL}"
  echo "   浏览器会自动打开。若刚改过代码没生效,先双击「停止排键器.bat」再启动。"
  exit 0
fi

# 2) 依赖检查(首次运行自动装)
if [ ! -d node_modules ]; then
  echo "首次运行:正在安装依赖,可能需要几分钟…"
  if ! npm install --no-audit --no-fund; then
    echo
    echo "❌ npm install 失败。请检查网络后重试。"
    exit 1
  fi
  echo
fi

# 3) 前台启动。WATCHPACK_POLLING:仓库在 Windows 盘(drvfs)上,不轮询会热更新失灵。
echo "正在启动开发服务器… 就绪后浏览器会自动打开 ${URL}"
echo "⚠  关闭此窗口 = 停止服务器。"
echo
exec env WATCHPACK_POLLING=true npm run dev
