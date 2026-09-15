/** Pure keyboard-emulator gesture state for the six-key Dance Cube controller. */

import type { Column } from "./arrangement";

export const SIMULATOR_HOLD_THRESHOLD_MS = 350;

export const SIMULATOR_KEY_LABELS = ["B", "E", "L", "K", "Z", "J"] as const;

export interface SimulatorKeyBinding {
  column: Column;
  code: string;
  key: string;
  keyCode?: number;
  label: string;
}

export type SimulatorKeymap = readonly [
  SimulatorKeyBinding,
  SimulatorKeyBinding,
  SimulatorKeyBinding,
  SimulatorKeyBinding,
  SimulatorKeyBinding,
  SimulatorKeyBinding,
];

export const DEFAULT_SIMULATOR_KEYMAP: SimulatorKeymap = [
  { column: 0, code: "KeyB", key: "B", keyCode: 66, label: "B" },
  { column: 1, code: "KeyE", key: "E", keyCode: 69, label: "E" },
  { column: 2, code: "KeyL", key: "L", keyCode: 76, label: "L" },
  { column: 3, code: "KeyK", key: "K", keyCode: 75, label: "K" },
  { column: 4, code: "KeyZ", key: "Z", keyCode: 90, label: "Z" },
  { column: 5, code: "KeyJ", key: "J", keyCode: 74, label: "J" },
];

const CODE_TO_COLUMN: Readonly<Record<string, Column>> = {
  KeyB: 0,
  KeyE: 1,
  KeyL: 2,
  KeyK: 3,
  KeyZ: 4,
  KeyJ: 5,
};

const KEY_TO_COLUMN: Readonly<Record<string, Column>> = {
  B: 0,
  E: 1,
  L: 2,
  K: 3,
  Z: 4,
  J: 5,
};

const LEGACY_KEY_CODE_TO_COLUMN: Readonly<Record<number, Column>> = {
  66: 0,
  69: 1,
  76: 2,
  75: 3,
  90: 4,
  74: 5,
};

/** 格式化按键展示标签 (如 KeyA -> A, Space -> Space, Digit1 -> 1, Numpad1 -> Num 1) */
export function formatKeyLabel(code: string, key = "", keyCode = 0): string {
  if (code.startsWith("Key") && code.length === 4) {
    return code.slice(3).toUpperCase();
  }
  if (code.startsWith("Digit") && code.length === 6) {
    return code.slice(5);
  }
  if (code.startsWith("Numpad") && code.length >= 7) {
    return `Num ${code.slice(6)}`;
  }
  if (code === "Space") return "Space";
  if (code === "Enter") return "Enter";
  if (code === "Tab") return "Tab";
  if (code === "Backspace") return "⌫";
  if (code === "ArrowUp") return "↑";
  if (code === "ArrowDown") return "↓";
  if (code === "ArrowLeft") return "←";
  if (code === "ArrowRight") return "→";
  if (code === "Minus") return "-";
  if (code === "Equal") return "=";
  if (code === "BracketLeft") return "[";
  if (code === "BracketRight") return "]";
  if (code === "Semicolon") return ";";
  if (code === "Quote") return "'";
  if (code === "Backquote") return "`";
  if (code === "Comma") return ",";
  if (code === "Period") return ".";
  if (code === "Slash") return "/";
  if (code === "Backslash") return "\\";
  if (key && key.trim().length === 1) {
    return key.trim().toUpperCase();
  }
  if (code) {
    return code.replace(/^Key|^Digit/, "").toUpperCase();
  }
  if (keyCode > 0 && keyCode >= 32 && keyCode <= 126) {
    return String.fromCharCode(keyCode).toUpperCase();
  }
  return code || "Unknown";
}

export function createSimulatorKeyBinding(
  column: Column,
  event: { code?: string; key?: string; keyCode?: number },
): SimulatorKeyBinding {
  const code = event.code && event.code !== "Unidentified" ? event.code : "";
  const rawKey = event.key || "";
  const key = rawKey === " " ? " " : rawKey.trim().toUpperCase();
  const keyCode = event.keyCode ?? (code === "Space" ? 32 : 0);
  const label = formatKeyLabel(code, key, keyCode);
  return {
    column,
    code: code || `Key${label}`,
    key: key || label,
    keyCode: keyCode || (label.length === 1 ? label.charCodeAt(0) : undefined),
    label,
  };
}

export interface SimulatorKeyConflict {
  column: Column;
  conflictsWith: Column[];
  label: string;
}

