"use client";

/**
 * 时间轴(Premiere/剪映式,象牙底)。x 轴 = 音频秒;每采音点一根条形,高度 = 同刻键数
 * (未指派=灰矮条,墨色细描边);长条尾带压同列后续采音点 → 红;节拍网格随 nudge 即时重绘;
 * 陶土色播放头。
 *
 * 指针交互:
 *  - 普通单击 → 播放头吸附最近节拍(snapClickEnabled 时)+ 暂停态落点试听。
 *  - Ctrl/⌘+单击 → 吸附最近采音点并选中它 + 试听。
 *  - 右键采音点 → 清空该点排键。
 *  - Alt+拖拽 → 画框选(rubber-band),松手批量选中框内采音点。
 *  - 标尺/播放头附近拖拽 = 自由 scrub;空白拖拽 = 平移;滚轮 = 缩放(光标锚定)。
 */

import { useEffect, useMemo, useRef } from "react";

import type { AudioClock } from "@/hooks/useAudioClock";
import {
  assignmentsAt,
  chordSize,
  type AssignmentsMap,
  type HoldOverlapWarning,
  type Onset,
  type TripleChordWarning,
} from "@/lib/arrangement";
import { beatToFloat } from "@/lib/beat";
import { noteColor } from "@/lib/colors";
import { fmtTime } from "@/lib/format";
import {
  relationIndexesForSegment,
  type SegmentRange,
  type SegmentRelationV1,
} from "@/lib/segments";
import { relationGroupColor, THEME } from "@/lib/theme";
import { assignHoldLanes, nearestBeatAudioSec, onsetIdsInRange, type HoldSpan } from "@/lib/timeline";
import { audioSecToBeat, beatToAudioSec, type TimingContext } from "@/lib/timemap";

export interface TimelineView {
  pxPerSec: number;
  scrollSec: number;
}

export interface TimelineProps {
  onsets: Onset[];
  assignments: AssignmentsMap;
  /** Uncommitted simulator gesture, used for rendering only. */
  renderAssignments?: AssignmentsMap;
  simulatorDraftHeadId?: string | null;
  markedSwapOnsetId?: string | null;
  timing: TimingContext;
  clock: AudioClock;
  playing: boolean;
  selectedId: string | null;
  selectionSet: Set<string>;
  snapClickEnabled: boolean;
  /** 当前吸附细分(网格线与点击吸附都按它) */
  snapDenom: number;
  warnings: HoldOverlapWarning[];
  tripleWarnings?: TripleChordWarning[];
  segments: SegmentRange[];
  segmentRelations: SegmentRelationV1[];
  selectedSegmentIds: Set<string>;
  pendingInSec: number | null;
  initialView: TimelineView;
  onViewPersist(view: TimelineView): void;
  onSeek(sec: number, audition?: boolean): void;
  onClearOnset(id: string): void;
  onMarquee(ids: string[]): void;
  onToggleSegment(id: string): void;
  onMergeClips(leftId: string, rightId: string): void;
  onDeleteClip(id: string): void;
}

const RULER_H = 22;
const SEGMENT_H = 14;
const MIN_PX = 20;
const MAX_PX = 1600;
const T = THEME.timeline;
// 长条尾带的垂直轨道:重叠的长条逐行排开而非叠压。纵向预算 = 标尺(22)到条形顶(~85)
// 之间约 53px,6px/轨 → 8 轨。
const HOLD_TOP = RULER_H + 5;
const HOLD_H = 4;
const HOLD_GAP = 2;
const HOLD_MAX_LANES = 8;

type PointerMode = "idle" | "maybe" | "pan" | "scrub" | "marquee";

