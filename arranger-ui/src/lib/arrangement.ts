/**
 * 排键工作模型:以「采音点(onset,同一 tick)」为单位管理键位指派。
 *
 * - Onset:按 tickId(精确有理数)聚合的同刻源音符,保留该刻首个源三元组用于忠实回写。
 * - AssignmentsMap:onsetId → 指派列表(每 onset 内列唯一,1..6 个);不可变更新,
 *   便于 UndoStack 直接持有快照。
 * - 所有编辑操作为纯函数,返回 EditResult(成功新 map / 失败中文错误),UI 不含判定逻辑。
 */

import { type Beat, beatToFloat, gcd, tickId, validateBeat } from "./beat";
import type { ExportNote, SourceNote } from "./mc";

export type Column = 0 | 1 | 2 | 3 | 4 | 5;
export type SourceMode = "placeholder" | "real";

export interface Onset {
  id: string;
  /** 该刻首个源音符的三元组,原样回写(保持源文件分母风格)。 */
  beat: Beat;
  beatFloat: number;
  source: SourceNote[];
}

export interface Assignment {
  column: Column;
  /** null = 单点;非 null = 长条尾(严格晚于头拍)。 */
  endbeat: Beat | null;
}

export type AssignmentsMap = Readonly<Record<string, readonly Assignment[]>>;

export type EditResult =
  | { ok: true; map: AssignmentsMap }
  | { ok: false; error: string };

const EPS = 1e-9;

export function buildOnsets(gameplay: SourceNote[]): Onset[] {
  const byId = new Map<string, Onset>();
  for (const n of gameplay) {
    const id = tickId(n.beat);
    const existing = byId.get(id);
    if (existing) existing.source.push(n);
    else byId.set(id, { id, beat: n.beat, beatFloat: n.beatFloat, source: [n] });
  }
  return [...byId.values()].sort((a, b) => a.beatFloat - b.beatFloat);
}

/** 新增采音点(用户手动创建):没有源音符,故 `source` 为空。 */
export function makeAddedOnset(beat: Beat): Onset {
  return { id: tickId(beat), beat, beatFloat: beatToFloat(beat), source: [] };
}

/**
 * 源谱面看起来是否是"未排键的采音骨架"(列全同或没有音符)。
 * 写回开启后源 .mc 会含真实排键,此时打开对话框的「视为占位」应默认**取消**勾选,
 * 否则会把真排键当成占位而全部丢弃。
 */
export function looksLikePlaceholder(gameplay: readonly SourceNote[]): boolean {
  if (gameplay.length === 0) return true;
  return new Set(gameplay.map((n) => n.column)).size <= 1;
}

/** 是否是用户新增的采音点(源采音点永不可删,新增点可删)。 */
export function isAddedOnset(o: Onset): boolean {
  return o.source.length === 0;
}

/**
 * 合并源采音点与用户新增采音点:按 tickId 去重(**与源点同刻则复用源点**,不新建)、
 * 按 beatFloat 升序。用于把持久化的 addedOnsets 融进 onsets 列表。
 */
export function mergeOnsets(sourceOnsets: Onset[], addedBeats: readonly Beat[]): Onset[] {
  const byId = new Map<string, Onset>();
  for (const o of sourceOnsets) byId.set(o.id, o);
  for (const b of addedBeats) {
    const o = makeAddedOnset(b);
    if (!byId.has(o.id)) byId.set(o.id, o);
  }
  return [...byId.values()].sort((a, b) => a.beatFloat - b.beatFloat);
}

/** placeholder:全部未指派(源列视为占位);real:按源列/源长条播种(同刻同列去重,保首个)。 */
export function seedAssignments(onsets: Onset[], mode: SourceMode): AssignmentsMap {
  if (mode === "placeholder") return {};
  const map: Record<string, readonly Assignment[]> = {};
  for (const o of onsets) {
    const seen = new Set<number>();
    const list: Assignment[] = [];
    for (const n of o.source) {
      if (seen.has(n.column)) continue;
      seen.add(n.column);
      list.push({ column: n.column as Column, endbeat: n.endbeat });
    }
    list.sort((a, b) => a.column - b.column);
    map[o.id] = list;
  }
  return map;
}

