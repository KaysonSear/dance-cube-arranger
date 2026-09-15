# arranger-ui — 舞立方排键器规格(spec)

Malody V 舞立方(`mode:9`)谱面的**可视化排键工具**:输入是任意本机位置的 `.mc/.mcz`，
输出统一为逐个采音点指派列/多押/长条后的终态 `.mcz`，不提供裸 `.mc` 导出。一个 `.mcz`
（或一次三件套复制导入）= 一个工程，
工程内可有多张共享音频/封面的 `.mc`；启动页与编辑器侧栏均可展开切谱。技术栈 Next.js(App Router)+
TypeScript + Tailwind v4 + Canvas 2D;测试 vitest。视觉采用 **Claude/Anthropic 设计语言**
(全局浅色羊皮纸,见 §3)。

**一键启动(推荐)**:双击仓库根的 **`启动排键器.bat`** —— 通过原生 PowerShell 自动定位仓库、
检查 Node/npm、开好 dev server 后**自动打开浏览器**;已在运行则复用不重开。
启动器优先使用 3000;若该端口被占用、被 Windows 保留或无权绑定,自动选用 3210–3299 中
第一个可绑定端口并打开实际 URL。也可双击 **`停止排键器.bat`**(只停止由启动器记录的
服务进程与端口,不误伤其它 node)。

命令行方式:
```bash
cd arranger-ui
npm install
./start.sh         # 与 .bat 同一套逻辑(复用/自动装依赖/轮询热更新)
npm run dev        # 或手动:http://localhost:3000(端口冲突:npm run dev -- -p 3210)
npm test           # vitest(src/lib 纯逻辑)
npm run build      # 生产构建 + 全量类型检查
```

必须在工程根目录下启动:服务端向上查找 `configs/column_geometry.json` 定位根目录。
WSL/drvfs 下 HMR 不生效时:`WATCHPACK_POLLING=true npm run dev`。

## 1. 目的与范围

- **做**:多工程(导入/最近列表/URL 定位);采音点选择 → 键位指派(0–5)/ 多押(≤6)/
  长条创建;实机式飞行预览(封面高透明度垫底);时间轴密度条形图;自动保存 + 历史快照;
  新建空白 `.mc`;编辑元信息并导入/替换工程共享音频与封面;统一导出 `.mcz`，支持自定义
  输出目录、包名与包内每张 `.mc` 名。
- **新增采音点**:播放头停在无采音点的细分格上点击键位 → **新建采音点并按点击排键**
  (源采音点不可删;**新增点**清空排键后自动消失)。
- **两点互换排键**:播放头位于采音点 A 时，按 `Alt+C` 标记点 A；移动播放头至其他采音点 B 时，按 `Alt+V`
  互换两点排键(包含长条尾拍依持续时值精确平移，支持单击、双押、长条与未排键互换，`Ctrl+Z` 可撤销；`Esc` 取消标记)。
- **结构 clip**:编辑器内以显式起止时间标记任意数量桥段;无采音点区间允许不属于任何 clip,
  但 clip 不可重叠、全部采音点最终必须恰好归属一次。`I` 记录起点、`O` 以播放头完成区间,
  右击两个 clip 的共用切口可合并相邻桥段。选中 clip 后按 `Ctrl/⌘+M` 水平镜像区间内所有排键(可撤销)。
- **桥段语义**:`Ctrl/⌘+单击`覆盖带多选桥段,按 `R` 快速标记重复;可改为升级、变奏、
  对比或自定义关系,供后续逐段生成复用。每个关系组分配独立颜色，同组 clip 保持同色。
- **一包多谱**:一个导入文件夹 = 一个 `.mcz` 工程,内含多张共享素材的 `.mc`;
  右侧栏可在**包内谱面**与**不同包**之间快速切换。
- **工程与保存**:任意绝对路径 `.mc/.mcz` 登记为 V3 受管工程，URL 只含不透明工程/谱面 ID。
  自动保存只更新工作区；Ctrl/⌘+S 或「立即保存」才原子同步原文件，并在首次写回前创建
  `<name>.mc.orig` / `<name>.mcz.orig`。WDA 首次变更透明转为普通工作副本，原始资产不动。
- **删除条目**:工程与单谱均以悬停时显现的叉号操作；普通灰色叉号仅隐藏且可恢复。
  V3 受管工程不会从工程列表直接删除工作区或外部原文件；WDA 与其他工程在界面能力上没有特殊分支。
- **不做(non-goals)**:删除源采音点;
  `dir`/slide 音符;波形/频谱背景;WSOLA 变速;自动排键(那是 `src/generation/` 的事);
  难度评估;暗色主题。

## 2. 数据流与多工程

```
启动页(/)── GET /api/projects ──▶ V3 受管工程卡片(最近 + 已导入 + WDA 普通注册项)
   │  原生选择器/绝对路径 ──▶ POST /api/projects/open-path
   │                          └─▶ artifacts/arranger/workspaces/<project-id>/
   │  新建绝对路径空白 .mc ─▶ POST /api/projects/create ─▶ V3 工作区
   │  复制导入 POST /api/import ──▶ artifacts/arranger/imports/<slug>/{mc,音频,封面}
   │     ① **.mcz 单文件**(经 scripts/import_mcz.py 用 stdlib zipfile 解包)
   │     ② .mc(必需)+ 音频/封面(**可选**;缺素材仍可编辑但不能导出)
   ▼ 打开 → URL ?src=managed:<project-id>:<chart-id>(F5 保持工程;不暴露绝对路径)
<源 .mc> ── /api/chart?src ──▶ 浏览器 parseMc → Onset[] + AssignmentsMap
   ▲                               │ 编辑(纯函数 reducer + UndoStack<EditorSnapshot>)
   └── POST /api/writeback?src ────┤ 自动更新受管工作区
       POST /api/projects/save ────┤ 显式同步 .mc / 重新打包并同步 .mcz
      POST /api/projects/setup ────┤ 元信息 + 工程共享音频/封面事务更新
artifacts/arranger/projects/<key>/ ◀── 自动保存/快照(按工程隔离)
artifacts/arranger/registry.json   ◀── V3 来源路径/指纹/名称/最近目录/隐藏与最近打开
<用户选择目录>/<自定义包名>.mcz ◀── 全包 mode:9 谱面 + 唯一音频/封面
```

