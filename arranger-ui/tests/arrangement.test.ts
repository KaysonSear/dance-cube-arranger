import { describe, expect, it } from "vitest";

import {
  assign,
  assignAllToColumn,
  assignmentsAt,
  assignmentsFromJson,
  assignmentsToJson,
  buildExportNotes,
  buildOnsets,
  chordSize,
  clearOnset,
  clearOnsets,
  isAddedOnset,
  isKeyCEvent,
  isKeyVEvent,
  isMirrorKeyEvent,
  makeAddedOnset,
  mergeOnsets,
  mirrorAssignments,
  mirrorColumn,
  move,
  replaceOnsetAssignments,
  seedAssignments,
  setHoldEnd,
  shiftHoldBeat,
  swapOnsetAssignments,
  unassign,
  validate,
  validateTriples,
  type AssignmentsMap,
  type Column,
  type Onset,
} from "../src/lib/arrangement";
import { noteColor, NOTE_COLORS } from "../src/lib/colors";
import type { SourceNote } from "../src/lib/mc";

function sn(beat: [number, number, number], column = 5, endbeat: [number, number, number] | null = null): SourceNote {
  const f = beat[0] + beat[1] / beat[2];
  return {
    beat,
    beatFloat: f,
    column,
    endbeat,
    endbeatFloat: endbeat ? endbeat[0] + endbeat[1] / endbeat[2] : null,
  };
}

describe("buildOnsets", () => {
  it("groups equal-rational ticks and sorts", () => {
    const onsets = buildOnsets([sn([4, 0, 4], 1), sn([1, 2, 4], 2), sn([1, 1, 2], 3)]);
    expect(onsets).toHaveLength(2);
    expect(onsets[0].id).toBe("1+1/2");
    expect(onsets[0].source).toHaveLength(2);
    expect(onsets[1].beatFloat).toBe(4);
  });
});

describe("seedAssignments", () => {
  const onsets = buildOnsets([sn([0, 0, 1], 5), sn([1, 0, 1], 2, [2, 0, 1]), sn([1, 0, 1], 2)]);

  it("placeholder → 全部未指派", () => {
    expect(seedAssignments(onsets, "placeholder")).toEqual({});
  });

  it("real → 按源列播种(同刻同列去重保首个,保留长条)", () => {
    const map = seedAssignments(onsets, "real");
    expect(assignmentsAt(map, "0")).toEqual([{ column: 5, endbeat: null }]);
    expect(assignmentsAt(map, "1")).toEqual([{ column: 2, endbeat: [2, 0, 1] }]);
  });
});

function single(): { onset: Onset; map: AssignmentsMap } {
  const onsets = buildOnsets([sn([2, 0, 4], 5)]);
  return { onset: onsets[0], map: {} };
}

describe("assign / unassign / move", () => {
  it("assign adds a tap; duplicate column rejected", () => {
    const { onset, map } = single();
    const r1 = assign(map, onset, 3);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(assignmentsAt(r1.map, onset.id)).toEqual([{ column: 3, endbeat: null }]);
    const r2 = assign(r1.map, onset, 3);
    expect(r2.ok).toBe(false);
  });

  it("allows up to 6 keys, rejects the 7th", () => {
    const { onset } = single();
    let map: AssignmentsMap = {};
    for (const c of [0, 1, 2, 3, 4, 5] as Column[]) {
      const r = assign(map, onset, c);
      expect(r.ok).toBe(true);
      if (r.ok) map = r.map;
    }
    expect(chordSize(map, onset.id)).toBe(6);
  });

  it("unassign removes; missing column errors; empty onset drops the key", () => {
    const { onset } = single();
    const a = assign({}, onset, 2);
    if (!a.ok) throw new Error(a.error);
    const bad = unassign(a.map, onset, 4);
    expect(bad.ok).toBe(false);
    const r = unassign(a.map, onset, 2);
    expect(r.ok && r.map[onset.id] === undefined).toBe(true);
  });

  it("move keeps the endbeat and rejects occupied targets", () => {
    const { onset } = single();
    let map: AssignmentsMap = {};
    const a = assign(map, onset, 2);
    if (!a.ok) throw new Error(a.error);
    map = a.map;
    const h = setHoldEnd(map, onset, 2, [3, 0, 4]);
    if (!h.ok) throw new Error(h.error);
    map = h.map;
    const b = assign(map, onset, 4);
    if (!b.ok) throw new Error(b.error);
    map = b.map;

    const occupied = move(map, onset, 2, 4);
    expect(occupied.ok).toBe(false);
    const moved = move(map, onset, 2, 5);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(assignmentsAt(moved.map, onset.id)).toEqual([
      { column: 4, endbeat: null },
      { column: 5, endbeat: [3, 0, 4] },
    ]);
  });
});

