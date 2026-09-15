"use client";

/**
 * 主工作区:模拟实机的六边形预览(羊皮纸舞台)。键位坐标来自 /api/geometry(唯一权威;
 * 屏幕 y 向下,不翻转);Note 从中心飞向指派键,0 ≤ h−t ≤ leadIn,prog = 1 − dt/leadIn,
 * 线性插值 — 与旧采音器同一套飞行数学。渲染是 t 的纯函数(倒拖自动反向)。
 * 封面图以羊皮纸水彩罩垫底(用户需求:jpg 作主工作区背景、较高透明度)。
 *
 * 未指派采音点提示(Task C,替换旧中心小脉冲):
 *  - 迫近灰影:整个 leadIn 窗口内中心灰盘渐显渐大(随当前飞行时间提前可见);
 *  - 命中墨环:±0.09s 内墨色双环从中心扩散至 55% 半径 + 外圈描边加深 —— 醒目且倒放对称。
 *
 * 交互:点击键位 → onKeyClick(编辑对象=播放头所在采音点,状态机在 EditorSession);
 * Shift+点击 → 把该键之前的音符延伸成长条;右键 → onKeyRightClick。已废除选中态叠加层,
 * 预览只画实机会看到的东西 + 一处极简提示(可延伸键位上的淡弧)。
 * 长条持续中 = 键位保持点亮 + 六边形同色首尾帽与四条平行光轨向中心回缩,不画旋转进度弧。
 */

import { useEffect, useRef } from "react";

import type { AudioClock } from "@/hooks/useAudioClock";
import {
  assignmentsAt,
  type AssignmentsMap,
  type Column,
  type Onset,
} from "@/lib/arrangement";
import { beatToFloat } from "@/lib/beat";
import { holdColor, NOTE_COLORS, noteColor } from "@/lib/colors";
import { type Geometry, keyPos, zhLabel } from "@/lib/geometry";
import {
  computePreviewLayout,
  formatKeySlotLabel,
  holdRibbonVisualStyle,
  holdVisibleLength,
  PREVIEW_HOLD_RAIL_COUNT,
  PREVIEW_HOLD_TAIL_DIAMETER,
  PREVIEW_NOTE_DIAMETER,
  PREVIEW_NOTE_HIT_RADIUS,
  PREVIEW_ORB_RING_RATIOS,
  type Point,
} from "@/lib/preview-geometry";
import { flightProgress, holdBreathStrength, PREVIEW_TIME_EPS } from "@/lib/preview-timing";
import { THEME } from "@/lib/theme";
import { SIMULATOR_KEY_LABELS, type SimulatorKeyBinding } from "@/lib/simulator-input";
import {
  audioSecToBeat,
  beatToAudioSec,
  snapBeatFloat,
  type TimingContext,
} from "@/lib/timemap";

export interface HexPreviewProps {
  geometry: Geometry;
  onsets: Onset[];
  assignments: AssignmentsMap;
  selectedOnset: Onset | null;
  timing: TimingContext;
  leadInSec: number;
  snapDenom: number;
  clock: AudioClock;
  coverUrl: string;
  simulatorMode: boolean;
  simulatorPressedColumns: readonly Column[];
  simulatorPreviousColumns: readonly Column[];
  simulatorStatus: string | null;
  simulatorKeymap?: readonly SimulatorKeyBinding[];
  interactionLocked: boolean;
  onKeyClick(col: Column, shift?: boolean, ctrl?: boolean): void;
  onKeyRightClick(col: Column): void;
  /** 拖拽画面上的音符换列 */
  onNoteMove(onsetId: string, from: Column, to: Column): void;
  /** 右击画面上的音符删除该键 */
  onNoteDelete(onsetId: string, column: Column): void;
}

/** 本帧画出的可命中音符(拖拽/右击用) */
interface NoteHit {
  onsetId: string;
  column: Column;
  x: number;
  y: number;
  r: number;
  color: string;
  isHold: boolean;
}

const HIT_WINDOW = 0.09;
const S = THEME.stage;

type ArcadePalette = { readonly [K in keyof typeof S.noteBlue]: string };

function notePalette(color: string): ArcadePalette {
  return color === NOTE_COLORS.chord ? S.noteYellow : S.noteBlue;
}