**工程包(一包多谱)**:`?src` 用稳定不透明 ID 定位当前具体谱面；工作区文件名可变但 ID 不变。
同一工程目录下的多张
`.mc` 共享一份音频/封面,在侧栏列为兄弟谱。`.mcz` 内的全部 mode:9 谱面都会被解包
(非 mode:9 的 key/catch 谱直接丢弃,否则会让浏览器解析器崩)。

- `WDA/`、`data/corpus/` **只读**;一切写入 `artifacts/arranger/`(仓库不变量)。
- `<key>` = sha1(不透明 source ref) 前 16 位；V2 `artifacts/arranger/imports` 状态和快照迁移时
  改写引用并搬到对应 V3 key，内容不丢失。
- **`?src` 参数**:`managed:<16hex>:<12hex>`；绝对路径仅在 POST JSON 中接收，经
  `path.win32.isAbsolute`、存在性、扩展名和工作区 containment 校验，永不出现在 URL。
- 音频/封面按 ingest 式发现:**源 .mc 所在目录**内恰好一个音频(.mp3/.ogg/.wav)与一张
  图片(.jpg/.jpeg/.png);0 个 → 404/拒绝打包,多个 → 歧义报错(不猜)。**无音频的工程**
  仍可排键，顶部显示提示条；统一 MCZ 导出会明确阻止并说明缺少哪类素材。
- 用户在编辑阶段导入/替换素材时，先校验扩展名、大小、非空和文件签名，再规范命名为
  `audio.<ext>` / `cover.<ext>`，并同步更新工程内全部 `.mc` 引用；未主动替换的旧素材不改名。
- **Python 桥**(均 cwd=仓库根 + 相对路径;Windows venv 回传**反斜杠**路径,Node 侧须
  先归一化再取 basename):`scripts/import_mcz.py`(解包 .mcz)/ `scripts/export_arranged_mcz.py`
  (打包 .mcz)。
- 键位几何唯一权威 = `configs/column_geometry.json`,经 `/api/geometry` 运行时读取;
  UI 显示列号 0–5 + 中文方位,**永不显示 habit 编号**。

## 3. 主题(Claude/Anthropic 设计语言,全局浅色)

DOM token 定义在 `src/app/globals.css` 的 `@theme`;**Canvas 颜色唯一取自
`src/lib/theme.ts` 的 `THEME`**。全暖调(灰都带黄棕底),无冷灰、无重投影；除谱面 Note 的
实机材质复现外不使用渐变。

| 角色 | token | 值 |
|---|---|---|
| 页面底 | parchment | `#f5f4ed` |
| 卡片/工具条 | ivory | `#faf9f5` |
| 按钮底 / hover | sand / sand-deep | `#e8e6dc` / `#dfdcd0` |
| 主文字 / 按钮字 | ink / charcoal | `#141413` / `#4d4c48` |
| 次要 / 三级文字 | olive / stone | `#5e5d59` / `#87867f` |
| 结构分隔 / 交互 ring | cream / hairline | `#f0eee6` / `#d1cfc5` |
| 主 CTA + 播放头 | clay(hover coral) | `#c96442`(`#d97757`) |
| 错误 / 输入聚焦 | err / focus | `#b53333` / `#3898ec`(唯一冷色) |
| 功能底色 | warn/err/ok-wash | `#f8f1de` `#f7e9e6` `#eef2e6` |

- 阴影:交互件 `shadow-ring`(0 0 0 1px hairline,代替可见边框);对话框
  `shadow-whisper`(rgba(0,0,0,.05) 0 4px 24px)。
- 圆角:8px 标准(rounded-lg)/ 12px 主按钮·输入·对话框内件(rounded-xl)/ 16px 对话框与
  特色容器(rounded-2xl);禁 <6px。
- 字体:serif(Georgia+宋体系)**仅标题、字重 500**;sans(system-ui+PingFang/雅黑)为 UI;
  mono 仅数字读数。body line-height 1.6。
- **封面水彩罩**:主工作区先绘 cover-fit 原图,再盖 `THEME.stage.coverWash`
  (`rgba(245,244,237,0.85)`,≈15% 显影)——jpg 高透明度垫底(用户需求);cover 加载失败
  → 纯羊皮纸。
- DOM 仍禁用装饰性渐变；谱面预览的蓝/黄 Note 与长条是唯一例外：为逐层复现实机参考的发光
  材质，可用 Canvas 原生线性/径向渐变与阴影，但禁止嵌入、裁切或描摹参考位图。

## 4. 数据结构(`src/lib/`)

- `Beat = [A, B, C]` → 拍 `A + B/C`(`beat.ts`;`floatToBeat` 带进位)。
- **Onset**(`arrangement.ts`):同一 tick 的采音点。id = gcd 约分的 `tickId`
  (`[1,2,4]` ≡ `[1,1,2]` → `"1+1/2"`);`beat` 保留该刻**首个源三元组**,导出原样回写。
- **AssignmentsMap**:`onsetId → Assignment[{ column, endbeat|null }]`;每 onset 内列唯一,
  1..6 个;**不可变更新**,UndoStack(cap 500)直接持有快照。
- **ParsedChart**(`mc.ts`):`raw` 原样保留整个源 JSON;`dir` 丢弃并告警;恰好一个
  type:1 音频 note;offset 缺失 = `null`(≠0,并告警)。
- **WorkingStateV1**(`persist-types.ts`):`{schema:1, sourcePath, sourceSha1, sourceMode,
  assignments, structure?, ui, updatedAt}`;`structure` 只存工作状态、不写源 `.mc`;sha1 不符 →
  打开对话框给"继续/重新播种"分支。
- **SegmentStructureV3**(`segments.ts`):有序显式 clip `{id,startSec,endSec,label}` + 语义关系。
  clip 可在首尾及中间留空白但不可互相重叠;相接边界点归右侧，最后一个 clip 包含其右端点。
  V1 共享边界状态在音频时长与采音点时间就绪后迁移，稳定 ID/关系保留、空 clip 自动移除。
- **Snapshot**:`{id(时间戳), createdAt, label, assignedCount, state}`。
- **EditorProject**(`projects.ts`):工程根路径/名称 + `charts[]` + 实际 `audio`/`cover` 路径、
  隐藏状态与删除能力；同目录资产在卡片上只显示一次公共路径。
- **ProjectRegistryV3**:稳定工程 ID、工作区、来源类型/绝对路径/指纹、显示名、谱面 ID、
  `sourceAssets`（裸 `.mc` 同目录素材名与指纹）、`hiddenProjects`、`hiddenCharts`、
  `lastOpenedSrc`;旧注册表无损迁移。

