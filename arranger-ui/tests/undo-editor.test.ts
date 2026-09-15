import { describe, expect, it } from "vitest";

import type { AssignmentsMap } from "../src/lib/arrangement";
import type { Beat } from "../src/lib/beat";
import type { EditorSnapshot } from "../src/lib/editor-state";
import { UndoStack } from "../src/lib/undo";

/**
 * 本次回归:撤销必须同时还原 **assignments 与 addedOnsets**。
 * 旧实现只还原 assignments,导致撤销后指派挂在已被 GC 掉的新增采音点上 → 渲染不出来 →
 * 表现为「Ctrl+Z 只能回退一步」。
 */
describe("UndoStack<EditorSnapshot>(撤销覆盖完整编辑状态)", () => {
  const A: EditorSnapshot = {
    assignments: { "0": [{ column: 2, endbeat: null }] } as AssignmentsMap,
    addedOnsets: [],
  };
  const B: EditorSnapshot = {
    assignments: {
      "0": [{ column: 2, endbeat: null }],
      "2": [{ column: 1, endbeat: null }],
    } as AssignmentsMap,
    addedOnsets: [[2, 0, 4]] as Beat[],
  };

  it("undo 同时还原两个字段,redo 原样前进", () => {
    const s = new UndoStack<EditorSnapshot>({ assignments: {}, addedOnsets: [] });
    s.push(A);
    s.push(B);

    const u1 = s.undo();
    expect(u1).toEqual(A);
    expect(u1?.addedOnsets).toEqual([]); // ← 旧实现在这里遗漏,新增点不会被还原

    const u2 = s.undo();
    expect(u2).toEqual({ assignments: {}, addedOnsets: [] });

    expect(s.redo()).toEqual(A);
    expect(s.redo()).toEqual(B);
    expect(s.redo()).toBeNull();
  });

  it("多步连续撤销(远不止一步)", () => {
    const s = new UndoStack<EditorSnapshot>({ assignments: {}, addedOnsets: [] });
    for (let i = 1; i <= 30; i++) {
      s.push({ assignments: { [`${i}`]: [{ column: 1, endbeat: null }] } as AssignmentsMap, addedOnsets: [] });
    }
    expect(s.pastLength).toBe(30);
    for (let i = 0; i < 30; i++) expect(s.undo()).not.toBeNull();
    expect(s.undo()).toBeNull();
    expect(s.pastLength).toBe(0);
  });

  it("undo 同时还原 deletedOnsetIds,redo 原样前进", () => {
    const initial: EditorSnapshot = {
      assignments: { "0": [{ column: 2, endbeat: null }] } as AssignmentsMap,
      addedOnsets: [],
      deletedOnsetIds: [],
    };
    const s = new UndoStack<EditorSnapshot>(initial);
    const deletedSnapshot: EditorSnapshot = {
      assignments: {},
      addedOnsets: [],
      deletedOnsetIds: ["0"],
    };
    s.push(deletedSnapshot);

    const u = s.undo();
    expect(u?.deletedOnsetIds).toEqual([]);
    expect(u?.assignments["0"]).toHaveLength(1);

    const r = s.redo();
    expect(r?.deletedOnsetIds).toEqual(["0"]);
    expect(r?.assignments["0"]).toBeUndefined();
  });
});

