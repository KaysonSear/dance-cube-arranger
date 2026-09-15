/**
 * 撤销快照 = **完整编辑状态**(排键 + 用户新增采音点)。
 *
 * 历史 bug:`applyEdit` 同时改 `assignments` 与 `addedOnsets`(回收排键被清空的新增采音点),
 * 而撤销只还原 `assignments` → 还原出的指派挂在已被回收、不在 `onsets` 里的采音点上,
 * 两块画布都按 `onsets` 遍历渲染,于是**渲染不出来**,表现为「Ctrl+Z 只能回退一步」。
 * 本模块把这份状态转移收拢成纯函数,让快照天然覆盖两者。
 */

import { clearOnset, type AssignmentsMap, type EditResult } from "./arrangement";
import { tickId, type Beat } from "./beat";

export interface EditorSnapshot {
  assignments: AssignmentsMap;
  addedOnsets: Beat[];
  deletedOnsetIds?: string[];
}

/** 两个 beat 列表是否等价(引用相同走快路径)。 */
export function sameBeats(a: readonly Beat[], b: readonly Beat[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1] || a[i][2] !== b[i][2]) return false;
  }
  return true;
}

/** 两个字符串列表是否等价(引用相同走快路径)。 */
export function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * 回收排键被清空的**新增**采音点;与源采音点同刻的一律保留(源点永不可删)。
 * 无删除时返回**同一数组引用**,便于上层判定"无变化"。
 */
export function gcAddedOnsets(
  added: readonly Beat[],
  map: AssignmentsMap,
  sourceIds: ReadonlySet<string>,
): Beat[] {
  const kept = added.filter((b) => {
    const id = tickId(b);
    if (sourceIds.has(id)) return true; // 与源点同刻 → 不是新增点
    return (map[id]?.length ?? 0) > 0;
  });
  return kept.length === added.length ? (added as Beat[]) : kept;
}

export type SnapshotStep =
  | { ok: true; changed: boolean; snapshot: EditorSnapshot }
  | { ok: false; error: string };

/**
 * 由一次编辑结果推导下一个撤销快照。
 * `changed === false` 表示这次编辑什么都没改(如 `clearOnsets` 对未指派 id、`move(from===to)`
 * 都会返回**同一个 map 对象**)—— 此时**不得入栈**,否则撤销会撞上 React 的 `Object.is`
 * 空转,那一次 Z 看起来毫无反应。
 */
export function nextSnapshot(
  prev: EditorSnapshot,
  res: EditResult,
  opts: { addOnset?: Beat | null; sourceIds: ReadonlySet<string> },
): SnapshotStep {
  if (!res.ok) return { ok: false, error: res.error };
  const base = opts.addOnset ? [...prev.addedOnsets, opts.addOnset] : prev.addedOnsets;
  const addedOnsets = gcAddedOnsets(base, res.map, opts.sourceIds);
  const prevDeleted = prev.deletedOnsetIds ?? [];
  const deletedOnsetIds = opts.addOnset
    ? prevDeleted.filter((id) => id !== tickId(opts.addOnset!))
    : prevDeleted;
  const changed =
    res.map !== prev.assignments ||
    !sameBeats(addedOnsets, prev.addedOnsets) ||
    !sameStrings(deletedOnsetIds, prevDeleted);
  return {
    ok: true,
    changed,
    snapshot: changed ? { assignments: res.map, addedOnsets, deletedOnsetIds } : prev,
  };
}

/**
 * 从快照中彻底删除某个采音点(整点删除):
 * 1. 清除该采音点上的排键 assignments;
 * 2. 若是新增采音点,从 addedOnsets 中剔除;
 * 3. 将 targetId 记录进 deletedOnsetIds(无论源点或新增点均标记删除,防止其在 onsets 中显示或写回);
 * 4. 计算是否有状态变动(幂等保护)。
 */
export function deleteOnsetFromSnapshot(
  prev: EditorSnapshot,
  targetId: string,
): { changed: boolean; snapshot: EditorSnapshot } {
  const nextAssignments = clearOnset(prev.assignments, targetId);
  const nextAdded = prev.addedOnsets.filter((b) => tickId(b) !== targetId);
  const prevDeleted = prev.deletedOnsetIds ?? [];
  const nextDeleted = prevDeleted.includes(targetId)
    ? prevDeleted
    : [...prevDeleted, targetId];

  const changed =
    nextAssignments !== prev.assignments ||
    !sameBeats(nextAdded, prev.addedOnsets) ||
    !sameStrings(nextDeleted, prevDeleted);

  return {
    changed,
    snapshot: changed
      ? {
          assignments: nextAssignments,
          addedOnsets: nextAdded,
          deletedOnsetIds: nextDeleted,
        }
      : prev,
  };
}