## 5. 时间与同步(核心)

- **beat ↔ 谱面秒**:移植 `src/pipeline/time_map.py` 的分段算法(逐段 60/bpm 积分 +
  `time[0].delay` 前置),支持多 BPM(`timemap.ts`)。
- **offset 符号统一**(`docs/offset_convention.md`):语料正值(+392 → beat0 在音频
  0.392s);WDA 存 **−463**(相反符号约定,实测首拍 ≈0.42–0.47s,人耳定案)。两者物理
  含义一致 → `beat0AudioSec = |offset| / 1000`;缺失 → 0 + 常驻警告。
- `audioSec(beat) = beat0AudioSec + nudge/1000 + beatToChartSec(beat)`。
  **锚点自检**(单测):WDA 首采音点 beat 0.25 → 0.463 + 0.25×60/103 ≈ **0.609s**。
- **主时钟 = WebAudio + soundtouch 引擎**(`src/lib/audio-engine.ts` `AudioEngine`,由
  `useAudioClock(audioUrl)` 包装)。整曲 `fetch(/api/audio?src).arrayBuffer()` → `decodeAudioData`
  入内存;经 soundtouch PitchShifter(AudioWorklet `soundtouch-processor`,`public/vendor/`)做
  **变调保持**的 **0.1–2× WSOLA 变速**(慢放不卡顿)。移植自旧采音器 `src/editor/static/app.js`。
- **位置时钟锚定 AudioContext**(关键):`_position = anchorPos + (ctx.currentTime − anchorCtx) × speed`
  (play/seek/setRate 时重锚)。**不用** soundtouch 上报的 `percentagePlayed` 读位置 —— 那是拉入
  WSOLA 输入缓冲(~16384 帧 ≈ 371ms)的**源样本数**,领先可听输出约 371ms,会让 kick 与视觉播放头
  整体提前跑拍。ctx.currentTime 是可听输出的真实时钟(WSOLA 产出时长 = 源/tempo,长期无漂移),
  故 kick/播放头与音乐对齐。rAF 每帧广播(暂停恒定),渲染是 t 的**纯函数** → 倒拖自动反向。
- **落点试听 + 吸附后默认暂停**:点击时间轴 → `audition(center)` 播 [center−0.12, center+0.15] 后
  `finishAudition` 停回落点(**结束态即暂停**,即便点击前在播放);deadline 按 1/speed 缩放,慢放不被
  掐断。
- **worklet 闸门(根因修复)**:`AudioWorkletNode.process()` 返回 true,Chrome 在 `disconnect()`
  后**仍继续调用**它 —— 实测暂停 3s 源位置前进 **3.072s**、worklet 领先引擎 **7.89s**,这正是
  kick 恒定偏晚的根因。修复:worklet 增 `{type:'running'}` 消息闸门(未 running 输出静音且
  **不调用 extract**),`pause()` 先关闸再断连、`play()` 开闸并先 `applySeek(_position)` 重同步;
  `onAudioEnd()` 加 `if (!_playing) return` 守卫(暂停期误发 end 不再把播放头跳到曲尾)。
- **seek 打断试听即暂停**:`seek()` 若打断 `auditioning` 则连同 `pause()` —— 否则帧循环的
  `finishAudition()` 永不触发,引擎无限播放、播放头前漂,表现为**按 Q 只退一步就被拽回**
  ("空气墙";E 因同向前漂而看似正常)。
- **kick 军鼓打点**:播放头掠过每个采音点触发 `punchy-snare.mp3`;onset 时刻 = `beatToAudioSec`
  (**含 offset 与 BPM**);`setInterval(25ms)` 前瞻 `KICK_LOOKAHEAD=0.25s`(须显著大于采样前导
  ≈46ms,否则 `playKick` 的 `Math.max(currentTime,…)` 会把近端 kick 钳到"立刻播"而迟到)。
  排期 **直接由锚点换算**:`kickTime = anchorCtx + (onset − anchorPos)/speed + kickOffset`
  —— **不可**用 `ctx.currentTime + (onset − _position)/speed`,因 `_position` 只在 rAF 更新,与当场
  读的 `currentTime` 不同刻,会给每个 kick 注入 0–16ms 随机迟到。kick 与音乐同走 destination,
  输出延迟一致;`computeSampleOnset` 裁前导静音让瞬态落准(实测该采样 20%-peak 46.08ms vs 峰值
  47.83ms,误差 1.75ms)。音乐/kick 各自 GainNode 独立音量。
- **起播重同步**:`play()` 在锚定前先 `applySeek(_position)`,强制 worklet 对齐引擎位置
  (setter 自带 `clear()`),消除暂停期间可能的源位置泄漏。
- **诊断入口**(控制台):`__kickDiag()` 打印引擎/worklet 位置、二者差、锚点、kick 排期与钳位计数、
  baseLatency/outputLatency;`__kickLeakTest()`(**暂停态**跑)测断连期间 worklet 是否仍消耗源。
- **设备延迟补偿(原"AV微调",`nudgeMs`)**:补偿耳机/蓝牙/显示器延迟,只平移**预览**
  (飞行/网格/打点)的观感,**永不写入 .mc**。与下面的"谱面 offset"职责不同。
- **手动 BPM / offset(按文件记忆,会写入导出)**:`UiPrefs.bpmOverride/offsetOverride`
  (null = 用源值),经 WorkingStateV1 按工程持久化。timing 派生时覆盖 `timeMap[0].bpm` 与
  `offsetMs`(**多 BPM 谱面只覆盖首段**,UI 标注段数)。导出时 `buildArrangedMc(…, overrides)`
  写入 `time[0].bpm`、`meta.song.bpm`、音频 note `offset` —— 这是"meta/time 逐字保留"不变量的
  **唯一例外**(用户显式修正源谱面)。
- **打点音色**:9 种(`KICK_SOUNDS`)—— `kick` 为 punchy-snare 采样(默认),其余
  snare/rim/clap/cowbell/zap/guitar/beep/gong 为纯 WebAudio 合成(移植自旧采音器音库),
  统一经 `kickGain` 输出,音量/微调/前瞻排期逻辑不变;切换即试听一声。存 `UiPrefs.kickSound`。

## 6. 交互定义

编辑对象 O = **播放头之前最近的采音点**(`onsetAtOrBefore`,正好落其上也算;已废除选中态),P = 播放头按当前细分吸附后的拍位:

| 事件 | 条件 | 动作 |
|---|---|---|
| 普通单击时间轴 | snapClickEnabled(默认开) | 播放头**吸附到当前细分格**(1/1…1/32) + 落点试听 + **停在落点(暂停)** |
| 普通单击时间轴 | snapClickEnabled 关 | 播放头移到落点(不吸附、不试听) |
| **Ctrl/⌘+单击**时间轴 | — | 把**播放头**吸附到最近采音点 + 试听 + 停在落点 |
| `Q` / `E` | — | 播放头平滑穿梭到**上/下一采音点**，抵达后试听落点音频并保持暂停(播放中按 Q/E 默认暂停) |
| 模拟器模式 `←` / `→` | 无活动长条手势 | 平滑穿梭到前/后采音点，抵达后试听落点并停回该点 |
| 点击键 K | 吸附格上**没有**采音点 | **新建采音点**于该格 + `assign`(单步 undo) |
| **Ctrl+点击键 K** | — | 指派给**播放头之前最近**的采音点(不新建) |
| 点击键 K | 播放头所在采音点上 K 未指派 | `assign`(单点) |
| 点击键 K | K 已指派单点 | 取消指派 |
| 点击键 K | K 已指派长条 | 改回单点 |
| **Shift+点击键 K** | 播放头**之前**该键有音符 | 把最近那次指派**延伸成长条**,尾落在吸附拍位 |
| 右键时间轴采音点(±8px) | — | **清空该采音点全部排键**(`clearOnset`) |
| **Alt+拖拽**时间轴 | — | 画框选,松手批量选中框内采音点 → 浮出「重排 · 清空所选」按钮(`clearOnsets`) |
| **Ctrl/⌘+单击桥段覆盖带** | — | 以黑色虚线框多选/取消多选桥段(采音点区域仍保持原 Ctrl 吸附语义) |
| `R` | 播放头位于采音点(未选多段) | **智能伪随机排键**(学习自全量人类语料上下文与 N-gram，预测生成单击/单击长条/双击/双击长条/一长一短，覆盖已有指派，可单步 Ctrl+Z 回退) |
| `R` | 已选 ≥2 个桥段 | 建立“重复”关系并清空临时多选;右侧可改升级/变奏/对比/自定义 |
| `I` | — | 记录播放头为待完成区间起点；再次按 I 覆盖旧起点，不创建/编号 clip |
| `O` | 已设置 I 且 O>I | 创建 I→O clip 并将其设为唯一选中段；无采音点或与已有 clip 重叠则提示且保留 I |
| **Ctrl/⌘+C** | 恰好选中 1 个 clip | 把 clip 内全部采音点的键位序列写入系统剪贴板；多选时拒绝 |
| **Ctrl/⌘+C** | 未选 clip 且播放头精确停在采音点 | 只复制当前采音点的键位组 |
| **Ctrl/⌘+V** | 播放头精确停在目标采音点 | 从该点起按采音点顺序原子覆盖；忽略源/目标点间隔，点数或长条尾映射不足时拒绝 |
| **右击 clip 顶部色带** | 未命中共用切口 | 删除该 clip、清理失效关系；采音点可暂时遗漏，可用“回退分割”恢复 |
| **右击共用切口** | 命中 ±8px | 合并相接的左右 clip;孤立空隙边缘不响应;关系自动清理失效成员 |
| 标尺/播放头拖拽 | — | 自由 scrub(不吸附;松手落点试听) |
| 空白拖拽 | — | 平移视图 |
| 右键键 K | K 已指派 | 取消指派 |
| **右击画面上的音符** | — | 删除该音符的键(`unassign(该onset, 该列)`) |
| **拖拽画面上的音符** → 另一键 | 目标列空闲 | 改列(`move`);目标列被占用则拒绝 |
| 拖光标圈 K→K′ | K′ 空闲 | 换列(保留长条尾;目标绿圈) |
| 拖光标圈 K→K′ | K′ 占用 | 拒绝(红圈 + 提示) |
| Shift+点击但之前无该键音符 | — | 不动作 + 提示「该键在播放头之前没有可延伸的音符」 |

**编辑对象由播放头派生(已废除选中态)** = 播放头**之前最近的一个采音点**
(`onsetAtOrBefore`,正好落在其上也算)。因此播放头停在**任意位置**都能排键 —— 指派落到前一个
采音点;右侧栏同步聚焦该点。只有播放头早于第一个采音点时无编辑对象。

**长条创建流程**(支持一个采音点上**多键各自长条**):在起点采音点点键 K 指派 → 按 `E`
(或 ←/→、点时间轴)把播放头移到目标时刻 → **Shift+点击键 K** → 把该键之前最近一次指派延伸成
长条,尾吸附节拍网格(细分 1/1·1/2·1/3·1/4·1/6·1/8,**不限于既有采音点**)。
`setHoldEnd` 每(onset,列)独立,故同一采音点多键可各设不同长条尾。

**活动采音点高亮**:播放头所在采音点在时间轴画**全高墨色竖带 + 虚线中线 + 顶部实心菱形 +
标签**(区别于陶土播放头三角)。预览区**不再画选中叠加层**(虚线环/徽标已移除),只保留一处
极简提示:可 Shift 延伸的键位上画一小段淡弧。

**快捷键**:`Space` 播放/暂停 · `Q`/`E` 上/下一采音点 · `R` 采音点智能伪随机排键(未选多段时) / 标记重复(多选段时) · `I` 设置
clip 起点 · `O` 完成区间 · `←`/`→` 快退/快进
±1s(`Shift`×5,**暂停下时间轴自动滚动跟随播放头**)· `Z` 回退(= `Ctrl+Z`)· `Ctrl+Y` / `Ctrl+Shift+Z`
重做 · **`Ctrl/⌘+C/V` 跨窗口复制/粘贴键位** · **`Ctrl/⌘+S` 立即保存**(挡浏览器保存框,焦点在输入框也生效)· `Home` 回开头 · `Esc`
取消待完成 I/选择/框选。I 只存在于当前会话,不持久化、不进入撤销栈;O 成功创建 clip 才作为
一次结构编辑入栈。只在 INPUT/TEXTAREA/contentEditable 聚焦时让路(SELECT 不 bail);编辑器根容器
`tabIndex=-1`,点击任意处经 `onPointerDownCapture` 收回焦点,`<select>` onChange 后 `blur()` ——
确保碰过工具栏控件后 **Q/E 仍生效**。顶栏:「⏮」回开头 · 「▶/⏸」· 「**⏮▶ 从头**」· 「← 工程」。

