/**
 * Malody .mc(mode:9)宽容解析与忠实回写。
 *
 * 解析:保留原始 JSON 对象(raw)不动;gameplay note 校验 beat/column/endbeat;`dir`
 * 属性丢弃并告警(绝不支持 slide);恰好一个 type:1 音频 note(offset 原值保留,可负可缺)。
 * 回写:深拷贝 raw,仅替换 note[](排序后的 gameplay + 原音频 note 对象殿后),压缩单行 —
 * meta/time/offset 逐字节忠实。
 */

import { type Beat, BeatError, beatToFloat, validateBeat } from "./beat";
import { type TimePoint, timePointsFromMc } from "./timemap";

export class McParseError extends Error {}

export interface SourceNote {
  beat: Beat;
  beatFloat: number;
  column: number;
  endbeat: Beat | null;
  endbeatFloat: number | null;
}

export interface AudioNoteInfo {
  sound: string;
  /** offset 原值(ms);缺失为 null(≠0)。 */
  offsetMs: number | null;
  /** 原始 JSON 对象,回写时逐字段复用。 */
  raw: Record<string, unknown>;
}

export interface ParsedChart {
  raw: Record<string, unknown>;
  gameplay: SourceNote[];
  audioNote: AudioNoteInfo;
  timeMap: TimePoint[];
  warnings: string[];
}

export function parseMc(text: string): ParsedChart {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (e) {
    throw new McParseError(`not valid JSON: ${(e as Error).message}`);
  }
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    throw new McParseError("root must be a JSON object");
  }
  const obj = root as Record<string, unknown>;
  const noteArr = obj.note;
  if (!Array.isArray(noteArr) || noteArr.length === 0) {
    throw new McParseError("missing or empty note[]");
  }
  const timeMap = timePointsFromMc(obj.time);

  const warnings: string[] = [];
  const audioNotes: Record<string, unknown>[] = [];
  const gameplay: SourceNote[] = [];
  let dirDropped = 0;

  for (const entry of noteArr) {
    if (typeof entry !== "object" || entry === null) {
      throw new McParseError(`invalid note entry: ${JSON.stringify(entry)}`);
    }
    const rec = entry as Record<string, unknown>;
    if (rec.type === 1) {
      audioNotes.push(rec);
      continue;
    }
    let beat: Beat;
    try {
      beat = validateBeat(rec.beat);
    } catch (e) {
      if (e instanceof BeatError) {
        throw new McParseError(`bad gameplay beat: ${e.message}`);
      }
      throw e;
    }
    const column = rec.column;
    if (!Number.isInteger(column) || (column as number) < 0 || (column as number) > 5) {
      throw new McParseError(`gameplay column must be an integer 0..5: ${JSON.stringify(rec)}`);
    }
    if ("dir" in rec) dirDropped += 1;
    let endbeat: Beat | null = null;
    if (rec.endbeat != null) {
      try {
        endbeat = validateBeat(rec.endbeat);
      } catch (e) {
        if (e instanceof BeatError) {
          throw new McParseError(`bad endbeat: ${e.message}`);
        }
        throw e;
      }
      if (beatToFloat(endbeat) < beatToFloat(beat)) {
        throw new McParseError(`endbeat before beat: ${JSON.stringify(rec)}`);
      }
    }
    gameplay.push({
      beat,
      beatFloat: beatToFloat(beat),
      column: column as number,
      endbeat,
      endbeatFloat: endbeat ? beatToFloat(endbeat) : null,
    });
  }

  if (audioNotes.length === 0) throw new McParseError("no type:1 audio note");
  if (audioNotes.length > 1) {
    throw new McParseError(`expected exactly one type:1 audio note, found ${audioNotes.length}`);
  }
  const an = audioNotes[0];
  const offRaw = an.offset;
  const offsetMs = offRaw == null ? null : Number(offRaw);
  if (offsetMs !== null && !Number.isFinite(offsetMs)) {
    throw new McParseError(`invalid audio-note offset: ${JSON.stringify(offRaw)}`);
  }
  if (offsetMs === null) {
    warnings.push("音频 note 无 offset(beat0 按 0s 处理,请靠耳朵校验同步)");
  }
  if (dirDropped > 0) {
    warnings.push(`已丢弃 ${dirDropped} 个 note 的 dir 属性(不支持 slide)`);
  }

  gameplay.sort((a, b) => a.beatFloat - b.beatFloat || a.column - b.column);

  return {
    raw: obj,
    gameplay,
    audioNote: { sound: String(an.sound ?? ""), offsetMs, raw: an },
    timeMap,
    warnings,
  };
}

export interface ExportNote {
  beat: Beat;
  column: number;
  endbeat?: Beat | null;
}

/** 用户对源谱面 BPM/offset 的修正(仅在显式设置时写入导出)。 */
export interface McOverrides {
  /** 覆盖 time[0].bpm 与 meta.song.bpm */
  bpm?: number | null;
  /** 覆盖音频 note 的 offset(ms) */
  offsetMs?: number | null;
}

/**
 * 用给定音符重建 .mc 文本:仅替换 note[],其余字段**逐字保留**;按 (beat, column) 排序。
 * 唯一例外:`overrides` 显式给出的 BPM/offset 会被写入(用户手动修正源谱面的场景)。
 */
export function buildArrangedMc(
  chart: ParsedChart,
  notes: ExportNote[],
  overrides?: McOverrides,
): string {
  const clone = structuredClone(chart.raw);

  if (overrides?.bpm != null && Number.isFinite(overrides.bpm) && overrides.bpm > 0) {
    const timeArr = clone.time as Record<string, unknown>[] | undefined;
    if (Array.isArray(timeArr) && timeArr.length > 0) timeArr[0].bpm = overrides.bpm;
    const meta = clone.meta as Record<string, unknown> | undefined;
    const song = meta?.song as Record<string, unknown> | undefined;
    if (song) song.bpm = overrides.bpm;
  }
  const sorted = [...notes].sort(
    (a, b) => beatToFloat(a.beat) - beatToFloat(b.beat) || a.column - b.column,
  );
  const noteDicts: Record<string, unknown>[] = sorted.map((n) => {
    if (!Number.isInteger(n.column) || n.column < 0 || n.column > 5) {
      throw new McParseError(`export column out of range: ${n.column}`);
    }
    const d: Record<string, unknown> = { beat: [...validateBeat(n.beat)], column: n.column };
    if (n.endbeat != null) d.endbeat = [...validateBeat(n.endbeat)];
    return d;
  });
  const audioNote = structuredClone(chart.audioNote.raw);
  if (overrides?.offsetMs != null && Number.isFinite(overrides.offsetMs)) {
    audioNote.offset = Math.round(overrides.offsetMs);
  }
  noteDicts.push(audioNote);
  (clone as Record<string, unknown>).note = noteDicts;
  return JSON.stringify(clone);
}