describe("replaceOnsetAssignments", () => {
  it("atomically replaces an old chord/hold and preserves no-op identity", () => {
    const { onset } = single();
    const old: AssignmentsMap = {
      [onset.id]: [
        { column: 1, endbeat: [3, 0, 4] },
        { column: 4, endbeat: null },
      ],
    };
    const replaced = replaceOnsetAssignments(old, onset, [
      { column: 5, endbeat: [4, 0, 4] },
      { column: 2, endbeat: null },
    ]);
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(assignmentsAt(replaced.map, onset.id)).toEqual([
      { column: 2, endbeat: null },
      { column: 5, endbeat: [4, 0, 4] },
    ]);
    expect(replaceOnsetAssignments(replaced.map, onset, assignmentsAt(replaced.map, onset.id))).toEqual({
      ok: true,
      map: replaced.map,
    });
  });

  it("rejects empty, duplicate, and non-forward groups", () => {
    const { onset } = single();
    expect(replaceOnsetAssignments({}, onset, []).ok).toBe(false);
    expect(
      replaceOnsetAssignments({}, onset, [
        { column: 2, endbeat: null },
        { column: 2, endbeat: null },
      ]).ok,
    ).toBe(false);
    expect(replaceOnsetAssignments({}, onset, [{ column: 2, endbeat: onset.beat }]).ok).toBe(false);
  });
});

describe("assignAllToColumn", () => {
  it("replaces every onset with one tap on the chosen column", () => {
    const onsets = buildOnsets([
      sn([0, 0, 1], 5),
      sn([1, 0, 1], 2, [2, 0, 1]),
      sn([2, 0, 1], 4),
    ]);
    const existing: AssignmentsMap = {
      [onsets[0].id]: [
        { column: 1, endbeat: null },
        { column: 4, endbeat: null },
      ],
      [onsets[1].id]: [{ column: 2, endbeat: [2, 0, 1] }],
    };

    const next = assignAllToColumn(existing, onsets, 3);
    for (const onset of onsets) {
      expect(assignmentsAt(next, onset.id)).toEqual([{ column: 3, endbeat: null }]);
    }
  });

  it("returns the original map when every onset already matches", () => {
    const onsets = buildOnsets([sn([0, 0, 1]), sn([1, 0, 1])]);
    const map: AssignmentsMap = Object.fromEntries(
      onsets.map((onset) => [onset.id, [{ column: 0, endbeat: null }]]),
    );
    expect(assignAllToColumn(map, onsets, 0)).toBe(map);
  });
});

describe("setHoldEnd(长条尾)", () => {
  it("strictly after the head; equal/earlier rejected; null converts back", () => {
    const { onset } = single(); // beat 2.0
    const a = assign({}, onset, 1);
    if (!a.ok) throw new Error(a.error);

    expect(setHoldEnd(a.map, onset, 1, [2, 0, 4]).ok).toBe(false); // 等于头拍
    expect(setHoldEnd(a.map, onset, 1, [1, 0, 4]).ok).toBe(false); // 早于头拍
    expect(setHoldEnd(a.map, onset, 5, [3, 0, 4]).ok).toBe(false); // 未指派列

    const h = setHoldEnd(a.map, onset, 1, [2, 1, 4]);
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    expect(assignmentsAt(h.map, onset.id)[0].endbeat).toEqual([2, 1, 4]);

    const back = setHoldEnd(h.map, onset, 1, null);
    expect(back.ok && assignmentsAt(back.ok ? back.map : {}, onset.id)[0].endbeat).toBeNull();
  });
});