export function assignmentsAt(map: AssignmentsMap, onsetId: string): readonly Assignment[] {
  return map[onsetId] ?? [];
}

export function chordSize(map: AssignmentsMap, onsetId: string): number {
  return assignmentsAt(map, onsetId).length;
}

function withOnset(
  map: AssignmentsMap,
  onsetId: string,
  list: readonly Assignment[],
): AssignmentsMap {
  const next: Record<string, readonly Assignment[]> = { ...map };
  if (list.length === 0) {
    delete next[onsetId];
  } else {
    next[onsetId] = [...list].sort((a, b) => a.column - b.column);
  }
  return next;
}

export function assign(map: AssignmentsMap, onset: Onset, column: Column): EditResult {
  const cur = assignmentsAt(map, onset.id);
  if (cur.some((a) => a.column === column)) {
    return { ok: false, error: `列 ${column} 在该采音点已被指派` };
  }
  if (cur.length >= 6) return { ok: false, error: "一个采音点最多指派 6 键" };
  return { ok: true, map: withOnset(map, onset.id, [...cur, { column, endbeat: null }]) };
}

/** Atomically replaces one onset with a complete tap/hold group. */
export function replaceOnsetAssignments(
  map: AssignmentsMap,
  onset: Onset,
  assignments: readonly Assignment[],
): EditResult {
  if (assignments.length === 0) return { ok: false, error: "模拟器键组不能为空" };
  const seen = new Set<number>();
  const normalized: Assignment[] = [];
  for (const assignment of assignments) {
    if (!Number.isInteger(assignment.column) || assignment.column < 0 || assignment.column > 5) {
      return { ok: false, error: `非法列 ${assignment.column}` };
    }
    if (seen.has(assignment.column)) {
      return { ok: false, error: `列 ${assignment.column} 重复` };
    }
    if (
      assignment.endbeat !== null &&
      beatToFloat(assignment.endbeat) <= onset.beatFloat + EPS
    ) {
      return { ok: false, error: "长条尾必须在音符之后" };
    }
    seen.add(assignment.column);
    normalized.push({ column: assignment.column, endbeat: assignment.endbeat });
  }
  normalized.sort((a, b) => a.column - b.column);
  const current = assignmentsAt(map, onset.id);
  const unchanged =
    current.length === normalized.length &&
    current.every(
      (item, index) =>
        item.column === normalized[index].column &&
        JSON.stringify(item.endbeat) === JSON.stringify(normalized[index].endbeat),
    );
  return { ok: true, map: unchanged ? map : withOnset(map, onset.id, normalized) };
}

/** 用一个单点列覆盖全部采音点；作为一次批量编辑进入撤销栈。 */
export function assignAllToColumn(
  map: AssignmentsMap,
  onsets: readonly Onset[],
  column: Column,
): AssignmentsMap {
  const alreadyMatches =
    Object.keys(map).length === onsets.length &&
    onsets.every((onset) => {
      const list = assignmentsAt(map, onset.id);
      return list.length === 1 && list[0].column === column && list[0].endbeat === null;
    });
  if (alreadyMatches) return map;

  return Object.fromEntries(
    onsets.map((onset) => [onset.id, [{ column, endbeat: null }]]),
  ) as AssignmentsMap;
}

/** 清空单个采音点的全部指派(不可变,幂等;未知 id 返回原 map)。 */
export function clearOnset(map: AssignmentsMap, onsetId: string): AssignmentsMap {
  if (map[onsetId] === undefined) return map;
  return withOnset(map, onsetId, []);
}

/** 批量清空(框选后的「清空所选」)。跳过未指派的 id;无变化时返回原 map。 */
export function clearOnsets(map: AssignmentsMap, ids: Iterable<string>): AssignmentsMap {
  let next = map;
  for (const id of ids) next = clearOnset(next, id);
  return next;
}

export function unassign(map: AssignmentsMap, onset: Onset, column: Column): EditResult {
  const cur = assignmentsAt(map, onset.id);
  if (!cur.some((a) => a.column === column)) {
    return { ok: false, error: `列 ${column} 未在该采音点指派` };
  }
  return { ok: true, map: withOnset(map, onset.id, cur.filter((a) => a.column !== column)) };
}