**键位剪贴板**使用带版本号的 JSON 协议，同时写自定义 MIME 与 `text/plain`，因此可跨标签页和
浏览器窗口粘贴。单选 clip 优先于播放头单点；空指派也属于序列并会清空对应目标点。长条尾以
连续采音点序号表示，落在两点之间时在目标两点间同比例插值，跨出 clip 的尾部继续引用源/目标
后续点。粘贴只覆盖键位，不复制采音点时间、clip、标签或关系；整次操作只进一个排键撤销快照。
普通文本输入框保留系统复制粘贴，成功复制/粘贴均显示带 `✓` 的居中提示。

Q/E 与 ←/→ 导航使用**快速穿梭**而非闪现 seek：按约 8× 谱面时间线性逐帧经过，单次限制
120–350ms；连续按键以最后请求终点为逻辑基准并从当前画面位置平滑改向。正向时 Note 由中心飞向
键位，反向时同一纯时间函数使其从键位沿原路退回中心，长条头尾亦严格倒放。Q/E 跳转采音点在抵达后
触发落点试听并停在落点(若在播放中按 Q/E 默认立即暂停)；←/→ 静音穿梭，若穿梭前正在播放则在终点恢复；
拖拽、时间轴点击与 Space 会取消穿梭。

模拟器模式默认映射 `B/E/L/K/Z/J → 0/1/2/3/4/5`（通道 0~5 对应左上/左中/左下/右下/右中/右上）；
同时在顶栏与右侧检查器提供「⌨ 键位设置」入口，支持用户自由更换 6 个通道的输入按键。设置面板
以舞立方实机环形六角布局排布各通道卡片，在修改时明显高亮当前指派方位与按键，并具备实时冲突检测与
即时敲击测试反馈（敲击键盘按键即时点亮对应通道）。自定义按键经 LocalStorage 持久化记忆，且主工作区
六角预览画布（HexPreview）与顶栏状态标签同步显示最新按键标识。
输入层同时读取 `KeyboardEvent.code` 与 `KeyboardEvent.key`，兼容将 Z 报告为 `Unidentified`、带 Shift 大写字符或附带瞬时
Ctrl/Meta/Alt 修饰状态的可编程控制器。模式开启时设备键优先于同字母全局快捷键，因此所配置键位
不触发默认字符快捷键；撤销可用顶栏按钮，或使用 Ctrl+Z。首个键锁定距离播放头最近的采音点；
部分控制器会把单键作为 Unicode 文本注入，文本框可收到 `z` 而页面没有 `keydown/up`；模拟器模式
使用不可见文本接收器兼容该输入，并将配置字符（含全角字符）作为短按提交。编辑器加载、窗口
重新获得焦点，以及点击预览、时间轴或普通按钮后，下一帧会自动恢复该接收器；BPM、offset、滑杆、
下拉框和其它可编辑控件主动保留焦点，结束编辑后再恢复。工具栏以“设备输入已就绪”或“点击预览区
启用设备输入”明确显示捕获状态。若同时存在标准键盘事件则以标准事件为准，避免重复提交并保留
长按/长条能力；composition/beforeinput/input 的同一字符在 120ms 内只提交一次，纯文本注入因没有
松手边界，仅支持短按。
短按键组原子覆盖该点并自动穿梭至下一采音点。按住任一键 350 ms，或在键仍按下时首次按
`←/→`，进入长条手势；方向键逐个采音点选择尾部，且不得早于头部。多个键可以在不同位置
松开，生成具有独立尾点的多押长条。全部键松开后才一次提交、一次撤销，并从最远尾点继续
前进。无活动手势时，模拟器模式的 `←/→` 不再按固定秒数移动，而是平滑穿梭到前/后采音点；
活动长条手势中仍逐采音点选择尾部。两种情况下抵达后都播放短促落点音频并最终暂停在目标点。
手势中按 `Escape`、窗口失焦、关闭模式、切换谱面或恢复快照会取消草稿。

**右侧栏工程面板**(`ProjectPanel`):工作区自动保存 + 「立即保存」显式同步来源 + 常驻
「管理名称与位置…」；可永久修改显示名、包路径/文件名和各包内 `.mc` 名。移动/重命名前先保存，
失败不提交注册表；**本包谱面**用大点击行切换(切换前先 `await persistNow()`),工程和单谱均使用
普通灰色叉号与红色带框叉号。前者保留状态/快照并可恢复；后者删除单谱 `.mc`、`.mc.orig`
及对应状态，最后一谱或工程级彻底删除会清理整个导入目录。内置/非导入工程拒绝彻底删除。

**批量排键菜单**:`InspectorPanel` 提供「所有采音点排至键 0…5」六个选项。执行后每个采音点
仅保留目标列上的一个单点，覆盖既有单押、多押与长条，并作为单次编辑进入撤销/重做栈。

**独立撤销历史**:顶栏分为「回退/重做排键」与「回退/重做分割」两组。排键栈快照为
`EditorSnapshot = {assignments, addedOnsets}` —— **必须同时还原两者**；结构栈快照为完整
`SegmentStructureV3`，覆盖 I/O 创建、端点移动/合并、段名与段关系。任一栈的新编辑只清空自身 redo，
不影响另一条历史；`Z` / `Ctrl+Z` 与 `Ctrl+Y` 仍只操作排键栈，结构历史通过独立按钮操作。
旧实现只还原 `assignments`,而 `applyEdit` 会顺带回收"排键被清空的新增采音点",于是撤销出的
指派挂在已消失的采音点上、渲染不出来,表现为**「Ctrl+Z 只能回退一步」**。另外**无变化的编辑
不入栈**(`clearOnsets`/`move` 无变化时返回同一 map 对象,入栈会让撤销撞上 React 的 `Object.is`
空转)。诊断入口:`__undoDiag()`(`desync:true` 即快照与实时状态脱节)。

## 7. 渲染规则

- **细分网格(1/1·1/2·1/3·1/4·1/6·1/8·1/12·1/16·1/24·1/32)**:时间轴画**三级线**——
  小节(`b%4`)/ 整拍 / 细分(最淡),按像素密度自动降级(细分间距 <4px 不画、拍距 <5px 只画
  小节线)。点击吸附走 `nearestBeatAudioSec(sec, timing, snapDenom)`。
  *(旧 bug:`nearestBeatAudioSec` 只 `Math.round` 到整拍、Timeline 根本没有 `snapDenom` prop,
  故"切换网格无响应";已修。)*
