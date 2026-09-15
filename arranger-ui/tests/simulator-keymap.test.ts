import { describe, expect, it } from "vitest";

import {
  createSimulatorKeyBinding,
  DEFAULT_SIMULATOR_KEYMAP,
  findSimulatorKeyConflicts,
  formatKeyLabel,
  getSimulatorKeymapLabels,
  loadStoredSimulatorKeymap,
  resetStoredSimulatorKeymap,
  saveStoredSimulatorKeymap,
  simulatorColumnForCode,
  simulatorColumnForEvent,
  simulatorColumnForKeyboard,
  simulatorColumnForText,
  type SimulatorKeyBinding,
  type SimulatorKeymap,
} from "../src/lib/simulator-input";

describe("Simulator Keymap Customization", () => {
  it("provides valid default keymap matching Dance Cube BELKZJ", () => {
    expect(DEFAULT_SIMULATOR_KEYMAP).toHaveLength(6);
    expect(DEFAULT_SIMULATOR_KEYMAP.map((b) => b.column)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(DEFAULT_SIMULATOR_KEYMAP.map((b) => b.label)).toEqual(["B", "E", "L", "K", "Z", "J"]);
    expect(getSimulatorKeymapLabels(DEFAULT_SIMULATOR_KEYMAP)).toEqual([
      "B",
      "E",
      "L",
      "K",
      "Z",
      "J",
    ]);
  });

  it("formats key labels clearly for letters, digits, numpad and symbols", () => {
    expect(formatKeyLabel("KeyA", "a")).toBe("A");
    expect(formatKeyLabel("KeyZ", "z")).toBe("Z");
    expect(formatKeyLabel("Digit1", "1")).toBe("1");
    expect(formatKeyLabel("Numpad7", "7")).toBe("Num 7");
    expect(formatKeyLabel("Space", " ")).toBe("Space");
    expect(formatKeyLabel("Enter", "Enter")).toBe("Enter");
    expect(formatKeyLabel("Tab", "Tab")).toBe("Tab");
    expect(formatKeyLabel("ArrowLeft", "ArrowLeft")).toBe("←");
    expect(formatKeyLabel("ArrowRight", "ArrowRight")).toBe("→");
    expect(formatKeyLabel("Slash", "/")).toBe("/");
    expect(formatKeyLabel("Semicolon", ";")).toBe(";");
  });

  it("creates custom SimulatorKeyBinding from keyboard event accurately", () => {
    const b0 = createSimulatorKeyBinding(0, { code: "KeyS", key: "s", keyCode: 83 });
    expect(b0).toEqual({
      column: 0,
      code: "KeyS",
      key: "S",
      keyCode: 83,
      label: "S",
    });

    const b1 = createSimulatorKeyBinding(1, { code: "Space", key: " " });
    expect(b1).toEqual({
      column: 1,
      code: "Space",
      key: " ",
      keyCode: 32,
      label: "Space",
    });
  });

  it("detects key conflicts between columns", () => {
    const customKeymap: SimulatorKeyBinding[] = [
      { column: 0, code: "KeyD", key: "D", label: "D" },
      { column: 1, code: "KeyF", key: "F", label: "F" },
      { column: 2, code: "KeyJ", key: "J", label: "J" },
      { column: 3, code: "KeyK", key: "K", label: "K" },
      { column: 4, code: "KeyL", key: "L", label: "L" },
      { column: 5, code: "KeyD", key: "D", label: "D" }, // duplicate with col 0
    ];

    const conflicts = findSimulatorKeyConflicts(customKeymap);
    expect(conflicts).toHaveLength(2);
    expect(conflicts.some((c) => c.column === 0 && c.conflictsWith.includes(5))).toBe(true);
    expect(conflicts.some((c) => c.column === 5 && c.conflictsWith.includes(0))).toBe(true);

    const noConflicts = findSimulatorKeyConflicts(DEFAULT_SIMULATOR_KEYMAP);
    expect(noConflicts).toHaveLength(0);
  });

  it("resolves custom keymap in simulatorColumnForCode and simulatorColumnForKeyboard", () => {
    // Custom layout: SDF JKL
    const customKeymap: SimulatorKeymap = [
      { column: 0, code: "KeyS", key: "S", label: "S" },
      { column: 1, code: "KeyD", key: "D", label: "D" },
      { column: 2, code: "KeyF", key: "F", label: "F" },
      { column: 3, code: "KeyJ", key: "J", label: "J" },
      { column: 4, code: "KeyK", key: "K", label: "K" },
      { column: 5, code: "KeyL", key: "L", label: "L" },
    ];

    expect(simulatorColumnForCode("KeyS", customKeymap)).toBe(0);
    expect(simulatorColumnForCode("KeyB", customKeymap)).toBeNull(); // B no longer mapped
    expect(simulatorColumnForCode("KeyL", customKeymap)).toBe(5);

    expect(simulatorColumnForKeyboard("Unidentified", "d", 0, customKeymap)).toBe(1);
    expect(
      simulatorColumnForKeyboard("", "", 75, [
        ...customKeymap.slice(0, 4),
        { column: 4, code: "KeyK", key: "K", keyCode: 75, label: "K" },
        customKeymap[5],
      ]),
    ).toBe(4);

    expect(simulatorColumnForText("s", customKeymap)).toBe(0);
    expect(simulatorColumnForText("k", customKeymap)).toBe(4);
    expect(simulatorColumnForText("b", customKeymap)).toBeNull();

    const plain = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
    expect(simulatorColumnForEvent(true, "KeyS", plain, "s", 0, customKeymap)).toBe(0);
    expect(simulatorColumnForEvent(false, "KeyS", plain, "s", 0, customKeymap)).toBeNull();
  });

  it("supports roundtrip persistence via localStorage mock", () => {
    const customKeymap: SimulatorKeymap = [
      { column: 0, code: "KeyA", key: "A", label: "A" },
      { column: 1, code: "KeyS", key: "S", label: "S" },
      { column: 2, code: "KeyD", key: "D", label: "D" },
      { column: 3, code: "KeyH", key: "H", label: "H" },
      { column: 4, code: "KeyJ", key: "J", label: "J" },
      { column: 5, code: "KeyK", key: "K", label: "K" },
    ];

    saveStoredSimulatorKeymap(customKeymap);
    const loaded = loadStoredSimulatorKeymap();
    expect(loaded).toEqual(customKeymap);

    const reset = resetStoredSimulatorKeymap();
    expect(reset).toEqual(DEFAULT_SIMULATOR_KEYMAP);
  });
});