export function move(map: AssignmentsMap, onset: Onset, from: Column, to: Column): EditResult {
  if (from === to) return { ok: true, map };
  const cur = assignmentsAt(map, onset.id);
  const src = cur.find((a) => a.column === from);
  if (!src) return { ok: false, error: `列 ${from} 未在该采音点指派` };
  if (cur.some((a) => a.column === to)) return { ok: false, error: `列 ${to} 已被占用` };
  return {
    ok: true,
    map: withOnset(map, onset.id, cur.map((a) => (a === src ? { ...a, column: to } : a))),
  };
}

/** 设/清长条尾:endbeat 必须严格晚于头拍;null = 改回单点。 */
export function setHoldEnd(
  map: AssignmentsMap,
  onset: Onset,
  column: Column,
  endbeat: Beat | null,
): EditResult {
  const cur = assignmentsAt(map, onset.id);
  const src = cur.find((a) => a.column === column);
  if (!src) return { ok: false, error: `列 ${column} 未在该采音点指派` };
  if (endbeat !== null && beatToFloat(endbeat) <= onset.beatFloat + EPS) {
    return { ok: false, error: "长条尾必须在音符之后(可提高细分档位)" };
  }
  return {
    ok: true,
    map: withOnset(map, onset.id, cur.map((a) => (a === src ? { ...a, endbeat } : a))),
  };
}

export interface HoldOverlapWarning {
  kind: "hold-overlap";
  onsetId: string;
  column: Column;
  endbeatFloat: number;
  overlappedOnsetId: string;
}

/** 长条尾压过后续同列采音点 → 警告(允许导出,谱面质量判断)。onsets 须升序。 */
export function validate(onsets: Onset[], map: AssignmentsMap): HoldOverlapWarning[] {
  const warnings: HoldOverlapWarning[] = [];
  for (let i = 0; i < onsets.length; i++) {
    const o = onsets[i];
    for (const a of assignmentsAt(map, o.id)) {
      if (a.endbeat === null) continue;
      const endF = beatToFloat(a.endbeat);
      for (let j = i + 1; j < onsets.length; j++) {
        const other = onsets[j];
        if (other.beatFloat > endF + EPS) break;
        if (assignmentsAt(map, other.id).some((b) => b.column === a.column)) {
          warnings.push({
            kind: "hold-overlap",
            onsetId: o.id,
            column: a.column,
            endbeatFloat: endF,
            overlappedOnsetId: other.id,
          });
        }
      }
    }
  }
  return warnings;
}

export const validateHoldOverlaps = validate;

export interface TripleChordWarning {
  kind: "triple-chord";
  beatFloat: number;
  /** 若该时刻落在某个采音点上(或其邻域内)，记录 onsetId(优先跳转至采音点) */
  onsetId: string | null;
  /** 该时刻同时动作/占用的互异列清单，已升序排列 */
  columns: Column[];
  /** 起始音符(Tap 或 Hold 头)所在列清单 */
  startingColumns: Column[];
  /** 在该时刻结束释放的长条尾所在列清单 */
  endingColumns: Column[];
  /** 跨越该时刻被按住的长条所在列清单 */
  holdingColumns: Column[];
  /** 涉及的总键数(>=3) */
  totalCount: number;
}

/**
 * 校验三押及以上(含长条尾)：
 * 统计同一时刻涉及的所有互异按键(起始音符 + 结束释放的长条尾 + 跨越中的长条)。
 * 当互异键数 >= 3 时生成警报。
 */
