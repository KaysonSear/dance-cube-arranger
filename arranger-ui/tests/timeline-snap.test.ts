import { describe, expect, it } from "vitest";

import { buildOnsets, type Onset } from "../src/lib/arrangement";
import type { SourceNote } from "../src/lib/mc";
import {
  assignHoldLanes,
  nearestBeatAudioSec,
  nextOnsetByTime,
  nearestOnsetByTime,
  onsetAtOrBefore,
  onsetIdsInRange,
} from "../src/lib/timeline";
import { beatToAudioSec, type TimingContext } from "../src/lib/timemap";

const wda: TimingContext = {
  timeMap: [{ beat: 0, bpm: 103, delayMs: 0 }],
  offsetMs: -463,
  nudgeMs: 0,
};

describe("nearestBeatAudioSec 细分吸附(denom)", () => {
  const beatSec = (b: number) => beatToAudioSec(b, wda);

  it("denom=4 吸附到 1/4 拍格", () => {
    expect(nearestBeatAudioSec(beatSec(1.26), wda, 4)).toBeCloseTo(beatSec(1.25), 9);
    expect(nearestBeatAudioSec(beatSec(1.9), wda, 4)).toBeCloseTo(beatSec(2.0), 9);
  });

  it("denom=8 / 16 / 32 越来越细", () => {
    expect(nearestBeatAudioSec(beatSec(1.13), wda, 8)).toBeCloseTo(beatSec(1.125), 9);
    expect(nearestBeatAudioSec(beatSec(1.06), wda, 16)).toBeCloseTo(beatSec(1.0625), 9);
    expect(nearestBeatAudioSec(beatSec(1.03), wda, 32)).toBeCloseTo(beatSec(1.03125), 9);
  });

  it("denom=3 支持三连音", () => {
    expect(nearestBeatAudioSec(beatSec(1.34), wda, 3)).toBeCloseTo(beatSec(1 + 1 / 3), 9);
  });

  it("缺省 denom=1 仍是整拍(向后兼容)", () => {
    expect(nearestBeatAudioSec(beatSec(1.26), wda)).toBeCloseTo(beatSec(1), 9);
  });
});

describe("nearestBeatAudioSec", () => {
  it("snaps an audio-time to the nearest integer beat's audio-time", () => {
    // beat0 @ 0.463s;beat1 @ 0.463 + 60/103 ≈ 1.0455s
    expect(nearestBeatAudioSec(0.5, wda)).toBeCloseTo(0.463, 6); // 0.5 → beat≈0.06 → beat 0
    expect(nearestBeatAudioSec(0.9, wda)).toBeCloseTo(0.463 + 60 / 103, 6); // → beat 1
    expect(nearestBeatAudioSec(0.463, wda)).toBeCloseTo(0.463, 6);
  });

  it("never returns negative and respects nudge", () => {
    expect(nearestBeatAudioSec(0.0, wda)).toBeGreaterThanOrEqual(0);
    const nudged = { ...wda, nudgeMs: 50 };
    expect(nearestBeatAudioSec(0.5, nudged)).toBeCloseTo(0.513, 6); // 0.463 + 0.05
  });
});

function sn(beat: [number, number, number], column = 5): SourceNote {
  const f = beat[0] + beat[1] / beat[2];
  return { beat, beatFloat: f, column, endbeat: null, endbeatFloat: null };
}

describe("onsetIdsInRange", () => {
  const onsets: Onset[] = buildOnsets([sn([0, 1, 4]), sn([4, 0, 4]), sn([8, 0, 4])]);
  // audio secs: beat0.25→0.463+0.25*60/103≈0.609; beat4→0.463+4*60/103≈2.793; beat8→0.463+8*60/103≈5.123

  it("collects onset ids whose audio time falls in [sec0, sec1] (inclusive, order-insensitive)", () => {
    expect(onsetIdsInRange(onsets, wda, 0.5, 3.0).sort()).toEqual([onsets[0].id, onsets[1].id].sort());
    expect(onsetIdsInRange(onsets, wda, 3.0, 0.5).sort()).toEqual(
      [onsets[0].id, onsets[1].id].sort(),
    ); // 反向范围也可
  });

  it("empty when range misses all", () => {
    expect(onsetIdsInRange(onsets, wda, 3.0, 4.0)).toEqual([]);
  });

  it("includes an onset exactly at an endpoint", () => {
    const at = nearestBeatAudioSec(2.793, wda); // ≈ beat4 audio sec
    expect(onsetIdsInRange(onsets, wda, at - 0.001, at + 0.001)).toContain(onsets[1].id);
  });
});

