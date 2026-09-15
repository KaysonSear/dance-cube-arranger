import { describe, expect, it } from "vitest";

import {
  EMPTY_SEGMENT_STRUCTURE,
  analyzeSegmentCoverage,
  createClipFromRange,
  createSuggestedStructure,
  deriveSegments,
  ensureRelation,
  findClipOverlapIssues,
  findPointCoverageIssues,
  formatAllClipsRangeText,
  formatClipRangeText,
  formatClipTime,
  mergeClips,
  moveClipEdge,
  normalizeSegmentStructure,
  nextCyclicIndex,
  parseAbsoluteTime,
  partitionTimedPoints,
  relationIndexesForSegment,
  removeClip,
  renameSegment,
  restoreSegmentStructure,
  updateRelationKind,
  type SegmentClipV2,
  type SegmentStructureV3,
  type TimedPoint,
} from "../src/lib/segments";

function structure(clips: SegmentClipV2[]): SegmentStructureV3 {
  return { schema: 3, initialized: true, source: "manual", clips, relations: [] };
}

const clip = (id: string, startSec: number, endSec: number, label = ""): SegmentClipV2 => ({
  id,
  startSec,
  endSec,
  label,
});

describe("sparse clip structure", () => {
  it("starts with no clip instead of claiming the full audio", () => {
    expect(deriveSegments(EMPTY_SEGMENT_STRUCTURE)).toEqual([]);
  });

  it("allows point-free audio gaps without treating them as invalid", () => {
    const ranges = deriveSegments(structure([clip("a", 10, 40), clip("b", 50, 80)]));
    const layout = analyzeSegmentCoverage(ranges, 100);
    const points = partitionTimedPoints(ranges, [
      { id: "p1", atSec: 20 },
      { id: "p2", atSec: 60 },
    ]);

    expect(layout.nonOverlapping).toBe(true);
    expect(layout.gapSec).toBe(40);
    expect(points.coveredCount).toBe(2);
    expect(points.missingIds).toEqual([]);
    expect(points.duplicateIds).toEqual([]);
  });

  it("detects clip overlap even when the overlap contains no point", () => {
    const layout = analyzeSegmentCoverage(
      deriveSegments(structure([clip("a", 0, 60), clip("b", 50, 100)])),
      100,
    );
    expect(layout.nonOverlapping).toBe(false);
    expect(layout.overlapSec).toBe(10);
  });

  it("migrates V1 boundaries, preserves ids/labels, and drops empty clips", () => {
    const migrated = normalizeSegmentStructure(
      {
        schema: 1,
        initialized: true,
        source: "manual",
        boundaries: [
          { id: "b1", atSec: 30 },
          { id: "b2", atSec: 50 },
        ],
        labels: ["verse", "silence", "chorus"],
        relations: [
          { id: "rel", kind: "repeat", segmentIds: ["segment-root", "segment-b2"] },
        ],
      },
      100,
      [
        { id: "a", atSec: 10 },
        { id: "b", atSec: 70 },
      ],
    );

    expect(migrated.clips).toEqual([
      clip("segment-root", 0, 30, "verse"),
      clip("segment-b2", 50, 100, "chorus"),
    ]);
    expect(migrated.relations[0].segmentIds).toEqual(["segment-root", "segment-b2"]);
  });
});