export function validateTriples(onsets: Onset[], map: AssignmentsMap): TripleChordWarning[] {
  // 1. 收集所有关键 beatFloat：包括采音点与长条尾
  const criticalBeats: number[] = [];
  for (const o of onsets) {
    criticalBeats.push(o.beatFloat);
    for (const a of assignmentsAt(map, o.id)) {
      if (a.endbeat !== null) {
        criticalBeats.push(beatToFloat(a.endbeat));
      }
    }
  }

  // 2. 升序排序并聚类去重 (EPS = 1e-4)
  criticalBeats.sort((a, b) => a - b);
  const uniqueBeats: number[] = [];
  for (const b of criticalBeats) {
    if (uniqueBeats.length === 0 || Math.abs(b - uniqueBeats[uniqueBeats.length - 1]) > EPS) {
      uniqueBeats.push(b);
    }
  }

  // 3. 逐个关键时刻检查
  const warnings: TripleChordWarning[] = [];
  for (const t of uniqueBeats) {
    const startingColumns = new Set<Column>();
    const endingColumns = new Set<Column>();
    const holdingColumns = new Set<Column>();
    let matchingOnsetId: string | null = null;

    for (const o of onsets) {
      const isOnsetAtT = Math.abs(o.beatFloat - t) <= EPS;
      if (isOnsetAtT && matchingOnsetId === null) {
        matchingOnsetId = o.id;
      }
      for (const a of assignmentsAt(map, o.id)) {
        if (isOnsetAtT) {
          startingColumns.add(a.column);
        }
        if (a.endbeat !== null) {
          const endF = beatToFloat(a.endbeat);
          if (Math.abs(endF - t) <= EPS) {
            endingColumns.add(a.column);
          } else if (o.beatFloat < t - EPS && endF > t + EPS) {
            holdingColumns.add(a.column);
          }
        }
      }
    }

    const allColumns = new Set<Column>([
      ...startingColumns,
      ...endingColumns,
      ...holdingColumns,
    ]);

    if (allColumns.size >= 3) {
      warnings.push({
        kind: "triple-chord",
        beatFloat: t,
        onsetId: matchingOnsetId,
        columns: [...allColumns].sort((a, b) => a - b),
        startingColumns: [...startingColumns].sort((a, b) => a - b),
        endingColumns: [...endingColumns].sort((a, b) => a - b),
        holdingColumns: [...holdingColumns].sort((a, b) => a - b),
        totalCount: allColumns.size,
      });
    }
  }

  return warnings;
}

export interface ExportBuild {
  notes: ExportNote[];
  assignedCount: number;
  unassignedCount: number;
}

/**
 * 生成导出音符:已指派 onset → 每个指派一个音符(用 onset 原三元组);未指派 onset →
 * 源音符原样透传(占位列保留,绝不静默丢弃/自动指派)。
 */
export function buildExportNotes(onsets: Onset[], map: AssignmentsMap): ExportBuild {
  const notes: ExportNote[] = [];
  let assignedCount = 0;
  let unassignedCount = 0;
  for (const o of onsets) {
    const list = assignmentsAt(map, o.id);
    if (list.length === 0) {
      // 新增采音点(source 为空)没有占位音符可透传 → 不产音符、也不计入"未排"计数
      if (o.source.length === 0) continue;
      unassignedCount += 1;
      for (const s of o.source) {
        notes.push({ beat: s.beat, column: s.column, endbeat: s.endbeat });
      }
    } else {
      assignedCount += 1;
      for (const a of list) {
        notes.push({ beat: o.beat, column: a.column, endbeat: a.endbeat });
      }
    }
  }
  return { notes, assignedCount, unassignedCount };
}

export type AssignmentsJson = Record<string, { column: Column; endbeat?: Beat }[]>;

export function assignmentsToJson(map: AssignmentsMap): AssignmentsJson {
  const out: AssignmentsJson = {};
  for (const [id, list] of Object.entries(map)) {
    out[id] = list.map((a) => (a.endbeat ? { column: a.column, endbeat: a.endbeat } : { column: a.column }));
  }
  return out;
}