- **新增采音点标记**:时间轴上新增点在 baseline 下画一个小**空心三角**,与源采音点区分。
- **长条渲染(实机式六边形光轨)**:长条持续中,从**键位向中心回退**画与 42px 头部全程等宽的
  深色轨道；头部为同心六边形晶核，尾部为 34px 同色六边形端帽，中间由四条平行发光轨连接，
  单押为蓝色、多押为黄色。42px 外轮廓固定，内部轨道宽度与明暗按谱面时间以 0.8s 周期在
  32–37px 间柔和呼吸；落键时最亮最宽，
  暂停时冻结，倒放时严格倒序。飞行期尾带保持静态。长度 =
  `min(dist, dist × 剩余时长 / leadIn)`(与飞行同速),键位保持点亮。飞行期尾带另受已飞距离
  限制并与六边形头衔接；长度不足以容纳尾帽时只画头部，避免重叠闪烁。**不画旋转进度弧**。时间轴长条尾带按
  `assignHoldLanes` 分配**垂直轨道**(甘特图式贪心区间划分,重叠分行、不重叠复用同行、
  首尾相接算不重叠、超 8 轨回绕),避免多条长条叠压成一条。
- **配色(需求5,玩法语义,浅底调校)**:该时刻键数 0 → 暖石灰 `#78716c`(未指派);
  1 → 蓝 `#2563eb`(单押/长条);≥2 → 金黄 `#ca8a04`(双押/多押;**长条头计入同刻键数**)。
  金黄(hue≈45°)与陶土播放头(hue≈17°)保持色相距离;浅底对比由 **1px 墨色描边
  `THEME.stage.noteOutline`** 补偿(实机式 Note、时间轴条形);备选更深金 `#d97706`。
- **飞行**(HexPreview):`0 ≤ h−t ≤ leadIn`,`prog = 1 − dt/leadIn`,中心→键位线性插值。
  普通已分配音符为直径 42px 的恒定尺寸实机式同心圆：发光彩色外环、深色隔离井、彩色内环和
  中央晶核四层，并以硬质高光强化材质；单押为青蓝、多押为黄橙。长条使用上述六边形头而非
  圆形头。全部图形由 Canvas 路径和渐变实时绘制，不使用图片切片；全程不缩放、不淡出；
  默认 leadIn **0.75s**(滑杆 0.30–2.50s,步进 0.05s)。
  六边形目标半径为短边 42%，顶部预留
  16px、底部预留 36px,键位半径按六边形约 19% 并限制于 26–36px,不足时整体安全缩放。
  旧工作状态/快照通过 `previewVisualVersion=7` 一次性迁移到 0.75s，迁移后的用户值继续保留。
  命中闪 ±0.09s；长条头尾按起点时刻的总押数保持同色：单押长条为蓝色，多押中的长条为黄色。
- **模拟器反馈**：草稿键组同时覆盖六键预览与时间轴。当前按下一键为蓝色、多键为黄色；
  提交后的上一键组使用陶土色双外环持续高亮，直到下一次提交、关闭模式或切换谱面。
- **未指派采音点提示(Task C,替换旧中心小脉冲)**——纯 t 函数,倒放对称:
  1. *迫近灰影*:`0 ≤ dt ≤ leadIn`,`prog = 1−dt/leadIn`:中心实心灰盘 r=`4+9·prog`,
     alpha `0.25+0.5·prog`,墨描边 alpha `0.15+0.35·prog` —— 提前一个 leadIn 可见,静止于中心
     (区别于外飞的已指派音符)。
  2. *命中墨环爆发*:`|t−h|<0.09`,`int=1−|t−h|/0.09`,`u=1−int`:外环
     r=`10+(0.55·R−10)·u` 描边 `rgba(墨,0.45·int)` 宽 `1.5+1.5·int`;内环 r=`0.62·外环`
     alpha `0.30·int`;中心闪盘 r=13 灰 alpha `0.6·int`。
  3. *辅助线索*:六边形外圈描边 alpha `0.10+0.20·burstMax`、宽 `1+burstMax`。
- **时间轴**(象牙底):条形高度 = 同刻键数(未指派灰矮条),墨色细描边;长条半透明
  尾带,压同列后续采音点 → 红;节拍网格墨色细/粗线(nudge 即时重绘);**陶土色播放头**;
  滚轮缩放(20–1600 px/s,光标锚定)、拖空白平移、播放追随。
- **桥段覆盖带**:标尺下方只为实际 clip 使用交替暖色区间带,未归属空隙保持底色;每个 clip
  两端使用深橄榄虚线;临时多选使用黑色虚线外框。每个关系组按列表序号从独立调色板取色，
  同组成员使用同色持久内框；clip 同属多个关系时逐层内缩绘制全部组色。
  `R1/U1/V1/C1/X1` 徽标使用对应组色表示重复/升级/变奏/对比/自定义，右侧 clip 卡片与
  关系列表沿用同一配色，不复用音符蓝黄与陶土播放头。
- **待完成 I/O**:I 起点使用青绿色虚线与 `I` 标签，I 到当前播放头间仅画半透明预览；预览
  不参与覆盖、不获得 `Sxx`。完成的 clip 才按时间顺序编号。
- 绿色门禁只要求“全部采音点恰好覆盖一次”且 clip 重叠为 0；未归属空白秒数为允许的信息项。
  遗漏/重复采音点或 clip 重叠时显示醒目红色。新工程不自动播种结构；用户可手动“载入自动
  建议”，确认后整体替换现有 clip/关系。无 skeleton 时按 16 小节生成建议，无采音点建议段不创建。
- 红色门禁中的「遗漏 N」「重复 N」「clip 重叠 Xs」均可点击并按时间循环定位。遗漏只移动
  播放头；重复覆盖与 clip 重叠还会滚动右侧栏到冲突 clip，并以红色虚线外框同时高亮全部
  冲突成员约 2.5 秒。红色诊断框不修改黑色临时多选或彩色语义关系状态。

## 8. 校验与统一 MCZ 导出

### 空白谱面、信息与素材

- 启动页“新建空白谱面”必须选择真实的绝对 `.mc` 路径；自动补扩展名，目标存在返回 409，
  不覆盖也不留下半成品注册项。也可在 `.mcz`/workspace 工程内新增包内 `.mc`；裸 `.mc`
  工程始终只容纳一张谱。
