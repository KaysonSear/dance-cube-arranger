"use client";

/** 右侧检查面板(象牙面):**播放头所在**采音点的指派明细(可移除/改单点)+ 图例与统计。 */

import {
  assignmentsAt,
  type AssignmentsMap,
  type Column,
  type HoldOverlapWarning,
  type Onset,
  type TripleChordWarning,
} from "@/lib/arrangement";
import { beatToFloat } from "@/lib/beat";
import { NOTE_COLORS, noteColor } from "@/lib/colors";
import { fmtBeatFloat, fmtTime } from "@/lib/format";
import { type Geometry, zhLabel } from "@/lib/geometry";
import type { SimulatorKeyBinding } from "@/lib/simulator-input";
import { beatToAudioSec, type TimingContext } from "@/lib/timemap";

export interface InspectorPanelProps {
  geometry: Geometry;
  selectedOnset: Onset | null;
  assignments: AssignmentsMap;
  timing: TimingContext;
  warnings: HoldOverlapWarning[];
  tripleWarnings?: TripleChordWarning[];
  unassignedCount: number;
  simulatorKeymap?: readonly SimulatorKeyBinding[];
  onAssignAll(col: Column): void;
  onUnassign(col: Column): void;
  onClearHold(col: Column): void;
  onRandomize?(): void;
  markedSwapOnset?: Onset | null;
  onClearMarkedSwap?(): void;
  onOpenSimulatorKeymap?(): void;
  onJumpToHoldOverlap?(): void;
  onJumpToTriple?(): void;
  onDeleteOnset?(): void;
}

