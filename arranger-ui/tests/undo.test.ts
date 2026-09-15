import { describe, expect, it } from "vitest";

import { UndoStack } from "../src/lib/undo";

describe("UndoStack", () => {
  it("linear undo/redo", () => {
    const s = new UndoStack<number>(0);
    s.push(1);
    s.push(2);
    expect(s.current).toBe(2);
    expect(s.undo()).toBe(1);
    expect(s.undo()).toBe(0);
    expect(s.undo()).toBeNull();
    expect(s.redo()).toBe(1);
    expect(s.redo()).toBe(2);
    expect(s.redo()).toBeNull();
  });

  it("a new push clears the redo branch", () => {
    const s = new UndoStack<number>(0);
    s.push(1);
    s.push(2);
    s.undo();
    s.push(9);
    expect(s.redo()).toBeNull();
    expect(s.undo()).toBe(1);
  });

  it("evicts oldest past beyond the cap", () => {
    const s = new UndoStack<number>(0, 3);
    for (let i = 1; i <= 5; i++) s.push(i);
    expect(s.undo()).toBe(4);
    expect(s.undo()).toBe(3);
    expect(s.undo()).toBe(2);
    expect(s.undo()).toBeNull(); // 0/1 被淘汰
  });

  it("reset clears both branches", () => {
    const s = new UndoStack<number>(0);
    s.push(1);
    s.reset(7);
    expect(s.current).toBe(7);
    expect(s.undo()).toBeNull();
    expect(s.redo()).toBeNull();
  });

  it("independent arrangement and structure histories do not clear each other's redo", () => {
    const arrangement = new UndoStack("notes-0");
    const structure = new UndoStack("segments-0");
    arrangement.push("notes-1");
    structure.push("segments-1");
    arrangement.undo();
    structure.undo();

    arrangement.push("notes-2");
    expect(arrangement.canRedo).toBe(false);
    expect(structure.canRedo).toBe(true);
    expect(structure.redo()).toBe("segments-1");
  });
});