- 空白谱为合法 `mode:9` JSON：一段 BPM、唯一 type:1 音频 note、零 gameplay notes；默认
  BPM 120、offset/preview 0ms、version `New`。没有音频时允许编辑元信息和排键，但播放控件禁用。
- “谱面信息与素材”可编辑标题/艺术家/原始标题与艺术家/版本或难度名/制作者/BPM/offset/
  preview。BPM 只覆盖 `time[0]` 与 `meta.song.bpm`，已有后续变速段不变；offset 取整写入唯一
  音频 note。元信息名称不联动工程显示名或磁盘/包内文件名。
- 高级 JSON 只替换标准表单未管理的 `meta` 顶层字段；必须是 ≤64KB 的可序列化对象，拒绝
  `mode/id/song/creator/version/preview/background/cover`、危险键和畸形值。设置与素材变更
  自动写工作区、不进入排键撤销栈。
- 音频支持 MP3/OGG/WAV（40MB），封面支持 JPG/JPEG/PNG（10MB）。裸 `.mc` 在显式保存时
  将引用素材同步到源文件同目录：首次覆盖建立 `.orig`，未知或外部修改冲突先返回 409，用户
  确认后才能重试。`.mcz` 显式保存则以工作区全部谱面和最新共享素材重新打包。

- `validate()` 警告(不阻断):长条尾压过同列后续采音点。底部状态栏与检查器显示为可点击按钮，点击循环跳转定位至重叠处。
- `validateTriples()` 警告(不阻断):三押及以上(含起始音符、结束释放的长条尾与跨越中的长条占键 $\ge 3$)。底部状态栏与检查器显示感叹号警报按钮，点击循环跳转定位至警报处；时间轴画布采音点顶端标以红色圆点。
- **未指派采音点** = 源占位音符**原样透传**,导出面板显式勾选确认,绝不静默丢弃/自动指派。
- **唯一导出 `.mcz`**(`POST /api/export/mcz?src=`):请求包含当前内存谱、绝对输出目录、包名、
  包内谱面名称映射和 `overwrite`。默认收集工程内全部 mode:9 谱；当前谱以内存为准，兄弟谱以
  最新工作状态为准。音频或封面非唯一则 422；同名目标先 409，确认后以 `overwrite:true`
  原子替换。所有中间 `.mc` 位于系统临时目录并在成功/失败后清理。
- 文件名自动补 `.mc/.mcz`，支持 Unicode；拒绝分隔符、控制字符、Windows 保留名、尾随点/
  空格与包内大小写重复名。面板醒目标注本次导出名称不会永久改名，并链接永久管理入口。

## 9. 持久化

- **自动保存**:编辑后防抖 800ms(maxWait 5s)`POST /api/state?src=`;`pagehide` 时
  `navigator.sendBeacon` 兜底;原子写(tmp + rename)。
- **快照**:手动(可命名)+ 每 5 分钟自动(有改动才拍);按工程保留最新 **50** 份;
  恢复需确认,恢复本身进入 undo 栈(可 `Z` 回退)。
- 重启恢复:URL `?src` 定位工程;state.json 的 sha1 与源一致 → 直接续排;不一致 →
  对话框二选一。
- 旧 `source:auto` 自动播种结构在恢复时清空，用户从 I/O 重新标记；V1/V2 手工结构照常迁移。
  用户主动“载入自动建议”后结构记为 `manual`，重启不会再次清空。清空/载入建议均进入结构
  撤销栈；结构回退/重做会取消待完成 I。
- **UiPrefs**(`persist-types.ts`,`{...DEFAULT_UI, ...saved.ui}` 合并兼容旧状态)含:
  playheadSec/leadInSec/snapDenom/nudgeMs/pxPerSec/scrollSec/selectedOnsetId/playbackRate +
  新增 **musicVol(默认 1)/kickVol(默认 0.5)/kickOffsetMs(默认 0,−200…200)/
  snapClickEnabled(默认 true)/kickSound/bpmOverride/offsetOverride/simulatorMode(默认 false)**。
  模拟器开关随工程工作状态与快照恢复；旧状态缺失该字段时保持关闭。
  `WorkingStateV1.addedOnsets?: Beat[]` 记录**新增采音点**(可选 → 旧状态文件照常加载;
  **hydrate 必须先 merge 再 `assignmentsFromJson`**,否则新增点上的指派会被当未知 id 丢弃)。
  框选 `selectionSet` 为会话态,**不持久化**。

## 10. API 一览(全部 Node runtime;路径服务端解析,`?src` 严格校验)

| 方法+路径 | 说明 |
|---|---|
| `GET /api/geometry` | 原样返回 `configs/column_geometry.json`(全局,无 src) |
| `GET /api/projects` | 包级工程列表、实际资产路径、隐藏状态与有效 `lastOpenedSrc` |
| `POST /api/system-dialog` | 仅本机：Windows 原生 `.mc/.mcz` 打开、`.mc` 保存路径或输出目录选择；取消非错误 |
| `POST /api/projects/open-path` | 绝对路径建/复用工作区，返回不透明工程 ID、谱面 ID 与 `src` |
| `POST /api/projects/create` | 在不存在的绝对 `.mc` 路径创建零 gameplay 空白谱并建立 V3 工作区 |
| `POST /api/projects/charts?src` | 为 `.mcz`/workspace 工程新增空白包内谱；拒绝裸 `.mc` 与大小写重名 |
| `POST /api/projects/setup?src` | multipart 事务更新当前内存 MC 的元信息及可选共享音频/封面，并同步全部谱面引用 |
| `POST /api/projects/save` | 显式同步工作区到来源 `.mc`（含共享素材），或全包重建并原子替换来源 `.mcz`；指纹冲突 409 |
| `POST /api/projects/manage` | 保存后的事务式显示名、源路径/包名、包内谱面名修改 |
| `POST /api/projects/entry` | `{scope,target,action}`:工程/谱面 hide、unhide、purge；谱面 touch 记录最近打开 |
| `POST /api/import` | multipart:**`mcz` 单文件**(≤60MB,Python 桥解包)**或** `mc`(必需)+`audio`/`cover`(可选);+可选 name。400 缺件 / 413 超限(mc 2MB、音频 40MB、封面 10MB、mcz 60MB)/ 415 扩展名 / 422 解包或解析失败、非 mode:9;成功返回 `{src, hasAudio, hasCover, …}` |
| `GET /api/chart?src` | `{path, text, sourceSha1}`(源 .mc 原文;解析在客户端) |
| `GET /api/audio?src` | 工程目录唯一音频;HTTP Range → 206 |
| `GET /api/structure-suggestions?src` | 读取工程音频同名 skeleton 的结构建议;无则返回 fallback |
| `GET /api/cover?src` | 工程目录唯一图片 |
| `GET/POST /api/state?src` | 工作状态(POST 兼容 sendBeacon) |
| `GET/POST /api/snapshots?src`、`GET /api/snapshots/[id]?src` | 快照(id 白名单防穿越) |
| `GET/POST /api/export/mcz?src` | 导出默认值/逐谱统计；全包临时构建、校验并原子写入自定义绝对路径 |

