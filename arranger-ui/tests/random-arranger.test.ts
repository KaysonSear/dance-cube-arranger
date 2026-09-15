import { describe, expect, it } from "vitest";

import {
  replaceOnsetAssignments,
  type AssignmentsMap,
  type Onset,
} from "../src/lib/arrangement";
import type { Beat } from "../src/lib/beat";
import {
  generateSmartOnsetArrangement,
  isRandomizeKeyEvent,
  type SmartPatternType,
} from "../src/lib/random-arranger";

function beat(value: number): Beat {
  const whole = Math.floor(value);
  const frac = value - whole;
  if (Math.abs(frac) < 1e-4) return [whole, 0, 4];
  const denom = 48;
  const num = Math.round(frac * denom);
  return [whole, num, denom];
}

function makeOnsets(values: number[]): Onset[] {
  return values.map((val, idx) => ({
    id: `onset-${idx}`,
    beat: beat(val),
    beatFloat: val,
    source: [],
  }));
}

describe("generateSmartOnsetArrangement", () => {
  it("returns a valid arrangement with at most 2 notes", () => {
    const onsets = makeOnsets([0, 1, 2, 3]);
    const assignments: AssignmentsMap = {};
    const result = generateSmartOnsetArrangement(onsets, assignments, "onset-1");
    expect(result).not.toBeNull();
    expect(result!.assignments.length).toBeGreaterThanOrEqual(1);
    expect(result!.assignments.length).toBeLessThanOrEqual(2);
    // Columns must be distinct
    const cols = result!.assignments.map((a) => a.column);
    expect(new Set(cols).size).toBe(cols.length);
  });

  it("produces valid pattern types: single_tap, single_hold, double_tap, double_hold, tap_and_hold", () => {
    const onsets = makeOnsets([0, 2, 4, 6]);
    const assignments: AssignmentsMap = {};
    const patternTypesSeen = new Set<SmartPatternType>();

    // Run multiple random generations
    for (let i = 0; i < 600; i++) {
      const result = generateSmartOnsetArrangement(onsets, assignments, "onset-1", {
        temperature: 1.5,
      });
      if (result) {
        patternTypesSeen.add(result.patternType);
        if (result.patternType === "single_tap") {
          expect(result.assignments).toHaveLength(1);
          expect(result.assignments[0].endbeat).toBeNull();
        } else if (result.patternType === "single_hold") {
          expect(result.assignments).toHaveLength(1);
          expect(result.assignments[0].endbeat).not.toBeNull();
        } else if (result.patternType === "double_tap") {
          expect(result.assignments).toHaveLength(2);
          expect(result.assignments.every((a) => a.endbeat === null)).toBe(true);
        } else if (result.patternType === "double_hold") {
          expect(result.assignments).toHaveLength(2);
          expect(result.assignments.every((a) => a.endbeat !== null)).toBe(true);
        } else if (result.patternType === "tap_and_hold") {
          expect(result.assignments).toHaveLength(2);
          const taps = result.assignments.filter((a) => a.endbeat === null);
          const holds = result.assignments.filter((a) => a.endbeat !== null);
          expect(taps).toHaveLength(1);
          expect(holds).toHaveLength(1);
        }
      }
    }

    // Should see single taps, single holds, double taps, double holds, and tap_and_hold
    expect(patternTypesSeen.has("single_tap")).toBe(true);
    expect(patternTypesSeen.has("double_tap")).toBe(true);
    expect(patternTypesSeen.has("single_hold")).toBe(true);
    expect(patternTypesSeen.has("tap_and_hold")).toBe(true);
  });

  it("favors single taps in fast 16th streams and avoids 16th jacks", () => {
    // Fast 16th stream: 0, 0.25, 0.5, 0.75
    const onsets = makeOnsets([0, 0.25, 0.5, 0.75]);
    // Preceding note at 0 is on column 1 (left hand)
    const assignments: AssignmentsMap = {
      "onset-0": [{ column: 1, endbeat: null }],
    };

    let singleTapCount = 0;
    let jackCount = 0;
    const trials = 100;

    for (let i = 0; i < trials; i++) {
      const result = generateSmartOnsetArrangement(onsets, assignments, "onset-1", {
        temperature: 0.5,
      });
      if (result) {
        if (result.patternType === "single_tap") singleTapCount++;
        if (result.assignments.some((a) => a.column === 1)) jackCount++;
      }
    }

    // Almost all should be single tap in 16th stream
    expect(singleTapCount / trials).toBeGreaterThanOrEqual(0.85);
    // Jack on the exact same column 1 immediately 0.25 beats later should be strongly suppressed
    expect(jackCount / trials).toBeLessThan(0.15);
  });

  it("avoids assigning columns occupied by active holds", () => {
    // Onset 0 has a hold on column 2 extending to beat 3.0
    // Target is onset 1 at beat 1.0
    const onsets = makeOnsets([0, 1.0, 2.0, 4.0]);
    const assignments: AssignmentsMap = {
      "onset-0": [{ column: 2, endbeat: beat(3.0) }],
    };

    for (let i = 0; i < 50; i++) {
      const result = generateSmartOnsetArrangement(onsets, assignments, "onset-1");
      expect(result).not.toBeNull();
      // Column 2 must NEVER be chosen because it is held from beat 0 to 3.0
      expect(result!.assignments.some((a) => a.column === 2)).toBe(false);
    }
  });

  it("ensures hold end does not collide with a future note on the same column", () => {
    // Target is onset 1 at beat 1.0. Future onset 2 at beat 2.0 has note on column 4.
    const onsets = makeOnsets([0, 1.0, 2.0, 4.0]);
    const assignments: AssignmentsMap = {
      "onset-2": [{ column: 4, endbeat: null }],
    };

    for (let i = 0; i < 100; i++) {
      const result = generateSmartOnsetArrangement(onsets, assignments, "onset-1");
      if (result) {
        const holdOnCol4 = result.assignments.find((a) => a.column === 4 && a.endbeat !== null);
        if (holdOnCol4 && holdOnCol4.endbeat) {
          const endFloat = holdOnCol4.endbeat[0] + holdOnCol4.endbeat[1] / holdOnCol4.endbeat[2];
          // Must end at or before 2.0
          expect(endFloat).toBeLessThanOrEqual(2.0001);
        }
      }
    }
  });

  it("generates tap_and_hold with exactly one tap and one hold", () => {
    const onsets = makeOnsets([0, 2, 4, 6]);
    const assignments: AssignmentsMap = {};

    let foundTapAndHold = false;
    for (let i = 0; i < 500; i++) {
      const result = generateSmartOnsetArrangement(onsets, assignments, "onset-1", {
        temperature: 1.5,
      });
      if (result && result.patternType === "tap_and_hold") {
        foundTapAndHold = true;
        expect(result.assignments).toHaveLength(2);
        const taps = result.assignments.filter((a) => a.endbeat === null);
        const holds = result.assignments.filter((a) => a.endbeat !== null);
        expect(taps).toHaveLength(1);
        expect(holds).toHaveLength(1);
        // Both columns should be distinct
        expect(taps[0].column).not.toBe(holds[0].column);
        break;
      }
    }
    expect(foundTapAndHold).toBe(true);
  });

  it("generates double_hold with two holds", () => {
    const onsets = makeOnsets([0, 4, 8]);
    const assignments: AssignmentsMap = {};

    let foundDoubleHold = false;
    for (let i = 0; i < 200; i++) {
      const result = generateSmartOnsetArrangement(onsets, assignments, "onset-1", {
        temperature: 1.5,
      });
      if (result && result.patternType === "double_hold") {
        foundDoubleHold = true;
        expect(result.assignments).toHaveLength(2);
        expect(result.assignments.every((a) => a.endbeat !== null)).toBe(true);
        expect(result.assignments[0].column).not.toBe(result.assignments[1].column);
        break;
      }
    }
    expect(foundDoubleHold).toBe(true);
  });

  it("overwrites existing assignments seamlessly with replaceOnsetAssignments", () => {
    const onsets = makeOnsets([0, 1, 2]);
    const initialMap: AssignmentsMap = {
      "onset-1": [
        { column: 0, endbeat: null },
        { column: 1, endbeat: null },
      ],
    };

    const generated = generateSmartOnsetArrangement(onsets, initialMap, "onset-1");
    expect(generated).not.toBeNull();

    const replaced = replaceOnsetAssignments(initialMap, onsets[1], generated!.assignments);
    expect(replaced.ok).toBe(true);
    if (replaced.ok) {
      expect(replaced.map["onset-1"]).toEqual(generated!.assignments);
    }
  });

  it("allows pairs (0, 2) and (3, 5) to be generated without bans", () => {
    const onsets = makeOnsets([0, 1, 2]);
    const assignments: AssignmentsMap = {};

    let found02 = false;
    let found35 = false;

    for (let i = 0; i < 500; i++) {
      const result = generateSmartOnsetArrangement(onsets, assignments, "onset-1", {
        temperature: 1.5,
      });
      if (result && result.assignments.length === 2) {
        const cols = result.assignments.map((a) => a.column).sort();
        if (cols[0] === 0 && cols[1] === 2) found02 = true;
        if (cols[0] === 3 && cols[1] === 5) found35 = true;
        if (found02 && found35) break;
      }
    }
    expect(found02).toBe(true);
    expect(found35).toBe(true);
  });

  it("returns null for non-existent onset ID", () => {
    const onsets = makeOnsets([0, 1, 2]);
    const result = generateSmartOnsetArrangement(onsets, {}, "non-existent");
    expect(result).toBeNull();
  });
});

