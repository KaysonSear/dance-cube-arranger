"use client";

import { useEffect, useState } from "react";

import UpdateDialog from "@/components/UpdateDialog";
import { useAppUpdate } from "@/hooks/useAppUpdate";
import { DEFAULT_SIMULATOR_KEYMAP } from "@/lib/simulator-input";

export interface HelpDialogProps {
  open?: boolean;
  isOpen?: boolean;
  onClose(): void;
}

type TabKey =
  | "basics"
  | "charting"
  | "drag_mirror"
  | "mark_clipboard"
  | "simulator"
  | "projects"
  | "shortcuts"
  | "use_cases";

interface TabItem {
  id: TabKey;
  label: string;
  icon: string;
}

const TABS: readonly TabItem[] = [
  { id: "basics", label: "快速上手", icon: "🧭" },
  { id: "charting", label: "采音与排键", icon: "🎵" },
  { id: "drag_mirror", label: "拖拽与镜像", icon: "🖱️" },
  { id: "mark_clipboard", label: "标记互换与剪贴板", icon: "🔄" },
  { id: "simulator", label: "模拟器模式", icon: "🎮" },
  { id: "projects", label: "工程与导出", icon: "📁" },
  { id: "shortcuts", label: "快捷键速查", icon: "⌨️" },
  { id: "use_cases", label: "典型工作流", icon: "💡" },
];

