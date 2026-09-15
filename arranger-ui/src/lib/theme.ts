/**
 * Claude/Anthropic 设计语言 —— Canvas 侧唯一取色源(DOM 侧用 globals.css 的 @theme token)。
 * 全暖调 UI 与玩法蓝/黄分层;陶土 #c96442 只用于播放头等最高信号时刻。
 * 预览音符的多层发光色板来自用户提供的实机参考图，仍由此处统一管理。
 * 零依赖 const,便于测试与两块 Canvas 直接引用。
 */

export const RELATION_GROUP_COLORS = [
  "#7b3f8c",
  "#1f6f8b",
  "#8a5a20",
  "#9a3f55",
  "#4e6b31",
  "#495a9c",
  "#8c4f2f",
  "#2f6f68",
] as const;

export function relationGroupColor(index: number): string {
  const safe = Number.isFinite(index) ? Math.max(0, Math.trunc(index)) : 0;
  return RELATION_GROUP_COLORS[safe % RELATION_GROUP_COLORS.length];
}

export const THEME = {
  font: {
    sans: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
    mono: "ui-monospace, Consolas, monospace",
  },
  /** HexPreview(主工作区舞台) */
  stage: {
    bg: "#f5f4ed",
    /** 封面水彩罩:cover 原图上盖一层羊皮纸,≈15% 显影(用户需求:高透明度背景) */
    coverWash: "rgba(245,244,237,0.85)",
    ringOutline: "rgba(20,20,19,0.10)",
    /** Task C 辅助线索:未指派爆发时外圈描边的 alpha 增幅上限 */
    ringOutlineBurstBoost: 0.2,
    keyFill: "#faf9f5",
    keyStroke: "#d1cfc5",
    keyLabel: "#4d4c48",
    keySubLabel: "#87867f",
    centerDot: "rgba(20,20,19,0.28)",
    selectionRing: "rgba(20,20,19,0.85)",
    badgeBg: "rgba(250,249,245,0.94)",
    dragLine: "rgba(20,20,19,0.35)",
    dragGhost: "rgba(20,20,19,0.45)",
    dropValid: "#15803d",
    dropInvalid: "#b53333",
    hintText: "#5e5d59",
    hintTextMuted: "#87867f",
    /** rgba() 拼装用的墨色 RGB(Task C 灰影/墨环) */
    inkRGB: "20,20,19",
    /** 浅底上所有音符标记的 1px 描边(金黄对比不足的补偿) */
    noteOutline: "rgba(20,20,19,0.40)",
    noteRim: "rgba(20,20,19,0.58)",
    noteHighlight: "rgba(250,249,245,0.72)",
    noteGlint: "rgba(250,249,245,0.92)",
    noteShadow: "rgba(20,20,19,0.22)",
    holdOutline: "rgba(20,20,19,0.32)",
    holdHighlight: "rgba(250,249,245,0.52)",
    /** 实机式同心圆 / 六边形长条色板：不得以参考图片切图代替。 */
    noteBlue: {
      shadow: "#063a70",
      edge: "#087fcb",
      body: "#08cfea",
      bright: "#bffcff",
      darkWell: "#071923",
      innerEdge: "#0a719d",
      innerBody: "#0b3349",
      core: "#0dd8e8",
      coreBright: "#c8ffff",
      glow: "rgba(0,205,255,0.52)",
    },
    noteYellow: {
      shadow: "#a93d12",
      edge: "#ef651b",
      body: "#ff9f16",
      bright: "#fff1d2",
      darkWell: "#1b120a",
      innerEdge: "#a95b08",
      innerBody: "#4a2b0a",
      core: "#ff9f0a",
      coreBright: "#fff0b8",
      glow: "rgba(255,153,0,0.50)",
    },
    holdTrackDark: "rgba(5,9,13,0.74)",
    holdTrackFrame: "rgba(215,226,232,0.66)",
    holdTrackGlint: "rgba(255,255,255,0.82)",
    /** 模拟器上一提交键组：与蓝/黄玩法色分离的陶土参照环。 */
    simulatorPrevious: "#c96442",
    simulatorPreviousWash: "rgba(201,100,66,0.16)",
  },
  /** Timeline(时间轴) */
  timeline: {
    bg: "#faf9f5",
    rulerBg: "#f0eee6",
    rulerTick: "rgba(20,20,19,0.25)",
    rulerText: "#87867f",
    gridBar: "rgba(20,20,19,0.15)",
    gridBeat: "rgba(20,20,19,0.055)",
    /** 细分线(比整拍更淡) */
    gridSub: "rgba(20,20,19,0.028)",
    /** 陶土播放头 —— 全应用最高信号的品牌时刻 */
    playhead: "#c96442",
    selectionHalo: "rgba(20,20,19,0.85)",
    /** 选中采音点的全高竖带(墨色,区别于陶土播放头);播放头被 Q/E 移开后仍一眼可辨 */
    selectionBand: "rgba(20,20,19,0.09)",
    selectionEdge: "rgba(20,20,19,0.55)",
    selectionMark: "#141413",
    warnTail: "#b53333",
    simulatorDraft: "#c96442",
    /** 结构桥段：暖橄榄色系，区别于玩法蓝/黄、墨色选中与陶土播放头。 */
    segmentWashA: "rgba(111,107,79,0.045)",
    segmentWashB: "rgba(201,100,66,0.035)",
    segmentRibbonA: "rgba(111,107,79,0.20)",
    segmentRibbonB: "rgba(201,100,66,0.14)",
    segmentBoundary: "#6f6b4f",
    segmentText: "#4d4c48",
    segmentSelected: "#141413",
    /** I/O 待完成区间：青绿，不与陶土播放头或橄榄 clip 混淆。 */
    inPoint: "#2f6b5f",
    inPointWash: "rgba(47,107,95,0.10)",
    inPointRibbon: "rgba(47,107,95,0.28)",
  },
} as const;