export default function InspectorPanel(props: InspectorPanelProps) {
  const {
    geometry,
    selectedOnset,
    assignments,
    timing,
    warnings,
    unassignedCount,
    markedSwapOnset,
    onClearMarkedSwap,
  } = props;

  return (
    <div className="space-y-3 p-3 text-xs text-olive">
      <div className="flex items-center gap-3 text-[11px]">
        <span className="flex items-center gap-1">
          <i
            className="inline-block h-2.5 w-2.5 rounded-sm shadow-ring"
            style={{ background: NOTE_COLORS.single }}
          />
          单押/长条
        </span>
        <span className="flex items-center gap-1">
          <i
            className="inline-block h-2.5 w-2.5 rounded-sm shadow-ring"
            style={{ background: NOTE_COLORS.chord }}
          />
          双押/多押
        </span>
        <span className="flex items-center gap-1">
          <i
            className="inline-block h-2.5 w-2.5 rounded-sm shadow-ring"
            style={{ background: NOTE_COLORS.unassigned }}
          />
          未指派 ({unassignedCount})
        </span>
      </div>

      {!selectedOnset ? (
        <div className="rounded-lg border border-dashed border-hairline p-3 leading-relaxed">
          <p className="text-ink">播放头早于第一个采音点。</p>
          <p className="mt-1">往后移动播放头即可开始排键(编辑对象 = 播放头之前最近的采音点);</p>
          <p>点击键位指派,再次点击 = 取消;<b>Shift+点击</b> = 延伸成长条;右击画面音符 = 删除。</p>
        </div>
      ) : (
        <SelectedInfo {...props} onset={selectedOnset} />
      )}

      {warnings.length > 0 && (
        props.onJumpToHoldOverlap ? (
          <button
            type="button"
            onClick={props.onJumpToHoldOverlap}
            className="w-full text-left rounded-lg bg-err-wash p-2 text-err hover:opacity-90 transition-opacity cursor-pointer block"
            title="点击跳转至下一个长条重叠处"
          >
            ⚠ {warnings.length} 处长条压过同列后续采音点(时间轴红色尾带)。点击跳转重叠处。
          </button>
        ) : (
          <div className="rounded-lg bg-err-wash p-2 text-err">
            ⚠ {warnings.length} 处长条压过同列后续采音点(时间轴红色尾带)。允许导出,但请确认手感。
          </div>
        )
      )}

      {(props.tripleWarnings?.length ?? 0) > 0 && (
        props.onJumpToTriple ? (
          <button
            type="button"
            onClick={props.onJumpToTriple}
            className="w-full text-left rounded-lg bg-err-wash p-2 text-err hover:opacity-90 transition-opacity cursor-pointer block"
            title="点击跳转至下一个三押及以上处"
          >
            ⚠ {props.tripleWarnings!.length} 处三押及以上(包括长条尾)。点击跳转警报处。
          </button>
        ) : (
          <div className="rounded-lg bg-err-wash p-2 text-err">
            ⚠ {props.tripleWarnings!.length} 处三押及以上(包括长条尾)。
          </div>
        )
      )}

      <div className="rounded-xl bg-cream p-2.5 shadow-ring">
        <label className="block font-medium text-ink" htmlFor="assign-all-column">
          批量排键
        </label>
        <select
          id="assign-all-column"
          value=""
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isInteger(value) && value >= 0 && value <= 5) {
              props.onAssignAll(value as Column);
            }
            event.currentTarget.blur();
          }}
          className="mt-1.5 w-full rounded-lg bg-white px-2 py-1.5 text-xs text-ink shadow-ring outline-none"
        >
          <option value="" disabled>
            所有采音点排至…
          </option>
          {([0, 1, 2, 3, 4, 5] as const).map((column) => (
            <option key={column} value={column}>
              所有采音点排至键 {column}（单点）
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[10px] leading-relaxed text-stone">
          覆盖现有单押、多押与长条；整批操作可一步回退。
        </p>
      </div>

      {markedSwapOnset && (
        <div className="flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-ink">
          <div className="min-w-0">
            <strong className="block font-bold text-amber-700">★ 已标记互换点 A</strong>
            <span className="mt-0.5 block font-mono text-[11px] text-stone">
              {fmtTime(beatToAudioSec(markedSwapOnset.beatFloat, timing))} · 移动播放头至点 B 按 Alt+V 互换
            </span>
          </div>
          {onClearMarkedSwap && (
            <button
              type="button"
              onClick={onClearMarkedSwap}
              className="ml-2 shrink-0 rounded-lg bg-white px-2 py-1 text-[11px] text-stone shadow-ring hover:text-err"
              title="取消标记 (Esc)"
            >
              取消
            </button>
          )}
        </div>
      )}

      <div className="leading-relaxed text-stone">
        快捷键:Space 播放 · Q/E 上下采音点 · ←/→ 快退快进(Shift×5) · Z 回退 · Ctrl+Y 重做 ·
        Ctrl+S 保存 · Ctrl+C/V 跨窗口复制粘贴键位 · Alt+C 标记点 A · Alt+V 互换排键 · Ctrl+M 镜像选中 clip ·
        I 设置起点 · O 完成 clip · Ctrl+点击桥段多选 · R 采音点智能随机排键(未选多段) / 标记重复(多选段) ·
        Delete 彻底删除采音点 · 右击 clip 色带删除 · 右击共用切口合并 · Esc 取消 I/选择/互换标记 · Shift+点击键位 = 设长条尾
      </div>
      <div className="mt-1 text-[10px] leading-relaxed text-stone">
        模拟器模式：{props.simulatorKeymap ? props.simulatorKeymap.map((b) => b.label).join("/") : "B/E/L/K/Z/J"} → 键 0–5；短按提交并前进，按住键位配合 ←/→
        选择独立长条尾；撤销请用 Ctrl+Z。
        {props.onOpenSimulatorKeymap && (
          <button
            type="button"
            onClick={props.onOpenSimulatorKeymap}
            className="ml-1 text-olive underline hover:text-ink cursor-pointer"
          >
            [修改模拟器键位]
          </button>
        )}
      </div>
    </div>
  );

  function SelectedInfo({
    onset,
    onUnassign,
    onClearHold,
    onRandomize,
  }: InspectorPanelProps & { onset: Onset }) {
    const list = assignmentsAt(assignments, onset.id);
    const color = noteColor(list.length);
    return (
      <div className="rounded-xl bg-white p-2.5 shadow-ring">
        <div className="flex items-center justify-between">
          <span className="font-mono text-sm" style={{ color }}>
            ● {fmtBeatFloat(onset.beatFloat)}
          </span>
          <div className="flex items-center gap-1.5">
            {onRandomize && (
              <button
                className="cursor-pointer rounded-md bg-sand px-2 py-0.5 text-[11px] text-ink shadow-ring hover:bg-sand-deep transition-colors"
                title="智能预测随机排键 (快捷键 R)"
                onClick={() => onRandomize()}
              >
                🎲 随机排键 (R)
              </button>
            )}
            {props.onDeleteOnset && (
              <button
                className="cursor-pointer rounded-md bg-err/10 px-2 py-0.5 text-[11px] text-err shadow-ring hover:bg-err/20 transition-colors"
                title="彻底删除此采音点 (快捷键 Delete)"
                onClick={() => props.onDeleteOnset?.()}
              >
                🗑️ 删除点 (Delete)
              </button>
            )}
          </div>
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-stone">
          beat [{onset.beat.join(", ")}] · {fmtTime(beatToAudioSec(onset.beatFloat, timing))}
        </div>
        <div className="mt-2 space-y-1.5">
          {list.length === 0 && <div className="text-stone">未指派 —— 点击键位开始</div>}
          {list.map((a) => (
            <div key={a.column} className="flex items-center gap-2 rounded-lg bg-cream px-2 py-1">
              <span className="font-mono text-ink">
                键 {a.column}({zhLabel(geometry.columns[String(a.column)]?.label ?? "")})
              </span>
              {a.endbeat ? (
                <span style={{ color: NOTE_COLORS.single }}>
                  长条 → {beatToFloat(a.endbeat).toFixed(2)}拍
                  <button
                    className="ml-1.5 text-stone hover:text-ink"
                    title="改回单点"
                    onClick={() => onClearHold(a.column)}
                  >
                    改单点
                  </button>
                </span>
              ) : (
                <span className="text-stone">单点</span>
              )}
              <button
                className="ml-auto text-stone hover:text-err"
                title="移除该键(右键键位同效)"
                onClick={() => onUnassign(a.column)}
              >
                移除
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }
}