`?src` 无效 → 400，不存在的工程/谱面 ID → 404；绝对路径只允许经本机 POST 打开。

## 11. 开发约定

- **TDD**:`src/lib/` 全部纯函数,先写失败测试再实现;测试镜像为 `tests/<module>.test.ts`;
  金测试直读 `../WDA/WDA_Recorded.mc`(618 音符、offset −463、重建回环),文件缺失自动跳过。
- 组件不含判定逻辑:编辑语义在 `arrangement.ts` reducer,工程列表在 `projects.ts`,
  路径校验在 `server/paths.ts`;Canvas 每帧全量重绘,props 经 ref 读取。
- 主题纪律:DOM 只用 `@theme` 生成的工具类(`bg-parchment`/`text-ink`/`shadow-ring`…),
  Canvas 只用 `THEME`;**禁止**引入冷灰(`neutral-*`/`zinc-*`)、渐变、重投影;serif 只出现
  在标题、字重 500;陶土 clay 只给主 CTA 与播放头。
- TypeScript strict;npm;`npm run build` 即类型门禁(`useSearchParams` 须包 `<Suspense>`)。
- 仓库不变量复述:WDA/ 与 data/corpus/ 只读;输出进 artifacts/;绝不产生 `dir`;几何运行时
  读取;habit 永不显示;offset 原值回写,nudge 不入 .mc。

## 12. 验收清单

1. `npm test` 全绿(74+);`npm run build` 干净。`public/vendor/soundtouch*.js` 与
   `public/punchy-snare.mp3` 经 `curl` 返回 200(worklet 须 `application/javascript`)。
2. `/` 工程页按 `.mcz`/导入目录显示卡片、完整三件套路径与展开谱面行；导入成功进入具体谱面；
   启动器访问 `/?resume=1` 恢复最近成功打开的谱面，「← 工程」返回普通 `/` 且不自动跳回。
3. 文件选择器取消不报错；盘符/UNC/Unicode 绝对路径可打开；地址栏只出现 managed ID；路径穿越、
   非 `.mc/.mcz` 和不存在目标被拒绝。WDA 首次保存后原包哈希不变并切换普通工作副本。
   新建空白 `.mc` 自动补扩展名、目标存在时零覆盖；创建后直接进入零音符编辑态且无音频时播放禁用。
4. 速度滑杆 0.1× 变调保持不卡顿;**播放时军鼓与音乐每拍对齐(不再整体提前跑拍)**,视觉播放头
   亦与音乐同步;🎵/🥁 两条音量条独立(🥁 拉 0 静音)。
5. 指派/拖拽/右键键位/多押变金黄可复现;**长条工作流**:Ctrl+点击 onset i → 点键 K → 按 E
   (播放头到 i+1、**i 仍高亮选中**、K 上"设长条尾"徽标在)→ 点 K → 尾设到 i+1;再给 onset i 键 3
   指派并同法设尾 → **多键各自长条**;时间轴上 onset i 有醒目竖带/菱形/标签一眼可辨。
6. **吸附后默认暂停**:播放中普通单击/Ctrl+单击 → 听到落点一瞬 → 停在落点(暂停)。
   **快速穿梭**:Q/E 与 ←/→ 在 120–350ms 内连续经过中间谱面；c 连按两次 Q 平滑经过 b 到 a，
   倒放时音符从键位退回中心；暂停下播放头出屏时时间轴自动滚动跟随。
   模拟器模式下无手势的 ←/→ 改为前/后采音点，长条手势中改为前/后尾点；抵达后试听落点并
   最终暂停。Z 必须稳定指派右中列 4，不能触发裸 Z 撤销。
   **Ctrl+S**:任意焦点下按 → 不弹浏览器保存框、工作区立即更新并显式同步来源；首次生成 `.orig`，
   外部修改时 409 且不覆盖。
7. **Q/E** 移播放头到上/下采音点(碰过工具栏控件后仍生效);`Z`/`Ctrl+Y`/`Esc`/`Home`
   生效;「⏮▶ 从头」从 0 起播;F5 状态恢复(含 musicVol/kickVol/snapClickEnabled/速度);
   快照新建/恢复/第 51 份淘汰。
   **跨窗口复制粘贴**:I/O 新建并选中 5 点 clip 后 Ctrl+C，在另一标签页的目标采音点 Ctrl+V，
   键位依次覆盖目标连续 5 点且不受间隔差异影响；无 clip 选择时可复制当前单点；成功有显著提示，
   一次 Ctrl+Z 撤销整批粘贴、Ctrl+Y 完整恢复。
8. 导出面板只有 `.mcz`；自定义 Unicode 包名与每张内部谱面名，所有 mode:9 谱齐全；目标存在先
   确认覆盖；未指派点需显式确认；永久重命名按钮进入同一管理对话框且普通导出不改工程路径。
9. 导出 `.mcz`:`zipfile.testzip() is None`，包含自定义 `*.mc`、`audio.ogg`、`cover.jpg`，
   不留下中间 `.mc`；`pytest tests/test_export_arranged_mcz.py -q` 绿。
10. 编辑阶段导入合法音频/封面后无需刷新即可播放/换封面且全部包内谱引用同步；元信息保存保留
    后续 BPM 段并正确替换高级字段；非法签名/受保护键/事务故障均零部分修改。裸 `.mc` 显式保存
    会同步素材并建立 `.orig`，素材外部冲突需确认覆盖。
11. 视觉过检:全羊皮纸、serif 500 标题、无装饰性渐变/重投影/冷灰；仅 Note 使用实机材质渐变；
    封面淡水彩垫底;焦点蓝仅输入框。
12. **终局(二元观察,人工)**:`.mcz` 导入 Malody V,实机听感同步、蓝/黄配色符合规则5。