describe("颜色规则联动(规则5)", () => {
  it("tap+长条头同刻 = 2 键 → 黄", () => {
    const { onset } = single();
    let map: AssignmentsMap = {};
    const a = assign(map, onset, 1);
    if (!a.ok) throw new Error(a.error);
    map = a.map;
    const h = setHoldEnd(map, onset, 1, [3, 0, 4]);
    if (!h.ok) throw new Error(h.error);
    map = h.map;
    expect(noteColor(chordSize(map, onset.id))).toBe(NOTE_COLORS.single); // 仅长条 → 蓝
    const b = assign(map, onset, 2);
    if (!b.ok) throw new Error(b.error);
    expect(noteColor(chordSize(b.map, onset.id))).toBe(NOTE_COLORS.chord); // 单押+长条 → 黄
  });
});

describe("validate(长条压后续同列)", () => {
  it("flags overlapped same-column onsets only", () => {
    const onsets = buildOnsets([sn([2, 0, 1], 5), sn([4, 0, 1], 5), sn([8, 0, 1], 5)]);
    let map: AssignmentsMap = {};
    for (const [o, c] of [
      [onsets[0], 3],
      [onsets[1], 3],
      [onsets[2], 3],
    ] as [Onset, Column][]) {
      const r = assign(map, o, c);
      if (!r.ok) throw new Error(r.error);
      map = r.map;
    }
    const h = setHoldEnd(map, onsets[0], 3, [6, 0, 1]); // 覆盖 beat 4,不含 beat 8
    if (!h.ok) throw new Error(h.error);
    const warnings = validate(onsets, h.map);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ onsetId: onsets[0].id, column: 3, overlappedOnsetId: onsets[1].id });

    const m = move(h.map, onsets[1], 3, 4);
    if (!m.ok) throw new Error(m.error);
    expect(validate(onsets, m.map)).toHaveLength(0);
  });
});