/** 反序列化并净化:未知 onsetId、非法列/尾拍一律丢弃(容忍旧状态文件)。 */
export function assignmentsFromJson(json: AssignmentsJson, onsets: Onset[]): AssignmentsMap {
  const byId = new Map(onsets.map((o) => [o.id, o]));
  const map: Record<string, readonly Assignment[]> = {};
  for (const [id, rawList] of Object.entries(json ?? {})) {
    const onset = byId.get(id);
    if (!onset || !Array.isArray(rawList)) continue;
    const seen = new Set<number>();
    const list: Assignment[] = [];
    for (const raw of rawList) {
      const col = raw?.column;
      if (!Number.isInteger(col) || (col as number) < 0 || (col as number) > 5) continue;
      if (seen.has(col as number)) continue;
      let endbeat: Beat | null = null;
      if (raw.endbeat != null) {
        try {
          const eb = validateBeat(raw.endbeat);
          if (beatToFloat(eb) > onset.beatFloat + EPS) endbeat = eb;
        } catch {
          endbeat = null;
        }
      }
      seen.add(col as number);
      list.push({ column: col as Column, endbeat });
    }
    if (list.length > 0) {
      list.sort((a, b) => a.column - b.column);
      map[id] = list;
    }
  }
  return map;
}

/** 舞立方 6 键环形布局水平镜像: 0↔5, 1↔4, 2↔3 */
export function mirrorColumn(col: Column): Column {
  return (5 - col) as Column;
}

export interface MirrorAssignmentsResult {
  ok: true;
  map: AssignmentsMap;
  mirroredOnsetCount: number;
  mirroredNoteCount: number;
  changed: boolean;
}

/**
 * 批量镜像指定采音点上的排键 (0↔5, 1↔4, 2↔3)。
 * - 保留长条 endbeat 时值不变
 * - 镜像后按列号升序排列
 * - 未排键的采音点保持原样
 * - 若无实质变动，返回原 map 引用
 */
export function mirrorAssignments(
  map: AssignmentsMap,
  onsetIds: Iterable<string>,
): MirrorAssignmentsResult {
  const idSet = onsetIds instanceof Set ? onsetIds : new Set(onsetIds);
  let mirroredOnsetCount = 0;
  let mirroredNoteCount = 0;
  let changed = false;
  const next: Record<string, readonly Assignment[]> = { ...map };

  for (const id of idSet) {
    const list = map[id];
    if (!list || list.length === 0) continue;

    mirroredOnsetCount += 1;
    mirroredNoteCount += list.length;

    const mirrored: Assignment[] = list.map((a) => ({
      column: mirrorColumn(a.column),
      endbeat: a.endbeat,
    }));
    mirrored.sort((a, b) => a.column - b.column);

    const same =
      mirrored.length === list.length &&
      mirrored.every(
        (item, idx) =>
          item.column === list[idx].column &&
          JSON.stringify(item.endbeat) === JSON.stringify(list[idx].endbeat),
      );

    if (!same) {
      changed = true;
      next[id] = mirrored;
    }
  }

  return {
    ok: true,
    map: changed ? next : map,
    mirroredOnsetCount,
    mirroredNoteCount,
    changed,
  };
}

/** 判断按键事件是否为 M / KeyM / 键码 77 */
export function isMirrorKeyEvent(e: { key?: string; code?: string; keyCode?: number }): boolean {
  if (e.code === "KeyM") return true;
  if (e.key === "m" || e.key === "M") return true;
  if (e.keyCode === 77) return true;
  return false;
}

/**
 * 将长条尾拍按时值严格平移至目标采音点 (精确有理数分数运算，无浮点误差)。
 * - sourceEndBeat - sourceOnsetBeat = duration > 0
 * - targetEndBeat = targetOnsetBeat + duration > targetOnsetBeat
 */
export function shiftHoldBeat(
  targetOnsetBeat: Beat,
  sourceOnsetBeat: Beat,
  sourceEndBeat: Beat,
): Beat {
  const fromNum = sourceOnsetBeat[0] * sourceOnsetBeat[2] + sourceOnsetBeat[1];
  const fromDen = sourceOnsetBeat[2];

  const endNum = sourceEndBeat[0] * sourceEndBeat[2] + sourceEndBeat[1];
  const endDen = sourceEndBeat[2];

  const deltaDen = fromDen * endDen;
  const deltaNum = endNum * fromDen - fromNum * endDen;

  const baseNum = targetOnsetBeat[0] * targetOnsetBeat[2] + targetOnsetBeat[1];
  const baseDen = targetOnsetBeat[2];

  const resDen = baseDen * deltaDen;
  const resNum = baseNum * deltaDen + deltaNum * baseDen;

  const g = gcd(resNum, resDen);
  const simpNum = resNum / g;
  const simpDen = resDen / g;

  const whole = Math.floor(simpNum / simpDen);
  const remainder = simpNum - whole * simpDen;

  // 尽量保持源长条的分母风格 (例如 4 或 48)
  const prefDenom = sourceEndBeat[2];
  if (prefDenom > 0 && (prefDenom * remainder) % simpDen === 0) {
    const scaledNumerator = Math.round((prefDenom * remainder) / simpDen);
    return [whole, scaledNumerator, prefDenom];
  }

  return [whole, remainder, simpDen];
}

