/** Versioned system-clipboard payload for ordinal onset-sequence copy/paste. */

import { beatToFloat, floatToBeat } from "./beat";
import {
  assignmentsAt,
  clearOnset,
  replaceOnsetAssignments,
  type Assignment,
  type AssignmentsMap,
  type Column,
  type EditResult,
  type Onset,
} from "./arrangement";

export const ARRANGEMENT_CLIPBOARD_MIME = "application/x-wulifang-arranger-sequence+json";
export const ARRANGEMENT_CLIPBOARD_KIND = "wulifang-arranger-key-sequence";
export const ARRANGEMENT_CLIPBOARD_VERSION = 1;

// Malody's canonical event resolution. Interpolated hold tails are rounded only after
// their ordinal position has been transferred to the destination onset sequence.
const CLIPBOARD_BEAT_DENOM = 2304;
const EPS = 1e-9;

export interface ClipboardAssignmentV1 {
  column: Column;
  /** Continuous distance from this head in onset-index coordinates. */
  holdOffset: number | null;
}

export interface ClipboardOnsetV1 {
  assignments: ClipboardAssignmentV1[];
}

export interface ArrangementClipboardV1 {
  kind: typeof ARRANGEMENT_CLIPBOARD_KIND;
  version: typeof ARRANGEMENT_CLIPBOARD_VERSION;
  onsets: ClipboardOnsetV1[];
}

export type ClipboardPayloadResult =
  | { ok: true; payload: ArrangementClipboardV1 }
  | { ok: false; error: string };

export type ClipboardPasteResult =
  | { ok: true; map: AssignmentsMap; onsetCount: number }
  | { ok: false; error: string };

function coordinateForHoldTail(onsets: readonly Onset[], headIndex: number, endbeat: Assignment["endbeat"]): number | null {
  if (endbeat === null) return null;
  const end = beatToFloat(endbeat);
  for (let index = headIndex + 1; index < onsets.length; index++) {
    const upper = onsets[index].beatFloat;
    if (Math.abs(end - upper) <= EPS) return index;
    if (end < upper) {
      const lowerIndex = index - 1;
      const lower = onsets[lowerIndex].beatFloat;
      return lowerIndex + (end - lower) / (upper - lower);
    }
  }
  return null;
}

/** Build a clipboard payload from source onset ids. Ids are normalized to chart order. */
export function buildArrangementClipboard(
  onsets: readonly Onset[],
  map: AssignmentsMap,
  sourceOnsetIds: readonly string[],
): ClipboardPayloadResult {
  if (sourceOnsetIds.length === 0) return { ok: false, error: "所选范围内没有采音点" };
  if (new Set(sourceOnsetIds).size !== sourceOnsetIds.length) {
    return { ok: false, error: "复制范围包含重复采音点" };
  }

  const order = new Map(onsets.map((onset, index) => [onset.id, index]));
  const sourceIndexes: number[] = [];
  for (const onsetId of sourceOnsetIds) {
    const index = order.get(onsetId);
    if (index === undefined) return { ok: false, error: "复制范围包含未知采音点" };
    sourceIndexes.push(index);
  }
  sourceIndexes.sort((a, b) => a - b);

  const copied: ClipboardOnsetV1[] = [];
  for (const sourceIndex of sourceIndexes) {
    const onset = onsets[sourceIndex];
    const assignments: ClipboardAssignmentV1[] = [];
    for (const assignment of assignmentsAt(map, onset.id)) {
      let holdOffset: number | null = null;
      if (assignment.endbeat !== null) {
        const coordinate = coordinateForHoldTail(onsets, sourceIndex, assignment.endbeat);
        if (coordinate === null) {
          return { ok: false, error: "长条尾超过源谱最后一个采音点，无法按序号复制" };
        }
        holdOffset = coordinate - sourceIndex;
        if (!Number.isFinite(holdOffset) || holdOffset <= EPS) {
          return { ok: false, error: "复制范围包含非法长条" };
        }
      }
      assignments.push({ column: assignment.column, holdOffset });
    }
    copied.push({ assignments });
  }

  return {
    ok: true,
    payload: {
      kind: ARRANGEMENT_CLIPBOARD_KIND,
      version: ARRANGEMENT_CLIPBOARD_VERSION,
      onsets: copied,
    },
  };
}