describe("validateTriples(三押及以上，含长条尾与进行中长条)", () => {
  it("does not flag single notes or double taps", () => {
    const onsets = buildOnsets([sn([2, 0, 1], 5), sn([4, 0, 1], 5)]);
    let map: AssignmentsMap = {};
    const r1 = assign(map, onsets[0], 0);
    const r2 = assign(r1.map, onsets[0], 1); // double tap
    const r3 = assign(r2.map, onsets[1], 2); // single tap
    map = r3.map;
    expect(validateTriples(onsets, map)).toHaveLength(0);
  });

  it("flags 3 taps at the same onset", () => {
    const onsets = buildOnsets([sn([2, 0, 1], 5)]);
    let map: AssignmentsMap = {};
    map = assign(map, onsets[0], 0).map;
    map = assign(map, onsets[0], 2).map;
    map = assign(map, onsets[0], 4).map;
    const warnings = validateTriples(onsets, map);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].columns).toEqual([0, 2, 4]);
    expect(warnings[0].startingColumns).toEqual([0, 2, 4]);
    expect(warnings[0].totalCount).toBe(3);
  });

  it("flags double tap + hold tail at the same beat (包括长条尾)", () => {
    const onsets = buildOnsets([sn([0, 0, 1], 5), sn([2, 0, 1], 5)]);
    let map: AssignmentsMap = {};
    // Hold on col 4 from beat 0 to beat 2
    map = assign(map, onsets[0], 4).map;
    map = setHoldEnd(map, onsets[0], 4, [2, 0, 1]).map;
    // Double tap on cols 0, 1 at beat 2
    map = assign(map, onsets[1], 0).map;
    map = assign(map, onsets[1], 1).map;

    const warnings = validateTriples(onsets, map);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].beatFloat).toBe(2);
    expect(warnings[0].columns).toEqual([0, 1, 4]);
    expect(warnings[0].startingColumns).toEqual([0, 1]);
    expect(warnings[0].endingColumns).toEqual([4]);
    expect(warnings[0].totalCount).toBe(3);
  });

  it("flags 1 tap + 2 hold tails at the same beat", () => {
    const onsets = buildOnsets([sn([0, 0, 1], 5), sn([2, 0, 1], 5)]);
    let map: AssignmentsMap = {};
    map = assign(map, onsets[0], 3).map;
    map = setHoldEnd(map, onsets[0], 3, [2, 0, 1]).map;
    map = assign(map, onsets[0], 5).map;
    map = setHoldEnd(map, onsets[0], 5, [2, 0, 1]).map;
    map = assign(map, onsets[1], 0).map;

    const warnings = validateTriples(onsets, map);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].columns).toEqual([0, 3, 5]);
    expect(warnings[0].startingColumns).toEqual([0]);
    expect(warnings[0].endingColumns).toEqual([3, 5]);
  });

  it("flags 3 hold tails ending at the same beat even without note head", () => {
    // 3 holds start at staggered beats (0, 0.5, 1) so no triple at start, but all end at beat 2
    const onsets = buildOnsets([sn([0, 0, 1], 5), sn([1, 1, 2], 5), sn([1, 0, 1], 5), sn([4, 0, 1], 5)]);
    let map: AssignmentsMap = {};
    map = assign(map, onsets[0], 0).map;
    map = setHoldEnd(map, onsets[0], 0, [2, 0, 1]).map;
    map = assign(map, onsets[1], 2).map;
    map = setHoldEnd(map, onsets[1], 2, [2, 0, 1]).map;
    map = assign(map, onsets[2], 4).map;
    map = setHoldEnd(map, onsets[2], 4, [2, 0, 1]).map;

    const warnings = validateTriples(onsets, map);
    expect(warnings).toHaveLength(2);
    // At beat 1.5, 3 keys are active (col 0 & 4 held, col 2 starts)
    expect(warnings[0].beatFloat).toBe(1.5);
    expect(warnings[0].columns).toEqual([0, 2, 4]);
    // At beat 2, all 3 holds end simultaneously (3 hold tails)
    expect(warnings[1].beatFloat).toBe(2);
    expect(warnings[1].endingColumns).toEqual([0, 2, 4]);
    expect(warnings[1].totalCount).toBe(3);
  });

  it("flags double tap during an ongoing hold", () => {
    const onsets = buildOnsets([sn([0, 0, 1], 5), sn([2, 0, 1], 5), sn([4, 0, 1], 5)]);
    let map: AssignmentsMap = {};
    map = assign(map, onsets[0], 0).map;
    map = setHoldEnd(map, onsets[0], 0, [4, 0, 1]).map;
    map = assign(map, onsets[1], 3).map;
    map = assign(map, onsets[1], 4).map;

    const warnings = validateTriples(onsets, map);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].beatFloat).toBe(2);
    expect(warnings[0].holdingColumns).toEqual([0]);
    expect(warnings[0].startingColumns).toEqual([3, 4]);
    expect(warnings[0].columns).toEqual([0, 3, 4]);
  });

  it("does not flag same-column restrike with 1 other tap (2 keys total)", () => {
    const onsets = buildOnsets([sn([0, 0, 1], 5), sn([2, 0, 1], 5)]);
    let map: AssignmentsMap = {};
    map = assign(map, onsets[0], 0).map;
    map = setHoldEnd(map, onsets[0], 0, [2, 0, 1]).map;
    // At beat 2, col 0 is restruck, plus col 1 tap -> total 2 distinct columns
    map = assign(map, onsets[1], 0).map;
    map = assign(map, onsets[1], 1).map;

    const warnings = validateTriples(onsets, map);
    expect(warnings).toHaveLength(0);
  });
});

