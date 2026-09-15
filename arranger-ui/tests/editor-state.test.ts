import { describe, expect, it } from "vitest";

import { assign, clearOnsets, move, type AssignmentsMap, type Onset } from "../src/lib/arrangement";
import type { Beat } from "../src/lib/beat";
import {
  deleteOnsetFromSnapshot,
  gcAddedOnsets,
  nextSnapshot,
  sameBeats,
  sameStrings,
} from "../src/lib/editor-state";

const onsetAt = (beat: Beat, id: string): Onset => ({
  id,
  beat,
  beatFloat: beat[0] + beat[1] / beat[2],
  source: [],
});

describe("sameBeats", () => {
  it("reference fast path / length / value", () => {
    const a: Beat[] = [[1, 0, 4]];
    expect(sameBeats(a, a)).toBe(true);
    expect(sameBeats([[1, 0, 4]], [[1, 0, 4]])).toBe(true);
    expect(sameBeats([[1, 0, 4]], [])).toBe(false);
    expect(sameBeats([[1, 1, 2]], [[1, 1, 4]])).toBe(false);
  });
});

describe("gcAddedOnsets(排键被清空的新增采音点自动回收)", () => {
  const added: Beat[] = [[2, 0, 4]];

  it("有指派 → 保留", () => {
    const map: AssignmentsMap = { "2": [{ column: 3, endbeat: null }] };
    expect(gcAddedOnsets(added, map, new Set())).toEqual(added);
  });

  it("指派被清空 → 移除", () => {
    expect(gcAddedOnsets(added, {}, new Set())).toEqual([]);
  });

  it("与源采音点同刻 → 永不回收(源点不可删)", () => {
    expect(gcAddedOnsets(added, {}, new Set(["2"]))).toEqual(added);
  });

  it("无删除时返回同一数组引用(供 changed 判定走快路径)", () => {
    const map: AssignmentsMap = { "2": [{ column: 3, endbeat: null }] };
    expect(gcAddedOnsets(added, map, new Set())).toBe(added);
  });
});

describe("nextSnapshot(撤销快照 = assignments + addedOnsets)", () => {
  const sourceIds = new Set(["0"]);
  const src = onsetAt([0, 0, 1], "0");
  const base = { assignments: {} as AssignmentsMap, addedOnsets: [] as Beat[] };

  it("编辑失败 → 错误透传,不产生快照", () => {
    const step = nextSnapshot(base, { ok: false, error: "boom" }, { sourceIds });
    expect(step).toEqual({ ok: false, error: "boom" });
  });

  it("指派成功 → changed 且 assignments 更新", () => {
    const res = assign({}, src, 2);
    const step = nextSnapshot(base, res, { sourceIds });
    expect(step.ok && step.changed).toBe(true);
    if (!step.ok) throw new Error(step.error);
    expect(step.snapshot.assignments["0"]).toHaveLength(1);
  });

  it("addOnset 一次原子完成:新增采音点 + 指派同属一个快照", () => {
    const created = onsetAt([2, 0, 4], "2");
    const res = assign({}, created, 1);
    const step = nextSnapshot(base, res, { sourceIds, addOnset: [2, 0, 4] });
    expect(step.ok && step.changed).toBe(true);
    if (!step.ok) throw new Error(step.error);
    expect(step.snapshot.addedOnsets).toEqual([[2, 0, 4]]);
  });

  it("无变化的编辑 → changed:false(不得入栈,否则撞 React 空转)", () => {
    // clearOnsets 对未指派的 id 返回**同一个 map 对象**
    const prev = { assignments: {} as AssignmentsMap, addedOnsets: [] as Beat[] };
    const same = clearOnsets(prev.assignments, ["nope"]);
    expect(same).toBe(prev.assignments);
    const step = nextSnapshot(prev, { ok: true, map: same }, { sourceIds });
    expect(step.ok && step.changed).toBe(false);
  });

  it("move(from === to) 同样是无变化", () => {
    const a = assign({}, src, 2);
    if (!a.ok) throw new Error(a.error);
    const prev = { assignments: a.map, addedOnsets: [] as Beat[] };
    const step = nextSnapshot(prev, move(a.map, src, 2, 2), { sourceIds });
    expect(step.ok && step.changed).toBe(false);
  });

  it("新增后清空 → 该新增采音点被回收(changed:true)", () => {
    const created = onsetAt([2, 0, 4], "2");
    const a = assign({}, created, 1);
    if (!a.ok) throw new Error(a.error);
    const withAdded = { assignments: a.map, addedOnsets: [[2, 0, 4]] as Beat[] };
    const cleared = clearOnsets(a.map, ["2"]);
    const step = nextSnapshot(withAdded, { ok: true, map: cleared }, { sourceIds });
    expect(step.ok && step.changed).toBe(true);
    if (!step.ok) throw new Error(step.error);
    expect(step.snapshot.addedOnsets).toEqual([]);
  });
});