function circle(ctx: CanvasRenderingContext2D, center: Point, radius: number): void {
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
}

function hexagon(ctx: CanvasRenderingContext2D, center: Point, radius: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    const x = center.x + Math.cos(angle) * radius;
    const y = center.y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * Procedural recreation of the supplied blue/yellow arcade notes: luminous outer target ring,
 * black isolation well, coloured inner ring and a glossy central core. No bitmap is used.
 */
function drawArcadeOrb(
  ctx: CanvasRenderingContext2D,
  center: Point,
  color: string,
  alpha = 0.96,
): void {
  const radius = PREVIEW_NOTE_DIAMETER / 2;
  const palette = notePalette(color);
  const ratios = PREVIEW_ORB_RING_RATIOS;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = radius * 0.38;
  circle(ctx, center, radius);
  const outer = ctx.createLinearGradient(
    center.x - radius,
    center.y - radius,
    center.x + radius,
    center.y + radius,
  );
  outer.addColorStop(0, palette.bright);
  outer.addColorStop(0.18, palette.edge);
  outer.addColorStop(0.5, palette.body);
  outer.addColorStop(0.78, palette.bright);
  outer.addColorStop(1, palette.shadow);
  ctx.fillStyle = outer;
  ctx.fill();
  ctx.shadowBlur = 0;

  circle(ctx, center, radius * ratios.darkWell);
  ctx.fillStyle = palette.darkWell;
  ctx.fill();

  circle(ctx, center, radius * ratios.innerRing);
  const innerRing = ctx.createRadialGradient(
    center.x - radius * 0.12,
    center.y - radius * 0.15,
    0,
    center.x,
    center.y,
    radius * ratios.innerRing,
  );
  innerRing.addColorStop(0, palette.body);
  innerRing.addColorStop(0.72, palette.innerEdge);
  innerRing.addColorStop(1, palette.bright);
  ctx.fillStyle = innerRing;
  ctx.fill();

  circle(ctx, center, radius * ratios.innerWell);
  ctx.fillStyle = palette.innerBody;
  ctx.fill();

  circle(ctx, center, radius * ratios.core);
  const core = ctx.createRadialGradient(
    center.x - radius * 0.11,
    center.y - radius * 0.13,
    radius * 0.02,
    center.x,
    center.y,
    radius * ratios.core,
  );
  core.addColorStop(0, palette.coreBright);
  core.addColorStop(0.3, palette.core);
  core.addColorStop(1, palette.edge);
  ctx.fillStyle = core;
  ctx.fill();

  // Reference-like hard highlights keep the rings legible on pale cover art.
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius * 0.88, Math.PI * 1.04, Math.PI * 1.43);
  ctx.strokeStyle = palette.bright;
  ctx.lineWidth = Math.max(1.2, radius * 0.08);
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius * 0.89, Math.PI * 0.08, Math.PI * 0.43);
  ctx.strokeStyle = palette.shadow;
  ctx.lineWidth = Math.max(1, radius * 0.055);
  ctx.stroke();
  ctx.restore();
}

function drawOffsetLine(
  ctx: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  nx: number,
  ny: number,
  offset: number,
): void {
  ctx.beginPath();
  ctx.moveTo(start.x + nx * offset, start.y + ny * offset);
  ctx.lineTo(end.x + nx * offset, end.y + ny * offset);
  ctx.stroke();
}