export default function HelpDialog({ open, isOpen, onClose }: HelpDialogProps) {
  const visible = Boolean(open ?? isOpen);
  const [activeTab, setActiveTab] = useState<TabKey>("basics");
  const [suppressStartup, setSuppressStartup] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const { currentVersion, updateInfo, loading: updateLoading, error: updateError, hasUpdate, latestVersion, checkUpdate } = useAppUpdate();

  useEffect(() => {
    if (!visible) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveTab("basics"); // 每次打开强制聚焦首屏快速上手

    try {
      const val = localStorage.getItem("arranger:suppress-startup-help");
      setSuppressStartup(val === "1");
    } catch {
      setSuppressStartup(false);
    }
  }, [visible]);

  const handleToggleSuppress = (checked: boolean) => {
    setSuppressStartup(checked);
    try {
      localStorage.setItem("arranger:suppress-startup-help", checked ? "1" : "0");
    } catch {}
  };

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex h-[86vh] w-full max-w-4xl flex-col rounded-2xl border border-cream bg-ivory shadow-2xl overflow-hidden">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between border-b border-cream bg-parchment/60 px-6 py-3.5">
          <div className="flex items-center gap-3">
            <span className="text-xl">📖</span>
            <div>
              <h2 className="text-base font-bold text-ink" id="help-dialog-title">
                舞立方谱面编辑器 使用说明与机制指南
              </h2>
              <p className="text-[11px] text-stone">
                Malody V Mode:9 六角环形排键 · 完整功能操作与交互细节参考手册
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone transition-colors hover:bg-sand hover:text-ink"
            aria-label="关闭使用说明 (Esc)"
            title="关闭 (Esc)"
          >
            ✕
          </button>
        </div>

        {/* 内容主体：左侧分类导航 + 右侧详细说明 */}
        <div className="flex min-h-0 flex-1">
          {/* 左侧导航栏 */}
          <div className="w-48 shrink-0 border-r border-cream bg-ivory/50 p-3 space-y-1 overflow-y-auto">
            <div className="mb-2 px-2 text-[10px] font-semibold tracking-wider text-stone uppercase">
              文档章节
            </div>
            {TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium transition-all ${
                    active
                      ? "bg-sand text-ink shadow-xs font-semibold"
                      : "text-olive hover:bg-sand/40 hover:text-ink"
                  }`}
                >
                  <span className="text-sm">{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* 右侧详细内容 */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs text-ink leading-relaxed">
            {activeTab === "basics" && <BasicsSection />}
            {activeTab === "charting" && <ChartingSection />}
            {activeTab === "drag_mirror" && <DragMirrorSection />}
            {activeTab === "mark_clipboard" && <MarkClipboardSection />}
            {activeTab === "simulator" && <SimulatorSection />}
            {activeTab === "projects" && <ProjectsSection />}
            {activeTab === "shortcuts" && <ShortcutsSection />}
            {activeTab === "use_cases" && <UseCasesSection />}
          </div>
        </div>

        {/* 底部状态栏 */}
        <div className="flex items-center justify-between border-t border-cream bg-parchment/60 px-6 py-2.5 text-[11px] text-stone">
          <div className="flex items-center gap-3.5">
            <label className="flex items-center gap-1.5 text-xs text-charcoal cursor-pointer select-none font-medium hover:text-ink transition-colors">
              <input
                type="checkbox"
                checked={suppressStartup}
                onChange={(e) => handleToggleSuppress(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-hairline accent-clay focus:ring-coral/40 cursor-pointer"
              />
              <span>下次启动不再自动弹出</span>
              {suppressStartup && (
                <span className="text-[10px] text-stone">(取消勾选可恢复自动弹出)</span>
              )}
            </label>
            <span className="text-hairline">|</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-ink">v{currentVersion}</span>
              <button
                type="button"
                onClick={() => setUpdateOpen(true)}
                className={`rounded px-2 py-0.5 text-[10px] font-semibold transition-colors cursor-pointer ${
                  hasUpdate
                    ? "bg-clay text-white hover:bg-coral animate-pulse"
                    : "bg-sand text-charcoal hover:bg-sand-deep"
                }`}
              >
                {hasUpdate ? `✨ 新版 v${latestVersion}` : "检查更新"}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-stone">按 <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink shadow-xs">F1</kbd> 或 <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink shadow-xs">Esc</kbd> 退出</span>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-clay px-3.5 py-1 text-xs font-semibold text-white shadow-xs hover:bg-coral transition-colors cursor-pointer"
            >
              我知道了，开始排键
            </button>
          </div>
        </div>
      </div>
      <UpdateDialog
        open={updateOpen}
        onClose={() => setUpdateOpen(false)}
        updateInfo={updateInfo}
        loading={updateLoading}
        error={updateError}
        onCheckAgain={() => void checkUpdate(true)}
      />
    </div>
  );
}

function SectionCard({ title, icon, children }: { title: string; icon?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-cream bg-white/80 p-4 shadow-xs space-y-2.5">
      <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
        {icon && <span>{icon}</span>}
        <span>{title}</span>
      </h3>
      {children}
    </div>
  );
}

function KeyBadge({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block rounded-md border border-cream bg-sand/60 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-charcoal shadow-2xs">
      {children}
    </kbd>
  );
}

/* ── 1. 快速上手（默认首屏） ── */
function BasicsSection() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-ink flex items-center gap-2">
          <span>🧭</span>
          <span>快速上手指南</span>
          <span className="rounded-full bg-clay/15 px-2 py-0.5 text-[10px] font-semibold text-clay">3 分钟快速通关</span>
        </h3>
        <p className="mt-0.5 text-stone text-xs">
          掌握播放定位、6 键单点 (Tap)、长条 (Hold) 及六键模拟器试打核心流程。
        </p>
      </div>

      {/* 视觉图解一：6 键物理通道布局与按键映射（照搬预览区现成元素，支持点击交互试排） */}
      <InteractiveHexLayoutGraphic />

      {/* 核心五步工作流卡片 */}
      <div className="rounded-xl border border-cream bg-white/80 p-4 shadow-xs space-y-3">
        <h4 className="font-bold text-ink text-xs flex items-center gap-1.5">
          <span>⚡</span>
          <span>五步核心排键流程</span>
        </h4>
        <div className="space-y-2.5 text-olive text-xs leading-relaxed">
          <div className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sand text-[11px] font-bold text-ink">1</span>
            <div>
              <strong className="text-ink">播放与采音跳点：</strong>按 <KeyBadge>Space</KeyBadge> 随时播放/暂停；按 <KeyBadge>Q</KeyBadge> / <KeyBadge>E</KeyBadge> 在前后采音点（拍点）间精准穿梭，伴随纯净的落点试听音（Audition）。
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sand text-[11px] font-bold text-ink">2</span>
            <div>
              <strong className="text-ink">点击通道指派单点 (Tap)：</strong>停留在目标采音点时，直接在中央六角盘上<strong>点击对应的物理通道圆圈（0~5 键）</strong>即刻落键！支持双手双押（直接点两个通道）。再次点击同通道可取消或改排。
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sand text-[11px] font-bold text-ink">3</span>
            <div>
              <strong className="text-ink">设置长条 (Hold)：</strong>排好起点音符后，按住 <KeyBadge>Shift + 点击</KeyBadge> 目标采音点快速拉出长条尾部，或在右侧面板直接微调结束拍时值。
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sand text-[11px] font-bold text-ink">4</span>
            <div>
              <strong className="text-ink">撤销与误操作修复：</strong>随时按 <KeyBadge>Ctrl+Z</KeyBadge> / <KeyBadge>Ctrl+Y</KeyBadge> 回退或重做；播放头位于某点时按 <KeyBadge>Delete</KeyBadge> 可一键整点删除当前采音点。
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sand text-[11px] font-bold text-ink">5</span>
            <div>
              <strong className="text-ink">六键模拟器试打（键盘打谱辅助）：</strong>点击顶部走带栏【模拟器】开关，可用电脑键盘像街机一样试打打谱手感（默认通道 0/1/2/3/4/5 依次对应键盘 {DEFAULT_SIMULATOR_KEYMAP.map((binding) => binding.label).join("/")}；可在【⌨ 键位设置】中自定义，修改后以界面显示的当前绑定为准）。在常规排键编辑时直接点击通道即可，无需依赖键盘试打键。
            </div>
          </div>
        </div>
      </div>

      {/* 视觉图解二：单点与长条操作对比 */}
      <NoteActionGraphic />

      {/* 冲突诊断小贴士 */}
      <div className="rounded-xl border border-warn-ink/20 bg-warn-wash/60 p-3 text-xs space-y-1 text-warn-ink">
        <div className="font-semibold flex items-center gap-1.5">
          <span>⚠</span>
          <span>智能手感防翻车警报</span>
        </div>
        <p className="text-[11px] leading-relaxed text-charcoal">
          若排键出现双手无法承受的<strong>三押及以上</strong>或<strong>长条与单点同轨重叠</strong>，顶部走带栏会即刻亮起黄色/红色感叹号警报，点击即可一键跳转至问题位置快速修复。
        </p>
      </div>
    </div>
  );
}

/* ── 六角盘 6 物理通道可交互图解（照搬预览区现成元素与实机 Note decoration） ── */
const PREVIEW_COLUMNS = [
  { id: 0, xRatio: -0.5, yRatio: -0.866, zh: "左上" },
  { id: 1, xRatio: -1.0, yRatio: 0.0,   zh: "左中" },
  { id: 2, xRatio: -0.5, yRatio: 0.866,  zh: "左下" },
  { id: 3, xRatio: 0.5,  yRatio: 0.866,  zh: "右下" },
  { id: 4, xRatio: 1.0,  yRatio: 0.0,   zh: "右中" },
  { id: 5, xRatio: 0.5,  yRatio: -0.866, zh: "右上" },
] as const;

function InteractiveHexLayoutGraphic() {
  const [selectedCols, setSelectedCols] = useState<number[]>([0, 5]);
  const [demoMode, setDemoMode] = useState<"tap" | "hold">("tap");

  const cx = 220;
  const cy = 135;
  const r = 90;
  const keyR = 25;

  const handleToggleCol = (colId: number) => {
    setSelectedCols((prev) =>
      prev.includes(colId) ? prev.filter((c) => c !== colId) : [...prev, colId].sort((a, b) => a - b)
    );
  };

  const isChord = selectedCols.length >= 2;
  const notePalette = isChord
    ? {
        outerGrad: "url(#preview-note-yellow-outer)",
        innerGrad: "url(#preview-note-yellow-inner)",
        coreGrad: "url(#preview-note-yellow-core)",
        darkWell: "#1b120a",
        innerWell: "#4a2b0a",
        glow: "#ff9f16",
        hexCap: "#ff9f16",
        desc: "双押/多押和弦 (黄色 Note)",
      }
    : {
        outerGrad: "url(#preview-note-blue-outer)",
        innerGrad: "url(#preview-note-blue-inner)",
        coreGrad: "url(#preview-note-blue-core)",
        darkWell: "#071923",
        innerWell: "#0b3349",
        glow: "#08cfea",
        hexCap: "#08cfea",
        desc: "单点音符 (蓝色 Note)",
      };

  // 六边形轮廓闭合路径 (0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 0)
  const ringPoints = PREVIEW_COLUMNS.map((col) => {
    const px = cx + col.xRatio * r;
    const py = cy + col.yRatio * r;
    return `${px},${py}`;
  }).join(" ");

  return (
    <div className="flex flex-col items-center rounded-xl border border-cream bg-white/95 p-3.5 shadow-xs space-y-2.5">
      <div className="flex w-full items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-ink">
            舞立方 6 键物理通道布局（预览区实装样式）
          </span>
          <span className="rounded-full bg-sand px-2 py-0.5 text-[10px] font-semibold text-charcoal">
            支持直接点击试排
          </span>
        </div>
        <div className="flex items-center gap-1 text-[11px]">
          <button
            type="button"
            onClick={() => setDemoMode("tap")}
            className={`rounded-lg px-2.5 py-1 font-semibold transition-all cursor-pointer ${
              demoMode === "tap"
                ? "bg-clay text-white shadow-xs"
                : "bg-parchment text-stone hover:text-ink hover:bg-sand"
            }`}
          >
            ● 单点 (Tap)
          </button>
          <button
            type="button"
            onClick={() => setDemoMode("hold")}
            className={`rounded-lg px-2.5 py-1 font-semibold transition-all cursor-pointer ${
              demoMode === "hold"
                ? "bg-coral text-white shadow-xs"
                : "bg-parchment text-stone hover:text-ink hover:bg-sand"
            }`}
          >
            ⬡ 长条 (Hold)
          </button>
          <button
            type="button"
            onClick={() => setSelectedCols(selectedCols.length > 0 ? [] : [0, 5])}
            className="ml-1 text-[10px] text-stone hover:text-ink underline cursor-pointer"
          >
            {selectedCols.length > 0 ? "清空" : "重置双押"}
          </button>
        </div>
      </div>

      <div className="relative w-full max-w-md overflow-hidden rounded-xl border border-cream bg-[#f5f4ed] shadow-inner">
        <svg
          viewBox="0 0 440 270"
          className="w-full h-auto select-none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* 实机蓝色 Note 渐变色板 (预览区唯一取色规范) */}
            <linearGradient id="preview-note-blue-outer" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#bffcff" />
              <stop offset="18%" stopColor="#087fcb" />
              <stop offset="50%" stopColor="#08cfea" />
              <stop offset="78%" stopColor="#bffcff" />
              <stop offset="100%" stopColor="#063a70" />
            </linearGradient>
            <radialGradient id="preview-note-blue-inner" cx="42%" cy="40%" r="58%">
              <stop offset="0%" stopColor="#08cfea" />
              <stop offset="72%" stopColor="#0a719d" />
              <stop offset="100%" stopColor="#bffcff" />
            </radialGradient>
            <radialGradient id="preview-note-blue-core" cx="40%" cy="38%" r="60%">
              <stop offset="0%" stopColor="#c8ffff" />
              <stop offset="35%" stopColor="#0dd8e8" />
              <stop offset="100%" stopColor="#087fcb" />
            </radialGradient>

            {/* 实机黄色 Note 渐变色板 (和弦多押) */}
            <linearGradient id="preview-note-yellow-outer" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fff1d2" />
              <stop offset="18%" stopColor="#ef651b" />
              <stop offset="50%" stopColor="#ff9f16" />
              <stop offset="78%" stopColor="#fff1d2" />
              <stop offset="100%" stopColor="#a93d12" />
            </linearGradient>
            <radialGradient id="preview-note-yellow-inner" cx="42%" cy="40%" r="58%">
              <stop offset="0%" stopColor="#ff9f16" />
              <stop offset="72%" stopColor="#a95b08" />
              <stop offset="100%" stopColor="#fff1d2" />
            </radialGradient>
            <radialGradient id="preview-note-yellow-core" cx="40%" cy="38%" r="60%">
              <stop offset="0%" stopColor="#fff0b8" />
              <stop offset="35%" stopColor="#ff9f0a" />
              <stop offset="100%" stopColor="#ef651b" />
            </radialGradient>
          </defs>

          {/* 1. 中心辐射虚线（各通道通往中心环） */}
          {PREVIEW_COLUMNS.map((col) => {
            const px = cx + col.xRatio * r;
            const py = cy + col.yRatio * r;
            return (
              <line
                key={`ray-${col.id}`}
                x1={cx}
                y1={cy}
                x2={px}
                y2={py}
                stroke="rgba(20,20,19,0.09)"
                strokeDasharray="3 3"
                strokeWidth="1.2"
              />
            );
          })}

          {/* 2. 六角形环形轮廓线 */}
          <polygon
            points={ringPoints}
            fill="none"
            stroke="rgba(20,20,19,0.14)"
            strokeWidth="1.5"
          />

          {/* 3. 机台中心锚点 */}
          <circle cx={cx} cy={cy} r={3.5} fill="rgba(20,20,19,0.3)" />
          <circle cx={cx} cy={cy} r={28} fill="none" stroke="rgba(20,20,19,0.06)" strokeDasharray="3 3" />

          {/* 4. 若为长条模式：为选中的通道绘制 4 条平行光轨与六边形首尾 */}
          {demoMode === "hold" &&
            selectedCols.map((colId) => {
              const col = PREVIEW_COLUMNS[colId];
              const px = cx + col.xRatio * r;
              const py = cy + col.yRatio * r;
              const dx = cx - px;
              const dy = cy - py;
              const dist = Math.hypot(dx, dy) || 1;
              const ux = dx / dist;
              const uy = dy / dist;
              const nx = -uy;
              const ny = ux;

              // 长条延伸至中途
              const tailLen = r * 0.72;
              const tailX = px + ux * tailLen;
              const tailY = py + uy * tailLen;

              return (
                <g key={`hold-rails-${colId}`}>
                  {/* 外层外框与暗底轨道 */}
                  <line
                    x1={px}
                    y1={py}
                    x2={tailX}
                    y2={tailY}
                    stroke="rgba(215,226,232,0.66)"
                    strokeWidth={20}
                    strokeLinecap="round"
                  />
                  <line
                    x1={px}
                    y1={py}
                    x2={tailX}
                    y2={tailY}
                    stroke="rgba(5,9,13,0.74)"
                    strokeWidth={16}
                    strokeLinecap="round"
                  />
                  {/* 四条平行发光轨 */}
                  {[-5.5, -1.8, 1.8, 5.5].map((off, idx) => (
                    <line
                      key={idx}
                      x1={px + nx * off}
                      y1={py + ny * off}
                      x2={tailX + nx * off}
                      y2={tailY + ny * off}
                      stroke={notePalette.glow}
                      strokeWidth={1.2}
                      strokeOpacity={0.9}
                    />
                  ))}
                  {/* 六角尾帽 */}
                  <circle
                    cx={tailX}
                    cy={tailY}
                    r={6}
                    fill="#faf9f5"
                    stroke={notePalette.glow}
                    strokeWidth={2}
                  />
                </g>
              );
            })}

          {/* 5. 六个物理按键通道圆圈（完全照搬预览区绘制参数） */}
          {PREVIEW_COLUMNS.map((col) => {
            const px = cx + col.xRatio * r;
            const py = cy + col.yRatio * r;
            const isSelected = selectedCols.includes(col.id);

            return (
              <g
                key={`col-${col.id}`}
                transform={`translate(${px}, ${py})`}
                onClick={() => handleToggleCol(col.id)}
                className="cursor-pointer group/slot"
              >
                {/* 默认未选中槽位底盘 */}
                <circle
                  cx={0}
                  cy={0}
                  r={keyR}
                  fill="#faf9f5"
                  stroke={isSelected ? notePalette.glow : "#d1cfc5"}
                  strokeWidth={isSelected ? 3 : 2}
                  className="transition-all duration-150 group-hover/slot:stroke-[#c96442]"
                />

                {/* 未排键时：显示通道编号 0-5 与 中文方位 */}
                {!isSelected && (
                  <>
                    <text
                      x={0}
                      y={-4}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#4d4c48"
                      fontSize={15}
                      fontWeight="bold"
                      fontFamily="system-ui, sans-serif"
                    >
                      {col.id}
                    </text>
                    <text
                      x={0}
                      y={10}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#87867f"
                      fontSize={10}
                      fontFamily="system-ui, sans-serif"
                    >
                      {col.zh}
                    </text>
                  </>
                )}

                {/* 选中时：直接照搬预览区实机 Arcade Note (同心发光多重环) 或 Hold Cap */}
                {isSelected && (
                  <>
                    {demoMode === "tap" ? (
                      <g>
                        {/* 外层发光靶环 */}
                        <circle cx={0} cy={0} r={20} fill={notePalette.outerGrad} />
                        {/* 暗隔离井槽 (darkWell) */}
                        <circle cx={0} cy={0} r={14.4} fill={notePalette.darkWell} />
                        {/* 彩色内环 (innerRing) */}
                        <circle cx={0} cy={0} r={10.2} fill={notePalette.innerGrad} />
                        {/* 内井槽 (innerWell) */}
                        <circle cx={0} cy={0} r={8.4} fill={notePalette.innerWell} />
                        {/* 核心高光 (core) */}
                        <circle cx={0} cy={0} r={6} fill={notePalette.coreGrad} />
                        {/* 上高光圆弧 */}
                        <path
                          d="M -15,-8 A 17 17 0 0 1 12,-12"
                          fill="none"
                          stroke="#ffffff"
                          strokeWidth={1.5}
                          strokeLinecap="round"
                          opacity={0.85}
                        />
                        {/* 通道编号标识 */}
                        <text
                          x={0}
                          y={1}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="#ffffff"
                          fontSize={11}
                          fontWeight="bold"
                          filter="drop-shadow(0 1px 2px rgba(0,0,0,0.6))"
                        >
                          {col.id}
                        </text>
                      </g>
                    ) : (
                      <g>
                        {/* 长条六边形头帽 */}
                        <polygon
                          points="0,-18 16,-9 16,9 0,18 -16,9 -16,-9"
                          fill={notePalette.outerGrad}
                          stroke="#ffffff"
                          strokeWidth={1.5}
                        />
                        <polygon
                          points="0,-12 11,-6 11,6 0,12 -11,6 -11,-6"
                          fill={notePalette.darkWell}
                        />
                        <polygon
                          points="0,-7 6,-3.5 6,3.5 0,7 -6,3.5 -6,-3.5"
                          fill={notePalette.coreGrad}
                        />
                        <text
                          x={0}
                          y={1}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="#ffffff"
                          fontSize={10}
                          fontWeight="bold"
                          filter="drop-shadow(0 1px 2px rgba(0,0,0,0.6))"
                        >
                          {col.id}
                        </text>
                      </g>
                    )}
                    {/* 选中方位徽标悬浮在圈外上方/下方 */}
                    <text
                      x={0}
                      y={col.yRatio < 0 ? -32 : 36}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={notePalette.glow}
                      fontSize={11}
                      fontWeight="bold"
                    >
                      {col.zh}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* 底部实时排键交互状态反馈条 */}
      <div className="flex w-full items-center justify-between rounded-lg bg-parchment/80 px-3 py-1.5 text-xs text-olive">
        <div className="flex items-center gap-1.5">
          <span className="text-clay font-bold">💡 点击试排状态：</span>
          {selectedCols.length === 0 ? (
            <span className="text-stone">全空未排，请点击上方任意通道圆圈（0~5 键）</span>
          ) : (
            <span className="text-ink font-medium">
              已指派 {selectedCols.map((id) => `通道 ${id} (${PREVIEW_COLUMNS[id].zh})`).join(" + ")}
              <span className="ml-1.5 text-[11px] font-semibold text-clay">[{notePalette.desc}]</span>
            </span>
          )}
        </div>
        <span className="text-[10px] text-stone">提示：直接在中央预览区点选</span>
      </div>
    </div>
  );
}

/* ── 单点 Tap 与长条 Hold 操作图解 ── */
function NoteActionGraphic() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {/* 单点 Tap */}
      <div className="rounded-xl border border-cream bg-white/90 p-3 space-y-1.5 shadow-xs">
        <div className="flex items-center gap-1.5 font-bold text-ink text-xs">
          <span className="h-2 w-2 rounded-full bg-clay" />
          <span>单点 (Tap) 排键操作</span>
        </div>
        <p className="text-[11px] text-olive leading-relaxed">
          将播放头移至采音点，直接<b>点击通道圆圈</b>即刻落键。再次点击同通道取消，点击其它通道改排。支持多押！
        </p>
        <div className="flex items-center justify-center rounded-lg bg-parchment/60 py-2">
          <svg viewBox="0 0 160 44" className="w-36 h-auto select-none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="28" cy="22" r="14" fill="#faf9f5" stroke="#d1cfc5" strokeWidth="2" strokeDasharray="3 3" />
            <text x="28" y="23" textAnchor="middle" dominantBaseline="middle" fill="#87867f" fontSize="10">未排</text>
            <polygon points="76,22 68,18 68,26" fill="#c96442" />
            <circle cx="108" cy="22" r="16" fill="#c96442" opacity="0.2" />
            <circle cx="108" cy="22" r="13" fill="#c96442" stroke="#fff" strokeWidth="2" />
            <text x="108" y="23" textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize="10" fontWeight="bold">Tap</text>
          </svg>
        </div>
      </div>

      {/* 长条 Hold */}
      <div className="rounded-xl border border-cream bg-white/90 p-3 space-y-1.5 shadow-xs">
        <div className="flex items-center gap-1.5 font-bold text-ink text-xs">
          <span className="h-2 w-2 rounded-full bg-coral" />
          <span>长条 (Hold) 排键操作</span>
        </div>
        <p className="text-[11px] text-olive leading-relaxed">
          排好起点音符后，按住 <KeyBadge>Shift</KeyBadge> <b>点击长条结束位置</b>，或在右侧面板直接微调结束拍时值。
        </p>
        <div className="flex items-center justify-center rounded-lg bg-parchment/60 py-2">
          <svg viewBox="0 0 160 44" className="w-36 h-auto select-none" xmlns="http://www.w3.org/2000/svg">
            <rect x="25" y="15" width="105" height="14" rx="7" fill="#d97757" opacity="0.3" />
            <line x1="25" y1="22" x2="130" y2="22" stroke="#c96442" strokeWidth="3" />
            <circle cx="25" cy="22" r="12" fill="#c96442" stroke="#fff" strokeWidth="2" />
            <text x="25" y="23" textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize="9" fontWeight="bold">始</text>
            <circle cx="130" cy="22" r="10" fill="#faf9f5" stroke="#c96442" strokeWidth="2" />
            <text x="130" y="23" textAnchor="middle" dominantBaseline="middle" fill="#c96442" fontSize="9" fontWeight="bold">终</text>
          </svg>
        </div>
      </div>
    </div>
  );
}

/* ── 2. 采音与排键 ── */
function ChartingSection() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-ink">🎵 采音与排键交互</h3>
        <p className="mt-1 text-stone">掌握单点 (Tap)、长条 (Hold)、双押、删除点与跳点 audition 听感机制。</p>
      </div>

      <SectionCard title="采音点导航与试听 (Audition)" icon="🎧">
        <p className="text-olive">
          编辑器会自动吸附音频中的采音点（Onset）。通过按键在采音点间穿梭时，具有纯净的声学反馈：
        </p>
        <ul className="list-disc list-inside space-y-1 mt-2 text-olive">
          <li>按 <KeyBadge>Q</KeyBadge>：向前跳至上一个采音点；</li>
          <li>按 <KeyBadge>E</KeyBadge>：向后跳至下一个采音点；</li>
          <li><strong>优化听感机制</strong>：按 QE 跳转时仅播放落点处的原声音频片断，不会叠加额外的 kick 鼓声，方便校准旋律与人声对齐。</li>
        </ul>
      </SectionCard>

      <SectionCard title="单点 (Tap) 与长条 (Hold) 排键" icon="🖐️">
        <div className="space-y-2 text-olive">
          <p>
            <strong>单点指派</strong>：将播放头移动到某个采音点上，鼠标直接左键点击六角盘中对应的通道（0~5），即可为该点指派该键位的音符。再次点击可取消指派。
          </p>
          <p>
            <strong>长条 (Hold) 录入</strong>：先指派头部键位，随后将播放头移动到预期结束的位置，按住 <KeyBadge>Shift</KeyBadge> 点击该键位，即可将音符延伸为长条；再次点击该键位可还原为普通单点。
          </p>
          <p>
            <strong>双押与多押</strong>：同个采音点上支持指派多个键位（如双押）；舞立方实机推荐最大不超过双押，以符合双手打击舒适度。
          </p>
        </div>
      </SectionCard>

      <SectionCard title="删除整采音点 (Delete)" icon="🗑️">
        <p className="text-olive">
          当播放头停留在某个采音点时，直接按下 <KeyBadge>Delete</KeyBadge> 键，将<strong>完全删除该采音点本身</strong>（不仅清除当前排键，而是从谱面时间轴中彻底移除该点）。支持通过 <KeyBadge>Ctrl + Z</KeyBadge> 随时回退撤销。
        </p>
      </SectionCard>

      <SectionCard title="冲突诊断与一键跳转" icon="⚠️">
        <p className="text-olive">
          顶部走带栏会实时统计当前工程存在的风险点：
        </p>
        <ul className="list-disc list-inside space-y-1.5 mt-2 text-olive">
          <li><strong>长条重叠警报</strong>：当同个通道出现长条尚未释放即落入新音符时触发。点击顶部的 <span className="text-err font-semibold">“⚠ X 处长条重叠”</span> 标签，页面直接自动跳至该重叠位置！</li>
          <li><strong>三押及以上警报</strong>：当某一瞬时打击数（含长条尾点）≥ 3 时触发感叹号警报。点击 <span className="text-err font-semibold">“⚠ X 处三押及以上”</span> 即可快速循环定位！</li>
        </ul>
      </SectionCard>
    </div>
  );
}

/* ── 3. 拖拽与镜像 ── */
function DragMirrorSection() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-ink">🖱️ 拖拽换列、镜像与随机排键</h3>
        <p className="mt-1 text-stone">支持直观的音符视觉拖拽换键，以及针对单个采音点或整段 Clip 的几何镜像。</p>
      </div>

      <SectionCard title="鼠标拖拽换列" icon="✋">
        <p className="text-olive">
          在中央的六角盘预览区中，如果当前采音点已有排键，您可以直接<strong>按住音符并拖拽移动</strong>到另一个目标键位上释放，即可瞬间完成音符的键位转移。
        </p>
      </SectionCard>

      <SectionCard title="单点排键水平与垂直镜像" icon="🪞">
        <div className="space-y-2 text-olive">
          <div className="rounded-lg bg-cream/50 p-2.5">
            <span className="font-semibold text-ink">水平镜像（I 键）</span>
            <p className="mt-0.5">当播放头处于某采音点时按下 <KeyBadge>I</KeyBadge>，将左侧键位与右侧对应镜像互换：0 ↔ 5（上排）、1 ↔ 4（中排）、2 ↔ 3（下排）。</p>
          </div>
          <div className="rounded-lg bg-cream/50 p-2.5">
            <span className="font-semibold text-ink">垂直镜像（O 键）</span>
            <p className="mt-0.5">按下 <KeyBadge>O</KeyBadge> 键，将上排与下排对应镜像互换：0 ↔ 2、5 ↔ 3，中排 1 与 4 保持在中间。</p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="整段 Clip 批量左右镜像 (Ctrl + M)" icon="🔁">
        <p className="text-olive">
          在右侧结构面板中点击选中一个或多个段落（Clip），按下 <KeyBadge>Ctrl + M</KeyBadge>（或点击段落栏的“左右镜像排键”按钮），即可<strong>对所选区间内的全部音符进行水平左右镜像翻转</strong>。非常适合用于副歌第二遍（Chorus 2）制造呼应与手感变奏！
        </p>
      </SectionCard>

      <SectionCard title="智能随机排键 (R / Ctrl + R)" icon="🎲">
        <p className="text-olive">
          按下 <KeyBadge>R</KeyBadge> 键可结合前后的手感流向，自动为当前采音点推荐并指派最合理的音符；按下 <KeyBadge>Ctrl + R</KeyBadge> 可强制换一种随机排键方案。
        </p>
      </SectionCard>
    </div>
  );
}

/* ── 4. 标记互换与剪贴板 ── */
function MarkClipboardSection() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-ink">🔄 标记互换、剪贴板与时间复制</h3>
        <p className="mt-1 text-stone">利用标记 A/B 键位呼唤互换，多段剪贴板复制，以及一键提取时间段文字。</p>
      </div>

      <SectionCard title="采音点排键标记互换 (Alt+C & Alt+V)" icon="📍">
        <p className="text-olive">
          当您需要将相隔两处的采音点排键完全互换时，无需手动重排：
        </p>
        <ol className="list-decimal list-inside space-y-1.5 mt-2 text-olive">
          <li><strong>标记点 A</strong>：将播放头移动到第一个采音点，按下 <KeyBadge>Alt + C</KeyBadge>，系统提示已标记该点为 A；</li>
          <li><strong>互换点 B</strong>：将播放头移动到目标采音点 B，按下 <KeyBadge>Alt + V</KeyBadge>，系统立即<strong>将点 A 与点 B 的排键配置（包括单点与长条）完全互换</strong>！</li>
          <li><strong>取消标记</strong>：随时按下 <KeyBadge>Esc</KeyBadge> 键可清除已标记的点 A。</li>
        </ol>
      </SectionCard>

      <SectionCard title="当前播放头时间点复制 (Ctrl + Alt + C)" icon="⏱️">
        <p className="text-olive">
          当播放头停留在某时刻，随时按下 <KeyBadge>Ctrl + Alt + C</KeyBadge>，或点击顶部走带栏 / 右侧面板上的 <span className="font-semibold text-charcoal bg-sand px-1.5 py-0.5 rounded">复制时间</span> 按钮，当前时间即写入剪贴板：
        </p>
        <div className="mt-2 rounded-lg bg-parchment p-2.5 font-mono text-[11px] text-ink">
          09 : 08 : 44
        </div>
        <p className="text-[11px] text-stone mt-1">（格式固定为分 : 秒 : 百分之一秒/厘秒，避开浏览器审查元素冲突，方便记录与沟通）。</p>
      </SectionCard>

      <SectionCard title="Clip 时段起止一键复制" icon="📋">
        <p className="text-olive">
          在右侧“结构 clip”面板中：
        </p>
        <ul className="list-disc list-inside space-y-1 mt-1.5 text-olive">
          <li><strong>复制此时段</strong>：点击卡片下方的“复制此时段”，复制单条如 <code className="bg-cream px-1 py-0.5 rounded">S01: 01 : 46 : 07 ~ 02 : 03 : 49</code>；</li>
          <li><strong>一键复制所有时段</strong>：点击顶部“一键复制所有时段”，自动将所有已设 Clip 换行拼合全部导出到剪贴板。</li>
        </ul>
      </SectionCard>

      <SectionCard title="多音符序列剪切板 (Ctrl+C / Ctrl+V)" icon="✂️">
        <p className="text-olive">
          选中单选或多选 Clip 后，按下 <KeyBadge>Ctrl + C</KeyBadge> 复制排键序列；移动到任意新的采音点位置，按下 <KeyBadge>Ctrl + V</KeyBadge> 即可整段粘帖覆盖。
        </p>
      </SectionCard>
    </div>
  );
}

/* ── 5. 模拟器模式 ── */
function SimulatorSection() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-ink">🎮 舞立方模拟器模式 (Simulator Mode)</h3>
        <p className="mt-1 text-stone">还原街机实机 6 键物理手感，支持全键位自由映射与真实长条手势录入。</p>
      </div>

      <SectionCard title="模拟器模式的核心特性" icon="🕹️">
        <ul className="list-disc list-inside space-y-1 text-olive">
          <li><strong>双重键位标注</strong>：无论是否开启模拟器，预览区各键位始终清晰标注物理轨位 <strong>0 ~ 5</strong>；开启模拟器后，会额外标注当前绑定的键盘按键（默认通道 0–5 依次为 {DEFAULT_SIMULATOR_KEYMAP.map((binding) => binding.label).join("、")}）。</li>
          <li><strong>真实打击手感</strong>：在模拟器模式下敲击对应按键即可直接录入 Tap，长按按键并配合方向键延伸录入 Hold。</li>
          <li><strong>输入捕获保护</strong>：点击预览区任意位置可确保模拟器焦点就绪，防止被其他输入控件失焦。</li>
        </ul>
      </SectionCard>

      <SectionCard title="自由指派模拟器快捷键" icon="⌨️">
        <p className="text-olive">
          点击走带栏中的 <KeyBadge>⌨ 键位设置</KeyBadge> 按钮，即可打开专用的模拟器键位映射窗口：
        </p>
        <ul className="list-disc list-inside space-y-1.5 mt-2 text-olive">
          <li><strong>直观环形映射</strong>：界面按照机台实机（左上0/右上5、左中1/右中4、左下2/右下3）对应呈现；</li>
          <li><strong>一键更换键位</strong>：点击任意一个通道卡片进入修改状态，随后在键盘上敲击目标键，即可瞬间完成自定义绑定；</li>
          <li><strong>实时触发测试</strong>：在设置弹窗中直接敲击按键，对应通道会实时亮起高光，手感一目了然；</li>
          <li><strong>智能冲突校验</strong>：如果绑定的按键重复，会自动高亮提示冲突通道，防止误指派。</li>
        </ul>
      </SectionCard>
    </div>
  );
}

/* ── 6. 工程与导出 ── */
function ProjectsSection() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-ink">📁 工程管理、快照与导出</h3>
        <p className="mt-1 text-stone">工程导入解包、快照自动保存、一曲多谱打包及导出为 Malody V 格式。</p>
      </div>

      <SectionCard title="工程导入与格式支持" icon="📦">
        <p className="text-olive">
          在编辑器首页或工程面板中，支持直接导入：
        </p>
        <ul className="list-disc list-inside space-y-1 mt-1 text-olive">
          <li><strong>Malody V .mcz 压缩包</strong>：自动解包提取内部音频（OGG）、封面与所有 mode:9 谱面；</li>
          <li><strong>单个 .mc 谱面与分离音频/封面</strong>：分别选择 .mc 与配乐（mp3/ogg/wav）建立受管工程。</li>
        </ul>
      </SectionCard>

      <SectionCard title="快照版本管理与回滚" icon="🗂️">
        <p className="text-olive">
          编辑器具备强大的防丢机制。不仅支持实时的 <KeyBadge>Ctrl + Z</KeyBadge> / <KeyBadge>Ctrl + Y</KeyBadge> 步进撤销重做，还可在右侧“快照”面板中随时创建带标签的历史版本，随时一键回滚。
        </p>
      </SectionCard>

      <SectionCard title="打包导出为 .mcz" icon="⇩">
        <p className="text-olive">
          点击右上角醒目的陶土色 <KeyBadge>⇩ 导出</KeyBadge> 按钮：
        </p>
        <ul className="list-disc list-inside space-y-1 mt-1 text-olive">
          <li>支持选择包内包含的变体难度谱面（一曲多谱）；</li>
          <li>点击“浏览”唤出系统现代资源管理器，自由选取电脑中的任意输出目录；</li>
          <li>自动转码生成标准 OGG Vorbis 44.1kHz 音频与规范 Mode:9 .mc 谱面，直接拖拽入 Malody V 即可游玩！</li>
        </ul>
      </SectionCard>
    </div>
  );
}

/* ── 7. 快捷键速查 ── */
function ShortcutsSection() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-ink">⌨️ 常用快捷键速查表</h3>
        <p className="mt-1 text-stone">掌握这些快捷键，让排键与校对效率倍增。</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-cream bg-white">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-cream bg-sand/40 text-stone">
            <tr>
              <th className="px-3.5 py-2 font-semibold">功能类别</th>
              <th className="px-3.5 py-2 font-semibold">快捷键</th>
              <th className="px-3.5 py-2 font-semibold">说明</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cream/60 text-olive">
            <tr>
              <td className="px-3.5 py-2 font-medium text-ink">播放控制</td>
              <td className="px-3.5 py-2"><KeyBadge>Space</KeyBadge></td>
              <td className="px-3.5 py-2">播放 / 暂停</td>
            </tr>
            <tr>
              <td className="px-3.5 py-2 font-medium text-ink">复位开头</td>
              <td className="px-3.5 py-2"><KeyBadge>Home</KeyBadge></td>
              <td className="px-3.5 py-2">播放头回到 00:00.000</td>
            </tr>
            <tr>
              <td className="px-3.5 py-2 font-medium text-ink">采音跳点</td>
              <td className="px-3.5 py-2"><KeyBadge>Q</KeyBadge> / <KeyBadge>E</KeyBadge></td>
              <td className="px-3.5 py-2">跳转上一个 / 下一个采音点（仅放原声无鼓）</td>
            </tr>
            <tr>
              <td className="px-3.5 py-2 font-medium text-ink">删除采音点</td>
              <td className="px-3.5 py-2"><KeyBadge>Delete</KeyBadge></td>
              <td className="px-3.5 py-2">整点删除当前停留的采音点</td>
            </tr>
            <tr>
              <td className="px-3.5 py-2 font-medium text-ink">单点排键镜像</td>
              <td className="px-3.5 py-2"><KeyBadge>I</KeyBadge> / <KeyBadge>O</KeyBadge></td>
              <td className="px-3.5 py-2">水平左右镜像 (I) / 垂直上下镜像 (O)</td>
            </tr>
            <tr>
              <td className="px-3.5 py-2 font-medium text-ink">Clip段落镜像</td>
              <td className="px-3.5 py-2"><KeyBadge>Ctrl + M</KeyBadge></td>
              <td className="px-3.5 py-2">左右水平镜像选中 Clip 内的所有排键</td>
            </tr>
            <tr>
              <td className="px-3.5 py-2 font-medium text-ink">排键互换</td>
              <td className="px-3.5 py-2"><KeyBadge>Alt + C</KeyBadge> → <KeyBadge>Alt + V</KeyBadge></td>
              <td className="px-3.5 py-2">先在点A按Alt+C标记，再在点B按Alt+V互换排键</td>
            </tr>
            <tr>
              <td className="px-3.5 py-2 font-medium text-ink">复制时间点</td>
              <td className="px-3.5 py-2"><KeyBadge>Ctrl + Alt + C</KeyBadge></td>
              <td className="px-3.5 py-2">复制当前时间点（如 09 : 08 : 44）</td>
            </tr>
            <tr>
              <td className="px-3.5 py-2 font-medium text-ink">随机排键</td>
              <td className="px-3.5 py-2"><KeyBadge>R</KeyBadge> / <KeyBadge>Ctrl + R</KeyBadge></td>
              <td className="px-3.5 py-2">单点随机排键 / 刷新随机方案</td>
            </tr>
            <tr>
              <td className="px-3.5 py-2 font-medium text-ink">撤销 / 重做</td>
              <td className="px-3.5 py-2"><KeyBadge>Ctrl + Z</KeyBadge> / <KeyBadge>Ctrl + Y</KeyBadge></td>
              <td className="px-3.5 py-2">排键与结构多级历史回退与重做</td>
            </tr>
            <tr>
              <td className="px-3.5 py-2 font-medium text-ink">快速保存</td>
              <td className="px-3.5 py-2"><KeyBadge>Ctrl + S</KeyBadge></td>
              <td className="px-3.5 py-2">保存工程当前状态</td>
            </tr>
            <tr>
              <td className="px-3.5 py-2 font-medium text-ink">使用说明</td>
              <td className="px-3.5 py-2"><KeyBadge>F1</KeyBadge></td>
              <td className="px-3.5 py-2">打开/关闭本帮助窗口</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── 8. 典型工作流 ── */
function UseCasesSection() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-ink">💡 典型工作流用例</h3>
        <p className="mt-1 text-stone">常见谱面制作场景的最佳实践指导。</p>
      </div>

      <SectionCard title="用例一：全新曲目快速排键实战" icon="🚀">
        <ol className="list-decimal list-inside space-y-1.5 text-olive">
          <li>导入歌曲 .mcz 或音频，进入编辑界面后先听一遍，检查节奏网格与吸附精度；</li>
          <li>使用 <KeyBadge>Space</KeyBadge> 播放，在主旋律或重拍处，配合 <KeyBadge>Q</KeyBadge> / <KeyBadge>E</KeyBadge> 定位采音点；</li>
          <li>点击六角盘为采音点指派键位；如果是长音，配合 <KeyBadge>Shift + 点击</KeyBadge> 拉出 Hold；</li>
          <li>对于不合理的采音点，停在上面直接按下 <KeyBadge>Delete</KeyBadge> 抹除。</li>
        </ol>
      </SectionCard>

      <SectionCard title="用例二：副歌变奏与段落结构复用" icon="🔁">
        <ol className="list-decimal list-inside space-y-1.5 text-olive">
          <li>在右侧段落面板，用 <KeyBadge>I</KeyBadge> 设起点，<KeyBadge>O</KeyBadge> 设终点创建副歌段落（Chorus 1）；</li>
          <li>选中该 Clip，按 <KeyBadge>Ctrl + C</KeyBadge> 复制整段排键序列；</li>
          <li>跳转到副歌 2（Chorus 2）的开始采音点，按下 <KeyBadge>Ctrl + V</KeyBadge> 粘贴整段；</li>
          <li>选中 Chorus 2 的 Clip，按下 <KeyBadge>Ctrl + M</KeyBadge> 一键进行左右镜像，再用 <KeyBadge>Alt+C/V</KeyBadge> 微调关键重拍！</li>
        </ol>
      </SectionCard>

      <SectionCard title="用例三：利用警报诊断排查手感缺陷" icon="🎯">
        <ol className="list-decimal list-inside space-y-1.5 text-olive">
          <li>完成一段排键后，观察顶部走带栏；若出现黄色/红色警报：</li>
          <li>点击 <span className="text-err font-semibold">“⚠ X 处长条重叠”</span>，编辑器立即飞到重叠位置，将前一个长条提早松开；</li>
          <li>点击 <span className="text-err font-semibold">“⚠ X 处三押及以上”</span>，检查是否意外将双手按键排成了不可打的三押，拆为双押或前后错位。</li>
        </ol>
      </SectionCard>
    </div>
  );
}
