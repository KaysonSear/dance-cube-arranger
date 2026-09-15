import { describe, expect, it } from "vitest";

import { holdColor, NOTE_COLORS, noteColor } from "../src/lib/colors";
import { relationGroupColor, RELATION_GROUP_COLORS } from "../src/lib/theme";

describe("noteColor(规则5)", () => {
  it("0 → 灰(未指派), 1 → 蓝(单押), ≥2 → 黄(双押/多押)", () => {
    expect(noteColor(0)).toBe(NOTE_COLORS.unassigned);
    expect(noteColor(1)).toBe(NOTE_COLORS.single);
    expect(noteColor(2)).toBe(NOTE_COLORS.chord);
    expect(noteColor(6)).toBe(NOTE_COLORS.chord);
  });
});

describe("holdColor(长条头尾一致)", () => {
  it("单押长条为蓝，多押中的长条头尾均为黄", () => {
    expect(holdColor(1)).toBe(NOTE_COLORS.single);
    expect(holdColor(2)).toBe(NOTE_COLORS.chord);
    expect(holdColor(6)).toBe(NOTE_COLORS.chord);
  });
});

describe("relationGroupColor", () => {
  it("assigns distinct group colors and wraps deterministically", () => {
    expect(new Set(RELATION_GROUP_COLORS).size).toBe(RELATION_GROUP_COLORS.length);
    expect(relationGroupColor(0)).toBe(RELATION_GROUP_COLORS[0]);
    expect(relationGroupColor(RELATION_GROUP_COLORS.length)).toBe(RELATION_GROUP_COLORS[0]);
  });
});