/** 检测键位中是否有重复冲突项 */
export function findSimulatorKeyConflicts(
  keymap: readonly SimulatorKeyBinding[],
): SimulatorKeyConflict[] {
  const conflicts: SimulatorKeyConflict[] = [];
  for (let i = 0; i < keymap.length; i++) {
    const cur = keymap[i];
    const withCols: Column[] = [];
    for (let j = 0; j < keymap.length; j++) {
      if (i === j) continue;
      const other = keymap[j];
      const matchCode = cur.code && other.code && cur.code === other.code;
      const matchKey = cur.key && other.key && cur.key.toUpperCase() === other.key.toUpperCase();
      if (matchCode || matchKey) {
        withCols.push(other.column);
      }
    }
    if (withCols.length > 0) {
      conflicts.push({
        column: cur.column,
        conflictsWith: withCols,
        label: cur.label,
      });
    }
  }
  return conflicts;
}

export const SIMULATOR_KEYMAP_STORAGE_KEY = "dance_cube_simulator_keymap_v1";

const memoryStorage: Record<string, string> = {};

function getSimulatorStorage(): {
  getItem(key: string): string | null;
  setItem(key: string, val: string): void;
  removeItem(key: string): void;
} {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  if (
    typeof globalThis !== "undefined" &&
    (globalThis as unknown as { localStorage?: Storage }).localStorage
  ) {
    return (globalThis as unknown as { localStorage: Storage }).localStorage;
  }
  return {
    getItem: (k) => memoryStorage[k] ?? null,
    setItem: (k, v) => {
      memoryStorage[k] = v;
    },
    removeItem: (k) => {
      delete memoryStorage[k];
    },
  };
}

export function loadStoredSimulatorKeymap(): SimulatorKeymap {
  try {
    const storage = getSimulatorStorage();
    const raw = storage.getItem(SIMULATOR_KEYMAP_STORAGE_KEY);
    if (!raw) return DEFAULT_SIMULATOR_KEYMAP;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 6) {
      const valid = parsed.every(
        (b, idx) =>
          b &&
          b.column === idx &&
          typeof b.code === "string" &&
          typeof b.key === "string" &&
          typeof b.label === "string",
      );
      if (valid) return parsed as unknown as SimulatorKeymap;
    }
  } catch {
    // ignore parse error and fallback
  }
  return DEFAULT_SIMULATOR_KEYMAP;
}

export function saveStoredSimulatorKeymap(keymap: readonly SimulatorKeyBinding[]): void {
  try {
    const storage = getSimulatorStorage();
    storage.setItem(SIMULATOR_KEYMAP_STORAGE_KEY, JSON.stringify(keymap));
  } catch {
    // ignore
  }
}

export function resetStoredSimulatorKeymap(): SimulatorKeymap {
  try {
    const storage = getSimulatorStorage();
    storage.removeItem(SIMULATOR_KEYMAP_STORAGE_KEY);
  } catch {
    // ignore
  }
  return DEFAULT_SIMULATOR_KEYMAP;
}

export function getSimulatorKeymapLabels(
  keymap?: readonly SimulatorKeyBinding[],
): readonly [string, string, string, string, string, string] {
  if (!keymap || keymap.length < 6) return SIMULATOR_KEY_LABELS;
  return [
    keymap[0]?.label ?? "B",
    keymap[1]?.label ?? "E",
    keymap[2]?.label ?? "L",
    keymap[3]?.label ?? "K",
    keymap[4]?.label ?? "Z",
    keymap[5]?.label ?? "J",
  ];
}

export function simulatorColumnForCode(
  code: string,
  keymap?: readonly SimulatorKeyBinding[],
): Column | null {
  if (!code) return null;
  if (!Array.isArray(keymap)) return CODE_TO_COLUMN[code] ?? null;
  const found = keymap.find((b) => b.code === code);
  return found ? found.column : null;
}

/** Some programmable keyboard controllers report `code=Unidentified`; keep a key fallback. */
export function simulatorColumnForKeyboard(
  code: string,
  key = "",
  legacyKeyCode = 0,
  keymap?: readonly SimulatorKeyBinding[],
): Column | null {
  if (!Array.isArray(keymap)) {
    return (
      simulatorColumnForCode(code) ??
      KEY_TO_COLUMN[key.toUpperCase()] ??
      LEGACY_KEY_CODE_TO_COLUMN[legacyKeyCode] ??
      null
    );
  }
  const byCode = code ? keymap.find((b) => b.code === code) : null;
  if (byCode) return byCode.column;

  const upperKey = key.toUpperCase();
  if (upperKey) {
    const byKey = keymap.find((b) => b.key.toUpperCase() === upperKey);
    if (byKey) return byKey.column;
  }

  if (legacyKeyCode > 0) {
    const byKeyCode = keymap.find((b) => b.keyCode === legacyKeyCode);
    if (byKeyCode) return byKeyCode.column;
  }

  return null;
}