describe("sameStrings", () => {
  it("reference fast path / length / value", () => {
    const a = ["0", "1"];
    expect(sameStrings(a, a)).toBe(true);
    expect(sameStrings(["0", "1"], ["0", "1"])).toBe(true);
    expect(sameStrings(["0"], ["0", "1"])).toBe(false);
    expect(sameStrings(["0", "1"], ["0", "2"])).toBe(false);
  });
});

describe("deleteOnsetFromSnapshot(彻底删除采音点整点)", () => {
  it("删除源采音点:从 assignments 清除排键,记入 deletedOnsetIds,changed 为 true", () => {
    const prev = {
      assignments: { "0": [{ column: 2, endbeat: null }] } as AssignmentsMap,
      addedOnsets: [] as Beat[],
      deletedOnsetIds: [],
    };
    const res = deleteOnsetFromSnapshot(prev, "0");
    expect(res.changed).toBe(true);
    expect(res.snapshot.assignments["0"]).toBeUndefined();
    expect(res.snapshot.deletedOnsetIds).toEqual(["0"]);
    expect(res.snapshot.addedOnsets).toEqual([]);
  });

  it("删除新增采音点:从 addedOnsets 剔除,从 assignments 清除,记入 deletedOnsetIds", () => {
    const prev = {
      assignments: { "2": [{ column: 1, endbeat: null }] } as AssignmentsMap,
      addedOnsets: [[2, 0, 4]] as Beat[],
      deletedOnsetIds: [],
    };
    const res = deleteOnsetFromSnapshot(prev, "2");
    expect(res.changed).toBe(true);
    expect(res.snapshot.assignments["2"]).toBeUndefined();
    expect(res.snapshot.addedOnsets).toEqual([]);
    expect(res.snapshot.deletedOnsetIds).toEqual(["2"]);
  });

  it("重复删除同一个采音点:changed 为 false 并返回原 snapshot 引用", () => {
    const prev = {
      assignments: {} as AssignmentsMap,
      addedOnsets: [] as Beat[],
      deletedOnsetIds: ["0"],
    };
    const res = deleteOnsetFromSnapshot(prev, "0");
    expect(res.changed).toBe(false);
    expect(res.snapshot).toBe(prev);
  });

  it("重新添加同刻采音点时:nextSnapshot 自动将其从 deletedOnsetIds 移出", () => {
    const prev = {
      assignments: {} as AssignmentsMap,
      addedOnsets: [] as Beat[],
      deletedOnsetIds: ["2"],
    };
    const created = onsetAt([2, 0, 4], "2");
    const a = assign({}, created, 3);
    if (!a.ok) throw new Error(a.error);
    const step = nextSnapshot(prev, a, {
      sourceIds: new Set(),
      addOnset: [2, 0, 4],
    });
    expect(step.ok && step.changed).toBe(true);
    if (!step.ok) throw new Error(step.error);
    expect(step.snapshot.deletedOnsetIds).toEqual([]);
    expect(step.snapshot.addedOnsets).toEqual([[2, 0, 4]]);
  });
});

