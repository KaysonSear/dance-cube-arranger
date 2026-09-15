import { describe, expect, it } from "vitest";

import type { Beat } from "../src/lib/beat";
import {
  assignmentsAt,
  type AssignmentsMap,
  type Column,
  type Onset,
} from "../src/lib/arrangement";
import {
  ARRANGEMENT_CLIPBOARD_KIND,
  ARRANGEMENT_CLIPBOARD_VERSION,
  buildArrangementClipboard,
  parseArrangementClipboard,
  pasteArrangementClipboard,
  serializeArrangementClipboard,
  type ArrangementClipboardV1,
} from "../src/lib/segment-clipboard";
import { deriveSegments, partitionTimedPoints, type SegmentStructureV3 } from "../src/lib/segments";

function beat(value: number): Beat {
  return [Math.floor(value), Math.round((value % 1) * 4), 4];
}

function onsets(values: number[]): Onset[] {
  return values.map((value, index) => ({
    id: `o${index}`,
    beat: beat(value),
    beatFloat: value,
    source: [],
  }));
}

function payload(groups: ArrangementClipboardV1["onsets"]): ArrangementClipboardV1 {
  return {
    kind: ARRANGEMENT_CLIPBOARD_KIND,
    version: ARRANGEMENT_CLIPBOARD_VERSION,
    onsets: groups,
  };
}

describe("arrangement clipboard", () => {
  it("maps ABCDE to five consecutive target onsets regardless of timing intervals", () => {
    const list = onsets([0, 0.25, 1, 3, 3.25, 10, 10.1, 13, 20, 20.25]);
    const source: AssignmentsMap = Object.fromEntries(
      list.slice(0, 5).map((onset, index) => [
        onset.id,
        [{ column: index as Column, endbeat: null }],
      ]),
    );
    const copied = buildArrangementClipboard(
      list,
      source,
      list.slice(0, 5).map((onset) => onset.id),
    );
    expect(copied.ok).toBe(true);
    if (!copied.ok) throw new Error(copied.error);

    const pasted = pasteArrangementClipboard(list, {}, list[5].id, copied.payload);
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) throw new Error(pasted.error);
    expect(
      list.slice(5).map((onset) => assignmentsAt(pasted.map, onset.id).map((item) => item.column)),
    ).toEqual([[0], [1], [2], [3], [4]]);
  });

  it("overwrites chords and clears targets for copied unassigned onsets", () => {
    const list = onsets([0, 1, 2, 10, 11, 12]);
    const source: AssignmentsMap = {
      o0: [
        { column: 0, endbeat: null },
        { column: 5, endbeat: null },
      ],
      o2: [{ column: 3, endbeat: null }],
    };
    const target: AssignmentsMap = {
      o3: [{ column: 2, endbeat: null }],
      o4: [{ column: 4, endbeat: null }],
      o5: [{ column: 1, endbeat: null }],
    };
    const copied = buildArrangementClipboard(list, source, ["o0", "o1", "o2"]);
    if (!copied.ok) throw new Error(copied.error);
    const pasted = pasteArrangementClipboard(list, target, "o3", copied.payload);
    if (!pasted.ok) throw new Error(pasted.error);

    expect(assignmentsAt(pasted.map, "o3").map((item) => item.column)).toEqual([0, 5]);
    expect(assignmentsAt(pasted.map, "o4")).toEqual([]);
    expect(assignmentsAt(pasted.map, "o5").map((item) => item.column)).toEqual([3]);
  });

  it("maps exact, fractional, and cross-clip hold tails by continuous onset position", () => {
    const list = onsets([0, 1, 2, 4, 10, 11, 13, 20, 30]);
    const source: AssignmentsMap = {
      o0: [
        { column: 0, endbeat: beat(2) },
        { column: 1, endbeat: beat(1.5) },
      ],
      o1: [{ column: 2, endbeat: beat(4) }],
    };
    const copied = buildArrangementClipboard(list, source, ["o0", "o1"]);
    if (!copied.ok) throw new Error(copied.error);
    const pasted = pasteArrangementClipboard(list, {}, "o4", copied.payload);
    if (!pasted.ok) throw new Error(pasted.error);

    const first = assignmentsAt(pasted.map, "o4");
    expect(first.find((item) => item.column === 0)?.endbeat).toEqual(beat(13));
    expect(first.find((item) => item.column === 1)?.endbeat).toEqual([12, 0, 2304]);
    expect(assignmentsAt(pasted.map, "o5")[0].endbeat).toEqual(beat(20));
  });

  it("serializes, parses, normalizes, and rejects malformed clipboard data", () => {
    const valid = payload([
      {
        assignments: [
          { column: 5, holdOffset: null },
          { column: 1, holdOffset: 1.5 },
        ],
      },
    ]);
    const parsed = parseArrangementClipboard(serializeArrangementClipboard(valid));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.payload.onsets[0].assignments.map((item) => item.column)).toEqual([1, 5]);

    expect(parseArrangementClipboard("not json").ok).toBe(false);
    expect(parseArrangementClipboard(JSON.stringify({ ...valid, version: 2 })).ok).toBe(false);
    expect(
      parseArrangementClipboard(
        JSON.stringify(
          payload([
            {
              assignments: [
                { column: 2, holdOffset: null },
                { column: 2, holdOffset: null },
              ],
            },
          ]),
        ),
      ).ok,
    ).toBe(false);
    expect(
      parseArrangementClipboard(
        JSON.stringify(payload([{ assignments: [{ column: 9 as Column, holdOffset: null }] }])),
      ).ok,
    ).toBe(false);
  });

  it("rejects shortages atomically and rejects a source hold beyond the last onset", () => {
    const list = onsets([0, 1, 2]);
    const original: AssignmentsMap = { o2: [{ column: 4, endbeat: null }] };
    const tooLong = payload([
      { assignments: [{ column: 0, holdOffset: null }] },
      { assignments: [{ column: 1, holdOffset: null }] },
    ]);
    const pasted = pasteArrangementClipboard(list, original, "o2", tooLong);
    expect(pasted.ok).toBe(false);
    expect(original).toEqual({ o2: [{ column: 4, endbeat: null }] });

    const holdNeedsMoreTargets = payload([
      { assignments: [{ column: 0, holdOffset: 2 }] },
    ]);
    expect(pasteArrangementClipboard(list, original, "o1", holdNeedsMoreTargets)).toEqual({
      ok: false,
      error: "目标谱后续采音点不足，无法映射长条尾",
    });

    const beyond: AssignmentsMap = { o1: [{ column: 3, endbeat: beat(3) }] };
    const copied = buildArrangementClipboard(list, beyond, ["o1"]);
    expect(copied).toEqual({
      ok: false,
      error: "长条尾超过源谱最后一个采音点，无法按序号复制",
    });
  });

  it("uses existing left-closed/right-open ownership at touching clip boundaries", () => {
    const structure: SegmentStructureV3 = {
      schema: 3,
      clips: [
        { id: "a", startSec: 0, endSec: 1, label: "" },
        { id: "b", startSec: 1, endSec: 2, label: "" },
      ],
      relations: [],
    };
    const segments = deriveSegments(structure);
    const partition = partitionTimedPoints(segments, [
      { id: "before", atSec: 0.5 },
      { id: "boundary", atSec: 1 },
    ]);
    expect(partition.bySegment).toEqual([["before"], ["boundary"]]);
  });
});
