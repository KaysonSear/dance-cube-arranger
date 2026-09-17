"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { AudioClock } from "@/hooks/useAudioClock";
import { copyTextToClipboard } from "@/lib/clipboard";
import { fmtTime } from "@/lib/format";
import {
  deriveSegments,
  formatAllClipsRangeText,
  formatAllRelationsText,
  formatClipRangeText,
  formatClipTime,
  mergeClips,
  moveClipEdge,
  parseAbsoluteTime,
  partitionTimedPoints,
  relationIndexesForSegment,
  removeRelation,
  renameSegment,
  SEGMENT_RELATION_KINDS,
  updateRelationKind,
  updateRelationNote,
  type ClipEdge,
  type SegmentRelationKind,
  type SegmentStructureV3,
  type TimedPoint,
} from "@/lib/segments";
import { relationGroupCardBg, relationGroupColor, THEME } from "@/lib/theme";

export interface SegmentsPanelProps {
  structure: SegmentStructureV3;
  duration: number;
  timedOnsets: TimedPoint[];
  clock: AudioClock;
  selectedSegmentIds: Set<string>;
  onToggleSegment(id: string): void;
  onDeselectSegment?(id: string): void;
  onChange(structure: SegmentStructureV3): void;
  pendingInSec: number | null;
  onSetIn(): void;
  onCompleteOut(): void;
  onCancelIn(): void;
  onLoadSuggestions(): void;
  onClearStructure(): void;
  onToast(message: string): void;
  onMirrorSelected?(): void;
}

type FocusedEdge = { clipId: string; edge: ClipEdge } | null;

function edgeKey(clipId: string, edge: ClipEdge): string {
  return `${clipId}:${edge}`;
}