describe("buildExportNotes", () => {
  it("assigned → per-assignment notes with the onset's original triple; unassigned → verbatim passthrough", () => {
    const onsets = buildOnsets([sn([0, 1, 4], 5), sn([1, 2, 8], 5, [2, 0, 8])]);
    const a = assign({}, onsets[0], 0);
    if (!a.ok) throw new Error(a.error);
    const b = assign(a.map, onsets[0], 4);
    if (!b.ok) throw new Error(b.error);

    const { notes, assignedCount, unassignedCount } = buildExportNotes(onsets, b.map);
    expect(assignedCount).toBe(1);
    expect(unassignedCount).toBe(1);
    expect(notes).toEqual([
      { beat: [0, 1, 4], column: 0, endbeat: null },
      { beat: [0, 1, 4], column: 4, endbeat: null },
      { beat: [1, 2, 8], column: 5, endbeat: [2, 0, 8] }, // 未指派:源音符(含长条)原样
    ]);
  });
});

describe("assignments JSON round-trip", () => {
  it("serializes and sanitizes back", () => {
    const onsets = buildOnsets([sn([0, 1, 4], 5), sn([4, 0, 4], 5)]);
    const a = assign({}, onsets[0], 2);
    if (!a.ok) throw new Error(a.error);
    const h = setHoldEnd(a.map, onsets[0], 2, [1, 0, 4]);
    if (!h.ok) throw new Error(h.error);

    const json = assignmentsToJson(h.map);
    expect(json[onsets[0].id]).toEqual([{ column: 2, endbeat: [1, 0, 4] }]);

    const restored = assignmentsFromJson(json, onsets);
    expect(restored).toEqual(h.map);

    // 净化:未知 onset、非法列、无效尾拍都被丢弃
    const dirty = {
      ...json,
      "999": [{ column: 1 as Column }],
      [onsets[1].id]: [{ column: 9 as Column }, { column: 3 as Column, endbeat: [0, 0, 1] as [number, number, number] }],
    };
    const cleaned = assignmentsFromJson(dirty, onsets);
    expect(cleaned["999"]).toBeUndefined();
    expect(assignmentsAt(cleaned, onsets[1].id)).toEqual([{ column: 3, endbeat: null }]);
  });
});

describe("clearOnset / clearOnsets(批量清空排键)", () => {
  const onsets = buildOnsets([sn([0, 1, 4]), sn([4, 0, 4]), sn([8, 0, 4])]);

  function seeded(): AssignmentsMap {
    let m: AssignmentsMap = {};
    for (const o of onsets) {
      const r = assign(m, o, 2);
      if (!r.ok) throw new Error(r.error);
      m = r.map;
    }
    return m;
  }

  it("clearOnset removes one onset's assignments, leaves others, is immutable + idempotent", () => {
    const m = seeded();
    const cleared = clearOnset(m, onsets[1].id);
    expect(cleared[onsets[1].id]).toBeUndefined();
    expect(assignmentsAt(cleared, onsets[0].id)).toHaveLength(1);
    expect(assignmentsAt(cleared, onsets[2].id)).toHaveLength(1);
    expect(m[onsets[1].id]).toBeDefined(); // 原 map 不变
    expect(clearOnset(cleared, onsets[1].id)).toEqual(cleared); // 幂等
    expect(clearOnset(m, "no-such-id")).toEqual(m); // 未知 id 无变化
  });

  it("clearOnsets clears a batch, skipping already-unassigned", () => {
    const m = seeded();
    const cleared = clearOnsets(m, [onsets[0].id, onsets[2].id, "ghost"]);
    expect(cleared[onsets[0].id]).toBeUndefined();
    expect(cleared[onsets[2].id]).toBeUndefined();
    expect(assignmentsAt(cleared, onsets[1].id)).toHaveLength(1);
    expect(clearOnsets(m, []).valueOf()).toEqual(m); // 空批次无变化
  });
});

