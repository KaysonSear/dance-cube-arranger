import { describe, expect, it } from "vitest";

import { parseRangeHeader } from "../src/lib/range";

describe("parseRangeHeader", () => {
  const SIZE = 1000;

  it("closed / open / suffix forms", () => {
    expect(parseRangeHeader("bytes=0-499", SIZE)).toEqual({ start: 0, end: 499 });
    expect(parseRangeHeader("bytes=500-", SIZE)).toEqual({ start: 500, end: 999 });
    expect(parseRangeHeader("bytes=-100", SIZE)).toEqual({ start: 900, end: 999 });
  });

  it("clamps end to size-1; suffix larger than size starts at 0", () => {
    expect(parseRangeHeader("bytes=0-99999", SIZE)).toEqual({ start: 0, end: 999 });
    expect(parseRangeHeader("bytes=-5000", SIZE)).toEqual({ start: 0, end: 999 });
  });

  it("malformed / unsatisfiable → null (200 全量)", () => {
    expect(parseRangeHeader(null, SIZE)).toBeNull();
    expect(parseRangeHeader("bytes=-", SIZE)).toBeNull();
    expect(parseRangeHeader("bytes=abc-", SIZE)).toBeNull();
    expect(parseRangeHeader("bytes=0-1,5-9", SIZE)).toBeNull(); // 多段不支持
    expect(parseRangeHeader("bytes=1000-", SIZE)).toBeNull(); // start ≥ size
    expect(parseRangeHeader("bytes=9-3", SIZE)).toBeNull();
    expect(parseRangeHeader("bytes=0-", 0)).toBeNull();
  });
});
