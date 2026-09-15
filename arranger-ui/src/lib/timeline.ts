/** 时间轴纯helper:落点吸附与框选范围(与 Canvas 无关,便于单测)。 */

import type { Onset } from "./arrangement";
import { audioSecToBeat, beatToAudioSec, snapBeatFloat, type TimingContext } from "./timemap";

/**
 * 把音频时刻吸附到**当前细分**网格(denom=4 → 1/4 拍格),返回该格的音频时刻(下限 0)。
 * denom 缺省 1 = 整拍。此前漏传 denom 导致"切换 1/8/1/16 网格无响应"。
 */
export function nearestBeatAudioSec(sec: number, timing: TimingContext, denom = 1): number {
  const beat = snapBeatFloat(audioSecToBeat(sec, timing), denom);
  return beatToAudioSec(beat, timing);
}

/**
 * 活动采音点 = 音频时刻 ≤ sec 的**最后一个**采音点(正好落在其上也算)。
 * 播放头早于首个采音点时返回 null。用于"播放头不在采音点时也能排键"——编辑对象取前一个点。
 */
export function onsetAtOrBefore(
  onsets: Onset[],
  timing: TimingContext,
  sec: number,
): Onset | null {
  const EPS = 1e-6;
  let best: Onset | null = null;
  for (const o of onsets) {
    if (beatToAudioSec(o.beatFloat, timing) <= sec + EPS) best = o;
    else break; // onsets 已按 beatFloat 升序
  }
  return best;
}

export interface HoldSpan {
  /** `${onsetId}:${column}` —— 长条是每(采音点,列)独立的 */
  key: string;
  startSec: number;
  endSec: number;
}

/**
 * 长条轨道分配(甘特图式贪心区间划分):时间上重叠的长条分到**不同垂直轨道**,互不重叠的
 * 复用同一轨(不浪费纵向空间)。首尾相接(前一条结束 == 后一条开始)视为不重叠。
 * 轨道数超过 `maxLanes` 时按模回绕,避免画到画布外。返回 `key → lane`。
 */
export function assignHoldLanes(spans: HoldSpan[], maxLanes = 8): Map<string, number> {
  const EPS = 1e-6;
  const sorted = [...spans].sort(
    (a, b) => a.startSec - b.startSec || a.key.localeCompare(b.key),
  );
  const laneEnds: number[] = []; // 每条轨道当前的结束时刻
  const out = new Map<string, number>();
  for (const s of sorted) {
    let lane = laneEnds.findIndex((end) => end <= s.startSec + EPS);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(s.endSec);
    } else {
      laneEnds[lane] = s.endSec;
    }
    out.set(s.key, lane % maxLanes);
  }
  return out;
}

/**
 * 相对播放头时间(音频秒)找上/下一采音点。dir=1 = 首个晚于 sec 的采音点,dir=−1 = 末个早于
 * sec 的采音点;越界(已在首/尾)返回 null。用于 Q/E 移播放头(保持选中)。
 */
export function nextOnsetByTime(
  onsets: Onset[],
  timing: TimingContext,
  sec: number,
  dir: 1 | -1,
): Onset | null {
  const EPS = 1e-3;
  if (dir === 1) {
    for (const o of onsets) {
      if (beatToAudioSec(o.beatFloat, timing) > sec + EPS) return o;
    }
    return null;
  }
  for (let i = onsets.length - 1; i >= 0; i--) {
    if (beatToAudioSec(onsets[i].beatFloat, timing) < sec - EPS) return onsets[i];
  }
  return null;
}

/** Absolute nearest onset to a chart-time cursor; an exact tie keeps the earlier onset. */
export function nearestOnsetByTime(
  onsets: Onset[],
  timing: TimingContext,
  sec: number,
): Onset | null {
  if (onsets.length === 0 || !Number.isFinite(sec)) return null;
  let best = onsets[0];
  let bestDistance = Math.abs(beatToAudioSec(best.beatFloat, timing) - sec);
  for (let index = 1; index < onsets.length; index++) {
    const candidate = onsets[index];
    const distance = Math.abs(beatToAudioSec(candidate.beatFloat, timing) - sec);
    if (distance < bestDistance - 1e-9) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** 音频时刻落在 [sec0, sec1](端点闭合,顺序不限)内的采音点 id。 */
export function onsetIdsInRange(
  onsets: Onset[],
  timing: TimingContext,
  sec0: number,
  sec1: number,
): string[] {
  const lo = Math.min(sec0, sec1);
  const hi = Math.max(sec0, sec1);
  const ids: string[] = [];
  for (const o of onsets) {
    const t = beatToAudioSec(o.beatFloat, timing);
    if (t >= lo && t <= hi) ids.push(o.id);
  }
  return ids;
}