function validatePayload(value: unknown): ClipboardPayloadResult {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "剪贴板中没有舞立方键位序列" };
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== ARRANGEMENT_CLIPBOARD_KIND) {
    return { ok: false, error: "剪贴板中没有舞立方键位序列" };
  }
  if (candidate.version !== ARRANGEMENT_CLIPBOARD_VERSION) {
    return { ok: false, error: "剪贴板键位序列版本不受支持" };
  }
  if (!Array.isArray(candidate.onsets) || candidate.onsets.length === 0) {
    return { ok: false, error: "剪贴板键位序列没有采音点" };
  }

  const onsets: ClipboardOnsetV1[] = [];
  for (const rawOnset of candidate.onsets) {
    if (!rawOnset || typeof rawOnset !== "object") {
      return { ok: false, error: "剪贴板采音点格式无效" };
    }
    const rawAssignments = (rawOnset as Record<string, unknown>).assignments;
    if (!Array.isArray(rawAssignments) || rawAssignments.length > 6) {
      return { ok: false, error: "剪贴板键位组格式无效" };
    }
    const seen = new Set<number>();
    const assignments: ClipboardAssignmentV1[] = [];
    for (const rawAssignment of rawAssignments) {
      if (!rawAssignment || typeof rawAssignment !== "object") {
        return { ok: false, error: "剪贴板键位格式无效" };
      }
      const item = rawAssignment as Record<string, unknown>;
      if (!Number.isInteger(item.column) || (item.column as number) < 0 || (item.column as number) > 5) {
        return { ok: false, error: "剪贴板包含非法列" };
      }
      const column = item.column as Column;
      if (seen.has(column)) return { ok: false, error: "剪贴板同一采音点包含重复列" };
      if (
        item.holdOffset !== null &&
        (typeof item.holdOffset !== "number" ||
          !Number.isFinite(item.holdOffset) ||
          item.holdOffset <= EPS)
      ) {
        return { ok: false, error: "剪贴板包含非法长条偏移" };
      }
      seen.add(column);
      assignments.push({ column, holdOffset: item.holdOffset as number | null });
    }
    assignments.sort((a, b) => a.column - b.column);
    onsets.push({ assignments });
  }

  return {
    ok: true,
    payload: {
      kind: ARRANGEMENT_CLIPBOARD_KIND,
      version: ARRANGEMENT_CLIPBOARD_VERSION,
      onsets,
    },
  };
}

export function parseArrangementClipboard(text: string): ClipboardPayloadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "剪贴板中没有有效的舞立方键位序列" };
  }
  return validatePayload(parsed);
}

export function serializeArrangementClipboard(payload: ArrangementClipboardV1): string {
  return JSON.stringify(payload);
}

function beatAtOrdinalCoordinate(onsets: readonly Onset[], coordinate: number): Assignment["endbeat"] {
  const nearestInteger = Math.round(coordinate);
  if (Math.abs(coordinate - nearestInteger) <= EPS) {
    return onsets[nearestInteger]?.beat ?? null;
  }
  const lowerIndex = Math.floor(coordinate);
  const upperIndex = lowerIndex + 1;
  const lower = onsets[lowerIndex];
  const upper = onsets[upperIndex];
  if (!lower || !upper) return null;
  const fraction = coordinate - lowerIndex;
  const beatFloat = lower.beatFloat + fraction * (upper.beatFloat - lower.beatFloat);
  return floatToBeat(beatFloat, CLIPBOARD_BEAT_DENOM);
}

/** Atomically overwrite consecutive target onsets with a validated clipboard sequence. */
export function pasteArrangementClipboard(
  onsets: readonly Onset[],
  map: AssignmentsMap,
  targetOnsetId: string,
  payload: ArrangementClipboardV1,
): ClipboardPasteResult {
  const checked = validatePayload(payload);
  if (!checked.ok) return checked;
  const targetStart = onsets.findIndex((onset) => onset.id === targetOnsetId);
  if (targetStart < 0) return { ok: false, error: "目标采音点不存在" };
  if (targetStart + checked.payload.onsets.length > onsets.length) {
    return { ok: false, error: `目标位置不足 ${checked.payload.onsets.length} 个采音点` };
  }

  const mappedGroups: Assignment[][] = [];
  for (let index = 0; index < checked.payload.onsets.length; index++) {
    const targetIndex = targetStart + index;
    const target = onsets[targetIndex];
    const mapped: Assignment[] = [];
    for (const assignment of checked.payload.onsets[index].assignments) {
      const endbeat =
        assignment.holdOffset === null
          ? null
          : beatAtOrdinalCoordinate(onsets, targetIndex + assignment.holdOffset);
      if (assignment.holdOffset !== null && endbeat === null) {
        return { ok: false, error: "目标谱后续采音点不足，无法映射长条尾" };
      }
      if (endbeat !== null && beatToFloat(endbeat) <= target.beatFloat + EPS) {
        return { ok: false, error: "目标采音点过密，长条尾映射后不再晚于头部" };
      }
      mapped.push({ column: assignment.column, endbeat });
    }
    mappedGroups.push(mapped);
  }

  let next = map;
  for (let index = 0; index < mappedGroups.length; index++) {
    const target = onsets[targetStart + index];
    const group = mappedGroups[index];
    if (group.length === 0) {
      next = clearOnset(next, target.id);
      continue;
    }
    const replaced: EditResult = replaceOnsetAssignments(next, target, group);
    if (!replaced.ok) return replaced;
    next = replaced.map;
  }
  return { ok: true, map: next, onsetCount: mappedGroups.length };
}
