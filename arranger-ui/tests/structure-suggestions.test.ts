import { describe, expect, it } from "vitest";
import path from "node:path";

import {
  shapeStructureSuggestions,
  suggestionsForAudio,
} from "../src/lib/server/structure-suggestions";

describe("shapeStructureSuggestions", () => {
  it("normalizes, sorts and filters malformed sections", () => {
    expect(
      shapeStructureSuggestions([
        { start: 20, end: 30, label: " Chorus " },
        { start: 0, end: 10, label: "INTRO" },
        { start: 9, end: 8, label: "bad" },
        { start: "x", end: 12, label: "bad" },
      ]),
    ).toEqual([
      { start: 0, end: 10, label: "intro" },
      { start: 20, end: 30, label: "chorus" },
    ]);
  });

  it("returns empty for non-arrays", () => {
    expect(shapeStructureSuggestions(null)).toEqual([]);
    expect(shapeStructureSuggestions({ sections: [] })).toEqual([]);
  });

  it("finds the real WDA skeleton from the WDA audio stem", () => {
    const audio = path.resolve(process.cwd(), "..", "WDA", "WDA.mp3");
    const sections = suggestionsForAudio(audio);
    expect(sections.length).toBeGreaterThan(3);
    expect(sections[0].start).toBe(0);
  });
});
