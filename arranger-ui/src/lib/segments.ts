/** 稀疏结构 clip：允许无采音点空隙，但 clip 不重叠且采音点最终须恰好覆盖一次。 */

const EPS = 1e-6;

export interface SegmentBoundaryV1 {
  id: string;
  atSec: number;
}

/** 仅用于读取已有工作状态；保存时统一写 V2。 */
export interface LegacySegmentStructureV1 {
  schema: 1;
  initialized?: boolean;
  source?: "auto" | "manual";
  boundaries: SegmentBoundaryV1[];
  labels: string[];
  relations: SegmentRelationV1[];
}

export type SegmentRole = "intro" | "outro" | "drop" | "buildup" | "break";

export interface SegmentClipV2 {
  id: string;
  startSec: number;
  endSec: number;
  label: string;
  role?: SegmentRole;
}

export interface LegacySegmentStructureV2 {
  schema: 2;
  initialized?: boolean;
  source?: "auto" | "manual";
  clips: SegmentClipV2[];
  relations: SegmentRelationV1[];
}

export interface SegmentStructureV3 {
  schema: 3;
  initialized?: boolean;
  source?: "auto" | "manual";
  clips: SegmentClipV2[];
  relations: SegmentRelationV1[];
}

export type PersistedSegmentStructure =
  | LegacySegmentStructureV1
  | LegacySegmentStructureV2
  | SegmentStructureV3;
/** @deprecated 过渡别名；运行时结构已升级为 V3。 */
export type SegmentStructureV2 = SegmentStructureV3;

export interface SegmentRange extends SegmentClipV2 {
  code: string;
  index: number;
}

export type SegmentRelationKind = "repeat" | "upgrade" | "variation" | "contrast" | "custom";

export interface SegmentRelationV1 {
  id: string;
  kind: SegmentRelationKind;
  segmentIds: string[];
  note?: string;
}

export interface TimedPoint {
  id: string;
  atSec: number;
}

export interface SuggestedSection {
  start: number;
  end: number;
  label: string;
}

export interface SegmentCoverage {
  nonOverlapping: boolean;
  coveredSec: number;
  gapSec: number;
  overlapSec: number;
}

export interface PointPartition {
  bySegment: string[][];
  coveredCount: number;
  missingIds: string[];
  duplicateIds: string[];
}

export interface MissingPointIssue {
  pointId: string;
  atSec: number;
}

export interface DuplicatePointIssue extends MissingPointIssue {
  clipIds: string[];
}

export interface PointCoverageIssues {
  missing: MissingPointIssue[];
  duplicates: DuplicatePointIssue[];
}

export interface ClipOverlapIssue {
  leftClipId: string;
  rightClipId: string;
  startSec: number;
  endSec: number;
  durationSec: number;
}

export type ClipEdge = "start" | "end";

export type SegmentEditResult =
  | { ok: true; structure: SegmentStructureV2 }
  | { ok: false; error: string };

export type RelationEditResult =
  | {
      ok: true;
      structure: SegmentStructureV2;
      relation: SegmentRelationV1;
      created: boolean;
    }
  | { ok: false; error: string };

export const EMPTY_SEGMENT_STRUCTURE: SegmentStructureV2 = {
  schema: 3,
  initialized: false,
  clips: [],
  relations: [],
};

export const SEGMENT_RELATION_KINDS: readonly SegmentRelationKind[] = [
  "repeat",
  "upgrade",
  "variation",
  "contrast",
  "custom",
];

function cleanRelations(
  relations: readonly SegmentRelationV1[] | undefined,
  validIds: ReadonlySet<string>,
  replaceId?: { from: string; to: string },
): SegmentRelationV1[] {
  const used = new Set<string>();
  const output: SegmentRelationV1[] = [];
  for (const [index, relation] of (relations ?? []).entries()) {
    if (!relation || !SEGMENT_RELATION_KINDS.includes(relation.kind)) continue;
    let id = String(relation.id || `relation-${index + 1}`);
    while (used.has(id)) id = `${id}-${index + 1}`;
    used.add(id);
    const mappedIds = (relation.segmentIds ?? []).map((segmentId) =>
      replaceId && segmentId === replaceId.from ? replaceId.to : segmentId,
    );
    const segmentIds = [...new Set<string>(mappedIds)].filter((segmentId) =>
      validIds.has(segmentId),
    );
    if (segmentIds.length < 2) continue;
    output.push({
      id,
      kind: relation.kind,
      segmentIds,
      ...(relation.note ? { note: String(relation.note) } : {}),
    });
  }
  return output;
}