describe("clip editing", () => {
  const points: TimedPoint[] = [
    { id: "a", atSec: 10 },
    { id: "b", atSec: 20 },
    { id: "c", atSec: 70 },
  ];

  it("creates an I/O clip in an unassigned range", () => {
    const base = structure([clip("later", 60, 90, "chorus")]);
    const result = createClipFromRange(base, 5, 25, "new", points, 100);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.structure.clips).toEqual([
      clip("new", 5, 25),
      clip("later", 60, 90, "chorus"),
    ]);
  });

  it("rejects an I/O range that overlaps an existing manual clip", () => {
    const base = structure([clip("a", 0, 30), clip("b", 50, 90)]);
    expect(createClipFromRange(base, 20, 40, "new", points, 100)).toEqual({
      ok: false,
      error: "新区间不可与已有 clip 重叠",
    });
  });

  it("rejects reversed and point-free I/O ranges", () => {
    const base = structure([]);
    expect(createClipFromRange(base, 30, 20, "new", points, 100)).toEqual({
      ok: false,
      error: "O 必须晚于 I",
    });
    expect(createClipFromRange(base, 30, 40, "new", points, 100)).toEqual({
      ok: false,
      error: "该 I/O 区间内没有采音点，未创建 clip",
    });
  });

  it("rejects endpoint moves that overlap another clip", () => {
    const base = structure([clip("a", 0, 30), clip("b", 40, 80)]);
    expect(moveClipEdge(base, "a", "end", 50, 100, points)).toEqual({
      ok: false,
      error: "clip 不可与相邻桥段重叠",
    });
  });

  it("allows a temporary missing point and removes a clip that becomes empty", () => {
    const base: SegmentStructureV3 = {
      ...structure([clip("a", 0, 30), clip("b", 60, 90)]),
      relations: [{ id: "rel", kind: "repeat", segmentIds: ["a", "b"] }],
    };
    const moved = moveClipEdge(base, "a", "start", 15, 100, points);
    expect(moved.ok).toBe(true);
    if (!moved.ok) throw new Error(moved.error);
    expect(moved.structure.clips.map((item) => item.id)).toEqual(["a", "b"]);
    expect(partitionTimedPoints(moved.structure.clips, points).missingIds).toEqual(["a"]);

    const removed = moveClipEdge(base, "a", "start", 25, 100, points);
    expect(removed.ok).toBe(true);
    if (!removed.ok) throw new Error(removed.error);
    expect(removed.structure.clips.map((item) => item.id)).toEqual(["b"]);
    expect(removed.structure.relations).toEqual([]);
  });

  it("merges neighbouring clips across an allowed empty gap", () => {
    const base = structure([clip("a", 0, 30, "verse"), clip("b", 50, 90, "chorus")]);
    const merged = mergeClips(base, "a", "b");
    expect(merged.ok).toBe(true);
    if (!merged.ok) throw new Error(merged.error);
    expect(merged.structure.clips).toEqual([clip("a", 0, 90, "verse")]);
  });

  it("removes one clip and prunes relations that no longer have two members", () => {
    const base: SegmentStructureV3 = {
      ...structure([clip("a", 0, 30), clip("b", 50, 90)]),
      relations: [{ id: "rel", kind: "upgrade", segmentIds: ["a", "b"] }],
    };
    const removed = removeClip(base, "a");
    expect(removed.clips).toEqual([clip("b", 50, 90)]);
    expect(removed.relations).toEqual([]);
    expect(removed.source).toBe("manual");
  });
});

describe("saved structure restore", () => {
  const points = [{ id: "p", atSec: 10 }];

  it("discards legacy auto-seeded clips so I/O can start from empty", () => {
    const restored = restoreSegmentStructure(
      {
        schema: 2,
        initialized: true,
        source: "auto",
        clips: [clip("auto", 0, 20)],
        relations: [],
      },
      100,
      points,
    );
    expect(restored).toEqual({
      schema: 3,
      initialized: true,
      source: "manual",
      clips: [],
      relations: [],
    });
  });

  it("preserves manually confirmed clips", () => {
    const manual = structure([clip("manual", 0, 20)]);
    expect(restoreSegmentStructure(manual, 100, points).clips).toEqual(manual.clips);
  });
});

describe("segment semantic relations", () => {
  const base = structure([
    clip("a", 0, 20),
    clip("b", 30, 50),
    clip("c", 60, 80),
  ]);

  it("creates relations in chronological order and updates their kind", () => {
    const relation = ensureRelation(base, "repeat", ["c", "a"], "rel-1");
    expect(relation.ok).toBe(true);
    if (!relation.ok) throw new Error(relation.error);
    expect(relation.relation.segmentIds).toEqual(["a", "c"]);
    expect(updateRelationKind(relation.structure, "rel-1", "upgrade").relations[0].kind).toBe(
      "upgrade",
    );
  });

  it("renames by stable clip id", () => {
    expect(renameSegment(base, "b", "bridge").clips[1].label).toBe("bridge");
  });

  it("returns every relation layer for a clip with multiple memberships", () => {
    const relations = [
      { id: "r1", kind: "repeat" as const, segmentIds: ["a", "b"] },
      { id: "r2", kind: "upgrade" as const, segmentIds: ["b", "c"] },
      { id: "r3", kind: "contrast" as const, segmentIds: ["a", "c"] },
    ];
    expect(relationIndexesForSegment(relations, "b")).toEqual([0, 1]);
    expect(relationIndexesForSegment(relations, "missing")).toEqual([]);
  });
});

describe("automatic sparse suggestions", () => {
  it("omits empty sections but retains all onset-containing sections", () => {
    const points = [
      { id: "a", atSec: 10 },
      { id: "b", atSec: 70 },
    ];
    const result = createSuggestedStructure(
      [
        { start: 0, end: 30, label: "verse" },
        { start: 30, end: 50, label: "silence" },
        { start: 50, end: 100, label: "chorus" },
      ],
      100,
      (sec) => sec,
      points,
    );
    expect(result.clips).toEqual([
      clip("auto-clip-1", 0, 30, "verse"),
      clip("auto-clip-2", 50, 100, "chorus"),
    ]);
    expect(partitionTimedPoints(result.clips, points).missingIds).toEqual([]);
  });
});