function drawHoldCap(
  ctx: CanvasRenderingContext2D,
  center: Point,
  diameter: number,
  color: string,
  alpha: number,
  subdued = false,
): void {
  const radius = diameter / 2;
  const palette = notePalette(color);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = subdued ? radius * 0.16 : radius * 0.32;
  hexagon(ctx, center, radius);
  const outer = ctx.createLinearGradient(
    center.x - radius,
    center.y - radius,
    center.x + radius,
    center.y + radius,
  );
  outer.addColorStop(0, palette.bright);
  outer.addColorStop(0.35, palette.body);
  outer.addColorStop(0.72, palette.edge);
  outer.addColorStop(1, palette.shadow);
  ctx.fillStyle = outer;
  ctx.fill();
  ctx.shadowBlur = 0;

  hexagon(ctx, center, radius * 0.72);
  ctx.fillStyle = palette.darkWell;
  ctx.fill();
  hexagon(ctx, center, radius * 0.53);
  ctx.fillStyle = palette.innerEdge;
  ctx.fill();
  hexagon(ctx, center, radius * 0.41);
  ctx.fillStyle = palette.innerBody;
  ctx.fill();
  hexagon(ctx, center, radius * 0.27);
  ctx.fillStyle = subdued ? palette.edge : palette.core;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(center.x - radius * 0.48, center.y - radius * 0.42);
  ctx.lineTo(center.x, center.y - radius * 0.68);
  ctx.lineTo(center.x + radius * 0.44, center.y - radius * 0.4);
  ctx.strokeStyle = palette.bright;
  ctx.lineWidth = Math.max(1, radius * 0.075);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

/** Procedural hex-cap hold with four parallel rails, matching the supplied long-note reference. */
function drawHoldNote(
  ctx: CanvasRenderingContext2D,
  head: Point,
  towardCenter: Point,
  length: number,
  alpha: number,
  color: string,
  breathStrength: number | null = null,
): void {
  const dx = towardCenter.x - head.x;
  const dy = towardCenter.y - head.y;
  const distance = Math.hypot(dx, dy) || 1;
  const ux = dx / distance;
  const uy = dy / distance;
  const nx = -uy;
  const ny = ux;
  const tail = { x: head.x + ux * length, y: head.y + uy * length };
  const visual = holdRibbonVisualStyle(breathStrength);
  const palette = notePalette(color);

  if (length >= 8) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    ctx.lineTo(tail.x, tail.y);
    ctx.strokeStyle = S.holdTrackFrame;
    ctx.lineWidth = visual.outerWidth;
    ctx.stroke();

    ctx.globalAlpha = alpha * 0.94;
    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    ctx.lineTo(tail.x, tail.y);
    ctx.strokeStyle = S.holdTrackDark;
    ctx.lineWidth = visual.innerWidth;
    ctx.stroke();

    const railOffsets = [-0.36, -0.12, 0.12, 0.36].map((u) => u * visual.innerWidth);
    for (let i = 0; i < PREVIEW_HOLD_RAIL_COUNT; i++) {
      const offset = railOffsets[i];
      ctx.globalAlpha = alpha * (0.45 + 0.38 * visual.bodyAlpha);
      ctx.strokeStyle = palette.shadow;
      ctx.lineWidth = visual.highlightWidth + 2.2;
      drawOffsetLine(ctx, head, tail, nx, ny, offset);
      ctx.globalAlpha = alpha * (0.52 + 0.4 * visual.highlightAlpha);
      ctx.strokeStyle = i === 0 || i === PREVIEW_HOLD_RAIL_COUNT - 1 ? palette.bright : palette.body;
      ctx.lineWidth = visual.highlightWidth;
      drawOffsetLine(ctx, head, tail, nx, ny, offset);
      ctx.globalAlpha = alpha * 0.7 * visual.highlightAlpha;
      ctx.strokeStyle = S.holdTrackGlint;
      ctx.lineWidth = 0.65;
      drawOffsetLine(ctx, head, tail, nx, ny, offset);
    }
    ctx.restore();
  }

  if (length >= PREVIEW_HOLD_TAIL_DIAMETER * 0.58) {
    drawHoldCap(ctx, tail, PREVIEW_HOLD_TAIL_DIAMETER, color, alpha * 0.9, true);
  }
  drawHoldCap(ctx, head, PREVIEW_NOTE_DIAMETER, color, alpha);
}

interface DragState {
  note: NoteHit;
  x: number;
  y: number;
}

