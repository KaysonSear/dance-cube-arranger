import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { tickId } from "../src/lib/beat";
import { buildArrangedMc, McParseError, parseMc } from "../src/lib/mc";

function miniMc(overrides?: { note?: unknown[] }): string {
  return JSON.stringify({
    meta: {
      $ver: 0,
      creator: "k",
      version: "Recorded",
      mode: 9,
      song: { title: "t", artist: "a", file: "x.ogg", bpm: 120 },
      mode_ext: { bar_begin: 0 },
    },
    time: [{ beat: [0, 0, 1], bpm: 120, delay: 0 }],
    note: overrides?.note ?? [
      { beat: [0, 1, 4], column: 5 },
      { beat: [1, 0, 4], column: 5, dir: 1 },
      { beat: [2, 0, 4], column: 3, endbeat: [3, 0, 4] },
      { beat: [0, 0, 1], type: 1, sound: "x.ogg", offset: -463 },
    ],
  });
}

describe("parseMc", () => {
  it("parses gameplay/audio/time and preserves raw", () => {
    const c = parseMc(miniMc());
    expect(c.gameplay).toHaveLength(3);
    expect(c.audioNote.offsetMs).toBe(-463);
    expect(c.audioNote.sound).toBe("x.ogg");
    expect(c.timeMap).toEqual([{ beat: 0, bpm: 120, delayMs: 0 }]);
    expect((c.raw.meta as Record<string, unknown>).mode).toBe(9);
    const hold = c.gameplay.find((n) => n.endbeat !== null);
    expect(hold?.endbeatFloat).toBe(3);
  });

  it("drops dir with a warning", () => {
    const c = parseMc(miniMc());
    expect(c.warnings.some((w) => w.includes("dir"))).toBe(true);
  });

  it("missing offset → null + warning (≠ 0)", () => {
    const c = parseMc(
      miniMc({
        note: [
          { beat: [0, 1, 4], column: 0 },
          { beat: [0, 0, 1], type: 1, sound: "x.ogg" },
        ],
      }),
    );
    expect(c.audioNote.offsetMs).toBeNull();
    expect(c.warnings.some((w) => w.includes("offset"))).toBe(true);
  });

  it("requires exactly one audio note", () => {
    expect(() =>
      parseMc(miniMc({ note: [{ beat: [0, 1, 4], column: 0 }] })),
    ).toThrow(McParseError);
    expect(() =>
      parseMc(
        miniMc({
          note: [
            { beat: [0, 1, 4], column: 0 },
            { beat: [0, 0, 1], type: 1, sound: "a.ogg", offset: 1 },
            { beat: [0, 0, 1], type: 1, sound: "b.ogg", offset: 2 },
          ],
        }),
      ),
    ).toThrow(/exactly one/);
  });

  it("rejects bad columns and reversed endbeat", () => {
    expect(() =>
      parseMc(
        miniMc({
          note: [
            { beat: [0, 1, 4], column: 6 },
            { beat: [0, 0, 1], type: 1, sound: "x.ogg", offset: 0 },
          ],
        }),
      ),
    ).toThrow(/column/);
    expect(() =>
      parseMc(
        miniMc({
          note: [
            { beat: [2, 0, 4], column: 0, endbeat: [1, 0, 4] },
            { beat: [0, 0, 1], type: 1, sound: "x.ogg", offset: 0 },
          ],
        }),
      ),
    ).toThrow(/endbeat/);
  });

  it("sorts gameplay by beat", () => {
    const c = parseMc(
      miniMc({
        note: [
          { beat: [4, 0, 4], column: 1 },
          { beat: [0, 1, 4], column: 2 },
          { beat: [0, 0, 1], type: 1, sound: "x.ogg", offset: 0 },
        ],
      }),
    );
    expect(c.gameplay.map((n) => n.beatFloat)).toEqual([0.25, 4]);
  });
});

