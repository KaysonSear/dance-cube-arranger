import { describe, expect, it } from "vitest";

import {
  type HoldOverlapWarning,
  type Onset,
  type TripleChordWarning,
} from "../src/lib/arrangement";
import { buildDiagnosticsCsv, encodeCsvField, holdOverlapTarget } from "../src/lib/diagnostics-csv";
import type { TimingContext } from "../src/lib/timemap";

const timing: TimingContext = {
  timeMap: [
    { beat: 0, bpm: 120, delayMs: 0 },
    { beat: 2, bpm: 60, delayMs: 0 },
  ],
  offsetMs: 250,
  nudgeMs: 50,
};
const onsets: Onset[] = [
  { id: "head", beat: [1, 0, 1], beatFloat: 1, source: [] },
  { id: "hit", beat: [3, 0, 1], beatFloat: 3, source: [] },
];
const overlap: HoldOverlapWarning = {
  kind: "hold-overlap", onsetId: "head", overlappedOnsetId: "hit", column: 0, endbeatFloat: 4,
};
const triple: TripleChordWarning = {
  kind: "triple-chord", beatFloat: 3, onsetId: "hit", columns: [0, 1, 3],
  startingColumns: [0, 1], endingColumns: [3], holdingColumns: [0], totalCount: 3,
};

describe("diagnostics CSV", () => {
  it("sorts by beat, then puts overlaps before triples and uses the audio time map", () => {
    const csv = buildDiagnosticsCsv(onsets, [overlap], [triple, { ...triple, beatFloat: 0 }], timing);
    expect(csv.split("\r\n")).toEqual([
      "\uFEFF类型,拍位,音频时间（秒）,通道,说明",
      '三押及以上,0,-0.200,"0,1,3","起始：0,1 / 释放：3 / 持续：0"',
      "长条重叠,3,1.800,0,同通道后续采音点与长条重叠",
      '三押及以上,3,1.800,"0,1,3","起始：0,1 / 释放：3 / 持续：0"',
      "",
    ]);
  });

  it("writes a UTF-8 BOM and only a header when there are no diagnostics", () => {
    const csv = buildDiagnosticsCsv([], [], [], timing);
    expect([...new TextEncoder().encode(csv).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv).toBe("\uFEFF类型,拍位,音频时间（秒）,通道,说明\r\n");
  });

  it("escapes commas, quotes and line breaks", () => {
    expect(encodeCsvField('通道,"备注"\r\n第二行')).toBe('"通道,""备注""\r\n第二行"');
    expect(encodeCsvField("长条重叠")).toBe("长条重叠");
  });

  it("uses the same target fallback as jumping and skips unresolved diagnostics", () => {
    expect(holdOverlapTarget(overlap, (id) => onsets.find((o) => o.id === id))).toBe(onsets[1]);
    expect(buildDiagnosticsCsv(onsets.slice(0, 1), [overlap], [], timing))
      .toContain("长条重叠,1,0.300,0,");
    expect(buildDiagnosticsCsv([], [overlap], [], timing)).not.toContain("长条重叠");
  });
});
