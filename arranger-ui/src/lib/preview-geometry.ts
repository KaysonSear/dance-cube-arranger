/** Canvas-independent geometry for the six-key preview. */

export interface Point {
  x: number;
  y: number;
}

/** Reference arcade note: large concentric target, scaled to the editor stage. */
export const PREVIEW_NOTE_DIAMETER = 42;
export const PREVIEW_NOTE_HIT_RADIUS = 24;
export const PREVIEW_HOLD_WIDTH = PREVIEW_NOTE_DIAMETER;
export const PREVIEW_HOLD_INNER_MIN_WIDTH = 32;
export const PREVIEW_HOLD_INNER_MAX_WIDTH = 37;
export const PREVIEW_HOLD_TAIL_DIAMETER = 34;
export const PREVIEW_HOLD_RAIL_COUNT = 4;

/** Radius ratios sampled from the supplied blue/yellow circular-note references. */
export const PREVIEW_ORB_RING_RATIOS = {
  darkWell: 0.72,
  innerRing: 0.51,
  innerWell: 0.42,
  core: 0.3,
} as const;

export interface HoldRibbonVisualStyle {
  outerWidth: number;
  innerWidth: number;
  bodyAlpha: number;
  highlightWidth: number;
  highlightAlpha: number;
}

/** Static flying ribbon when strength is null; breathing active ribbon otherwise. */
export function holdRibbonVisualStyle(strength: number | null): HoldRibbonVisualStyle {
  if (strength === null) {
    return {
      outerWidth: PREVIEW_HOLD_WIDTH,
      innerWidth: PREVIEW_HOLD_WIDTH - 5,
      bodyAlpha: 1,
      highlightWidth: 1.8,
      highlightAlpha: 1,
    };
  }
  const u = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 1;
  return {
    outerWidth: PREVIEW_HOLD_WIDTH,
    innerWidth:
      PREVIEW_HOLD_INNER_MIN_WIDTH +
      (PREVIEW_HOLD_INNER_MAX_WIDTH - PREVIEW_HOLD_INNER_MIN_WIDTH) * u,
    bodyAlpha: 0.82 + 0.18 * u,
    highlightWidth: 1.5 + 1.2 * u,
    highlightAlpha: 0.42 + 0.58 * u,
  };
}

export interface PreviewLayout {
  w: number;
  h: number;
  cx: number;
  cy: number;
  r: number;
  keyR: number;
  padding: number;
  topReserve: number;
  bottomReserve: number;
}

const HEX_Y = 0.866;

export function computePreviewLayout(w: number, h: number): PreviewLayout {
  const safeW = Math.max(1, w);
  const safeH = Math.max(1, h);
  const padding = 8;
  const topReserve = Math.min(16, safeH * 0.08);
  const bottomReserve = Math.min(36, safeH * 0.18);
  const cx = safeW / 2;
  const cy = topReserve + Math.max(0, safeH - topReserve - bottomReserve) / 2;
  const targetR = Math.min(safeW, safeH) * 0.42;
  const keyR = Math.min(36, Math.max(Math.min(26, safeH * 0.12), targetR * 0.19));
  const horizontalCap = Math.max(0, cx - padding - keyR);
  const verticalCap = Math.max(
    0,
    Math.min(cy - topReserve - keyR, safeH - bottomReserve - cy - keyR) / HEX_Y,
  );
  const r = Math.max(0, Math.min(targetR, horizontalCap, verticalCap));

  return { w: safeW, h: safeH, cx, cy, r, keyR, padding, topReserve, bottomReserve };
}

export function holdVisibleLength(
  laneDistance: number,
  durationSec: number,
  leadInSec: number,
  travelledDistance: number,
): number {
  if (laneDistance <= 0 || durationSec <= 0 || leadInSec <= 0 || travelledDistance <= 0) return 0;
  return Math.max(
    0,
    Math.min(laneDistance, travelledDistance, (laneDistance * durationSec) / leadInSec),
  );
}

/** 预览区键位标签：非模拟器模式恒为 0..5；模拟器模式下附带对应快捷键。 */
export function formatKeySlotLabel(
  col: number,
  simulatorMode: boolean,
  keyLabel?: string,
): string {
  if (!simulatorMode) return String(col);
  return keyLabel ? `${col} · ${keyLabel}` : String(col);
}

