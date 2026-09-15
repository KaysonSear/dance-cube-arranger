"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Column } from "@/lib/arrangement";
import {
  createSimulatorKeyBinding,
  DEFAULT_SIMULATOR_KEYMAP,
  findSimulatorKeyConflicts,
  simulatorColumnForKeyboard,
  type SimulatorKeyBinding,
  type SimulatorKeymap,
} from "@/lib/simulator-input";

export interface SimulatorKeymapModalProps {
  isOpen: boolean;
  onClose(): void;
  keymap: SimulatorKeymap;
  onSaveKeymap(nextKeymap: SimulatorKeymap): void;
}

const COLUMN_NAMES: Record<Column, { name: string; side: "left" | "right" }> = {
  0: { name: "左上 (Top-Left)", side: "left" },
  1: { name: "左中 (Mid-Left)", side: "left" },
  2: { name: "左下 (Bottom-Left)", side: "left" },
  3: { name: "右下 (Bottom-Right)", side: "right" },
  4: { name: "右中 (Mid-Right)", side: "right" },
  5: { name: "右上 (Top-Right)", side: "right" },
};

/**
 * 舞立方六键实机环形排布卡片对：
 * 第一排：左上 (0) 与 右上 (5)
 * 第二排：左中 (1) 与 右中 (4)
 * 第三排：左下 (2) 与 右下 (3)
 */
const LAYOUT_ROWS: readonly (readonly [Column, Column])[] = [
  [0, 5],
  [1, 4],
  [2, 3],
];

