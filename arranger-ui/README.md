# 舞立方排键编辑器

本项目的人工排键、结构编辑与谱面导入导出工具，基于Next.js 16。
它承载人工修改和反馈，不是可丢弃的实验输出。

从仓库根目录运行 `启动排键器.bat`，关闭用 `停止排键器.bat`。
或在本目录执行 `npm run dev`；端口和已有服务管理以启动脚本为准。
使用npm与package-lock，不混用yarn/pnpm/bun。

```powershell
npm test
npm run lint
npm run build
```

build同时检查TypeScript。当前基线234 passed、1 skipped，lint/build成功。
项目用 `?src=<仓库相对.mc路径>` 寻址；一曲可以包含多个谱面。
保留自动保存、快照和`.orig`备份；WDA写回由服务器白名单控制。
空白谱面允许导入音频后逐步编辑，不因音符列表为空而拒绝导出。

修改前阅读[本目录AGENTS](AGENTS.md)、[规格](spec.md)与[根操作约束](../AGENTS.md)。
项目现状、研究路线及反馈证据从[根README](../README.md)进入。