describe("onsetAtOrBefore(活动采音点 = 最近的前一个)", () => {
  const onsets: Onset[] = buildOnsets([sn([0, 1, 4]), sn([4, 0, 4]), sn([8, 0, 4])]);
  const secAt = (i: number) => beatToAudioSec(onsets[i].beatFloat, wda);

  it("正好落在采音点上 → 该点自身", () => {
    expect(onsetAtOrBefore(onsets, wda, secAt(1))?.id).toBe(onsets[1].id);
  });

  it("两点之间 → 前一个点", () => {
    expect(onsetAtOrBefore(onsets, wda, (secAt(0) + secAt(1)) / 2)?.id).toBe(onsets[0].id);
  });

  it("晚于末点 → 末点", () => {
    expect(onsetAtOrBefore(onsets, wda, secAt(2) + 99)?.id).toBe(onsets[2].id);
  });

  it("早于首点 → null", () => {
    expect(onsetAtOrBefore(onsets, wda, 0)).toBeNull();
    expect(onsetAtOrBefore([], wda, 5)).toBeNull();
  });
});

describe("assignHoldLanes(长条轨道分配,避免时间轴上重叠)", () => {
  const span = (key: string, startSec: number, endSec: number) => ({ key, startSec, endSec });

  it("不重叠的长条共用第 0 轨", () => {
    const lanes = assignHoldLanes([span("a", 0, 1), span("b", 2, 3), span("c", 4, 5)]);
    expect([...lanes.values()]).toEqual([0, 0, 0]);
  });

  it("用户案例:k 跨 1–14 小节、k+1 跨 12–14 小节 → 分到不同轨道", () => {
    const lanes = assignHoldLanes([span("k", 1, 14), span("k1", 12, 14)]);
    expect(lanes.get("k")).toBe(0);
    expect(lanes.get("k1")).toBe(1);
  });

  it("三条互相重叠 → 0/1/2 三轨", () => {
    const lanes = assignHoldLanes([span("a", 0, 10), span("b", 1, 9), span("c", 2, 8)]);
    expect(lanes.get("a")).toBe(0);
    expect(lanes.get("b")).toBe(1);
    expect(lanes.get("c")).toBe(2);
  });

  it("首尾相接(前一条结束即后一条开始)算不重叠,复用同轨", () => {
    const lanes = assignHoldLanes([span("a", 0, 5), span("b", 5, 9)]);
    expect(lanes.get("a")).toBe(0);
    expect(lanes.get("b")).toBe(0);
  });

  it("轨道用尽后回绕,避免画到画布外", () => {
    const spans = Array.from({ length: 5 }, (_, i) => span(`s${i}`, 0, 10)); // 全部互相重叠
    const lanes = assignHoldLanes(spans, 3);
    expect([...lanes.values()].every((l) => l >= 0 && l < 3)).toBe(true);
  });

  it("输入顺序不影响结果(内部按起点排序)", () => {
    const a = assignHoldLanes([span("late", 12, 14), span("early", 1, 14)]);
    expect(a.get("early")).toBe(0);
    expect(a.get("late")).toBe(1);
  });
});

describe("nextOnsetByTime(Q/E 移播放头)", () => {
  const onsets: Onset[] = buildOnsets([sn([0, 1, 4]), sn([4, 0, 4]), sn([8, 0, 4])]);
  const secAt = (i: number) => beatToAudioSec(onsets[i].beatFloat, wda);

  it("finds next / prev relative to the playhead", () => {
    expect(nextOnsetByTime(onsets, wda, secAt(0), 1)?.id).toBe(onsets[1].id); // 在 i0 上 → i1
    expect(nextOnsetByTime(onsets, wda, secAt(1), 1)?.id).toBe(onsets[2].id);
    expect(nextOnsetByTime(onsets, wda, secAt(2), -1)?.id).toBe(onsets[1].id);
    expect(nextOnsetByTime(onsets, wda, secAt(1), -1)?.id).toBe(onsets[0].id);
    // 播放头在两点之间
    const mid = (secAt(0) + secAt(1)) / 2;
    expect(nextOnsetByTime(onsets, wda, mid, 1)?.id).toBe(onsets[1].id);
    expect(nextOnsetByTime(onsets, wda, mid, -1)?.id).toBe(onsets[0].id);
  });

  it("returns null past the ends", () => {
    expect(nextOnsetByTime(onsets, wda, secAt(2), 1)).toBeNull();
    expect(nextOnsetByTime(onsets, wda, secAt(0), -1)).toBeNull();
    expect(nextOnsetByTime([], wda, 0, 1)).toBeNull();
  });
});

describe("nearestOnsetByTime(模拟器锁定头部)", () => {
  const onsets: Onset[] = buildOnsets([sn([0, 0, 1]), sn([1, 0, 1]), sn([3, 0, 1])]);
  const secAt = (i: number) => beatToAudioSec(onsets[i].beatFloat, wda);

  it("chooses absolute nearest and keeps the earlier onset on a tie", () => {
    expect(nearestOnsetByTime(onsets, wda, secAt(1) + 0.01)?.id).toBe(onsets[1].id);
    expect(nearestOnsetByTime(onsets, wda, (secAt(0) + secAt(1)) / 2)?.id).toBe(onsets[0].id);
    expect(nearestOnsetByTime(onsets, wda, secAt(2) + 99)?.id).toBe(onsets[2].id);
    expect(nearestOnsetByTime([], wda, 0)).toBeNull();
  });
});