export function SimulatorKeymapModal({
  isOpen,
  onClose,
  keymap,
  onSaveKeymap,
}: SimulatorKeymapModalProps) {
  const [draft, setDraft] = useState<SimulatorKeymap>(keymap);
  const [activeModifyingCol, setActiveModifyingCol] = useState<Column | null>(null);
  const [testHitCol, setTestHitCol] = useState<Column | null>(null);
  const [testHitText, setTestHitText] = useState<string | null>(null);
  const testClearTimerRef = useRef<number | null>(null);

  const conflicts = useMemo(() => findSimulatorKeyConflicts(draft), [draft]);
  const conflictMap = useMemo(() => {
    const map = new Map<Column, Column[]>();
    for (const c of conflicts) {
      map.set(c.column, c.conflictsWith);
    }
    return map;
  }, [conflicts]);

  // 全局键盘监听（捕获自定义修改与实时敲击测试）
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // 正在修改某个列
      if (activeModifyingCol !== null) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setActiveModifyingCol(null);
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        const newBinding = createSimulatorKeyBinding(activeModifyingCol, {
          code: e.code,
          key: e.key,
          keyCode: e.keyCode,
        });

        const nextDraft = [...draft] as unknown as [
          SimulatorKeyBinding,
          SimulatorKeyBinding,
          SimulatorKeyBinding,
          SimulatorKeyBinding,
          SimulatorKeyBinding,
          SimulatorKeyBinding,
        ];
        nextDraft[activeModifyingCol] = newBinding;
        setDraft(nextDraft as unknown as SimulatorKeymap);

        const assignedCol = activeModifyingCol;
        setActiveModifyingCol(null);

        // 闪烁一下刚指派的键位以提供直观反馈
        setTestHitCol(assignedCol);
        setTestHitText(
          `✓ 已为通道 ${assignedCol} (${COLUMN_NAMES[assignedCol].name}) 指派按键 [${newBinding.label}]`,
        );

        if (testClearTimerRef.current !== null) {
          window.clearTimeout(testClearTimerRef.current);
        }
        testClearTimerRef.current = window.setTimeout(() => {
          setTestHitCol(null);
        }, 800);
        return;
      }

      // 未处于修改状态时：按 Esc 关闭弹窗
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      // 实时按键测试模式
      const matchedCol = simulatorColumnForKeyboard(e.code, e.key, e.keyCode, draft);
      if (matchedCol !== null) {
        setTestHitCol(matchedCol);
        setTestHitText(
          `实时测试命中：按下 [${draft[matchedCol].label}] (code: ${e.code || "N/A"}) → 触发通道 ${matchedCol} (${COLUMN_NAMES[matchedCol].name})`,
        );

        if (testClearTimerRef.current !== null) {
          window.clearTimeout(testClearTimerRef.current);
        }
        testClearTimerRef.current = window.setTimeout(() => {
          setTestHitCol(null);
        }, 350);
      } else {
        setTestHitText(
          `未映射按键：[${e.key.toUpperCase()}] (code: ${e.code || "N/A"}) 未绑定到任何通道`,
        );
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      if (testClearTimerRef.current !== null) {
        window.clearTimeout(testClearTimerRef.current);
      }
    };
  }, [activeModifyingCol, draft, isOpen, onClose]);

  if (!isOpen) return null;

  const handleResetDefaults = () => {
    setDraft(DEFAULT_SIMULATOR_KEYMAP);
    setActiveModifyingCol(null);
    setTestHitText("已重置为默认键位 (BELKZJ)");
  };

  const handleSave = () => {
    onSaveKeymap(draft);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="simulator-keymap-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl border border-cream bg-ivory shadow-2xl">
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-cream px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-ink" id="simulator-keymap-title">
              ⌨ 模拟器各通道排键快捷键设置
            </span>
            <span className="rounded-md bg-sand px-2 py-0.5 font-mono text-[11px] font-semibold text-charcoal">
              舞立方 6 键环形布局
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-stone transition-colors hover:bg-sand hover:text-ink"
            aria-label="关闭设置 (Esc)"
            title="关闭 (Esc)"
          >
            ✕
          </button>
        </div>

        {/* 主内容区 */}
        <div className="overflow-y-auto px-5 py-4 space-y-4 text-xs text-ink">
          {/* 状态反馈指示栏 */}
          <div
            className={`rounded-xl border p-3 transition-all ${
              activeModifyingCol !== null
                ? "border-clay bg-clay/10 text-clay shadow-sm"
                : testHitCol !== null
                  ? "border-amber-500 bg-amber-500/10 text-amber-900"
                  : "border-cream bg-sand/40 text-stone"
            }`}
          >
            {activeModifyingCol !== null ? (
              <div className="flex items-center gap-2 font-medium">
                <span className="inline-block h-2.5 w-2.5 animate-ping rounded-full bg-clay" />
                <span>
                  正在指派：<strong>通道 {activeModifyingCol}（{COLUMN_NAMES[activeModifyingCol].name}）</strong>
                  ，请在键盘上按下想要绑定的按键（按 <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink shadow-xs">Esc</kbd> 取消）
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span>
                  {testHitText ?? (
                    <>
                      💡 <strong>实时对应关系</strong>：点击下方任意键位卡片进入修改；在当前弹窗中敲击键盘可实时点亮对应通道。
                    </>
                  )}
                </span>
                {testHitCol !== null && (
                  <span className="shrink-0 rounded-full bg-amber-500 px-2 py-0.5 font-bold text-white text-[10px]">
                    ● 触发中
                  </span>
                )}
              </div>
            )}
          </div>

          {/* 冲突警告 */}
          {conflicts.length > 0 && (
            <div className="rounded-xl border border-err/30 bg-err/10 p-3 text-err">
              <strong className="block font-bold">⚠️ 检测到按键冲突：</strong>
              <ul className="mt-1 list-disc list-inside space-y-0.5 text-[11px]">
                {conflicts.map((c) => (
                  <li key={c.column}>
                    通道 {c.column} 与通道 {c.conflictsWith.join(", ")} 重复使用了按键 [
                    {c.label}]
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 舞立方环形六角排布对齐视图 */}
          <div className="rounded-xl border border-cream bg-parchment p-3.5 shadow-inner">
            <div className="mb-2 text-center text-[11px] font-semibold text-stone">
              机台环形键位对应视图（从上至下依次为上/中/下排）
            </div>

            <div className="space-y-3">
              {LAYOUT_ROWS.map(([leftCol, rightCol]) => {
                const leftBinding = draft[leftCol];
                const rightBinding = draft[rightCol];
                const leftActive = activeModifyingCol === leftCol;
                const rightActive = activeModifyingCol === rightCol;
                const leftHit = testHitCol === leftCol;
                const rightHit = testHitCol === rightCol;
                const leftConflict = conflictMap.has(leftCol);
                const rightConflict = conflictMap.has(rightCol);

                return (
                  <div key={`${leftCol}-${rightCol}`} className="grid grid-cols-2 gap-3">
                    {/* 左侧按键 */}
                    <button
                      type="button"
                      onClick={() => setActiveModifyingCol(leftCol)}
                      className={`group relative flex items-center justify-between rounded-xl border p-3 text-left transition-all ${
                        leftActive
                          ? "border-clay ring-2 ring-clay/40 bg-clay/10 scale-[1.01]"
                          : leftHit
                            ? "border-amber-500 ring-2 ring-amber-400/50 bg-amber-500/15"
                            : leftConflict
                              ? "border-err/50 bg-err/5 hover:border-err"
                              : "border-cream bg-white hover:border-clay/40 hover:bg-ivory"
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sand font-mono text-[11px] font-bold text-charcoal">
                            {leftCol}
                          </span>
                          <span className="font-semibold text-ink">
                            {COLUMN_NAMES[leftCol].name}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-stone">
                          {leftActive ? (
                            <span className="font-semibold text-clay animate-pulse">
                              ● 请按任意键...
                            </span>
                          ) : (
                            <span className="font-mono text-[10px]">code: {leftBinding.code}</span>
                          )}
                        </div>
                        {leftConflict && (
                          <span className="mt-0.5 inline-block text-[10px] text-err">
                            ⚠️ 与通道 {conflictMap.get(leftCol)?.join("/")} 冲突
                          </span>
                        )}
                      </div>

                      <div
                        className={`flex h-11 w-12 shrink-0 items-center justify-center rounded-lg font-mono text-base font-bold shadow-xs transition-all ${
                          leftActive
                            ? "bg-clay text-white shadow-md ring-2 ring-clay/50"
                            : leftHit
                              ? "bg-amber-500 text-white shadow-md scale-105"
                              : "bg-sand-deep text-ink group-hover:bg-sand"
                        }`}
                      >
                        {leftActive ? "…" : leftBinding.label}
                      </div>
                    </button>

                    {/* 右侧按键 */}
                    <button
                      type="button"
                      onClick={() => setActiveModifyingCol(rightCol)}
                      className={`group relative flex items-center justify-between rounded-xl border p-3 text-left transition-all ${
                        rightActive
                          ? "border-clay ring-2 ring-clay/40 bg-clay/10 scale-[1.01]"
                          : rightHit
                            ? "border-amber-500 ring-2 ring-amber-400/50 bg-amber-500/15"
                            : rightConflict
                              ? "border-err/50 bg-err/5 hover:border-err"
                              : "border-cream bg-white hover:border-clay/40 hover:bg-ivory"
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sand font-mono text-[11px] font-bold text-charcoal">
                            {rightCol}
                          </span>
                          <span className="font-semibold text-ink">
                            {COLUMN_NAMES[rightCol].name}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-stone">
                          {rightActive ? (
                            <span className="font-semibold text-clay animate-pulse">
                              ● 请按任意键...
                            </span>
                          ) : (
                            <span className="font-mono text-[10px]">code: {rightBinding.code}</span>
                          )}
                        </div>
                        {rightConflict && (
                          <span className="mt-0.5 inline-block text-[10px] text-err">
                            ⚠️ 与通道 {conflictMap.get(rightCol)?.join("/")} 冲突
                          </span>
                        )}
                      </div>

                      <div
                        className={`flex h-11 w-12 shrink-0 items-center justify-center rounded-lg font-mono text-base font-bold shadow-xs transition-all ${
                          rightActive
                            ? "bg-clay text-white shadow-md ring-2 ring-clay/50"
                            : rightHit
                              ? "bg-amber-500 text-white shadow-md scale-105"
                              : "bg-sand-deep text-ink group-hover:bg-sand"
                        }`}
                      >
                        {rightActive ? "…" : rightBinding.label}
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 实时键位对应关系一览表 */}
          <div className="rounded-xl border border-cream bg-white p-3">
            <div className="text-[11px] font-semibold text-stone mb-1.5">
              当前修改中的按键映射概览（实时）：
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
              {draft.map((b) => (
                <div
                  key={b.column}
                  className={`rounded-lg p-1.5 border transition-all ${
                    testHitCol === b.column
                      ? "border-amber-500 bg-amber-500/10 font-bold"
                      : "border-cream bg-sand/30"
                  }`}
                >
                  <div className="text-[10px] text-stone">通道 {b.column}</div>
                  <div className="font-mono text-sm font-bold text-ink">{b.label}</div>
                  <div className="text-[9px] text-stone truncate">{COLUMN_NAMES[b.column].name.slice(0, 2)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 底部按钮栏 */}
        <div className="flex items-center justify-between border-t border-cream bg-sand/30 px-5 py-3 rounded-b-2xl">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="rounded-xl border border-cream bg-white px-3 py-1.5 text-xs text-stone shadow-xs hover:bg-sand hover:text-ink"
          >
            恢复默认 (BELKZJ)
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-cream bg-white px-3 py-1.5 text-xs text-stone shadow-xs hover:bg-sand hover:text-ink"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-xl bg-clay px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-clay/90"
            >
              保存并应用
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