export default function Timeline(props: TimelineProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef({ w: 800, h: 150, dpr: 1 });
  const propsRef = useRef(props);
  propsRef.current = props;
  const viewRef = useRef<TimelineView>({ ...props.initialView });
  // 长条轨道分配:只在 onsets/assignments/timing 变化时重算,不逐帧重排
  // (既省 60fps 的排序开销,也保证滚动/缩放时轨道不跳动)
  const holdLanes = useMemo(() => {
    const spans: HoldSpan[] = [];
    const rendered = props.renderAssignments ?? props.assignments;
    for (const o of props.onsets) {
      for (const a of assignmentsAt(rendered, o.id)) {
        if (!a.endbeat) continue;
        spans.push({
          key: `${o.id}:${a.column}`,
          startSec: beatToAudioSec(o.beatFloat, props.timing),
          endSec: beatToAudioSec(beatToFloat(a.endbeat), props.timing),
        });
      }
    }
    return assignHoldLanes(spans, HOLD_MAX_LANES);
  }, [props.onsets, props.assignments, props.renderAssignments, props.timing]);
  const holdLanesRef = useRef(holdLanes);
  holdLanesRef.current = holdLanes;
  const followRef = useRef(true);
  const lastFollowT = useRef(-1); // 暂停下检测 seek(t 变化)以跟随播放头
  const modeRef = useRef<PointerMode>("idle");
  const downRef = useRef({ x: 0, y: 0, scrollSec: 0, ctrl: false });
  const marqueeRef = useRef<{ x0: number; x1: number } | null>(null);
  const persistTimer = useRef<number | null>(null);

  useEffect(() => {
    if (props.playing) followRef.current = true;
  }, [props.playing]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ro = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const view = viewRef.current;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const delta = (e.deltaX || e.deltaY) / view.pxPerSec;
        viewRef.current = { ...view, scrollSec: Math.max(-1, view.scrollSec + delta) };
        followRef.current = false;
      } else {
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const next = Math.min(MAX_PX, Math.max(MIN_PX, view.pxPerSec * factor));
        const secAtCursor = view.scrollSec + px / view.pxPerSec;
        viewRef.current = { pxPerSec: next, scrollSec: secAtCursor - px / next };
      }
      schedulePersist();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const { clock } = propsRef.current;
    return clock.subscribe((t) => draw(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.clock]);

  function schedulePersist() {
    if (persistTimer.current) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      propsRef.current.onViewPersist({ ...viewRef.current });
    }, 600);
  }

  function xOf(sec: number): number {
    const v = viewRef.current;
    return (sec - v.scrollSec) * v.pxPerSec;
  }
  function secOf(x: number): number {
    const v = viewRef.current;
    return v.scrollSec + x / v.pxPerSec;
  }

  function draw(t: number) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { w, h, dpr } = sizeRef.current;
    const { onsets, timing, selectedId, selectionSet, warnings, playing, snapDenom } =
      propsRef.current;
    const assignments = propsRef.current.renderAssignments ?? propsRef.current.assignments;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const v = viewRef.current;
    const wSec = w / v.pxPerSec;
    if (playing && followRef.current) {
      if (t > v.scrollSec + wSec * 0.72 || t < v.scrollSec) {
        viewRef.current = { ...v, scrollSec: t - wSec * 0.35 };
      }
    } else if (!playing && t !== lastFollowT.current) {
      // 暂停下发生 seek(方向键快进退):若播放头出屏则滚动跟随(平移只改 scrollSec、t 不变,不误触发)
      if (t < v.scrollSec || t > v.scrollSec + wSec) {
        viewRef.current = { ...v, scrollSec: Math.max(-1, t - wSec * 0.35) };
      }
    }
    lastFollowT.current = t;

    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, w, h);

    // 标尺
    ctx.fillStyle = T.rulerBg;
    ctx.fillRect(0, 0, w, RULER_H);
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60];
    const step = steps.find((s) => s * viewRef.current.pxPerSec >= 70) ?? 60;
    const first = Math.max(0, Math.floor(viewRef.current.scrollSec / step) * step);
    ctx.font = `10px ${THEME.font.mono}`;
    ctx.textAlign = "left";
    for (let s = first; xOf(s) < w + 40; s += step) {
      const x = xOf(s);
      ctx.strokeStyle = T.rulerTick;
      ctx.beginPath();
      ctx.moveTo(x, RULER_H - 6);
      ctx.lineTo(x, RULER_H);
      ctx.stroke();
      ctx.fillStyle = T.rulerText;
      ctx.fillText(fmtTime(s).slice(0, 8), x + 3, RULER_H - 8);
    }

    // 结构桥段覆盖带：与蓝/黄/灰采音点、陶土播放头使用完全不同的橄榄色视觉层。
    for (const segment of propsRef.current.segments) {
      const x0 = xOf(segment.startSec);
      const x1 = xOf(segment.endSec);
      if (x1 < 0 || x0 > w) continue;
      const left = Math.max(0, x0);
      const right = Math.min(w, x1);
      const width = Math.max(0, right - left);
      ctx.fillStyle = segment.index % 2 === 0 ? T.segmentWashA : T.segmentWashB;
      ctx.fillRect(left, RULER_H, width, h - RULER_H);
      ctx.fillStyle = segment.index % 2 === 0 ? T.segmentRibbonA : T.segmentRibbonB;
      ctx.fillRect(left, RULER_H, width, SEGMENT_H);
      if (width > 42) {
        const rolePrefix = segment.role
          ? `[${segment.role === "buildup" ? "Build-Up" : segment.role === "break" ? "Break" : segment.role === "drop" ? "Drop" : segment.role === "intro" ? "Intro" : "Outro"}] `
          : "";
        const label = segment.label
          ? `${segment.code} ${rolePrefix}${segment.label}`
          : `${segment.code} ${rolePrefix}`.trim();
        ctx.font = `10px ${THEME.font.sans}`;
        ctx.textAlign = "center";
        ctx.fillStyle = T.segmentText;
        ctx.fillText(label, left + width / 2, RULER_H + 11, Math.max(20, width - 8));
      }
      const relationIndexes = relationIndexesForSegment(
        propsRef.current.segmentRelations,
        segment.id,
      );
      relationIndexes.forEach((relationIndex, layer) => {
        const inset = 1 + layer * 2;
        const innerWidth = width - inset * 2;
        const innerHeight = SEGMENT_H - inset * 2;
        if (innerWidth <= 0 || innerHeight <= 0) return;
        ctx.strokeStyle = relationGroupColor(relationIndex);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(left + inset, RULER_H + inset, innerWidth, innerHeight);
      });
      if (relationIndexes.length > 0 && width > 24) {
        ctx.font = `bold 9px ${THEME.font.mono}`;
        ctx.textAlign = "right";
        let badgeX = right - 3;
        for (const relationIndex of relationIndexes.toReversed()) {
          const relation = propsRef.current.segmentRelations[relationIndex];
          const badge = relationBadge(relation.kind, relationIndex + 1);
          ctx.fillStyle = relationGroupColor(relationIndex);
          ctx.fillText(badge, badgeX, RULER_H + 11);
          badgeX -= ctx.measureText(badge).width + 4;
        }
      }
      if (propsRef.current.selectedSegmentIds.has(segment.id)) {
        ctx.strokeStyle = T.segmentSelected;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(left + 0.75, RULER_H + 0.75, Math.max(0, width - 1.5), SEGMENT_H - 1.5);
        ctx.setLineDash([]);
      }
      for (const edgeX of [x0, x1]) {
        if (edgeX < -10 || edgeX > w + 10) continue;
        ctx.strokeStyle = T.segmentBoundary;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(edgeX, RULER_H);
        ctx.lineTo(edgeX, h);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = T.segmentBoundary;
        ctx.fillRect(edgeX - 3, RULER_H, 6, SEGMENT_H);
      }
    }

    const pendingInSec = propsRef.current.pendingInSec;
    if (pendingInSec != null) {
      const inX = xOf(pendingInSec);
      const currentX = xOf(t);
      const left = Math.max(0, Math.min(inX, currentX));
      const right = Math.min(w, Math.max(inX, currentX));
      if (right > left) {
        ctx.fillStyle = T.inPointWash;
        ctx.fillRect(left, RULER_H, right - left, h - RULER_H);
        ctx.fillStyle = T.inPointRibbon;
        ctx.fillRect(left, RULER_H, right - left, SEGMENT_H);
      }
      if (inX >= -10 && inX <= w + 10) {
        ctx.strokeStyle = T.inPoint;
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.moveTo(inX, RULER_H);
        ctx.lineTo(inX, h);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = T.inPoint;
        ctx.font = `bold 10px ${THEME.font.mono}`;
        ctx.textAlign = "left";
        ctx.fillText("I", inX + 4, RULER_H + 11);
      }
    }

    // 节拍网格
    const bpm = timing.timeMap[0]?.bpm ?? 120;
    const pxPerBeat = (viewRef.current.pxPerSec * 60) / bpm;
    if (pxPerBeat > 1.5) {
      // 三级线:小节(b%4)/ 整拍 / 细分。按像素密度自动降级,过密不画,避免糊成一片。
      const denom = Math.max(1, snapDenom);
      const pxPerSub = pxPerBeat / denom;
      const drawSub = denom > 1 && pxPerSub >= 4;
      const barsOnly = pxPerBeat < 5;
      const step = drawSub ? 1 / denom : 1; // 以拍为单位的步长
      const beatStart = Math.max(0, Math.floor(audioSecToBeat(viewRef.current.scrollSec, timing)));
      const beatEnd = Math.ceil(audioSecToBeat(secOf(w), timing));
      const maxLines = 4000;
      let drawn = 0;
      for (let b = beatStart; b <= beatEnd && drawn < maxLines; b += step) {
        const nearInt = Math.abs(b - Math.round(b)) < 1e-6;
        const isBar = nearInt && Math.round(b) % 4 === 0;
        const isBeat = nearInt && !isBar;
        if (barsOnly && !isBar) continue;
        ctx.strokeStyle = isBar ? T.gridBar : isBeat ? T.gridBeat : T.gridSub;
        const x = xOf(beatToAudioSec(b, timing));
        ctx.beginPath();
        ctx.moveTo(x, RULER_H);
        ctx.lineTo(x, h);
        ctx.stroke();
        drawn++;
      }
    }

    // 选中采音点全高竖带(播放头被 Q/E 移开后仍一眼可辨)—— 画在条形之下
    const selOnset = selectedId ? onsets.find((o) => o.id === selectedId) : null;
    let selX: number | null = null;
    if (selOnset) {
      selX = xOf(beatToAudioSec(selOnset.beatFloat, timing));
      if (selX >= -20 && selX <= w + 20) {
        ctx.fillStyle = T.selectionBand;
        ctx.fillRect(selX - 6, RULER_H, 12, h - RULER_H);
        ctx.strokeStyle = T.selectionEdge;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(selX, RULER_H);
        ctx.lineTo(selX, h);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        selX = null;
      }
    }

    // 长条尾带 + 条形
    const warnSet = new Set(warnings.map((wn) => `${wn.onsetId}:${wn.column}`));
    const tripleWarnSet = new Set(
      (propsRef.current.tripleWarnings ?? [])
        .map((w) => w.onsetId)
        .filter((id): id is string => id !== null),
    );
    const baseline = h - 6;
    for (const o of onsets) {
      const sec = beatToAudioSec(o.beatFloat, timing);
      const x = xOf(sec);
      const size = chordSize(assignments, o.id);
      if (size > 0) {
        for (const a of assignmentsAt(assignments, o.id)) {
          if (!a.endbeat) continue;
          const xEnd = xOf(beatToAudioSec(beatToFloat(a.endbeat), timing));
          if (xEnd < -10 || x > w + 10) continue;
          const key = `${o.id}:${a.column}`;
          // 按分配好的轨道逐行排开:时间上重叠的长条不再叠压成一条
          const lane = holdLanesRef.current.get(key) ?? 0;
          const y = HOLD_TOP + lane * (HOLD_H + HOLD_GAP);
          ctx.fillStyle = warnSet.has(key) ? T.warnTail : noteColor(size);
          ctx.globalAlpha = 0.45;
          ctx.fillRect(x, y, Math.max(2, xEnd - x), HOLD_H);
          ctx.globalAlpha = 1;
          if (o.id === propsRef.current.simulatorDraftHeadId) {
            ctx.strokeStyle = T.simulatorDraft;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(x, y - 1, Math.max(2, xEnd - x), HOLD_H + 2);
            ctx.setLineDash([]);
          }
        }
      }
      if (x < -10 || x > w + 10) continue;
      const barH = size === 0 ? 12 : 15 + 9 * size;
      const color = noteColor(size);
      if (o.id === selectedId) {
        ctx.fillStyle = T.selectionHalo;
        ctx.fillRect(x - 2.5, baseline - barH - 2, 5, barH + 4);
      }
      ctx.fillStyle = color;
      ctx.fillRect(x - 1.5, baseline - barH, 3, barH);
      ctx.strokeStyle = THEME.stage.noteOutline;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x - 1.5, baseline - barH, 3, barH);
      // 新增采音点标记:baseline 下方空心三角(源采音点没有)
      if (o.source.length === 0) {
        ctx.beginPath();
        ctx.moveTo(x - 4, baseline + 5);
        ctx.lineTo(x + 4, baseline + 5);
        ctx.lineTo(x, baseline);
        ctx.closePath();
        ctx.strokeStyle = T.selectionMark;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // 框选高亮:顶端陶土小帽
      if (selectionSet.has(o.id)) {
        ctx.fillStyle = T.playhead;
        ctx.fillRect(x - 3, baseline - barH - 6, 6, 4);
      }
      // 三押及以上(包括长条尾)警报:顶端红色小圆点
      if (tripleWarnSet.has(o.id)) {
        ctx.fillStyle = T.warnTail;
        ctx.beginPath();
        ctx.arc(x, baseline - barH - (selectionSet.has(o.id) ? 9 : 5), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 选中采音点标记:顶部实心墨色菱形 + 拍号标签(醒目、区别于陶土播放头三角)
    if (selX !== null && selOnset) {
      ctx.fillStyle = T.selectionMark;
      ctx.beginPath();
      ctx.moveTo(selX, RULER_H + 2);
      ctx.lineTo(selX + 5, RULER_H + 8);
      ctx.lineTo(selX, RULER_H + 14);
      ctx.lineTo(selX - 5, RULER_H + 8);
      ctx.closePath();
      ctx.fill();
      const bar = Math.floor(selOnset.beatFloat / 4) + 1;
      const label = `选中 ${bar}小节`;
      ctx.font = `10px ${THEME.font.sans}`;
      ctx.textAlign = "left";
      const lw = ctx.measureText(label).width + 8;
      const lx = Math.min(selX + 8, w - lw - 2);
      ctx.fillStyle = T.selectionMark;
      ctx.fillRect(lx, RULER_H + 2, lw, 13);
      ctx.fillStyle = "#faf9f5";
      ctx.fillText(label, lx + 4, RULER_H + 12);
    }

    // Alt+C 标记互换点 A: 琥珀金菱形 + 标签
    const markedSwapId = propsRef.current.markedSwapOnsetId;
    if (markedSwapId) {
      const markedOnset = onsets.find((o) => o.id === markedSwapId);
      if (markedOnset) {
        const mx = xOf(beatToAudioSec(markedOnset.beatFloat, timing));
        if (mx >= -40 && mx <= w + 40) {
          ctx.fillStyle = "rgba(217, 119, 6, 0.12)";
          ctx.fillRect(mx - 3, RULER_H, 6, h - RULER_H);

          ctx.fillStyle = "#d97706";
          ctx.beginPath();
          ctx.moveTo(mx, RULER_H + 2);
          ctx.lineTo(mx + 5, RULER_H + 8);
          ctx.lineTo(mx, RULER_H + 14);
          ctx.lineTo(mx - 5, RULER_H + 8);
          ctx.closePath();
          ctx.fill();

          const label = "★ 互换点 A";
          ctx.font = `bold 10px ${THEME.font.sans}`;
          ctx.textAlign = "left";
          const lw = ctx.measureText(label).width + 8;
          const lx = Math.min(mx + 8, w - lw - 2);
          ctx.fillStyle = "#d97706";
          ctx.fillRect(lx, RULER_H + 2, lw, 13);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(label, lx + 4, RULER_H + 12);
        }
      }
    }

    // 框选矩形
    const m = marqueeRef.current;
    if (m) {
      const rx = Math.min(m.x0, m.x1);
      const rw = Math.abs(m.x1 - m.x0);
      ctx.fillStyle = T.playhead;
      ctx.globalAlpha = 0.12;
      ctx.fillRect(rx, RULER_H, rw, h - RULER_H);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = T.playhead;
      ctx.lineWidth = 1;
      ctx.strokeRect(rx, RULER_H, rw, h - RULER_H);
    }

    // 播放头(陶土)
    const px = xOf(t);
    ctx.strokeStyle = T.playhead;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
    ctx.fillStyle = T.playhead;
    ctx.beginPath();
    ctx.moveTo(px - 6, 0);
    ctx.lineTo(px + 6, 0);
    ctx.lineTo(px, 10);
    ctx.closePath();
    ctx.fill();
  }

  /** 全局最近采音点(不限距离)—— Ctrl+点击用。 */
  function nearestOnsetId(x: number): string | null {
    const { onsets, timing } = propsRef.current;
    let best: string | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    const sec = secOf(x);
    for (const o of onsets) {
      const d = Math.abs(beatToAudioSec(o.beatFloat, timing) - sec);
      if (d < bestD) {
        bestD = d;
        best = o.id;
      }
    }
    return best;
  }

  /** 命中最近采音点(±8px)—— 右键清空用。 */
  function onsetUnderCursor(x: number): string | null {
    const { onsets, timing } = propsRef.current;
    let best: string | null = null;
    let bestD = 8;
    for (const o of onsets) {
      const d = Math.abs(xOf(beatToAudioSec(o.beatFloat, timing)) - x);
      if (d < bestD) {
        bestD = d;
        best = o.id;
      }
    }
    return best;
  }

  function clampSeek(sec: number): number {
    const d = propsRef.current.clock.duration();
    return Math.min(Math.max(0, sec), d > 0 ? d : sec);
  }

  function segmentAtX(x: number): SegmentRange | null {
    const sec = secOf(x);
    return (
      propsRef.current.segments.find((segment, index, all) => {
        const last = index === all.length - 1;
        return sec >= segment.startSec && (last ? sec <= segment.endSec : sec < segment.endSec);
      }) ?? null
    );
  }

  function mergePairUnderCursor(x: number): [string, string] | null {
    const segments = propsRef.current.segments;
    let best: [string, string] | null = null;
    let bestD = 8;
    for (let index = 0; index + 1 < segments.length; index++) {
      const left = segments[index];
      const right = segments[index + 1];
      if (Math.abs(left.endSec - right.startSec) > 1e-6) continue;
      const distance = Math.abs(xOf(left.endSec) - x);
      if (distance < bestD) {
        bestD = distance;
        best = [left.id, right.id];
      }
    }
    return best;
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return; // 右键走 onContextMenu
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    canvasRef.current?.setPointerCapture(e.pointerId);

    if ((e.ctrlKey || e.metaKey) && y > RULER_H && y <= RULER_H + SEGMENT_H) {
      const segment = segmentAtX(x);
      if (segment) propsRef.current.onToggleSegment(segment.id);
      modeRef.current = "idle";
      return;
    }

    if (e.altKey && y > RULER_H) {
      modeRef.current = "marquee";
      marqueeRef.current = { x0: x, x1: x };
      return;
    }
    const playheadX = xOf(propsRef.current.clock.getTime());
    if (y <= RULER_H || Math.abs(x - playheadX) <= 6) {
      modeRef.current = "scrub";
      followRef.current = false;
      propsRef.current.onSeek(clampSeek(secOf(x)));
    } else {
      modeRef.current = "maybe";
      downRef.current = { x, y, scrollSec: viewRef.current.scrollSec, ctrl: e.ctrlKey || e.metaKey };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (modeRef.current === "idle") return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (modeRef.current === "marquee") {
      if (marqueeRef.current) marqueeRef.current = { ...marqueeRef.current, x1: x };
      return;
    }
    if (modeRef.current === "scrub") {
      propsRef.current.onSeek(clampSeek(secOf(x)));
      return;
    }
    const dx = x - downRef.current.x;
    if (modeRef.current === "maybe" && Math.abs(dx) > 4) {
      modeRef.current = "pan";
      followRef.current = false;
    }
    if (modeRef.current === "pan") {
      viewRef.current = {
        ...viewRef.current,
        scrollSec: Math.max(-1, downRef.current.scrollSec - dx / viewRef.current.pxPerSec),
      };
      schedulePersist();
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const mode = modeRef.current;
    modeRef.current = "idle";
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;

    if (mode === "marquee") {
      const m = marqueeRef.current;
      marqueeRef.current = null;
      if (m) {
        const ids = onsetIdsInRange(
          propsRef.current.onsets,
          propsRef.current.timing,
          secOf(m.x0),
          secOf(m.x1),
        );
        propsRef.current.onMarquee(ids);
      }
      return;
    }
    if (mode === "scrub") {
      // 松手落点试听(仅暂停态)
      propsRef.current.onSeek(clampSeek(secOf(x)), true);
      return;
    }
    if (mode !== "maybe") return;

    if (downRef.current.ctrl) {
      // Ctrl+点击 → 把**播放头**吸附到最近采音点 + 试听(已废除"选中"机制:
      // 编辑对象一律由播放头派生,与预览此刻画面一致)
      const id = nearestOnsetId(x);
      const o = id ? propsRef.current.onsets.find((n) => n.id === id) : null;
      if (o) {
        propsRef.current.onSeek(
          clampSeek(beatToAudioSec(o.beatFloat, propsRef.current.timing)),
          true,
        );
      }
      return;
    }
    // 普通点击 → 吸附最近节拍(或原始点)+ 试听
    if (propsRef.current.snapClickEnabled) {
      propsRef.current.onSeek(
        clampSeek(
          nearestBeatAudioSec(secOf(x), propsRef.current.timing, propsRef.current.snapDenom),
        ),
        true,
      );
    } else {
      propsRef.current.onSeek(clampSeek(secOf(x)));
    }
  }

  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const mergePair = mergePairUnderCursor(x);
    if (mergePair) {
      propsRef.current.onMergeClips(mergePair[0], mergePair[1]);
      return;
    }
    if (y > RULER_H && y <= RULER_H + SEGMENT_H) {
      const segment = segmentAtX(x);
      if (segment) {
        propsRef.current.onDeleteClip(segment.id);
        return;
      }
    }
    const id = onsetUnderCursor(x);
    if (id) propsRef.current.onClearOnset(id);
  }

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={onContextMenu}
      />
    </div>
  );
}

function relationBadge(kind: SegmentRelationV1["kind"], index: number): string {
  const prefix = { repeat: "R", upgrade: "U", variation: "V", contrast: "C", custom: "X" }[
    kind
  ];
  return `${prefix}${index}`;
}