describe("onset partition", () => {
  it("assigns a touching boundary point to the right clip", () => {
    const ranges = deriveSegments(structure([clip("a", 0, 10), clip("b", 10, 20)]));
    const result = partitionTimedPoints(ranges, [
      { id: "left", atSec: 9.999 },
      { id: "edge", atSec: 10 },
      { id: "end", atSec: 20 },
    ]);
    expect(result.bySegment).toEqual([["left"], ["edge", "end"]]);
  });

  it("includes an isolated O endpoint even when another clip exists after a gap", () => {
    const ranges = deriveSegments(structure([clip("a", 0, 10), clip("b", 20, 30)]));
    const result = partitionTimedPoints(ranges, [{ id: "at-o", atSec: 10 }]);
    expect(result.bySegment).toEqual([["at-o"], []]);
  });

  it("reports missing and duplicate points", () => {
    const ranges = deriveSegments(structure([clip("a", 0, 15), clip("b", 10, 20)]));
    const result = partitionTimedPoints(ranges, [
      { id: "duplicate", atSec: 12 },
      { id: "missing", atSec: 30 },
    ]);
    expect(result.duplicateIds).toEqual(["duplicate"]);
    expect(result.missingIds).toEqual(["missing"]);
  });

  it("covers all 618 points exactly once across sparse clips", () => {
    const points = Array.from({ length: 618 }, (_, index) => ({
      id: `p${index}`,
      atSec: index < 309 ? index / 10 : 60 + (index - 309) / 10,
    }));
    const ranges = deriveSegments(structure([clip("a", 0, 31), clip("b", 60, 91)]));
    const result = partitionTimedPoints(ranges, points);
    expect(result.coveredCount).toBe(618);
    expect(result.missingIds).toEqual([]);
    expect(result.duplicateIds).toEqual([]);
  });
});

describe("navigable coverage issues", () => {
  const ranges = deriveSegments(
    structure([
      clip("a", 0, 10),
      clip("b", 10, 20),
      clip("c", 30, 50),
      clip("d", 40, 60),
    ]),
  );

  it("lists missing and duplicate points in time order with conflicting clip ids", () => {
    const issues = findPointCoverageIssues(ranges, [
      { id: "duplicate-late", atSec: 45 },
      { id: "touching", atSec: 10 },
      { id: "missing", atSec: 25 },
      { id: "duplicate-early", atSec: 42 },
    ]);
    expect(issues.missing).toEqual([{ pointId: "missing", atSec: 25 }]);
    expect(issues.duplicates).toEqual([
      { pointId: "duplicate-early", atSec: 42, clipIds: ["c", "d"] },
      { pointId: "duplicate-late", atSec: 45, clipIds: ["c", "d"] },
    ]);
  });

  it("lists every overlapping clip pair and overlap duration", () => {
    expect(findClipOverlapIssues(ranges)).toEqual([
      { leftClipId: "c", rightClipId: "d", startSec: 40, endSec: 50, durationSec: 10 },
    ]);
  });

  it("cycles to zero after the final issue", () => {
    expect(nextCyclicIndex(-1, 3)).toBe(0);
    expect(nextCyclicIndex(0, 3)).toBe(1);
    expect(nextCyclicIndex(2, 3)).toBe(0);
    expect(nextCyclicIndex(0, 0)).toBe(-1);
  });
});

describe("absolute time input", () => {
  it("accepts seconds and mm:ss.mmm", () => {
    expect(parseAbsoluteTime("62.5")).toBe(62.5);
    expect(parseAbsoluteTime("01:02.500")).toBe(62.5);
  });

  it("rejects malformed or negative values", () => {
    expect(parseAbsoluteTime("nope")).toBeNull();
    expect(parseAbsoluteTime("-1")).toBeNull();
  });
});

describe("clip time range formatting", () => {
  it("formats single seconds into mm : ss : cs with centisecond precision", () => {
    expect(formatClipTime(0)).toBe("00 : 00 : 00");
    // 1 minute 46.07 seconds = 106.07s
    expect(formatClipTime(106.07)).toBe("01 : 46 : 07");
    // 2 minutes 03.49 seconds = 123.49s
    expect(formatClipTime(123.49)).toBe("02 : 03 : 49");
    // 3 minutes 02.09 seconds = 182.09s
    expect(formatClipTime(182.09)).toBe("03 : 02 : 09");
    // 3 minutes 08.20 seconds = 188.20s
    expect(formatClipTime(188.2)).toBe("03 : 08 : 20");
  });

  it("formats single clip line with code and tilde separator matching user contract", () => {
    const s01 = { code: "S01", startSec: 106.07, endSec: 123.49 };
    expect(formatClipRangeText(s01)).toBe("S01: 01 : 46 : 07 ~ 02 : 03 : 49");
  });

  it("formats multiple clip lines with newlines matching user contract", () => {
    const clips = [
      { code: "S01", startSec: 106.07, endSec: 123.49 },
      { code: "S02", startSec: 182.09, endSec: 188.2 },
    ];
    const text = formatAllClipsRangeText(clips);
    expect(text).toBe(
      "S01: 01 : 46 : 07 ~ 02 : 03 : 49\nS02: 03 : 02 : 09 ~ 03 : 08 : 20",
    );
  });
});

