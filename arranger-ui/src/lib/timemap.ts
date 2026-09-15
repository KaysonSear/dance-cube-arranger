/**
 * beat ↔ 时间映射(多 BPM 分段,移植 src/pipeline/time_map.py)+ offset 符号统一。
 *
 * offset 语义(docs/offset_convention.md):.mc 音频 note 的 offset = beat 0 落在音频的
 * 毫秒位置;语料为正(+392 → 0.392s),WDA_Recorded.mc 存 −463(相反符号约定,实测首拍
 * ≈0.42–0.47s,人耳定案)。两种约定物理含义一致 → 统一 beat0AudioSec = |offset|/1000。
 * nudge 仅作用于预览,绝不写回 .mc。
 */

import { type Beat, BeatError, beatToFloat, floatToBeat, validateBeat } from "./beat";

export interface TimePoint {
  beat: number;
  bpm: number;
  delayMs: number;
}

export class TimeMapError extends Error {}

/** 解析 .mc 的 time[](每项 {beat, bpm, delay?}),按 beat 升序返回。 */
export function timePointsFromMc(timeArr: unknown): TimePoint[] {
  if (!Array.isArray(timeArr) || timeArr.length === 0) {
    throw new TimeMapError("missing or empty time[]");
  }
  const pts = timeArr.map((e) => {
    if (typeof e !== "object" || e === null) {
      throw new TimeMapError(`invalid time[] entry: ${JSON.stringify(e)}`);
    }
    const rec = e as Record<string, unknown>;
    const bpm = Number(rec.bpm);
    if (!Number.isFinite(bpm) || bpm <= 0) {
      throw new TimeMapError(`invalid bpm: ${JSON.stringify(rec.bpm)}`);
    }
    let beat: number;
    try {
      beat = beatToFloat(validateBeat(rec.beat));
    } catch (err) {
      if (err instanceof BeatError) throw new TimeMapError(`invalid time[] beat: ${err.message}`);
      throw err;
    }
    const delayMs = rec.delay == null ? 0 : Number(rec.delay);
    if (!Number.isFinite(delayMs)) {
      throw new TimeMapError(`invalid delay: ${JSON.stringify(rec.delay)}`);
    }
    return { beat, bpm, delayMs };
  });
  pts.sort((a, b) => a.beat - b.beat);
  return pts;
}

/** 谱面拍 → 谱面秒:逐段以 60/bpm 积分,加 time[0].delay 前置。 */
export function beatToChartSec(beatFloat: number, tm: TimePoint[]): number {
  if (tm.length === 0) throw new TimeMapError("empty time map");
  let seconds = tm[0].delayMs / 1000;
  let prev = tm[0];
  for (let i = 1; i < tm.length; i++) {
    const tp = tm[i];
    if (beatFloat <= tp.beat) break;
    seconds += ((tp.beat - prev.beat) * 60) / prev.bpm;
    prev = tp;
  }
  return seconds + ((beatFloat - prev.beat) * 60) / prev.bpm;
}

/** 谱面秒 → 谱面拍(beatToChartSec 的逆,定位所在段后线性反解)。 */
export function chartSecToBeat(sec: number, tm: TimePoint[]): number {
  if (tm.length === 0) throw new TimeMapError("empty time map");
  let segStart = tm[0].delayMs / 1000;
  let prev = tm[0];
  for (let i = 1; i < tm.length; i++) {
    const tp = tm[i];
    const segEnd = segStart + ((tp.beat - prev.beat) * 60) / prev.bpm;
    if (sec <= segEnd) break;
    segStart = segEnd;
    prev = tp;
  }
  return prev.beat + ((sec - segStart) * prev.bpm) / 60;
}

/** beat 0 在音频中的秒位置:|offset|/1000;offset 缺失(null)→ 0(上层须警示)。 */
export function beat0AudioSec(offsetMs: number | null): number {
  return offsetMs == null ? 0 : Math.abs(offsetMs) / 1000;
}

export interface TimingContext {
  timeMap: TimePoint[];
  /** .mc 音频 note 的 offset 原值(可负可缺);仅用于推导 beat0,导出时原样回写。 */
  offsetMs: number | null;
  /** 仅预览的 AV 微调(ms),存 UI 偏好,绝不写回 .mc。 */
  nudgeMs: number;
}

export function beatToAudioSec(beatFloat: number, ctx: TimingContext): number {
  return beat0AudioSec(ctx.offsetMs) + ctx.nudgeMs / 1000 + beatToChartSec(beatFloat, ctx.timeMap);
}

export function audioSecToBeat(audioSec: number, ctx: TimingContext): number {
  return chartSecToBeat(
    audioSec - beat0AudioSec(ctx.offsetMs) - ctx.nudgeMs / 1000,
    ctx.timeMap,
  );
}

/** 吸附到 1/denom 拍网格(四舍五入,half-up;下限 0)。 */
export function snapBeatFloat(beatFloat: number, denom: number): number {
  return Math.max(0, Math.round(beatFloat * denom)) / denom;
}

/** 吸附并返回三元组(分母即当前细分档位)。 */
export function snapToBeat(beatFloat: number, denom: number): Beat {
  return floatToBeat(Math.max(0, beatFloat), denom);
}