/** Fallback for controllers that inject Unicode text instead of keyboard down/up events. */
export function simulatorColumnForText(
  text: string,
  keymap?: readonly SimulatorKeyBinding[],
): Column | null {
  const normalized = text.normalize("NFKC").trim().toUpperCase();
  if (normalized.length !== 1) return null;
  if (!Array.isArray(keymap)) return KEY_TO_COLUMN[normalized] ?? null;
  const found = keymap.find(
    (b) => b.key.toUpperCase() === normalized || b.label.toUpperCase() === normalized,
  );
  return found ? found.column : null;
}

export interface SimulatorFocusTarget {
  tagName?: string | null;
  inputType?: string | null;
  isContentEditable?: boolean;
}

const EDITABLE_INPUT_TYPES = new Set([
  "color",
  "date",
  "datetime-local",
  "email",
  "file",
  "month",
  "number",
  "password",
  "range",
  "search",
  "tel",
  "text",
  "time",
  "url",
  "week",
]);

/** Visible value editors keep focus; canvas, document, buttons and toggles return it to capture. */
export function simulatorCaptureShouldRefocus(target: SimulatorFocusTarget | null): boolean {
  if (!target) return true;
  if (target.isContentEditable) return false;
  const tagName = (target.tagName ?? "").toUpperCase();
  if (tagName === "TEXTAREA" || tagName === "SELECT") return false;
  if (tagName !== "INPUT") return true;
  return !EDITABLE_INPUT_TYPES.has((target.inputType ?? "text").toLowerCase());
}

export interface SimulatorTextCommitStamp {
  column: Column;
  atMs: number;
}

/** IME compositionupdate/beforeinput/input can report the same character in one short burst. */
export function shouldCommitSimulatorText(
  previous: SimulatorTextCommitStamp | null,
  column: Column,
  nowMs: number,
  dedupeWindowMs = 120,
): boolean {
  return previous?.column !== column || nowMs - previous.atMs >= dedupeWindowMs;
}

