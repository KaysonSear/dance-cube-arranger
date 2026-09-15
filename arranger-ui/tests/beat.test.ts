import { describe, expect, it } from "vitest";

import { BeatError, beatCompare, beatToFloat, floatToBeat, tickId } from "../src/lib/beat";

describe("beatToFloat", () => {
  it("computes A + B/C", () => {
    expect(beatToFloat([1, 2, 4])).toBe(1.5);
    expect(beatToFloat([8, 0, 4])).toBe(8);
    expect(beatToFloat([0, 1, 4])).toBe(0.25);
  });

  it("rejects invalid tuples", () => {
    expect(() => beatToFloat([1, 2, 0])).toThrow(BeatError);
    expect(() => beatToFloat([1, -1, 4])).toThrow(BeatError);
    expect(() => beatToFloat([1.5, 0, 4] as never)).toThrow(BeatError);
    expect(() => beatToFloat([1, 2] as never)).toThrow(BeatError);
    expect(() => beatToFloat("x" as never)).toThrow(BeatError);
  });
});

describe("floatToBeat", () => {
  it("rounds to the grid", () => {
    expect(floatToBeat(0.25, 4)).toEqual([0, 1, 4]);
    expect(floatToBeat(2.75, 8)).toEqual([2, 6, 8]);
  });

  it("carries when rounding reaches the next whole beat", () => {
    expect(floatToBeat(0.99999, 4)).toEqual([1, 0, 4]);
    expect(floatToBeat(3.9999, 8)).toEqual([4, 0, 8]);
  });

  it("rejects invalid input", () => {
    expect(() => floatToBeat(-0.1, 4)).toThrow(BeatError);
    expect(() => floatToBeat(1, 0)).toThrow(BeatError);
    expect(() => floatToBeat(Number.NaN, 4)).toThrow(BeatError);
  });
});

describe("tickId", () => {
  it("canonicalizes equal rationals to the same id", () => {
    expect(tickId([1, 2, 4])).toBe("1+1/2");
    expect(tickId([1, 1, 2])).toBe("1+1/2");
    expect(tickId([8, 0, 4])).toBe("8");
    expect(tickId([8, 0, 1])).toBe("8");
  });

  it("carries improper fractions", () => {
    expect(tickId([0, 5, 4])).toBe("1+1/4");
    expect(tickId([0, 5, 4])).toBe(tickId([1, 1, 4]));
    expect(tickId([2, 8, 4])).toBe("4");
  });
});

describe("beatCompare", () => {
  it("orders by absolute beat", () => {
    expect(beatCompare([0, 1, 4], [0, 1, 2])).toBeLessThan(0);
    expect(beatCompare([1, 0, 4], [0, 4, 4])).toBe(0);
  });
});