export default function SegmentsPanel(props: SegmentsPanelProps) {
  const {
    structure,
    duration,
    timedOnsets,
    clock,
    selectedSegmentIds,
    onToggleSegment,
    onDeselectSegment,
    onChange,
    pendingInSec,
    onSetIn,
    onCompleteOut,
    onCancelIn,
    onLoadSuggestions,
    onClearStructure,
    onToast,
    onMirrorSelected,
  } = props;
  const [focusedEdge, setFocusedEdge] = useState<FocusedEdge>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const playheadRef = useRef<HTMLSpanElement | null>(null);
  const segments = useMemo(() => deriveSegments(structure), [structure]);
  const pointCoverage = useMemo(
    () => partitionTimedPoints(segments, timedOnsets),
    [segments, timedOnsets],
  );
  const segmentById = useMemo(
    () => new Map(segments.map((segment) => [segment.id, segment])),
    [segments],
  );

  useEffect(() => {
    return clock.subscribe((sec) => {
      if (playheadRef.current) playheadRef.current.textContent = fmtTime(sec);
    });
  }, [clock]);

  function applyEdge(clipId: string, edge: ClipEdge, sec: number) {
    const result = moveClipEdge(structure, clipId, edge, sec, duration, timedOnsets);
    const key = edgeKey(clipId, edge);
    if (!result.ok) {
      onToast(result.error);
      setDrafts((previous) => {
        const next = { ...previous };
        delete next[key];
        return next;
      });
      return;
    }
    onChange(result.structure);
    if (!result.structure.clips.some((item) => item.id === clipId)) {
      setFocusedEdge(null);
      onToast("该 clip 已无采音点，已自动移除");
      return;
    }
    setDrafts((previous) => ({ ...previous, [key]: fmtTime(sec) }));
  }

  function commitDraft(clipId: string, edge: ClipEdge) {
    const key = edgeKey(clipId, edge);
    const value = drafts[key];
    if (value == null) return;
    const sec = parseAbsoluteTime(value);
    if (sec == null) {
      onToast("时间格式应为秒数或 mm:ss.mmm");
      setDrafts((previous) => {
        const next = { ...previous };
        delete next[key];
        return next;
      });
      return;
    }
    applyEdge(clipId, edge, sec);
  }

  function edgeInput(clipId: string, edge: ClipEdge, fixedSec: number) {
    const key = edgeKey(clipId, edge);
    const value = drafts[key] ?? fmtTime(fixedSec);
    const selected = focusedEdge?.clipId === clipId && focusedEdge.edge === edge;
    return (
      <input
        value={value}
        aria-label={`clip ${edge === "start" ? "开始" : "结束"}绝对时间`}
        onFocus={() => setFocusedEdge({ clipId, edge })}
        onChange={(event) => setDrafts((previous) => ({ ...previous, [key]: event.target.value }))}
        onBlur={() => commitDraft(clipId, edge)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDrafts((previous) => {
              const next = { ...previous };
              delete next[key];
              return next;
            });
            event.currentTarget.blur();
          }
        }}
        className={`w-[6.35rem] rounded-lg bg-white px-2 py-1 font-mono text-[11px] text-ink shadow-ring outline-none ${
          selected ? "ring-2 ring-focus" : ""
        }`}
      />
    );
  }

  async function handleCopySingle(segment: { code: string; startSec: number; endSec: number }) {
    const text = formatClipRangeText(segment);
    const ok = await copyTextToClipboard(text);
    if (ok) {
      onToast(`已复制 ${segment.code} 时段：${text}`);
    } else {
      onToast("复制失败，请检查剪贴板权限");
    }
  }

  async function handleCopyAll() {
    if (segments.length === 0) {
      onToast("当前没有可复制的段落");
      return;
    }
    const text = formatAllClipsRangeText(segments);
    const ok = await copyTextToClipboard(text);
    if (ok) {
      onToast(`已复制全部 ${segments.length} 个段落时段到剪贴板`);
    } else {
      onToast("复制失败，请检查剪贴板权限");
    }
  }

  async function handleCopyPlayheadTime() {
    const t = clock.getTime();
    const formatted = formatClipTime(t);
    const ok = await copyTextToClipboard(formatted);
    if (ok) {
      onToast(`已复制当前时间点：${formatted}`);
    } else {
      onToast("复制失败，请检查剪贴板权限");
    }
  }

  async function handleCopyAllRelations() {
    const text = formatAllRelationsText(structure);
    if (!text.trim()) {
      onToast("当前谱面没有已标记的语义或配对关系");
      return;
    }
    const ok = await copyTextToClipboard(text);
    if (ok) {
      onToast("已复制全部语义关系到剪贴板");
    } else {
      onToast("复制失败，请检查剪贴板权限");
    }
  }

  return (
    <details open className="border-t border-cream">
      <summary className="cursor-pointer select-none px-3 py-2 font-serif text-sm font-medium text-ink">
        结构 clip <span className="ml-1 font-sans text-[10px] text-stone">{segments.length} 段</span>
      </summary>
      <div className="space-y-3 px-3 pb-3 text-xs text-olive">
        <div className="rounded-xl bg-cream p-2.5 shadow-ring">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>播放头</span>
              <button
                type="button"
                disabled={duration <= 0}
                onClick={handleCopyPlayheadTime}
                className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-medium text-stone shadow-ring hover:bg-sand-deep hover:text-ink disabled:opacity-40 transition-colors"
                title="复制当前播放头时间点 (Ctrl+Alt+C)"
              >
                复制时间
              </button>
            </div>
            <span ref={playheadRef} className="font-mono text-ink">
              {fmtTime(clock.getTime())}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px]">
            <span>I 起点</span>
            <span className={pendingInSec == null ? "text-stone" : "font-mono font-semibold text-ink"}>
              {pendingInSec == null ? "未设置" : fmtTime(pendingInSec)}
            </span>
          </div>
          <button
            disabled={!focusedEdge || duration <= 0}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              if (focusedEdge) applyEdge(focusedEdge.clipId, focusedEdge.edge, clock.getTime());
            }}
            className="mt-2 w-full rounded-lg bg-sand px-2 py-1.5 text-charcoal shadow-ring hover:bg-sand-deep disabled:opacity-40"
          >
            将播放头填入当前框
          </button>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <button
              disabled={duration <= 0}
              onClick={onSetIn}
              className="rounded-lg bg-sand px-2 py-1.5 font-semibold text-charcoal shadow-ring hover:bg-sand-deep disabled:opacity-40"
            >
              设置 I（I）
            </button>
            <button
              disabled={duration <= 0 || pendingInSec == null}
              onClick={onCompleteOut}
              className="rounded-lg bg-clay px-2 py-1.5 font-semibold text-white hover:bg-coral disabled:opacity-40"
            >
              完成 O（O）
            </button>
          </div>
          {pendingInSec != null && (
            <button className="mt-1.5 w-full text-[11px] text-stone hover:text-ink" onClick={onCancelIn}>
              取消 I（Esc）
            </button>
          )}
          <div className="mt-2 grid grid-cols-2 gap-1.5 border-t border-hairline pt-2">
            <button
              disabled={duration <= 0}
              onClick={onLoadSuggestions}
              className="rounded-lg bg-white px-2 py-1.5 text-[11px] text-olive shadow-ring hover:text-ink disabled:opacity-40"
            >
              载入自动建议
            </button>
            <button
              onClick={onClearStructure}
              className="rounded-lg bg-white px-2 py-1.5 text-[11px] text-stone shadow-ring hover:text-err"
            >
              清空全部 clip
            </button>
          </div>
          {selectedSegmentIds.size > 0 && onMirrorSelected && (
            <div className="mt-2 border-t border-hairline pt-2">
              <button
                type="button"
                onClick={onMirrorSelected}
                className="w-full rounded-lg bg-white px-2 py-1.5 text-[11px] font-medium text-ink shadow-ring hover:bg-cream hover:text-focus transition-colors"
                title="水平镜像选中 clip 内的所有排键 (Ctrl+M)"
              >
                左右镜像排键 (Ctrl+M)
              </button>
            </div>
          )}
          <p className="mt-1.5 text-[10px] leading-relaxed text-stone">
            I 记录起点，O 创建并选中区间；Ctrl+M 镜像选中 clip；Ctrl+C 复制单选 clip。无采音点区间不会创建或编号。
            已有 clip 的起止时间仍可独立调整。
          </p>
        </div>

        <div className="space-y-2">
          {segments.length > 0 && (
            <div className="flex items-center justify-between px-1">
              <span className="font-mono text-[11px] font-semibold text-stone">
                段落时段 ({segments.length})
              </span>
              <button
                type="button"
                onClick={handleCopyAll}
                className="rounded-lg bg-sand px-2 py-1 text-[11px] font-semibold text-charcoal shadow-ring hover:bg-sand-deep hover:text-ink transition-colors"
                title="一键复制所有时段到剪贴板"
              >
                一键复制所有时段
              </button>
            </div>
          )}
          {segments.map((segment, index) => {
            const nextSegment = segments[index + 1] ?? null;
            const count = pointCoverage.bySegment[index]?.length ?? 0;
            const relationIndexes = relationIndexesForSegment(structure.relations, segment.id);
            const hasRelation = relationIndexes.length > 0;
            const primaryRelIndex = hasRelation ? relationIndexes[0] : -1;
            const cardBg = hasRelation ? relationGroupCardBg(primaryRelIndex) : "#ffffff";
            const borderLeft = hasRelation
              ? `4px solid ${relationGroupColor(primaryRelIndex)}`
              : "4px solid transparent";
            const relationShadow = relationIndexes
              .slice(1)
              .map(
                (relationIndex, layer) =>
                  `inset 0 0 0 ${(layer + 1) * 2}px ${relationGroupColor(relationIndex)}`,
              )
              .join(", ");
            const selected = selectedSegmentIds.has(segment.id);
            return (
              <div
                key={segment.id}
                onPointerDown={(event) => {
                  const target = event.target as HTMLElement;
                  if (target.tagName === "INPUT" || target.tagName === "BUTTON") {
                    return;
                  }
                  (document.activeElement as HTMLElement)?.blur?.();
                  if (event.ctrlKey || event.metaKey) {
                    event.preventDefault();
                    onToggleSegment(segment.id);
                  }
                }}
                onContextMenu={(event) => {
                  const target = event.target as HTMLElement;
                  if (target.tagName === "INPUT") {
                    return;
                  }
                  event.preventDefault();
                  if (selectedSegmentIds.has(segment.id)) {
                    if (onDeselectSegment) {
                      onDeselectSegment(segment.id);
                    } else {
                      onToggleSegment(segment.id);
                    }
                    onToast(`已取消选中 ${segment.code}`);
                  }
                }}
                title={
                  selected
                    ? `右键单击取消选中 ${segment.code} · 按住 Ctrl 单击多选/切换`
                    : "按住 Ctrl 单击选中"
                }
                className="rounded-xl p-2 shadow-ring transition-colors"
                style={{
                  backgroundColor: cardBg,
                  borderLeft,
                  ...(relationShadow ? { boxShadow: relationShadow } : {}),
                  ...(selected
                    ? {
                        outline: `2px dashed ${THEME.timeline.segmentSelected}`,
                        outlineOffset: "2px",
                      }
                    : {}),
                }}
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  <strong className="font-mono text-ink">{segment.code}</strong>
                  {segment.role === "intro" && (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 border border-emerald-300">
                      Intro
                    </span>
                  )}
                  {segment.role === "outro" && (
                    <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-800 border border-indigo-300">
                      Outro
                    </span>
                  )}
                  {segment.role === "drop" && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-300">
                      Drop
                    </span>
                  )}
                  {segment.role === "buildup" && (
                    <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-800 border border-orange-300">
                      Build-Up
                    </span>
                  )}
                  {segment.role === "break" && (
                    <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-bold text-teal-800 border border-teal-300">
                      Break
                    </span>
                  )}
                  {relationIndexes.map((relIdx) => {
                    const rel = structure.relations[relIdx];
                    if (!rel) return null;
                    return (
                      <span
                        key={rel.id}
                        className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold text-white shadow-sm"
                        style={{ backgroundColor: relationGroupColor(relIdx) }}
                      >
                        {relationBadge(rel.kind, relIdx + 1)}
                      </span>
                    );
                  })}
                  <input
                    value={segment.label}
                    placeholder="名称（可选）"
                    onChange={(event) => onChange(renameSegment(structure, segment.id, event.target.value))}
                    className="min-w-0 flex-1 rounded-lg bg-cream px-2 py-1 text-[11px] text-ink outline-none focus:ring-2 focus:ring-focus"
                  />
                  {nextSegment && (
                    <button
                      title="与下一 clip 合并（包含中间空白）"
                      onClick={() => {
                        const result = mergeClips(structure, segment.id, nextSegment.id);
                        if (!result.ok) onToast(result.error);
                        else onChange(result.structure);
                      }}
                      className="px-1 text-stone hover:text-err"
                    >
                      合并↓
                    </button>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-1">
                  {edgeInput(segment.id, "start", segment.startSec)}
                  <span className="text-stone">→</span>
                  {edgeInput(segment.id, "end", segment.endSec)}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleCopySingle(segment);
                    }}
                    className="rounded-lg bg-sand px-2 py-1 text-[10px] font-semibold text-charcoal shadow-ring hover:bg-sand-deep hover:text-ink transition-colors"
                    title={`复制 ${segment.code} 时段 (${formatClipTime(segment.startSec)} ~ ${formatClipTime(segment.endSec)})`}
                  >
                    复制此时段
                  </button>
                  <span className="font-mono text-[10px] text-stone">{count} 点</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-xl bg-cream p-2.5 shadow-ring">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <strong className="text-ink">语义与配对关系</strong>
              <button
                type="button"
                onClick={handleCopyAllRelations}
                className="rounded-lg bg-sand px-2 py-1 text-[10px] font-semibold text-charcoal shadow-ring hover:bg-sand-deep hover:text-ink transition-colors"
                title="一键复制谱中所有语义关系为纯文本"
              >
                一键复制所有语义关系
              </button>
            </div>
            <div className="text-[10px] text-stone leading-relaxed border-t border-hairline pt-1">
              <div>• 关系配对：Shift+R 重复 · Shift+U 升级 · Shift+V 变奏 (1对1)</div>
              <div>• 角色语义：Shift+I Intro · Shift+O Outro · Shift+D Drop · Shift+B Build-Up · Shift+K Break</div>
              <div>• 选中操作：Ctrl+左键 多选/切换 · 右键卡片 取消选中 · Shift+Delete 清除语义</div>
            </div>
          </div>
          {structure.relations.length === 0 ? (
            <p className="mt-2 text-[11px] text-stone">尚未标记重复、升级或变奏关系。</p>
          ) : (
            <div className="mt-2 space-y-2">
              {structure.relations.map((relation, relationIndex) => {
                const memberCodes = relation.segmentIds
                  .map((id) => segmentById.get(id)?.code)
                  .filter(Boolean)
                  .join(" → ");
                return (
                  <div
                    key={relation.id}
                    className="rounded-lg border-l-4 bg-white p-2 shadow-ring"
                    style={{ borderLeftColor: relationGroupColor(relationIndex) }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="font-mono text-[10px] font-bold"
                        style={{ color: relationGroupColor(relationIndex) }}
                      >
                        {relationBadge(relation.kind, relationIndex + 1)}
                      </span>
                      <select
                        value={relation.kind}
                        onChange={(event) => {
                          onChange(
                            updateRelationKind(
                              structure,
                              relation.id,
                              event.target.value as SegmentRelationKind,
                            ),
                          );
                          event.currentTarget.blur();
                        }}
                        className="rounded-lg bg-cream px-2 py-1 text-[11px] text-ink outline-none"
                      >
                        {SEGMENT_RELATION_KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {relationLabel(kind)}
                          </option>
                        ))}
                      </select>
                      <button
                        title="删除关系"
                        onClick={() => onChange(removeRelation(structure, relation.id))}
                        className="ml-auto text-stone hover:text-err"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-stone">{memberCodes}</div>
                    {relation.kind === "custom" && (
                      <input
                        value={relation.note ?? ""}
                        placeholder="填写自定义关系"
                        onChange={(event) =>
                          onChange(updateRelationNote(structure, relation.id, event.target.value))
                        }
                        className="mt-1.5 w-full rounded-lg bg-cream px-2 py-1 text-[11px] text-ink outline-none focus:ring-2 focus:ring-focus"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </details>
  );
}

export function relationLabel(kind: SegmentRelationKind): string {
  return {
    repeat: "重复",
    upgrade: "升级",
    variation: "变奏",
    contrast: "对比",
    custom: "自定义",
  }[kind];
}

export function relationBadge(kind: SegmentRelationKind, index: number): string {
  const prefix = { repeat: "R", upgrade: "U", variation: "V", contrast: "C", custom: "X" }[
    kind
  ];
  return `${prefix}${index}`;
}
