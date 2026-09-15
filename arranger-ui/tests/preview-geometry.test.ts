import { describe, expect, it } from "vitest";

import {
  computePreviewLayout,
  formatKeySlotLabel,
  holdRibbonVisualStyle,
  holdVisibleLength,
  PREVIEW_HOLD_INNER_MAX_WIDTH,
  PREVIEW_HOLD_INNER_MIN_WIDTH,
  PREVIEW_HOLD_RAIL_COUNT,
  PREVIEW_HOLD_TAIL_DIAMETER,
  PREVIEW_HOLD_WIDTH,
  PREVIEW_NOTE_DIAMETER,
  PREVIEW_NOTE_HIT_RADIUS,
  PREVIEW_ORB_RING_RATIOS,
} from "../src/lib/preview-geometry";

describe("computePreviewLayout", () => {
  it("enlarges the default stage by at least 45% without clipping keys", () => {
    const layout = computePreviewLayout(960, 434);
    const oldRadius = 434 * 0.34;

    expect((layout.r * layout.r) / (oldRadius * oldRadius)).toBeGreaterThanOrEqual(1.45);
    expect(layout.keyR).toBeGreaterThanOrEqual(26);
    expect(layout.keyR).toBeLessThanOrEqual(36);

    const centers = [
      { x: layout.cx - layout.r, y: layout.cy },
      { x: layout.cx + layout.r, y: layout.cy },
      { x: layout.cx - layout.r * 0.5, y: layout.cy - layout.r * 0.866 },
      { x: layout.cx + layout.r * 0.5, y: layout.cy + layout.r * 0.866 },
    ];
    for (const point of centers) {
      expect(point.x - layout.keyR).toBeGreaterThanOrEqual(layout.padding);
      expect(point.x + layout.keyR).toBeLessThanOrEqual(layout.w - layout.padding);
      expect(point.y - layout.keyR).toBeGreaterThanOrEqual(layout.topReserve - 1e-9);
      expect(point.y + layout.keyR).toBeLessThanOrEqual(layout.h - layout.bottomReserve + 1e-9);
    }
  });

  it("shrinks safely on a small stage while preserving the hint area", () => {
    const layout = computePreviewLayout(320, 240);
    expect(layout.r).toBeGreaterThan(0);
    expect(layout.cy + layout.r * 0.866 + layout.keyR).toBeLessThanOrEqual(
      layout.h - layout.bottomReserve,
    );
    expect(layout.cy - layout.r * 0.866 - layout.keyR).toBeGreaterThanOrEqual(
      layout.topReserve,
    );
  });
});

describe("enamel note dimensions", () => {
  it("uses a large arcade ring and an exactly matching hold silhouette", () => {
    expect(PREVIEW_NOTE_DIAMETER).toBe(42);
    expect(PREVIEW_HOLD_WIDTH).toBe(PREVIEW_NOTE_DIAMETER);
    expect(PREVIEW_NOTE_HIT_RADIUS).toBeGreaterThan(PREVIEW_NOTE_DIAMETER / 2);
    expect(PREVIEW_HOLD_TAIL_DIAMETER).toBeLessThan(PREVIEW_NOTE_DIAMETER);
    expect(PREVIEW_HOLD_RAIL_COUNT).toBe(4);
  });

  it("matches the reference orb's outer-ring, dark-well, inner-ring and core proportions", () => {
    expect(PREVIEW_ORB_RING_RATIOS).toEqual({
      darkWell: 0.72,
      innerRing: 0.51,
      innerWell: 0.42,
      core: 0.3,
    });
  });

  it("keeps a fixed 42px silhouette while the active inner track breathes", () => {
    const contracted = holdRibbonVisualStyle(0);
    const expanded = holdRibbonVisualStyle(1);
    const flying = holdRibbonVisualStyle(null);

    expect(contracted.outerWidth).toBe(PREVIEW_NOTE_DIAMETER);
    expect(expanded.outerWidth).toBe(PREVIEW_NOTE_DIAMETER);
    expect(contracted.innerWidth).toBe(PREVIEW_HOLD_INNER_MIN_WIDTH);
    expect(expanded.innerWidth).toBe(PREVIEW_HOLD_INNER_MAX_WIDTH);
    expect(expanded.bodyAlpha).toBeGreaterThan(contracted.bodyAlpha);
    expect(expanded.highlightAlpha).toBeGreaterThan(contracted.highlightAlpha);
    expect(expanded.highlightWidth).toBeGreaterThan(contracted.highlightWidth);
    expect(flying).toEqual({
      outerWidth: PREVIEW_NOTE_DIAMETER,
      innerWidth: PREVIEW_NOTE_DIAMETER - 5,
      bodyAlpha: 1,
      highlightWidth: 1.8,
      highlightAlpha: 1,
    });
  });

  it("clamps active breath strength to its visual ranges", () => {
    expect(holdRibbonVisualStyle(-2)).toEqual(holdRibbonVisualStyle(0));
    expect(holdRibbonVisualStyle(3)).toEqual(holdRibbonVisualStyle(1));
  });
});

describe("holdVisibleLength", () => {
  it("is bounded by both travelled distance and hold duration", () => {
    expect(holdVisibleLength(180, 0.6, 1.8, 30)).toBe(30);
    expect(holdVisibleLength(180, 0.2, 1.8, 180)).toBe(20);
    expect(holdVisibleLength(180, 3, 1.8, 180)).toBe(180);
  });

  it("retracts monotonically with the remaining hold time", () => {
    const lengths = [1.8, 1.2, 0.6, 0].map((remain) =>
      holdVisibleLength(180, remain, 1.8, 180),
    );
    expect(lengths).toEqual([180, 120, 60, 0]);
  });
});

describe("formatKeySlotLabel(无论是否模拟器模式均显示0-5，模拟器多显示快捷键)", () => {
  it("always shows column 0..5 in non-simulator mode", () => {
    for (let col = 0; col < 6; col++) {
      expect(formatKeySlotLabel(col, false)).toBe(String(col));
      expect(formatKeySlotLabel(col, false, "B")).toBe(String(col));
    }
  });

  it("shows column 0..5 plus shortcut key in simulator mode", () => {
    const labels = ["B", "E", "L", "K", "Z", "J"];
    for (let col = 0; col < 6; col++) {
      expect(formatKeySlotLabel(col, true, labels[col])).toBe(`${col} · ${labels[col]}`);
    }
    // Fallback when label is missing
    expect(formatKeySlotLabel(3, true)).toBe("3");
  });
});
