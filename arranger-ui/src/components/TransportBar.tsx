"use client";

/**
 * 顶部走带栏(象牙面):播放控制 + 实时时间/拍读数(直接写 DOM,避免 60fps 重渲染)+
 * 撤销/重做 + 快照/导出入口 + 工程返回 + 统计与保存指示。导出为陶土主 CTA。
 */

import { useEffect, useRef, useState } from "react";

import UpdateDialog from "@/components/UpdateDialog";
import type { AudioClock } from "@/hooks/useAudioClock";
import { useAppUpdate } from "@/hooks/useAppUpdate";
import { fmtBeatFloat, fmtTime } from "@/lib/format";
import type { SimulatorKeymap } from "@/lib/simulator-input";
import { audioSecToBeat, type TimingContext } from "@/lib/timemap";

export interface TransportBarProps {
  clock: AudioClock;
  timing: TimingContext;
  playing: boolean;
  projectTitle: string;
  selectedIndex: number | null;
  totalOnsets: number;
  assignedCount: number;
  warningCount: number;
  tripleWarningCount?: number;
  canUndoArrangement: boolean;
  canRedoArrangement: boolean;
  canUndoStructure: boolean;
  canRedoStructure: boolean;
  saveStamp: string | null;
  simulatorMode: boolean;
  simulatorGestureActive: boolean;
  simulatorCaptureReady: boolean;
  simulatorKeymap?: SimulatorKeymap;
  onUndoArrangement(): void;
  onRedoArrangement(): void;
  onUndoStructure(): void;
  onRedoStructure(): void;
  onSnapshotPanel(): void;
  onExportPanel(): void;
  onOpenHelp?(): void;
  onSimulatorModeChange(on: boolean): void;
  onOpenSimulatorKeymap?(): void;
  onJumpToHoldOverlap?(): void;
  onJumpToTriple?(): void;
  onCopyTimePoint?(): void;
  onExit(): void;
}