describe("buildArrangedMc", () => {
  it("round-trips identically with the same notes", () => {
    const c = parseMc(miniMc());
    const rebuilt = buildArrangedMc(
      c,
      c.gameplay.map((n) => ({ beat: n.beat, column: n.column, endbeat: n.endbeat })),
    );
    const c2 = parseMc(rebuilt);
    expect(c2.gameplay).toEqual(c.gameplay);
    expect(c2.audioNote.offsetMs).toBe(-463);
    expect(c2.raw.meta).toEqual(c.raw.meta);
    expect(c2.raw.time).toEqual(c.raw.time);
  });

  it("sorts notes and keeps the audio note last", () => {
    const c = parseMc(miniMc());
    const rebuilt = buildArrangedMc(c, [
      { beat: [4, 0, 4], column: 2 },
      { beat: [0, 1, 4], column: 1 },
      { beat: [0, 1, 4], column: 0 },
    ]);
    const arr = (JSON.parse(rebuilt) as { note: Record<string, unknown>[] }).note;
    expect(arr).toHaveLength(4);
    expect(arr[arr.length - 1].type).toBe(1);
    expect(arr.slice(0, 3).map((n) => n.column)).toEqual([0, 1, 2]);
  });

  it("overrides 写入 BPM/offset(用户手动修正),其余字段逐字不变", () => {
    const c = parseMc(miniMc());
    const notes = c.gameplay.map((n) => ({ beat: n.beat, column: n.column, endbeat: n.endbeat }));
    const out = JSON.parse(buildArrangedMc(c, notes, { bpm: 103.5, offsetMs: -400 })) as {
      meta: { song: { bpm: number; title: string }; mode: number };
      time: { bpm: number }[];
      note: Record<string, unknown>[];
    };
    expect(out.time[0].bpm).toBe(103.5);
    expect(out.meta.song.bpm).toBe(103.5);
    expect(out.note[out.note.length - 1].offset).toBe(-400);
    // 其余 meta 字段逐字保留
    expect(out.meta.mode).toBe(9);
    expect(out.meta.song.title).toBe("t");
    // 重新解析仍自洽
    const re = parseMc(JSON.stringify(out));
    expect(re.timeMap[0].bpm).toBe(103.5);
    expect(re.audioNote.offsetMs).toBe(-400);
  });

  it("未给 overrides 时与现状完全一致(回归保护)", () => {
    const c = parseMc(miniMc());
    const notes = c.gameplay.map((n) => ({ beat: n.beat, column: n.column, endbeat: n.endbeat }));
    expect(buildArrangedMc(c, notes, {})).toBe(buildArrangedMc(c, notes));
    expect(buildArrangedMc(c, notes, { bpm: null, offsetMs: null })).toBe(
      buildArrangedMc(c, notes),
    );
    const re = parseMc(buildArrangedMc(c, notes, {}));
    expect(re.timeMap[0].bpm).toBe(120);
    expect(re.audioNote.offsetMs).toBe(-463);
  });

  it("rejects out-of-range export columns", () => {
    const c = parseMc(miniMc());
    expect(() => buildArrangedMc(c, [{ beat: [0, 0, 1], column: 7 }])).toThrow(McParseError);
  });
});

// 自动写回开启后,WDA_Recorded.mc 会含真实排键;`.mc.orig`(首次写回前的自动备份)
// 才是原始的人耳采音骨架 —— 存在时以它为金标准,断言语义不变。
const WDA_ORIG = path.resolve(__dirname, "../../WDA/WDA_Recorded.mc.orig");
const WDA_LIVE = path.resolve(__dirname, "../../WDA/WDA_Recorded.mc");
const WDA_MC = fs.existsSync(WDA_ORIG) ? WDA_ORIG : WDA_LIVE;

describe.runIf(fs.existsSync(WDA_MC))("golden: WDA_Recorded.mc(原始采音骨架)", () => {
  it("parses 618 col-5 onsets with offset -463 and round-trips", () => {
    const text = fs.readFileSync(WDA_MC, "utf-8");
    const c = parseMc(text);
    expect(c.gameplay).toHaveLength(618);
    expect(c.gameplay.every((n) => n.column === 5)).toBe(true);
    expect(c.gameplay.every((n) => n.endbeat === null)).toBe(true);
    expect(c.audioNote.offsetMs).toBe(-463);
    expect(new Set(c.gameplay.map((n) => tickId(n.beat))).size).toBe(618);

    const rebuilt = buildArrangedMc(
      c,
      c.gameplay.map((n) => ({ beat: n.beat, column: n.column, endbeat: n.endbeat })),
    );
    const c2 = parseMc(rebuilt);
    expect(c2.gameplay).toHaveLength(618);
    expect(c2.audioNote.offsetMs).toBe(-463);
    expect(c2.raw.meta).toEqual(c.raw.meta);
  });
});