export type SwapAssignmentsResult =
  | {
      ok: true;
      map: AssignmentsMap;
      aAssignments: readonly Assignment[];
      bAssignments: readonly Assignment[];
      changed: boolean;
    }
  | {
      ok: false;
      error: string;
    };

function transformAssignmentsForSwap(
  sourceAssignments: readonly Assignment[],
  sourceOnset: Onset,
  targetOnset: Onset,
): Assignment[] {
  return sourceAssignments
    .map((assignment) => {
      if (assignment.endbeat === null) {
        return { column: assignment.column, endbeat: null };
      }
      const newEndbeat = shiftHoldBeat(
        targetOnset.beat,
        sourceOnset.beat,
        assignment.endbeat,
      );
      return { column: assignment.column, endbeat: newEndbeat };
    })
    .sort((a, b) => a.column - b.column);
}

/**
 * 互换采音点 A 与采音点 B 的排键 (含长条尾拍时长平移)。
 * - 单击、双押、长条、一长一短及未排键均支持互换
 * - 长条持续拍数保持不变，相对目标采音点起始拍平移
 * - 对合可逆: A 与 B 连续互换两次结果完全恒等
 */
export function swapOnsetAssignments(
  map: AssignmentsMap,
  onsetA: Onset,
  onsetB: Onset,
): SwapAssignmentsResult {
  try {
    if (onsetA.id === onsetB.id) {
      return {
        ok: true,
        map,
        aAssignments: assignmentsAt(map, onsetA.id),
        bAssignments: assignmentsAt(map, onsetB.id),
        changed: false,
      };
    }

    const aOrig = assignmentsAt(map, onsetA.id);
    const bOrig = assignmentsAt(map, onsetB.id);

    const newForB = transformAssignmentsForSwap(aOrig, onsetA, onsetB);
    const newForA = transformAssignmentsForSwap(bOrig, onsetB, onsetA);

    const aSame =
      aOrig.length === newForA.length &&
      aOrig.every(
        (item, idx) =>
          item.column === newForA[idx].column &&
          JSON.stringify(item.endbeat) === JSON.stringify(newForA[idx].endbeat),
      );

    const bSame =
      bOrig.length === newForB.length &&
      bOrig.every(
        (item, idx) =>
          item.column === newForB[idx].column &&
          JSON.stringify(item.endbeat) === JSON.stringify(newForB[idx].endbeat),
      );

    const changed = !aSame || !bSame;

    if (!changed) {
      return {
        ok: true,
        map,
        aAssignments: aOrig,
        bAssignments: bOrig,
        changed: false,
      };
    }

    let next = withOnset(map, onsetA.id, newForA);
    next = withOnset(next, onsetB.id, newForB);

    return {
      ok: true,
      map: next,
      aAssignments: newForA,
      bAssignments: newForB,
      changed: true,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "互换排键时发生异常",
    };
  }
}

/** 判断按键事件是否为 C / KeyC / 键码 67 */
export function isKeyCEvent(e: { key?: string; code?: string; keyCode?: number }): boolean {
  if (e.code === "KeyC") return true;
  if (e.key === "c" || e.key === "C") return true;
  if (e.keyCode === 67) return true;
  return false;
}

/** 判断按键事件是否为 V / KeyV / 键码 86 */
export function isKeyVEvent(e: { key?: string; code?: string; keyCode?: number }): boolean {
  if (e.code === "KeyV") return true;
  if (e.key === "v" || e.key === "V") return true;
  if (e.keyCode === 86) return true;
  return false;
}

