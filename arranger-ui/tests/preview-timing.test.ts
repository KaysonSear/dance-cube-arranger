import { describe, expect, it } from "vitest";

import {
  flightProgress,
  HOLD_BREATH_PERIOD_SEC,
  holdBreathStrength,
  visibleFlightFrame,
} from "../src/lib/preview-timing";

describe("flightProgress(所得即所见)", () => {
  it("shows b while positioned at a, independent of how a was reached", () => {
    const notes = [
      { id: "a", hitSec: 10 },
      { id: "b", hitSec: 10.5 },
      { id: "c", hitSec: 11 },
    ];
    const expected = visibleFlightFrame(notes, 10, 0.75);
    expect(expected).toEqual([
      { id: "a", progress: 1 },
      { id: "b", progress: 1 - 0.5 / 0.75 },
    ]);
    expect(visibleFlightFrame(notes, 10, 0.75)).toEqual(expected);
  });

  it("is inclusive at both boundaries and tolerant of floating point noise", () => {
    expect(flightProgress(10, 10 + 1e-8, 0.75)).toBe(1);
    expect(flightProgress(10.75, 10, 0.75)).toBe(0);
    expect(flightProgress(10.75001, 10, 0.75)).toBeNull();
    expect(flightProgress(9.999, 10, 0.75)).toBeNull();
  });

  it("produces exact reverse samples when visual time runs backward", () => {
    const hitSec = 12;
    const forwardTimes = [11.25, 11.4375, 11.625, 11.8125, 12];
    const forward = forwardTimes.map((time) => flightProgress(hitSec, time, 0.75));
    const reverse = [...forwardTimes]
      .reverse()
      .map((time) => flightProgress(hitSec, time, 0.75));
    expect(reverse).toEqual([...forward].reverse());
  });
});

describe("holdBreathStrength(长条呼吸)", () => {
  it("uses a bounded 0.8s cosine cycle that peaks on landing", () => {
    expect(HOLD_BREATH_PERIOD_SEC).toBe(0.8);
    expect(holdBreathStrength(10, 10)).toBe(1);
    expect(holdBreathStrength(10.2, 10)).toBeCloseTo(0.5);
    expect(holdBreathStrength(10.4, 10)).toBe(0);
    expect(holdBreathStrength(10.8, 10)).toBeCloseTo(1);
    expect(holdBreathStrength(9.9, 10)).toBe(1);
  });

  it("is deterministic when paused or reached by seek and exactly reverses", () => {
    const forwardTimes = [12, 12.1, 12.2, 12.3, 12.4];
    const forward = forwardTimes.map((time) => holdBreathStrength(time, 12));
    const paused = Array.from({ length: 4 }, () => holdBreathStrength(12.25, 12));
    const reverse = [...forwardTimes]
      .reverse()
      .map((time) => holdBreathStrength(time, 12));

    expect(paused.every((value) => value === paused[0])).toBe(true);
    expect(holdBreathStrength(12.25, 12)).toBe(paused[0]);
    expect(reverse).toEqual([...forward].reverse());
  });

  it("falls back safely for an invalid period", () => {
    expect(holdBreathStrength(10.2, 10, 0)).toBe(1);
    expect(holdBreathStrength(10.2, 10, -1)).toBe(1);
  });
});