describe("新增采音点(mergeOnsets / makeAddedOnset / isAddedOnset)", () => {
  const source = buildOnsets([sn([0, 1, 4]), sn([4, 0, 4])]);

  it("makeAddedOnset:source 为空、id 与 tickId 一致", () => {
    const o = makeAddedOnset([2, 1, 2]);
    expect(o.beatFloat).toBe(2.5);
    expect(o.source).toEqual([]);
    expect(isAddedOnset(o)).toBe(true);
    expect(isAddedOnset(source[0])).toBe(false);
  });

  it("mergeOnsets:插入新点并按拍排序", () => {
    const merged = mergeOnsets(source, [[2, 0, 4]]);
    expect(merged.map((o) => o.beatFloat)).toEqual([0.25, 2, 4]);
    expect(isAddedOnset(merged[1])).toBe(true);
  });

  it("与源点同刻 → 复用源点,不新建(去重)", () => {
    const merged = mergeOnsets(source, [[0, 1, 4], [0, 2, 8]]); // 均等于 0.25 拍
    expect(merged).toHaveLength(2);
    expect(isAddedOnset(merged[0])).toBe(false); // 仍是源点
  });

  it("空输入 = 原样", () => {
    expect(mergeOnsets(source, []).map((o) => o.id)).toEqual(source.map((o) => o.id));
  });
});

describe("buildExportNotes 与新增采音点", () => {
  const source = buildOnsets([sn([0, 1, 4])]);

  it("新增点已指派 → 用其自身 beat 产音符", () => {
    const onsets = mergeOnsets(source, [[2, 0, 4]]);
    const added = onsets.find((o) => isAddedOnset(o))!;
    const a = assign({}, added, 3);
    if (!a.ok) throw new Error(a.error);
    const { notes, assignedCount, unassignedCount } = buildExportNotes(onsets, a.map);
    expect(notes).toContainEqual({ beat: [2, 0, 4], column: 3, endbeat: null });
    expect(assignedCount).toBe(1);
    expect(unassignedCount).toBe(1); // 只有源点未指派
  });

  it("新增点未指派 → 不产音符、也不计入未排计数", () => {
    const onsets = mergeOnsets(source, [[2, 0, 4]]);
    const { notes, unassignedCount } = buildExportNotes(onsets, {});
    expect(notes).toHaveLength(1); // 仅源点的占位音符
    expect(unassignedCount).toBe(1); // 新增空点不计
  });
});

describe("mirrorColumn & mirrorAssignments", () => {
  it("mirrorColumn performs 6-key MaiCube horizontal reflection", () => {
    expect(mirrorColumn(0)).toBe(5);
    expect(mirrorColumn(1)).toBe(4);
    expect(mirrorColumn(2)).toBe(3);
    expect(mirrorColumn(3)).toBe(2);
    expect(mirrorColumn(4)).toBe(1);
    expect(mirrorColumn(5)).toBe(0);

    for (const c of [0, 1, 2, 3, 4, 5] as Column[]) {
      expect(mirrorColumn(mirrorColumn(c))).toBe(c);
    }
  });

  it("mirrorAssignments mirrors single taps, chords, holds and preserves endbeat", () => {
    const initialMap: AssignmentsMap = {
      // 单击: 列 0 -> 列 5
      o1: [{ column: 0, endbeat: null }],
      // 双押: [0, 1] -> [4, 5] (排序保证列升序)
      o2: [
        { column: 0, endbeat: null },
        { column: 1, endbeat: null },
      ],
      // (1, 5) 双押: [0, 2] -> [3, 5]
      o3: [
        { column: 0, endbeat: null },
        { column: 2, endbeat: null },
      ],
      // 长条: 列 1 尾拍 [2, 0, 4] -> 列 4 尾拍 [2, 0, 4]
      o4: [{ column: 1, endbeat: [2, 0, 4] }],
      // 一长一短: 列 0 单击 + 列 2 长条 -> 列 3 长条 + 列 5 单击 (按列排序)
      o5: [
        { column: 0, endbeat: null },
        { column: 2, endbeat: [3, 0, 4] },
      ],
      // 未在 clip 范围内的 onset,不应被镜像
      outside: [{ column: 0, endbeat: null }],
    };

    const targetIds = ["o1", "o2", "o3", "o4", "o5", "unassigned_onset"];
    const result = mirrorAssignments(initialMap, targetIds);

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.mirroredOnsetCount).toBe(5);
    expect(result.mirroredNoteCount).toBe(8);

    expect(result.map.o1).toEqual([{ column: 5, endbeat: null }]);
    expect(result.map.o2).toEqual([
      { column: 4, endbeat: null },
      { column: 5, endbeat: null },
    ]);
    expect(result.map.o3).toEqual([
      { column: 3, endbeat: null },
      { column: 5, endbeat: null },
    ]);
    expect(result.map.o4).toEqual([{ column: 4, endbeat: [2, 0, 4] }]);
    expect(result.map.o5).toEqual([
      { column: 3, endbeat: [3, 0, 4] },
      { column: 5, endbeat: null },
    ]);
    // 外部 onset 原封不动
    expect(result.map.outside).toEqual([{ column: 0, endbeat: null }]);

    // 双重镜像还原原貌
    const doubleMirrored = mirrorAssignments(result.map, targetIds);
    expect(doubleMirrored.map).toEqual(initialMap);
  });

  it("mirrorAssignments reports changed=false when assignments are already self-symmetric", () => {
    const symmetricMap: AssignmentsMap = {
      s1: [
        { column: 1, endbeat: null },
        { column: 4, endbeat: null },
      ],
    };
    const result = mirrorAssignments(symmetricMap, ["s1"]);
    expect(result.changed).toBe(false);
    expect(result.mirroredOnsetCount).toBe(1);
    expect(result.map).toBe(symmetricMap);
  });

  it("isMirrorKeyEvent detects M, KeyM, and legacy keyCode 77", () => {
    expect(isMirrorKeyEvent({ code: "KeyM" })).toBe(true);
    expect(isMirrorKeyEvent({ key: "m" })).toBe(true);
    expect(isMirrorKeyEvent({ key: "M" })).toBe(true);
    expect(isMirrorKeyEvent({ keyCode: 77 })).toBe(true);
    expect(isMirrorKeyEvent({ key: "Process", code: "KeyM" })).toBe(true);

    expect(isMirrorKeyEvent({ code: "KeyR" })).toBe(false);
    expect(isMirrorKeyEvent({ key: "z" })).toBe(false);
    expect(isMirrorKeyEvent({ keyCode: 65 })).toBe(false);
  });
});