describe("isRandomizeKeyEvent (按键与中文输入法兼容性)", () => {
  it("recognizes bare 'r' and uppercase 'R'", () => {
    expect(isRandomizeKeyEvent({ key: "r", code: "KeyR", keyCode: 82 })).toBe(true);
    expect(isRandomizeKeyEvent({ key: "R", code: "KeyR", keyCode: 82 })).toBe(true);
    expect(isRandomizeKeyEvent({ key: "r" })).toBe(true);
    expect(isRandomizeKeyEvent({ code: "KeyR" })).toBe(true);
  });

  it("recognizes Chinese IME mode on Windows (key='Process', code='KeyR', keyCode=229)", () => {
    // 关键回归: Windows 中文输入法(如微软拼音)未切换英文时，裸按 R 触发 key='Process', keyCode=229
    expect(
      isRandomizeKeyEvent({
        key: "Process",
        code: "KeyR",
        keyCode: 229,
      }),
    ).toBe(true);
  });

  it("recognizes Ctrl+R and Cmd+R", () => {
    expect(isRandomizeKeyEvent({ key: "r", code: "KeyR", ctrlKey: true, keyCode: 82 })).toBe(true);
    expect(isRandomizeKeyEvent({ key: "r", code: "KeyR", metaKey: true, keyCode: 82 })).toBe(true);
  });

  it("rejects Alt+R and unrelated keys", () => {
    expect(isRandomizeKeyEvent({ key: "r", code: "KeyR", altKey: true, keyCode: 82 })).toBe(false);
    expect(isRandomizeKeyEvent({ key: "q", code: "KeyQ", keyCode: 81 })).toBe(false);
    expect(isRandomizeKeyEvent({ key: "z", code: "KeyZ", keyCode: 90 })).toBe(false);
    expect(isRandomizeKeyEvent({ key: " ", code: "Space", keyCode: 32 })).toBe(false);
  });
});