export default function TransportBar(props: TransportBarProps) {
  const [updateOpen, setUpdateOpen] = useState(false);
  const { currentVersion, updateInfo, loading: updateLoading, error: updateError, hasUpdate, latestVersion, checkUpdate } = useAppUpdate();
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const beatRef = useRef<HTMLSpanElement | null>(null);
  const propsRef = useRef(props);

  useEffect(() => {
    propsRef.current = props;
  }, [props]);

  useEffect(() => {
    return props.clock.subscribe((t) => {
      if (timeRef.current) timeRef.current.textContent = fmtTime(t);
      if (beatRef.current) {
        const b = audioSecToBeat(t, propsRef.current.timing);
        beatRef.current.textContent = b >= 0 ? fmtBeatFloat(b) : "—";
      }
    });
  }, [props.clock]);

  const {
    clock,
    playing,
    projectTitle,
    selectedIndex,
    totalOnsets,
    assignedCount,
    warningCount,
    canUndoArrangement,
    canRedoArrangement,
    canUndoStructure,
    canRedoStructure,
    saveStamp,
    simulatorMode,
    simulatorGestureActive,
    simulatorCaptureReady,
  } = props;

  const btn =
    "rounded-lg bg-sand px-2.5 py-1 text-xs text-charcoal shadow-ring hover:bg-sand-deep disabled:opacity-40 disabled:hover:bg-sand";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-cream bg-ivory px-3 py-2">
      <button
        className="rounded-lg px-1.5 py-0.5 text-xs text-olive hover:text-ink"
        title="返回工程列表"
        onClick={props.onExit}
      >
        ← 工程
      </button>
      <span className="font-serif text-sm font-medium tracking-wide text-ink flex items-baseline gap-2">
        舞立方谱面编辑器
        <span className="font-sans text-xs font-normal text-stone">{projectTitle}</span>
        {(projectTitle.includes("示例") || projectTitle.includes("WDA")) && (
          <span className="rounded bg-sand-deep px-1.5 py-0.5 text-[10px] font-medium text-olive shadow-sm">
            示例
          </span>
        )}
        <span
          onClick={() => setUpdateOpen(true)}
          className="font-sans font-mono text-[11px] text-stone hover:text-ink cursor-pointer transition-colors"
          title="点击查看版本与检查更新"
        >
          v{currentVersion}
        </span>
        {hasUpdate && (
          <button
            type="button"
            onClick={() => setUpdateOpen(true)}
            className="animate-pulse inline-flex items-center gap-1 rounded-full bg-clay px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-coral transition-colors cursor-pointer"
            title={`发现新版本 v${latestVersion}，点击查看详情并下载`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />
            <span>新版 v{latestVersion}</span>
          </button>
        )}
      </span>

      <div className="flex items-center gap-1.5">
        <label
          className={`flex cursor-pointer items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-semibold shadow-ring transition-colors ${
            simulatorMode ? "bg-clay text-white" : "bg-sand text-charcoal hover:bg-sand-deep"
          }`}
          title={`六键模拟器：${(props.simulatorKeymap ?? []).map((b) => `${b.label}→${b.column}`).join(" ")}；开启后设备键为排键输入`}
        >
          <input
            type="checkbox"
            checked={simulatorMode}
            onChange={(event) => {
              props.onSimulatorModeChange(event.target.checked);
              event.currentTarget.blur();
            }}
            className="sr-only"
            aria-label={`模拟器 ${props.simulatorKeymap ? props.simulatorKeymap.map((b) => b.label).join("") : "BELKZJ"}`}
          />
          <span aria-hidden="true">{simulatorMode ? "●" : "○"}</span>
          模拟器 {props.simulatorKeymap ? props.simulatorKeymap.map((b) => b.label).join("") : "BELKZJ"}
          {simulatorGestureActive && <span className="animate-pulse">录入中</span>}
        </label>
        {props.onOpenSimulatorKeymap && (
          <button
            type="button"
            onClick={props.onOpenSimulatorKeymap}
            className="flex items-center gap-1 rounded-xl border border-cream bg-white px-2 py-1 text-xs font-medium text-stone shadow-xs hover:bg-sand hover:text-ink transition-colors"
            title="更换模拟器排键快捷键 (配置 6 键映射与实时测试)"
          >
            ⌨ 键位设置
          </button>
        )}
      </div>
      {simulatorMode && (
        <span
          role="status"
          className={`text-[11px] font-medium ${
            simulatorCaptureReady ? "text-olive" : "text-warn-ink"
          }`}
        >
          {simulatorCaptureReady ? "设备输入已就绪" : "点击预览区启用设备输入"}
        </span>
      )}

      <div className="flex items-center gap-1.5">
        <button disabled={!clock.ready} className={btn} title="回到开头 (Home)" onClick={() => clock.seek(0)}>
          ⏮
        </button>
        <button
          disabled={!clock.ready}
          className={`${btn} w-16 text-center font-semibold`}
          title="播放/暂停 (Space)"
          onClick={() => clock.toggle()}
        >
          {playing ? "⏸ 暂停" : "▶ 播放"}
        </button>
        <button
          disabled={!clock.ready}
          className={btn}
          title="从头播放"
          onClick={() => {
            clock.seek(0);
            clock.play();
          }}
        >
          ⏮▶ 从头
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <span ref={timeRef} className="font-mono text-sm text-ink">
          00:00.000
        </span>
        {props.onCopyTimePoint && (
          <button
            type="button"
            disabled={!clock.ready}
            className="rounded-lg bg-sand px-2 py-0.5 text-xs text-charcoal shadow-ring hover:bg-sand-deep hover:text-ink disabled:opacity-40 transition-colors"
            title="复制当前时间点 (Ctrl+Alt+C)"
            onClick={props.onCopyTimePoint}
          >
            复制时间
          </button>
        )}
      </div>
      <span ref={beatRef} className="w-28 font-mono text-xs text-olive">
        —
      </span>

      <span className="text-xs text-olive">
        采音点{" "}
        <span className="font-mono text-ink">
          {selectedIndex !== null ? `#${selectedIndex + 1}` : "—"}/{totalOnsets}
        </span>
        <span className="ml-3">
          已排 <span className="font-mono text-ink">{assignedCount}</span>
        </span>
        {warningCount > 0 && (
          props.onJumpToHoldOverlap ? (
            <button
              type="button"
              className="ml-3 text-err underline decoration-dotted underline-offset-2 hover:opacity-80 cursor-pointer"
              title={`点击跳转至下一个长条重叠处（共 ${warningCount} 处）`}
              onClick={props.onJumpToHoldOverlap}
            >
              ⚠ {warningCount} 处长条重叠
            </button>
          ) : (
            <span className="ml-3 text-err">⚠ {warningCount} 处长条重叠</span>
          )
        )}
        {(props.tripleWarningCount ?? 0) > 0 && (
          props.onJumpToTriple ? (
            <button
              type="button"
              className="ml-3 text-err underline decoration-dotted underline-offset-2 hover:opacity-80 cursor-pointer"
              title={`点击跳转至下一个三押及以上处（共 ${props.tripleWarningCount} 处，含长条尾）`}
              onClick={props.onJumpToTriple}
            >
              ⚠ {props.tripleWarningCount} 处三押及以上
            </button>
          ) : (
            <span className="ml-3 text-err">⚠ {props.tripleWarningCount} 处三押及以上</span>
          )
        )}
      </span>

      <div className="ml-auto flex items-center gap-1.5">
        {saveStamp && <span className="mr-1 text-[10px] text-stone">已保存 {saveStamp}</span>}
        <button
          className={btn}
          disabled={!canUndoArrangement}
          title="回退排键 (Z / Ctrl+Z)"
          onClick={props.onUndoArrangement}
        >
          ⟲ 排键
        </button>
        <button
          className={btn}
          disabled={!canRedoArrangement}
          title={
            canRedoArrangement
              ? "重做排键 (Ctrl+Y / Ctrl+Shift+Z)"
              : "重做排键仅在回退排键后可用；执行新排键会清空记录"
          }
          onClick={props.onRedoArrangement}
        >
          ⟳ 排键
        </button>
        <button
          className={btn}
          disabled={!canUndoStructure}
          title="回退分割、段名或段关系"
          onClick={props.onUndoStructure}
        >
          ⟲ 分割
        </button>
        <button
          className={btn}
          disabled={!canRedoStructure}
          title={
            canRedoStructure
              ? "重做分割、段名或段关系"
              : "重做分割仅在回退分割后可用；执行新结构编辑会清空记录"
          }
          onClick={props.onRedoStructure}
        >
          ⟳ 分割
        </button>
        <button className={btn} onClick={props.onSnapshotPanel}>
          🗂 快照
        </button>
        {props.onOpenHelp && (
          <button
            type="button"
            className="flex items-center gap-1 rounded-xl bg-linear-to-r from-clay to-coral px-3 py-1 text-xs font-bold text-white shadow-xs shadow-clay/20 ring-1 ring-white/20 hover:brightness-110 active:scale-95 transition-all cursor-pointer"
            title="查看使用说明与机制指南 (F1) · 点击将恢复下次启动默认弹出"
            onClick={props.onOpenHelp}
          >
            <span>📖</span>
            <span>说明</span>
          </button>
        )}
        <button
          className="rounded-xl bg-clay px-4 py-1 text-xs font-semibold text-white hover:bg-coral"
          onClick={props.onExportPanel}
        >
          ⇩ 导出
        </button>
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