function pointInClip(point: TimedPoint, clip: SegmentClipV2, nextStart?: number): boolean {
  const touchesNext = nextStart != null && Math.abs(clip.endSec - nextStart) <= EPS;
  return (
    point.atSec >= clip.startSec - EPS &&
    (touchesNext ? point.atSec < clip.endSec - EPS : point.atSec <= clip.endSec + EPS)
  );
}

function pruneEmptyClips(
  structure: SegmentStructureV2,
  points: readonly TimedPoint[],
): SegmentStructureV2 {
  if (points.length === 0) {
    return { ...structure, clips: [], relations: [] };
  }
  const clips = structure.clips.toSorted((a, b) => a.startSec - b.startSec);
  const kept = clips.filter((item, index) =>
    points.some((point) => pointInClip(point, item, clips[index + 1]?.startSec)),
  );
  const validIds = new Set(kept.map((item) => item.id));
  return {
    ...structure,
    clips: kept,
    relations: cleanRelations(structure.relations, validIds),
  };
}

function normalizeV2(
  value: LegacySegmentStructureV2 | SegmentStructureV3,
  duration: number,
  points?: readonly TimedPoint[],
): SegmentStructureV2 {
  const max = duration > 0 ? duration : Number.POSITIVE_INFINITY;
  const used = new Set<string>();
  const clips = (Array.isArray(value.clips) ? value.clips : [])
    .filter(
      (item) =>
        Number.isFinite(item?.startSec) &&
        Number.isFinite(item?.endSec) &&
        item.startSec >= 0 &&
        item.endSec > item.startSec + EPS &&
        item.startSec < max,
    )
    .map((item, index) => {
      let id = String(item.id || `clip-${index + 1}`);
      while (used.has(id)) id = `${id}-${index + 1}`;
      used.add(id);
      return {
        id,
        startSec: Math.max(0, item.startSec),
        endSec: Math.min(max, item.endSec),
        label: String(item.label ?? ""),
        ...(item.role ? { role: item.role as SegmentRole } : {}),
      };
    })
    .filter((item) => item.endSec > item.startSec + EPS)
    .toSorted((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  const validIds = new Set(clips.map((item) => item.id));
  const clean: SegmentStructureV2 = {
    schema: 3,
    initialized: value.initialized === true || clips.length > 0,
    source: value.source === "auto" ? "auto" : value.source === "manual" ? "manual" : undefined,
    clips,
    relations: cleanRelations(value.relations, validIds),
  };
  return points ? pruneEmptyClips(clean, points) : clean;
}

/** V1 连续边界迁移为 V2 显式 clip；有 points 时顺便移除无采音点 clip。 */
export function normalizeSegmentStructure(
  value: PersistedSegmentStructure | null | undefined,
  duration = 0,
  points?: readonly TimedPoint[],
): SegmentStructureV2 {
  if (!value) return EMPTY_SEGMENT_STRUCTURE;
  if (value.schema === 2 || value.schema === 3) return normalizeV2(value, duration, points);
  if (!Array.isArray(value.boundaries) || duration <= 0) return EMPTY_SEGMENT_STRUCTURE;

  const boundaries = value.boundaries
    .filter((item) => Number.isFinite(item?.atSec) && item.atSec > EPS && item.atSec < duration - EPS)
    .toSorted((a, b) => a.atSec - b.atSec)
    .filter((item, index, all) => index === 0 || Math.abs(item.atSec - all[index - 1].atSec) > EPS);
  const times = [0, ...boundaries.map((item) => item.atSec), duration];
  const clips = times.slice(0, -1).map((startSec, index) => ({
    id: index === 0 ? "segment-root" : `segment-${boundaries[index - 1].id}`,
    startSec,
    endSec: times[index + 1],
    label: String(value.labels?.[index] ?? ""),
  }));
  return normalizeV2(
    {
      schema: 3,
      initialized: value.initialized === true || boundaries.length > 0,
      source: value.source,
      clips,
      relations: value.relations ?? [],
    },
    duration,
    points,
  );
}

/** 旧自动播种结构废弃；V1 手工状态与 V2 手工/确认建议结构照常恢复。 */
export function restoreSegmentStructure(
  value: PersistedSegmentStructure | null | undefined,
  duration: number,
  points: readonly TimedPoint[],
): SegmentStructureV2 {
  if (value && (value.schema !== 3 || value.source === "auto")) {
    return { schema: 3, initialized: true, source: "manual", clips: [], relations: [] };
  }
  return normalizeSegmentStructure(value, duration, points);
}

export function deriveSegments(structure: SegmentStructureV2): SegmentRange[] {
  return structure.clips
    .toSorted((a, b) => a.startSec - b.startSec || a.endSec - b.endSec)
    .map((item, index) => ({ ...item, code: `S${String(index + 1).padStart(2, "0")}`, index }));
}

export function analyzeSegmentCoverage(
  segments: readonly SegmentRange[],
  duration: number,
): SegmentCoverage {
  const max = Math.max(0, Number.isFinite(duration) ? duration : 0);
  const sorted = segments.toSorted((a, b) => a.startSec - b.startSec);
  let cursor = 0;
  let coveredSec = 0;
  let gapSec = 0;
  let overlapSec = 0;
  for (const segment of sorted) {
    const start = Math.min(max, Math.max(0, segment.startSec));
    const end = Math.min(max, Math.max(start, segment.endSec));
    if (start > cursor + EPS) gapSec += start - cursor;
    if (start < cursor - EPS) overlapSec += Math.max(0, Math.min(cursor, end) - start);
    if (end > cursor) coveredSec += end - Math.max(start, cursor);
    cursor = Math.max(cursor, end);
  }
  if (cursor < max - EPS) gapSec += max - cursor;
  return { nonOverlapping: overlapSec <= EPS, coveredSec, gapSec, overlapSec };
}

export function createClipFromRange(
  structure: SegmentStructureV2,
  startSec: number,
  endSec: number,
  id: string,
  points: readonly TimedPoint[],
  duration: number,
): SegmentEditResult {
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec > duration) {
    return { ok: false, error: "I/O 必须位于音频范围内" };
  }
  if (endSec <= startSec + EPS) return { ok: false, error: "O 必须晚于 I" };
  const candidate: SegmentClipV2 = { id, startSec, endSec, label: "" };
  const overlaps = structure.clips.some(
    (item) => startSec < item.endSec - EPS && endSec > item.startSec + EPS,
  );
  if (overlaps) return { ok: false, error: "新区间不可与已有 clip 重叠" };
  const clips = [...structure.clips, candidate].toSorted((a, b) => a.startSec - b.startSec);
  const index = clips.findIndex((item) => item.id === id);
  const hasPoint = points.some((point) => pointInClip(point, candidate, clips[index + 1]?.startSec));
  if (!hasPoint) return { ok: false, error: "该 I/O 区间内没有采音点，未创建 clip" };
  return {
    ok: true,
    structure: {
      ...structure,
      initialized: true,
      source: "manual",
      clips,
    },
  };
}

export function moveClipEdge(
  structure: SegmentStructureV2,
  clipId: string,
  edge: ClipEdge,
  atSec: number,
  duration: number,
  points: readonly TimedPoint[],
): SegmentEditResult {
  if (!Number.isFinite(atSec) || atSec < 0 || atSec > duration) {
    return { ok: false, error: "clip 起止时间必须位于音频范围内" };
  }
  const index = structure.clips.findIndex((item) => item.id === clipId);
  if (index < 0) return { ok: false, error: "找不到该 clip" };
  const current = structure.clips[index];
  const updated = {
    ...current,
    startSec: edge === "start" ? atSec : current.startSec,
    endSec: edge === "end" ? atSec : current.endSec,
  };
  if (updated.endSec <= updated.startSec + EPS) {
    return { ok: false, error: "clip 结束时间必须晚于开始时间" };
  }
  const clips = structure.clips.map((item) => (item.id === clipId ? updated : item));
  const ranges = deriveSegments({ ...structure, clips });
  if (!analyzeSegmentCoverage(ranges, duration).nonOverlapping) {
    return { ok: false, error: "clip 不可与相邻桥段重叠" };
  }
  return {
    ok: true,
    structure: pruneEmptyClips(
      { ...structure, initialized: true, source: "manual", clips },
      points,
    ),
  };
}

export function mergeClips(
  structure: SegmentStructureV2,
  firstId: string,
  secondId: string,
): SegmentEditResult {
  const clips = structure.clips.toSorted((a, b) => a.startSec - b.startSec);
  const firstIndex = clips.findIndex((item) => item.id === firstId);
  const secondIndex = clips.findIndex((item) => item.id === secondId);
  if (firstIndex < 0 || secondIndex < 0 || Math.abs(firstIndex - secondIndex) !== 1) {
    return { ok: false, error: "只能合并时间上相邻的两个 clip" };
  }
  const leftIndex = Math.min(firstIndex, secondIndex);
  const left = clips[leftIndex];
  const right = clips[leftIndex + 1];
  const merged = {
    ...left,
    endSec: right.endSec,
    label: left.label || right.label,
  };
  const next = [...clips];
  next.splice(leftIndex, 2, merged);
  const validIds = new Set(next.map((item) => item.id));
  return {
    ok: true,
    structure: {
      ...structure,
      initialized: true,
      source: "manual",
      clips: next,
      relations: cleanRelations(structure.relations, validIds, { from: right.id, to: left.id }),
    },
  };
}

export function removeClip(
  structure: SegmentStructureV2,
  clipId: string,
): SegmentStructureV2 {
  if (!structure.clips.some((item) => item.id === clipId)) return structure;
  const clips = structure.clips.filter((item) => item.id !== clipId);
  const validIds = new Set(clips.map((item) => item.id));
  return {
    ...structure,
    initialized: true,
    source: "manual",
    clips,
    relations: cleanRelations(structure.relations, validIds),
  };
}

export function renameSegment(
  structure: SegmentStructureV2,
  clipId: string,
  label: string,
): SegmentStructureV2 {
  if (!structure.clips.some((item) => item.id === clipId)) return structure;
  return {
    ...structure,
    initialized: true,
    source: "manual",
    clips: structure.clips.map((item) => (item.id === clipId ? { ...item, label } : item)),
  };
}

export function createSuggestedStructure(
  sections: readonly SuggestedSection[],
  duration: number,
  snap: (sec: number) => number,
  points: readonly TimedPoint[],
): SegmentStructureV2 {
  const clips: SegmentClipV2[] = [];
  for (const section of sections.toSorted((a, b) => a.start - b.start)) {
    const startSec = Math.min(duration, Math.max(0, snap(section.start)));
    const endSec = Math.min(duration, Math.max(0, snap(section.end)));
    if (endSec <= startSec + EPS) continue;
    const adjustedStart = clips.length > 0 ? Math.max(startSec, clips[clips.length - 1].endSec) : startSec;
    if (endSec <= adjustedStart + EPS) continue;
    const candidate = {
      id: `auto-clip-${clips.length + 1}`,
      startSec: adjustedStart,
      endSec,
      label: String(section.label ?? "").trim(),
    };
    const hasPoint = points.some((point) => pointInClip(point, candidate));
    if (hasPoint) clips.push(candidate);
  }

  if (clips.length === 0 && points.length > 0) {
    const first = Math.max(0, Math.min(...points.map((point) => point.atSec)));
    const last = Math.min(duration, Math.max(...points.map((point) => point.atSec)));
    clips.push({ id: "auto-clip-1", startSec: first, endSec: Math.max(first + EPS * 2, last), label: "" });
  }

  // 转录 section 偶有边缘漏点：扩展最近 clip，保证首次建议仍覆盖全部采音点。
  for (const point of points) {
    if (clips.some((item, index) => pointInClip(point, item, clips[index + 1]?.startSec))) continue;
    const nextIndex = clips.findIndex((item) => item.startSec > point.atSec);
    if (nextIndex === 0) clips[0] = { ...clips[0], startSec: point.atSec };
    else if (nextIndex < 0) {
      const lastIndex = clips.length - 1;
      clips[lastIndex] = { ...clips[lastIndex], endSec: Math.max(clips[lastIndex].endSec, point.atSec) };
    } else {
      const previous = clips[nextIndex - 1];
      const next = clips[nextIndex];
      const midpoint = (previous.endSec + next.startSec) / 2;
      if (point.atSec < midpoint) {
        clips[nextIndex - 1] = { ...previous, endSec: Math.min(next.startSec, point.atSec + EPS * 2) };
      } else {
        clips[nextIndex] = { ...next, startSec: Math.max(previous.endSec, point.atSec) };
      }
    }
  }

  return pruneEmptyClips({
    schema: 3,
    initialized: true,
    source: "auto",
    clips,
    relations: [],
  }, points);
}

function orderedSegmentIds(structure: SegmentStructureV2): string[] {
  return structure.clips
    .toSorted((a, b) => a.startSec - b.startSec)
    .map((item) => item.id);
}

export function ensureRelation(
  structure: SegmentStructureV2,
  kind: SegmentRelationKind,
  selectedIds: readonly string[],
  relationId: string,
): RelationEditResult {
  const selected = new Set(selectedIds);
  const segmentIds = orderedSegmentIds(structure).filter((id) => selected.has(id));
  if (kind === "variation") {
    if (segmentIds.length !== 2) {
      return {
        ok: false,
        error: `变奏关系只能一对一（当前选中了 ${segmentIds.length} 个 clip，请恰好选中 2 个）`,
      };
    }
  } else if (segmentIds.length < 2) {
    if (kind === "upgrade") {
      return { ok: false, error: "标记升级关系至少需要选中 2 个 clip（升级关系支持一对多）" };
    }
    return { ok: false, error: "请至少选择两个 clip 进行配对" };
  }

  // 若为变奏关系，清理参与变奏的 clip 原先所在的旧一对一遍奏关系，确保变奏严格 1 对 1
  let baseRelations = structure.relations;
  if (kind === "variation") {
    baseRelations = baseRelations.filter(
      (r) => !(r.kind === "variation" && r.segmentIds.some((id) => segmentIds.includes(id))),
    );
  }

  const key = segmentIds.join("\u0000");
  const existing = baseRelations.find(
    (relation) => relation.kind === kind && relation.segmentIds.join("\u0000") === key,
  );
  if (existing) return { ok: true, structure, relation: existing, created: false };
  const relation: SegmentRelationV1 = { id: relationId, kind, segmentIds };
  return {
    ok: true,
    structure: {
      ...structure,
      initialized: true,
      source: "manual",
      relations: [...baseRelations, relation],
    },
    relation,
    created: true,
  };
}

export function applyClipRoles(
  structure: SegmentStructureV2,
  selectedIds: readonly string[],
  role: SegmentRole,
): SegmentEditResult {
  const selected = new Set(selectedIds);
  const targetClips = structure.clips.filter((c) => selected.has(c.id));
  if (targetClips.length === 0) {
    return { ok: false, error: "请先选中至少一个 clip" };
  }

  if (role === "intro" || role === "outro") {
    const roleName = role === "intro" ? "Intro" : "Outro";
    if (targetClips.length > 1) {
      return { ok: false, error: `单张谱面仅限一个 ${roleName}，请单选 clip 后再标记` };
    }
    const target = targetClips[0];
    const isAlready = target.role === role;
    const nextRole: SegmentRole | undefined = isAlready ? undefined : role;

    const newClips = structure.clips.map((c) => {
      if (c.id === target.id) {
        return { ...c, role: nextRole };
      }
      if (c.role === role) {
        return { ...c, role: undefined };
      }
      return c;
    });

    return {
      ok: true,
      structure: {
        ...structure,
        initialized: true,
        source: "manual",
        clips: newClips,
      },
    };
  }

  if (role === "drop" || role === "buildup" || role === "break") {
    const allAlreadyRole = targetClips.every((c) => c.role === role);
    const nextRole: SegmentRole | undefined = allAlreadyRole ? undefined : role;

    const newClips = structure.clips.map((c) => {
      if (selected.has(c.id)) {
        return { ...c, role: nextRole };
      }
      return c;
    });

    return {
      ok: true,
      structure: {
        ...structure,
        initialized: true,
        source: "manual",
        clips: newClips,
      },
    };
  }

  const nextRole = role || undefined;
  const newClips = structure.clips.map((c) => {
    if (selected.has(c.id)) {
      return { ...c, role: nextRole };
    }
    return c;
  });

  return {
    ok: true,
    structure: {
      ...structure,
      initialized: true,
      source: "manual",
      clips: newClips,
    },
  };
}

export function clearClipSemanticsAndRelations(
  structure: SegmentStructureV2,
  selectedIds: readonly string[],
): SegmentStructureV2 {
  const selected = new Set(selectedIds);
  const newClips = structure.clips.map((c) => {
    if (selected.has(c.id)) {
      return { ...c, role: undefined };
    }
    return c;
  });

  const newRelations: SegmentRelationV1[] = [];
  for (const relation of structure.relations) {
    const remaining = relation.segmentIds.filter((id) => !selected.has(id));
    if (remaining.length >= 2) {
      newRelations.push({ ...relation, segmentIds: remaining });
    }
  }

  return {
    ...structure,
    initialized: true,
    source: "manual",
    clips: newClips,
    relations: newRelations,
  };
}

export function updateRelationKind(
  structure: SegmentStructureV2,
  relationId: string,
  kind: SegmentRelationKind,
): SegmentStructureV2 {
  return {
    ...structure,
    initialized: true,
    source: "manual",
    relations: structure.relations.map((relation) =>
      relation.id === relationId ? { ...relation, kind } : relation,
    ),
  };
}

export function updateRelationNote(
  structure: SegmentStructureV2,
  relationId: string,
  note: string,
): SegmentStructureV2 {
  return {
    ...structure,
    initialized: true,
    source: "manual",
    relations: structure.relations.map((relation) =>
      relation.id === relationId ? { ...relation, note } : relation,
    ),
  };
}

export function removeRelation(
  structure: SegmentStructureV2,
  relationId: string,
): SegmentStructureV2 {
  return {
    ...structure,
    initialized: true,
    source: "manual",
    relations: structure.relations.filter((relation) => relation.id !== relationId),
  };
}

export function relationIndexesForSegment(
  relations: readonly SegmentRelationV1[],
  segmentId: string,
): number[] {
  const indexes: number[] = [];
  relations.forEach((relation, index) => {
    if (relation.segmentIds.includes(segmentId)) indexes.push(index);
  });
  return indexes;
}

type TimedSegment = Pick<SegmentRange, "id" | "startSec" | "endSec">;

function matchingSegmentIndexes(segments: readonly TimedSegment[], point: TimedPoint): number[] {
  const matches: number[] = [];
  segments.forEach((segment, index) => {
    if (pointInClip(point, { ...segment, label: "" }, segments[index + 1]?.startSec)) {
      matches.push(index);
    }
  });
  return matches;
}

export function findPointCoverageIssues(
  segments: readonly TimedSegment[],
  points: readonly TimedPoint[],
): PointCoverageIssues {
  const sortedSegments = segments.toSorted(
    (a, b) => a.startSec - b.startSec || a.endSec - b.endSec,
  );
  const missing: MissingPointIssue[] = [];
  const duplicates: DuplicatePointIssue[] = [];
  for (const point of points.toSorted((a, b) => a.atSec - b.atSec)) {
    const matches = matchingSegmentIndexes(sortedSegments, point);
    if (matches.length === 0) missing.push({ pointId: point.id, atSec: point.atSec });
    else if (matches.length > 1) {
      duplicates.push({
        pointId: point.id,
        atSec: point.atSec,
        clipIds: matches.map((index) => sortedSegments[index].id),
      });
    }
  }
  return { missing, duplicates };
}

export function findClipOverlapIssues(segments: readonly TimedSegment[]): ClipOverlapIssue[] {
  const sorted = segments.toSorted((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  const issues: ClipOverlapIssue[] = [];
  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex++) {
    const left = sorted[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex++) {
      const right = sorted[rightIndex];
      if (right.startSec >= left.endSec - EPS) break;
      const startSec = Math.max(left.startSec, right.startSec);
      const endSec = Math.min(left.endSec, right.endSec);
      if (endSec <= startSec + EPS) continue;
      issues.push({
        leftClipId: left.id,
        rightClipId: right.id,
        startSec,
        endSec,
        durationSec: endSec - startSec,
      });
    }
  }
  return issues;
}

export function nextCyclicIndex(current: number, length: number): number {
  if (length <= 0) return -1;
  return (Math.max(-1, Math.trunc(current)) + 1) % length;
}

/** 每个点检查所有 clip；可同时报告遗漏与重复归属。 */
export function partitionTimedPoints(
  segments: readonly TimedSegment[],
  points: readonly TimedPoint[],
): PointPartition {
  const sorted = segments.toSorted((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  const bySegment = sorted.map(() => [] as string[]);
  const missingIds: string[] = [];
  const duplicateIds: string[] = [];
  let coveredCount = 0;
  for (const point of points) {
    const matches = matchingSegmentIndexes(sorted, point);
    if (matches.length === 0) missingIds.push(point.id);
    else {
      coveredCount += 1;
      for (const index of matches) bySegment[index].push(point.id);
      if (matches.length > 1) duplicateIds.push(point.id);
    }
  }
  return { bySegment, coveredCount, missingIds, duplicateIds };
}

export function parseAbsoluteTime(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  if (!text.includes(":")) {
    const seconds = Number(text);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  }
  const parts = text.split(":");
  if (parts.length !== 2) return null;
  const minutes = Number(parts[0]);
  const seconds = Number(parts[1]);
  if (!Number.isInteger(minutes) || minutes < 0 || !Number.isFinite(seconds) || seconds < 0 || seconds >= 60) {
    return null;
  }
  return minutes * 60 + seconds;
}

/**
 * 将秒数格式化为 clip 时段字符串，格式为 "mm : ss : cs" (分 : 秒 : 百分之一秒/厘秒)。
 * 例: 106.074 -> "01 : 46 : 07", 123.491 -> "02 : 03 : 49"
 */
export function formatClipTime(sec: number): string {
  const safeSec = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const totalCs = Math.round(safeSec * 100);
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  const cc = String(cs).padStart(2, "0");
  return `${mm} : ${ss} : ${cc}`;
}

/**
 * 格式化单个 clip 的时段文字。
 * 例: "S01: 01 : 46 : 07 ~ 02 : 03 : 49"
 */
export function formatClipRangeText(segment: { code: string; startSec: number; endSec: number }): string {
  return `${segment.code}: ${formatClipTime(segment.startSec)} ~ ${formatClipTime(segment.endSec)}`;
}

/**
 * 格式化所有 clips 的时段文字，多条转行。
 */
export function formatAllClipsRangeText(
  segments: readonly { code: string; startSec: number; endSec: number }[],
): string {
  return segments.map(formatClipRangeText).join("\n");
}

/**
 * 将谱面中所有的语义关系与角色格式化为纯文本。
 * 例:
 * S01(01 : 45 : 30 ~ 01 : 49 : 50) & S02(00 : 09 : 32 ~ 01 : 11 : 13) & S09(04 : 09 : 40 ~ 04 : 41 : 23) Repeat
 * S02(01 : 45 : 30 ~ 01 : 49 : 50) & S03(00 : 10 : 32 ~ 01 : 11 : 13) Upgrade
 * S01(00 : 00 : 00 ~ 00 : 15 : 00) Intro
 */
export function formatAllRelationsText(structure: SegmentStructureV2): string {
  const segments = deriveSegments(structure);
  const segmentById = new Map(segments.map((s) => [s.id, s]));
  const lines: string[] = [];

  // 1. 跨 Clip 配对关系 (Repeat, Upgrade, Variation 等)
  for (const relation of structure.relations) {
    const clipParts = relation.segmentIds
      .map((id) => segmentById.get(id))
      .filter((s): s is SegmentRange => s != null)
      .map((s) => `${s.code}(${formatClipTime(s.startSec)} ~ ${formatClipTime(s.endSec)})`);
    if (clipParts.length === 0) continue;

    let kindName = relation.kind.charAt(0).toUpperCase() + relation.kind.slice(1);
    if (relation.kind === "custom" && relation.note) {
      kindName = relation.note;
    }
    lines.push(`${clipParts.join(" & ")} ${kindName}`);
  }

  // 2. 单 Clip 角色语义 (Intro, Outro, Drop, Build-Up, Break)
  for (const s of segments) {
    if (s.role) {
      const roleName =
        s.role === "buildup"
          ? "Build-Up"
          : s.role.charAt(0).toUpperCase() + s.role.slice(1);
      lines.push(`${s.code}(${formatClipTime(s.startSec)} ~ ${formatClipTime(s.endSec)}) ${roleName}`);
    }
  }

  return lines.join("\n");
}