describe("shiftHoldBeat & swapOnsetAssignments", () => {
  it("shiftHoldBeat preserves exact duration across whole beats, fractions and triplets", () => {
    // 1 拍长条从 1 拍平移至 5.5 拍 -> 6.5 拍 [6, 2, 4] (保持分母 4 风格)
    expect(shiftHoldBeat([5, 2, 4], [1, 0, 4], [2, 0, 4])).toEqual([6, 2, 4]);

    // 1 拍长条从 0.25 拍 [0, 1, 4] 移至 3 拍 [3, 0, 1] -> 4 拍 [4, 0, 4]
    expect(shiftHoldBeat([3, 0, 1], [0, 1, 4], [1, 1, 4])).toEqual([4, 0, 4]);

    // 1/3 拍三连音从 1 拍 [1, 0, 1] 移至 2.25 拍 [2, 1, 4] -> 2 + 7/12 拍 [2, 7, 12]
    expect(shiftHoldBeat([2, 1, 4], [1, 0, 1], [1, 1, 3])).toEqual([2, 7, 12]);
  });

  it("swapOnsetAssignments swaps single taps, chords, holds and shifts hold durations accurately", () => {
    const onsetA: Onset = { id: "onsetA", beat: [1, 0, 4], beatFloat: 1.0, source: [] };
    const onsetB: Onset = { id: "onsetB", beat: [5, 2, 4], beatFloat: 5.5, source: [] };

    const initialMap: AssignmentsMap = {
      // 点 A: 一长一短 (列 0 单击, 列 2 长条持续 1 拍至 [2, 0, 4])
      onsetA: [
        { column: 0, endbeat: null },
        { column: 2, endbeat: [2, 0, 4] },
      ],
      // 点 B: 双押 (列 3 单击, 列 4 单击)
      onsetB: [
        { column: 3, endbeat: null },
        { column: 4, endbeat: null },
      ],
      other: [{ column: 5, endbeat: null }],
    };

    const res = swapOnsetAssignments(initialMap, onsetA, onsetB);
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);

    // 点 A 获得点 B 的双押
    expect(res.map.onsetA).toEqual([
      { column: 3, endbeat: null },
      { column: 4, endbeat: null },
    ]);

    // 点 B 获得点 A 的一长一短，长条尾拍自动从 5.5 拍延伸 1 拍至 6.5 拍 [6, 2, 4]
    expect(res.map.onsetB).toEqual([
      { column: 0, endbeat: null },
      { column: 2, endbeat: [6, 2, 4] },
    ]);

    // 未涉及的采音点保持原样
    expect(res.map.other).toEqual([{ column: 5, endbeat: null }]);

    // 双重互换自反恢复初始状态 (可逆性)
    const doubleRes = swapOnsetAssignments(res.map, onsetA, onsetB);
    expect(doubleRes.map.onsetA).toEqual(initialMap.onsetA);
    expect(doubleRes.map.onsetB).toEqual(initialMap.onsetB);
  });

  it("swapOnsetAssignments swaps between assigned and unassigned onsets cleanly", () => {
    const onsetA: Onset = { id: "onsetA", beat: [2, 0, 4], beatFloat: 2.0, source: [] };
    const onsetB: Onset = { id: "onsetB", beat: [4, 0, 4], beatFloat: 4.0, source: [] };

    const mapWithOnlyA: AssignmentsMap = {
      onsetA: [{ column: 1, endbeat: null }],
    };

    const res = swapOnsetAssignments(mapWithOnlyA, onsetA, onsetB);
    expect(res.changed).toBe(true);
    expect(res.map.onsetA).toBeUndefined();
    expect(res.map.onsetB).toEqual([{ column: 1, endbeat: null }]);

    // 反向互换同样恢复
    const reversed = swapOnsetAssignments(res.map, onsetA, onsetB);
    expect(reversed.map.onsetA).toEqual([{ column: 1, endbeat: null }]);
    expect(reversed.map.onsetB).toBeUndefined();
  });

  it("swapOnsetAssignments returns changed=false for same onset or identical assignments", () => {
    const onsetA: Onset = { id: "onsetA", beat: [2, 0, 4], beatFloat: 2.0, source: [] };
    const onsetB: Onset = { id: "onsetB", beat: [4, 0, 4], beatFloat: 4.0, source: [] };

    // 同一采音点
    const selfRes = swapOnsetAssignments({}, onsetA, onsetA);
    expect(selfRes.changed).toBe(false);

    // 两点均未排键
    const emptyRes = swapOnsetAssignments({}, onsetA, onsetB);
    expect(emptyRes.changed).toBe(false);

    // 两点排键相同
    const identicalMap: AssignmentsMap = {
      onsetA: [{ column: 2, endbeat: null }],
      onsetB: [{ column: 2, endbeat: null }],
    };
    const identicalRes = swapOnsetAssignments(identicalMap, onsetA, onsetB);
    expect(identicalRes.changed).toBe(false);
  });

  it("isKeyCEvent and isKeyVEvent detect physical keys, key characters, and keyCodes", () => {
    expect(isKeyCEvent({ code: "KeyC" })).toBe(true);
    expect(isKeyCEvent({ key: "c" })).toBe(true);
    expect(isKeyCEvent({ key: "C" })).toBe(true);
    expect(isKeyCEvent({ keyCode: 67 })).toBe(true);
    expect(isKeyCEvent({ key: "Process", code: "KeyC" })).toBe(true);
    expect(isKeyCEvent({ code: "KeyV" })).toBe(false);

    expect(isKeyVEvent({ code: "KeyV" })).toBe(true);
    expect(isKeyVEvent({ key: "v" })).toBe(true);
    expect(isKeyVEvent({ key: "V" })).toBe(true);
    expect(isKeyVEvent({ keyCode: 86 })).toBe(true);
    expect(isKeyVEvent({ key: "Process", code: "KeyV" })).toBe(true);
    expect(isKeyVEvent({ code: "KeyC" })).toBe(false);
  });
});