export interface SimulatorKeyModifiers {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function simulatorColumnForEvent(
  enabled: boolean,
  code: string,
  modifiers: SimulatorKeyModifiers,
  key = "",
  legacyKeyCode = 0,
  keymap?: readonly SimulatorKeyBinding[],
): Column | null {
  if (!enabled) return null;
  // Programmable keyboard boards may emit a lane macro with a transient modifier bit. In
  // simulator mode the six lane identities therefore outrank global letter shortcuts (notably
  // Ctrl+Z); the toolbar remains available for undo while recording.
  void modifiers;
  return simulatorColumnForKeyboard(code, key, legacyKeyCode, keymap);
}

/** Simulator-only arrow routing; normal mode keeps its fixed-second navigation. */
export function simulatorOnsetDirection(enabled: boolean, key: string): 1 | -1 | null {
  if (!enabled) return null;
  if (key === "ArrowLeft") return -1;
  if (key === "ArrowRight") return 1;
  return null;
}

export interface SimulatorLaneGesture {
  column: Column;
  pressedAtMs: number;
  down: boolean;
  /** Direction navigation while this lane was down makes it an intentional hold. */
  holdIntent: boolean;
  /** null means a tap; otherwise the independently chosen hold-tail onset. */
  tailOnsetId: string | null;
}

export interface SimulatorGesture {
  headOnsetId: string;
  cursorOnsetId: string;
  navigated: boolean;
  lanes: readonly SimulatorLaneGesture[];
}

export interface SimulatorCommit {
  headOnsetId: string;
  lanes: readonly { column: Column; tailOnsetId: string | null }[];
  usedHoldFallback: boolean;
}

export interface SimulatorReleaseResult {
  gesture: SimulatorGesture | null;
  commit: SimulatorCommit | null;
}

export function simulatorAdvanceIndex(
  commit: SimulatorCommit,
  onsetOrder: ReadonlyMap<string, number>,
  onsetCount: number,
): { farthestIndex: number; nextIndex: number | null } | null {
  const headIndex = onsetOrder.get(commit.headOnsetId);
  if (headIndex === undefined) return null;
  let farthestIndex = headIndex;
  for (const lane of commit.lanes) {
    const tailIndex = lane.tailOnsetId ? onsetOrder.get(lane.tailOnsetId) : headIndex;
    if (tailIndex !== undefined) farthestIndex = Math.max(farthestIndex, tailIndex);
  }
  return {
    farthestIndex,
    nextIndex: farthestIndex + 1 < onsetCount ? farthestIndex + 1 : null,
  };
}

export function startSimulatorGesture(
  headOnsetId: string,
  column: Column,
  nowMs: number,
): SimulatorGesture {
  return {
    headOnsetId,
    cursorOnsetId: headOnsetId,
    navigated: false,
    lanes: [{ column, pressedAtMs: nowMs, down: true, holdIntent: false, tailOnsetId: null }],
  };
}

/** Adds another head lane only before tail navigation begins. */
export function pressSimulatorLane(
  gesture: SimulatorGesture,
  column: Column,
  nowMs: number,
): { gesture: SimulatorGesture; accepted: boolean } {
  if (gesture.navigated || gesture.lanes.some((lane) => lane.column === column)) {
    return { gesture, accepted: false };
  }
  return {
    accepted: true,
    gesture: {
      ...gesture,
      lanes: [
        ...gesture.lanes,
        { column, pressedAtMs: nowMs, down: true, holdIntent: false, tailOnsetId: null },
      ].sort((a, b) => a.column - b.column),
    },
  };
}

/** Moves the draft tail cursor; every lane still held becomes an intentional hold. */
export function navigateSimulatorGesture(
  gesture: SimulatorGesture,
  cursorOnsetId: string,
): SimulatorGesture {
  if (cursorOnsetId === gesture.cursorOnsetId) return gesture;
  return {
    ...gesture,
    cursorOnsetId,
    navigated: cursorOnsetId !== gesture.headOnsetId || gesture.navigated,
    lanes: gesture.lanes.map((lane) =>
      lane.down ? { ...lane, holdIntent: true } : lane,
    ),
  };
}

export function simulatorHeldLong(
  lane: SimulatorLaneGesture,
  nowMs: number,
  thresholdMs = SIMULATOR_HOLD_THRESHOLD_MS,
): boolean {
  return lane.down && nowMs - lane.pressedAtMs >= thresholdMs;
}

export function simulatorGestureHoldReady(
  gesture: SimulatorGesture,
  nowMs: number,
  thresholdMs = SIMULATOR_HOLD_THRESHOLD_MS,
): boolean {
  return (
    gesture.navigated ||
    gesture.lanes.some((lane) => simulatorHeldLong(lane, nowMs, thresholdMs))
  );
}

/**
 * Releases one lane. A long/explicit hold only gets a tail after moving later than the head;
 * releasing at the head safely falls back to a tap. The last release emits one atomic commit.
 */
export function releaseSimulatorLane(
  gesture: SimulatorGesture,
  column: Column,
  nowMs: number,
  onsetOrder: ReadonlyMap<string, number>,
  thresholdMs = SIMULATOR_HOLD_THRESHOLD_MS,
): SimulatorReleaseResult {
  const lane = gesture.lanes.find((item) => item.column === column);
  if (!lane?.down) return { gesture, commit: null };

  const headIndex = onsetOrder.get(gesture.headOnsetId) ?? -1;
  const cursorIndex = onsetOrder.get(gesture.cursorOnsetId) ?? -1;
  const wantedHold = lane.holdIntent || nowMs - lane.pressedAtMs >= thresholdMs;
  const validTail = wantedHold && cursorIndex > headIndex;
  const usedHoldFallback = wantedHold && !validTail;
  const lanes = gesture.lanes.map((item) =>
    item.column === column
      ? {
          ...item,
          down: false,
          tailOnsetId: validTail ? gesture.cursorOnsetId : null,
        }
      : item,
  );

  if (lanes.some((item) => item.down)) {
    return { gesture: { ...gesture, lanes }, commit: null };
  }
  return {
    gesture: null,
    commit: {
      headOnsetId: gesture.headOnsetId,
      lanes: lanes.map(({ column: laneColumn, tailOnsetId }) => ({
        column: laneColumn,
        tailOnsetId,
      })),
      usedHoldFallback,
    },
  };
}
