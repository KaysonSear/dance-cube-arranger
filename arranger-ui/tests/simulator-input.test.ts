import { describe, expect, it } from "vitest";

import {
  navigateSimulatorGesture,
  pressSimulatorLane,
  releaseSimulatorLane,
  simulatorAdvanceIndex,
  simulatorCaptureShouldRefocus,
  simulatorColumnForEvent,
  simulatorColumnForCode,
  simulatorColumnForText,
  simulatorGestureHoldReady,
  simulatorOnsetDirection,
  shouldCommitSimulatorText,
  startSimulatorGesture,
} from "../src/lib/simulator-input";

const order = new Map([
  ["a", 0],
  ["b", 1],
  ["c", 2],
]);

describe("six-key simulator mapping", () => {
  it("maps BELKZJ to columns 0..5", () => {
    expect(["KeyB", "KeyE", "KeyL", "KeyK", "KeyZ", "KeyJ"].map(simulatorColumnForCode)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(simulatorColumnForCode("KeyQ")).toBeNull();
  });

  it("captures the Z/right-middle lane robustly from code or key", () => {
    const plain = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
    expect(simulatorColumnForEvent(true, "KeyZ", plain)).toBe(4);
    expect(simulatorColumnForEvent(true, "Unidentified", plain, "z")).toBe(4);
    expect(simulatorColumnForEvent(true, "Unidentified", { ...plain, shiftKey: true }, "Z")).toBe(4);
    expect(simulatorColumnForEvent(true, "KeyZ", { ...plain, ctrlKey: true }, "z")).toBe(4);
    expect(simulatorColumnForEvent(true, "KeyZ", { ...plain, metaKey: true }, "z")).toBe(4);
    expect(simulatorColumnForEvent(true, "KeyZ", { ...plain, altKey: true }, "z")).toBe(4);
    expect(simulatorColumnForEvent(true, "", plain, "Unidentified", 90)).toBe(4);
    expect(simulatorColumnForEvent(false, "KeyZ", plain)).toBeNull();
  });

  it("routes simulator arrows to adjacent onsets only while the mode is enabled", () => {
    expect(simulatorOnsetDirection(true, "ArrowLeft")).toBe(-1);
    expect(simulatorOnsetDirection(true, "ArrowRight")).toBe(1);
    expect(simulatorOnsetDirection(false, "ArrowLeft")).toBeNull();
    expect(simulatorOnsetDirection(true, "KeyZ")).toBeNull();
  });

  it("recognizes text-injected controller characters, including full-width Z", () => {
    expect(simulatorColumnForText("z")).toBe(4);
    expect(simulatorColumnForText("Ｚ")).toBe(4);
    expect(simulatorColumnForText(" b ")).toBe(0);
    expect(simulatorColumnForText("x")).toBeNull();
    expect(simulatorColumnForText("bz")).toBeNull();
  });

  it("restores capture after window, canvas and button focus but yields to value editors", () => {
    expect(simulatorCaptureShouldRefocus(null)).toBe(true);
    expect(simulatorCaptureShouldRefocus({ tagName: "CANVAS" })).toBe(true);
    expect(simulatorCaptureShouldRefocus({ tagName: "BUTTON" })).toBe(true);
    expect(simulatorCaptureShouldRefocus({ tagName: "INPUT", inputType: "checkbox" })).toBe(true);
    expect(simulatorCaptureShouldRefocus({ tagName: "INPUT", inputType: "number" })).toBe(false);
    expect(simulatorCaptureShouldRefocus({ tagName: "INPUT", inputType: "range" })).toBe(false);
    expect(simulatorCaptureShouldRefocus({ tagName: "SELECT" })).toBe(false);
    expect(simulatorCaptureShouldRefocus({ tagName: "TEXTAREA" })).toBe(false);
    expect(simulatorCaptureShouldRefocus({ tagName: "DIV", isContentEditable: true })).toBe(false);
  });

  it("deduplicates one IME character across composition, beforeinput and input", () => {
    const first = { column: 4 as const, atMs: 1_000 };
    expect(shouldCommitSimulatorText(null, 4, 1_000)).toBe(true);
    expect(shouldCommitSimulatorText(first, 4, 1_020)).toBe(false);
    expect(shouldCommitSimulatorText(first, 4, 1_119)).toBe(false);
    expect(shouldCommitSimulatorText(first, 4, 1_120)).toBe(true);
    expect(shouldCommitSimulatorText(first, 0, 1_020)).toBe(true);
  });
});

describe("SimulatorGesture", () => {
  it("commits a short chord only after every lane releases", () => {
    let gesture = startSimulatorGesture("a", 0, 0);
    gesture = pressSimulatorLane(gesture, 3, 20).gesture;
    const first = releaseSimulatorLane(gesture, 0, 100, order);
    expect(first.commit).toBeNull();
    expect(first.gesture?.lanes.find((lane) => lane.column === 0)?.down).toBe(false);
    const last = releaseSimulatorLane(first.gesture!, 3, 120, order);
    expect(last.gesture).toBeNull();
    expect(last.commit).toEqual({
      headOnsetId: "a",
      lanes: [
        { column: 0, tailOnsetId: null },
        { column: 3, tailOnsetId: null },
      ],
      usedHoldFallback: false,
    });
  });

  it("switches to hold-ready at 350ms and falls back to tap without a later tail", () => {
    const gesture = startSimulatorGesture("a", 2, 100);
    expect(simulatorGestureHoldReady(gesture, 449)).toBe(false);
    expect(simulatorGestureHoldReady(gesture, 450)).toBe(true);
    expect(releaseSimulatorLane(gesture, 2, 450, order).commit).toEqual({
      headOnsetId: "a",
      lanes: [{ column: 2, tailOnsetId: null }],
      usedHoldFallback: true,
    });
  });

  it("uses direction navigation as immediate hold intent with independent tails", () => {
    let gesture = startSimulatorGesture("a", 0, 0);
    gesture = pressSimulatorLane(gesture, 3, 10).gesture;
    gesture = navigateSimulatorGesture(gesture, "b");
    const first = releaseSimulatorLane(gesture, 0, 80, order);
    gesture = navigateSimulatorGesture(first.gesture!, "c");
    const last = releaseSimulatorLane(gesture, 3, 200, order);
    expect(last.commit?.lanes).toEqual([
      { column: 0, tailOnsetId: "b" },
      { column: 3, tailOnsetId: "c" },
    ]);
  });

  it("rejects new head lanes after navigation and never creates a tail before the head", () => {
    let gesture = startSimulatorGesture("b", 1, 0);
    gesture = navigateSimulatorGesture(gesture, "c");
    expect(pressSimulatorLane(gesture, 4, 20).accepted).toBe(false);
    gesture = navigateSimulatorGesture(gesture, "a");
    expect(releaseSimulatorLane(gesture, 1, 500, order).commit?.lanes).toEqual([
      { column: 1, tailOnsetId: null },
    ]);
  });

  it("keeps an early released chord lane as a tap while another lane becomes a hold", () => {
    let gesture = startSimulatorGesture("a", 0, 0);
    gesture = pressSimulatorLane(gesture, 5, 10).gesture;
    const tap = releaseSimulatorLane(gesture, 0, 100, order);
    gesture = navigateSimulatorGesture(tap.gesture!, "c");
    const done = releaseSimulatorLane(gesture, 5, 500, order);
    expect(done.commit?.lanes).toEqual([
      { column: 0, tailOnsetId: null },
      { column: 5, tailOnsetId: "c" },
    ]);
  });

  it("advances after the farthest independent tail and stops at the chart end", () => {
    expect(
      simulatorAdvanceIndex(
        {
          headOnsetId: "a",
          lanes: [
            { column: 0, tailOnsetId: "b" },
            { column: 3, tailOnsetId: "c" },
          ],
          usedHoldFallback: false,
        },
        order,
        4,
      ),
    ).toEqual({ farthestIndex: 2, nextIndex: 3 });
    expect(
      simulatorAdvanceIndex(
        {
          headOnsetId: "a",
          lanes: [{ column: 3, tailOnsetId: "c" }],
          usedHoldFallback: false,
        },
        order,
        3,
      ),
    ).toEqual({ farthestIndex: 2, nextIndex: null });
  });
});