export default function HexPreview(props: HexPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef({ w: 400, h: 400, dpr: 1 });
  const propsRef = useRef(props);
  const dragRef = useRef<DragState | null>(null);
  const hitsRef = useRef<NoteHit[]>([]); // 本帧可命中音符表
  const pendingClickRef = useRef<{
    col: Column | null;
    x: number;
    y: number;
    shift: boolean;
    ctrl: boolean;
  } | null>(null);
  const coverRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    propsRef.current = props;
  }, [props]);

  useEffect(() => {
    const img = new Image();
    img.onerror = () => {
      if (coverRef.current === img) coverRef.current = null;
    };
    img.src = props.coverUrl;
    coverRef.current = img;
  }, [props.coverUrl]);

  // 容器尺寸 → canvas 物理像素(dpr)
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

  function layout() {
    const { w, h } = sizeRef.current;
    return computePreviewLayout(w, h);
  }

  function keyCenter(col: number) {
    const { geometry } = propsRef.current;
    const { cx, cy, r } = layout();
    return keyPos(geometry, col, cx, cy, r);
  }

  function hitKey(x: number, y: number): Column | null {
    const { keyR } = layout();
    let best: Column | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (let col = 0; col < 6; col++) {
      const p = keyCenter(col);
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < bestD) {
        bestD = d;
        best = col as Column;
      }
    }
    return bestD <= keyR * 1.2 ? best : null;
  }

  function draw(t: number) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const {
      geometry,
      onsets,
      assignments,
      selectedOnset,
      timing,
      leadInSec,
      snapDenom,
      simulatorMode,
      simulatorPressedColumns,
      simulatorPreviousColumns,
      simulatorStatus,
      simulatorKeymap,
    } = propsRef.current;
    const { w, h, cx, cy, r, keyR } = layout();
    const { dpr } = sizeRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // ── 背景 + 封面水彩罩(需求:jpg 高透明度垫底) ──
    ctx.fillStyle = S.bg;
    ctx.fillRect(0, 0, w, h);
    const cover = coverRef.current;
    if (cover && cover.complete && cover.naturalWidth > 0) {
      const scale = Math.max(w / cover.naturalWidth, h / cover.naturalHeight);
      const dw = cover.naturalWidth * scale;
      const dh = cover.naturalHeight * scale;
      ctx.drawImage(cover, (w - dw) / 2, (h - dh) / 2, dw, dh);
      ctx.fillStyle = S.coverWash;
      ctx.fillRect(0, 0, w, h);
    }

    // ── 单遍扫描采音点:飞行 / 命中闪 / 长条光带 / 未指派灰影+墨环 ──
    interface Flight {
      onsetId: string;
      col: Column;
      prog: number;
      color: string;
      holdLenSec: number;
    }
    const flights: Flight[] = [];
    /** 长条持续中:键位处的音符(可拖拽/右击) */
    const holdNotes: {
      onsetId: string;
      col: Column;
      hitSec: number;
      remainSec: number;
      color: string;
    }[] = [];
    const hits: NoteHit[] = []; // 本帧可命中音符表(拖拽/右击用)
    const flashes = new Map<number, { int: number; color: string }>();
    const holdingCols = new Set<number>(); // 正处于长条持续中的键位
    const extendable = new Set<number>(); // 播放头之前有音符的键位 → Shift+点击 可延伸成长条
    const ghosts: number[] = []; // prog(未指派迫近灰影)
    const bursts: number[] = []; // int (未指派命中墨环)

    for (const o of onsets) {
      const hSec = beatToAudioSec(o.beatFloat, timing);
      const list = assignmentsAt(assignments, o.id);
      if (list.length === 0) {
        const progress = flightProgress(hSec, t, leadInSec);
        if (progress !== null) ghosts.push(progress);
        const dHit = Math.abs(t - hSec);
        if (dHit < HIT_WINDOW) bursts.push(1 - dHit / HIT_WINDOW);
        continue;
      }
      const color = noteColor(list.length);
      const tailColor = holdColor(list.length);
      for (const a of list) {
        if (hSec < t - 1e-6) extendable.add(a.column);
        const endSec = a.endbeat ? beatToAudioSec(beatToFloat(a.endbeat), timing) : null;
        const progress = flightProgress(hSec, t, leadInSec);
        if (progress !== null) {
          flights.push({
            onsetId: o.id,
            col: a.column,
            prog: progress,
            color: tailColor,
            holdLenSec: endSec !== null ? endSec - hSec : 0,
          });
        }
        const dHit = Math.abs(t - hSec);
        if (dHit < HIT_WINDOW) {
          const prev = flashes.get(a.column);
          const int = 1 - dHit / HIT_WINDOW;
          if (!prev || int > prev.int) flashes.set(a.column, { int, color });
        }
        if (endSec !== null && t > hSec + PREVIEW_TIME_EPS && t <= endSec + PREVIEW_TIME_EPS) {
          holdingCols.add(a.column); // 长条持续中 → 键位保持点亮
          holdNotes.push({
            onsetId: o.id,
            col: a.column,
            hitSec: hSec,
            remainSec: Math.max(0, endSec - t),
            color: tailColor,
          });
          const prev = flashes.get(a.column);
          if (!prev || prev.int < 0.85) flashes.set(a.column, { int: 0.85, color });
        }
      }
    }
    const burstMax = bursts.length > 0 ? Math.max(...bursts) : 0;
    const simulatorPressed = new Set<number>(simulatorPressedColumns);
    const simulatorPrevious = new Set<number>(simulatorPreviousColumns);
    const pressedColor = noteColor(simulatorPressedColumns.length);

    // ── 外圈轮廓(按 ring_order 连接键心;未指派爆发时加深 — Task C 辅助线索) ──
    ctx.beginPath();
    geometry.ringOrder.forEach((col, i) => {
      const p = keyCenter(col);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.strokeStyle = `rgba(${S.inkRGB},${(0.1 + S.ringOutlineBurstBoost * burstMax).toFixed(3)})`;
    ctx.lineWidth = 1 + burstMax;
    ctx.stroke();

    // ── 键位 ──
    for (let col = 0; col < 6; col++) {
      const p = keyCenter(col);
      const flash = flashes.get(col);
      ctx.beginPath();
      ctx.arc(p.x, p.y, keyR, 0, Math.PI * 2);
      ctx.fillStyle = S.keyFill;
      ctx.fill();
      if (simulatorPressed.has(col)) {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = pressedColor;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (flash) {
        ctx.globalAlpha = 0.4 * flash.int;
        ctx.fillStyle = flash.color;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = flash ? flash.color : S.keyStroke;
      ctx.lineWidth = flash ? 3 : 2;
      ctx.stroke();

      if (simulatorPrevious.has(col)) {
        for (const extra of [7, 11]) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, keyR + extra, 0, Math.PI * 2);
          ctx.strokeStyle = S.simulatorPrevious;
          ctx.lineWidth = extra === 7 ? 3 : 1.5;
          ctx.stroke();
        }
      }
      if (simulatorPressed.has(col)) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, keyR + 4, 0, Math.PI * 2);
        ctx.strokeStyle = pressedColor;
        ctx.lineWidth = 4;
        ctx.stroke();
      }

      // 长条持续中的键位:只保留点亮(光带在下方统一绘制,画在飞行音符之下)

      // ── 键位编号与快捷键（无论是否模拟器模式均清晰显示 0-5；模拟器模式下额外显示对应快捷键） ──
      const label = geometry.columns[String(col)]?.label ?? "";
      const currentKeyLabel =
        simulatorKeymap && simulatorKeymap[col]
          ? simulatorKeymap[col].label
          : SIMULATOR_KEY_LABELS[col];
      const slotText = formatKeySlotLabel(col, simulatorMode, currentKeyLabel);

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = S.keyLabel;
      ctx.font = simulatorMode
        ? `bold 13px ${THEME.font.sans}`
        : `bold 16px ${THEME.font.sans}`;
      ctx.fillText(slotText, p.x, p.y - 4);

      ctx.fillStyle = S.keySubLabel;
      ctx.font = `10px ${THEME.font.sans}`;
      ctx.fillText(zhLabel(label), p.x, p.y + 10);
    }

    // ── 常驻中心锚点 ──
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = S.centerDot;
    ctx.fill();

    // ── Task C ①:未指派迫近灰影(整个 leadIn 窗口渐显渐大,静止于中心) ──
    for (const prog of ghosts) {
      const gr = 4 + 9 * prog;
      ctx.beginPath();
      ctx.arc(cx, cy, gr, 0, Math.PI * 2);
      ctx.globalAlpha = 0.25 + 0.5 * prog;
      ctx.fillStyle = NOTE_COLORS.unassigned;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = `rgba(${S.inkRGB},${(0.15 + 0.35 * prog).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // ── Task C ②:未指派命中墨环爆发(对称扩散,倒放画面一致) ──
    for (const int of bursts) {
      const u = 1 - int;
      const outer = 10 + (0.55 * r - 10) * u;
      ctx.beginPath();
      ctx.arc(cx, cy, outer, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${S.inkRGB},${(0.45 * int).toFixed(3)})`;
      ctx.lineWidth = 1.5 + 1.5 * int;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, outer * 0.62, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${S.inkRGB},${(0.3 * int).toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 13, 0, Math.PI * 2);
      ctx.globalAlpha = 0.6 * int;
      ctx.fillStyle = NOTE_COLORS.unassigned;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // ── 长条光轨:六边形头尾帽 + 四条平行光轨,从键位向中心回缩。
    //    整体在飞行音符层绘制;键位处的六边形头供拖拽/右击命中。 ──
    for (const hn of holdNotes) {
      const p = keyCenter(hn.col);
      const dist = Math.hypot(p.x - cx, p.y - cy) || 1;
      const railLen = holdVisibleLength(dist, hn.remainSec, leadInSec, dist);
      const breath = holdBreathStrength(t, hn.hitSec);
      drawHoldNote(ctx, p, { x: cx, y: cy }, railLen, 0.9, hn.color, breath);
      hits.push({
        onsetId: hn.onsetId,
        column: hn.col,
        x: p.x,
        y: p.y,
        r: PREVIEW_NOTE_HIT_RADIUS,
        color: hn.color,
        isHold: true,
      });
    }

    // ── 飞行 Note(普通 Note 为实机式同心圆,长条为六边形;倒放沿原路退回中心) ──
    for (const f of flights) {
      const p = keyCenter(f.col);
      const x = cx + (p.x - cx) * f.prog;
      const y = cy + (p.y - cy) * f.prog;
      const alpha = 0.95;
      if (f.holdLenSec > 0) {
        const dist = Math.hypot(p.x - cx, p.y - cy);
        const tailLen = holdVisibleLength(
          dist,
          f.holdLenSec,
          leadInSec,
          Math.hypot(x - cx, y - cy),
        );
        drawHoldNote(ctx, { x, y }, { x: cx, y: cy }, tailLen, alpha * 0.9, f.color);
      } else {
        drawArcadeOrb(ctx, { x, y }, f.color, alpha);
      }
      hits.push({
        onsetId: f.onsetId,
        column: f.col,
        x,
        y,
        r: PREVIEW_NOTE_HIT_RADIUS,
        color: f.color,
        isHold: f.holdLenSec > 0,
      });
    }
    hitsRef.current = hits; // 供拖拽/右击命中测试(取最近的一个)

    // ── 极简编辑提示(已废除选中态;编辑对象=播放头所在采音点) ──
    // 键上一小段淡弧 = 该键在播放头之前有音符,Shift+点击 可把它延伸成长条。
    const pSnap = snapBeatFloat(audioSecToBeat(t, timing), snapDenom);
    for (const col of extendable) {
      if (holdingCols.has(col)) continue; // 正按住的不再提示
      const p = keyCenter(col);
      ctx.beginPath();
      ctx.arc(p.x, p.y, keyR + 9, -Math.PI * 0.75, -Math.PI * 0.25);
      ctx.strokeStyle = `rgba(${S.inkRGB},0.22)`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.textAlign = "center";
    ctx.font = `12px ${THEME.font.sans}`;
    if (simulatorMode && simulatorPreviousColumns.length > 0) {
      ctx.fillStyle = S.simulatorPrevious;
      ctx.font = `bold 12px ${THEME.font.sans}`;
      ctx.fillText(`上一点 ${simulatorPreviousColumns.join(" · ")}`, cx, h - 34);
    }
    if (simulatorMode && simulatorStatus) {
      ctx.fillStyle = S.hintText;
      ctx.font = `bold 12px ${THEME.font.sans}`;
      ctx.fillText(simulatorStatus, cx, h - 16);
    } else if (selectedOnset) {
      ctx.fillStyle = S.hintText;
      ctx.fillText(
        extendable.size > 0
          ? `点击键位指派 · Shift+点击 设长条尾 @ ${pSnap.toFixed(2)}拍`
          : "点击键位为当前采音点指派",
        cx,
        h - 16,
      );
    } else {
      ctx.fillStyle = S.hintTextMuted;
      ctx.fillText(
        extendable.size > 0
          ? `Shift+点击 设长条尾 @ ${pSnap.toFixed(2)}拍 · Q/E 跳到采音点`
          : "播放头不在采音点上 —— 按 Q/E 跳到采音点再点击键位",
        cx,
        h - 16,
      );
    }

    // ── 拖拽音符 ghost(从原音符位置拉到目标键) ──
    const drag = dragRef.current;
    if (drag) {
      const from = { x: drag.note.x, y: drag.note.y };
      const target = hitKey(drag.x, drag.y);
      const occupied =
        target !== null &&
        target !== drag.note.column &&
        assignmentsAt(assignments, drag.note.onsetId).some((a) => a.column === target);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(drag.x, drag.y);
      ctx.strokeStyle = S.dragLine;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (drag.note.isHold) {
        drawHoldCap(
          ctx,
          { x: drag.x, y: drag.y },
          PREVIEW_NOTE_DIAMETER,
          drag.note.color,
          0.52,
        );
      } else {
        drawArcadeOrb(ctx, { x: drag.x, y: drag.y }, drag.note.color, 0.52);
      }
      if (target !== null && target !== drag.note.column) {
        const p = keyCenter(target);
        ctx.beginPath();
        ctx.arc(p.x, p.y, keyR + 5, 0, Math.PI * 2);
        ctx.strokeStyle = occupied ? S.dropInvalid : S.dropValid;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
  }

  useEffect(() => {
    const { clock } = propsRef.current;
    return clock.subscribe((time) => draw(time));
    // Drawing reads the latest render data from propsRef; resubscribe only when the clock changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.clock]);

  function localPos(e: React.PointerEvent): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** 命中本帧画出的音符(飞行中/长条持续中),取最近的一个。 */
  function hitNote(x: number, y: number): NoteHit | null {
    let best: NoteHit | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const n of hitsRef.current) {
      const d = Math.hypot(x - n.x, y - n.y);
      if (d <= n.r && d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  function onPointerDown(e: React.PointerEvent) {
    if (propsRef.current.interactionLocked) return;
    if (e.button !== 0) return;
    const pos = localPos(e);
    // 优先拖拽**画面上的音符**(实机直接操作);否则按键位走点击状态机
    const note = hitNote(pos.x, pos.y);
    if (note) {
      dragRef.current = { note, x: pos.x, y: pos.y };
      canvasRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    pendingClickRef.current = {
      col: hitKey(pos.x, pos.y),
      x: pos.x,
      y: pos.y,
      shift: e.shiftKey,
      ctrl: e.ctrlKey || e.metaKey,
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (propsRef.current.interactionLocked) return;
    const pos = localPos(e);
    if (dragRef.current) {
      dragRef.current = { ...dragRef.current, x: pos.x, y: pos.y };
      return;
    }
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = hitNote(pos.x, pos.y)
        ? "grab"
        : hitKey(pos.x, pos.y) !== null
          ? "pointer"
          : "default";
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (propsRef.current.interactionLocked) return;
    const pos = localPos(e);
    const drag = dragRef.current;
    if (drag) {
      dragRef.current = null;
      const target = hitKey(pos.x, pos.y);
      const moved = Math.hypot(pos.x - drag.x, pos.y - drag.y);
      if (target !== null && target !== drag.note.column) {
        // 拖到别的键 → 改列(占用列由 reducer 拒绝)
        propsRef.current.onNoteMove(drag.note.onsetId, drag.note.column, target);
      } else if (moved < 6) {
        propsRef.current.onKeyClick(drag.note.column, e.shiftKey, e.ctrlKey || e.metaKey); // 原地点击 → 走状态机
      }
      return;
    }
    const pending = pendingClickRef.current;
    pendingClickRef.current = null;
    if (pending && pending.col !== null && Math.hypot(pos.x - pending.x, pos.y - pending.y) < 6) {
      propsRef.current.onKeyClick(pending.col, pending.shift, pending.ctrl);
    }
  }

  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    if (propsRef.current.interactionLocked) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // 右击画面上的音符 → 删除该键;未命中音符则回退到"活动采音点上该键"
    const note = hitNote(x, y);
    if (note) {
      propsRef.current.onNoteDelete(note.onsetId, note.column);
      return;
    }
    const col = hitKey(x, y);
    if (col !== null) propsRef.current.onKeyRightClick(col);
  }

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={onContextMenu}
      />
    </div>
  );
}
