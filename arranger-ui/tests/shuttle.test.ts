import { describe, expect, it } from "vitest";

import {
  makeShuttle,
  navigationTime,
  sampleShuttle,
  shuttleDurationMs,
} from "../src/lib/shuttle";

describe("distance-adaptive shuttle", () => {
  it("runs at 8x with 120–350ms bounds", () => {
    expect(shuttleDurationMs(10, 10.5)).toBe(120);
    expect(shuttleDurationMs(10, 12)).toBe(250);
    expect(shuttleDurationMs(10, 20)).toBe(350);
  });

  it("samples chart time linearly in both directions", () => {
    const forward = makeShuttle(10, 12, 1_000);
    const reverse = makeShuttle(12, 10, 1_000);
    expect(sampleShuttle(forward, 1_125).position).toBe(11);
    expect(sampleShuttle(reverse, 1_125).position).toBe(11);
    expect(sampleShuttle(forward, 1_250)).toEqual({ position: 12, done: true });
  });

  it("chains repeated navigation from the last requested target", () => {
    const cToB = makeShuttle(11, 10.5, 1_000);
    expect(navigationTime(11, cToB)).toBe(10.5);
    const halfway = sampleShuttle(cToB, 1_060).position;
    const retargeted = makeShuttle(halfway, 10, 1_060);
    expect(retargeted.from).toBe(halfway);
    expect(retargeted.target).toBe(10);
  });
});
