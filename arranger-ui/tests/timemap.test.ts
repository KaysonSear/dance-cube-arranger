import { describe, expect, it } from "vitest";

import {
  audioSecToBeat,
  beat0AudioSec,
  beatToAudioSec,
  beatToChartSec,
  chartSecToBeat,
  snapBeatFloat,
  snapToBeat,
  TimeMapError,
  timePointsFromMc,
  type TimingContext,
  type TimePoint,
} from "../src/lib/timemap";

const BPM120: TimePoint[] = [{ beat: 0, bpm: 120, delayMs: 0 }];
const TWO_SEG: TimePoint[] = [
  { beat: 0, bpm: 60, delayMs: 0 },
  { beat: 4, bpm: 120, delayMs: 0 },
];

describe("timePointsFromMc", () => {
  it("parses the WDA-style single entry", () => {
    expect(timePointsFromMc([{ beat: [0, 0, 1], bpm: 103.0, delay: 0.0 }])).toEqual([
      { beat: 0, bpm: 103, delayMs: 0 },
    ]);
  });

  it("sorts by beat and rejects invalid bpm", () => {
    const pts = timePointsFromMc([
      { beat: [4, 0, 1], bpm: 120 },
      { beat: [0, 0, 1], bpm: 60 },
    ]);
    expect(pts.map((p) => p.bpm)).toEqual([60, 120]);
    expect(() => timePointsFromMc([{ beat: [0, 0, 1], bpm: 0 }])).toThrow(TimeMapError);
    expect(() => timePointsFromMc([])).toThrow(TimeMapError);
  });
});

describe("beatToChartSec / chartSecToBeat", () => {
  it("single-BPM linear mapping", () => {
    expect(beatToChartSec(2, BPM120)).toBeCloseTo(1.0, 12);
    expect(chartSecToBeat(1.0, BPM120)).toBeCloseTo(2, 12);
  });

  it("applies the first point's delay as lead-in", () => {
    const tm: TimePoint[] = [{ beat: 0, bpm: 120, delayMs: 500 }];
    expect(beatToChartSec(0, tm)).toBeCloseTo(0.5, 12);
    expect(chartSecToBeat(0.5, tm)).toBeCloseTo(0, 12);
  });

  it("piecewise across a BPM change, both directions", () => {
    // 60bpm × 4 拍 = 4s,之后 120bpm:beat 6 → 4 + 2×0.5 = 5s
    expect(beatToChartSec(4, TWO_SEG)).toBeCloseTo(4.0, 12);
    expect(beatToChartSec(6, TWO_SEG)).toBeCloseTo(5.0, 12);
    expect(chartSecToBeat(2.0, TWO_SEG)).toBeCloseTo(2, 12);
    expect(chartSecToBeat(5.0, TWO_SEG)).toBeCloseTo(6, 12);
  });
});

describe("beat0AudioSec — offset 符号统一", () => {
  it("corpus-positive, WDA-negative, missing", () => {
    expect(beat0AudioSec(392)).toBeCloseTo(0.392, 12);
    expect(beat0AudioSec(-463)).toBeCloseTo(0.463, 12);
    expect(beat0AudioSec(null)).toBe(0);
    expect(beat0AudioSec(0)).toBe(0);
  });
});

describe("beatToAudioSec / audioSecToBeat", () => {
  const wda: TimingContext = {
    timeMap: [{ beat: 0, bpm: 103, delayMs: 0 }],
    offsetMs: -463,
    nudgeMs: 0,
  };

  it("WDA 锚点:首采音点 beat 0.25 → ≈0.609s", () => {
    expect(beatToAudioSec(0.25, wda)).toBeCloseTo(0.463 + (0.25 * 60) / 103, 6);
    expect(beatToAudioSec(0.25, wda)).toBeCloseTo(0.6086, 3);
  });

  it("nudge 只平移预览映射", () => {
    const nudged = { ...wda, nudgeMs: 50 };
    expect(beatToAudioSec(0.25, nudged) - beatToAudioSec(0.25, wda)).toBeCloseTo(0.05, 9);
  });

  it("round-trips", () => {
    const t = beatToAudioSec(123.25, wda);
    expect(audioSecToBeat(t, wda)).toBeCloseTo(123.25, 9);
  });
});

describe("snap", () => {
  it("snaps to the given denominator (half-up)", () => {
    expect(snapBeatFloat(0.26, 4)).toBeCloseTo(0.25, 12);
    expect(snapBeatFloat(1.24, 4)).toBeCloseTo(1.25, 12);
    expect(snapBeatFloat(0.16, 6)).toBeCloseTo(1 / 6, 12);
    expect(snapBeatFloat(0.35, 3)).toBeCloseTo(1 / 3, 12);
    expect(snapBeatFloat(0.125, 4)).toBeCloseTo(0.25, 12); // half-up
    expect(snapBeatFloat(-0.2, 4)).toBe(0); // 下限 0
  });

  it("snapToBeat returns a tuple at the snap denominator", () => {
    expect(snapToBeat(2.26, 4)).toEqual([2, 1, 4]);
    expect(snapToBeat(0.34, 3)).toEqual([0, 1, 3]);
  });
});
