import { describe, expect, it } from "vitest";

import {
  applyChartSetup,
  buildBlankMc,
  DEFAULT_CHART_METADATA,
  metadataFromChart,
  patchChartAssetRefs,
  validateChartMetadata,
} from "../src/lib/chart-setup";
import { parseMc } from "../src/lib/mc";

describe("blank mode:9 chart", () => {
  it("has zero gameplay notes and one valid audio note", () => {
    const text = buildBlankMc({ ...DEFAULT_CHART_METADATA, title: "空白谱", offsetMs: -120 });
    const chart = parseMc(text);
    expect(chart.gameplay).toEqual([]);
    expect(chart.audioNote).toMatchObject({ sound: "", offsetMs: -120 });
    expect(chart.timeMap[0].bpm).toBe(120);
    expect((chart.raw.meta as Record<string, unknown>).mode).toBe(9);
  });

  it("writes canonical asset references", () => {
    const chart = parseMc(buildBlankMc(DEFAULT_CHART_METADATA, {
      audioName: "audio.ogg",
      coverName: "cover.png",
    }));
    const meta = chart.raw.meta as Record<string, unknown>;
    expect(chart.audioNote.sound).toBe("audio.ogg");
    expect(meta.background).toBe("cover.png");
    expect((meta.song as Record<string, unknown>).file).toBe("audio.ogg");
  });
});

describe("chart metadata", () => {
  it("updates standard fields, replaces extras and preserves later BPM segments", () => {
    const raw = JSON.parse(buildBlankMc(DEFAULT_CHART_METADATA));
    raw.time.push({ beat: [8, 0, 1], bpm: 180, delay: 0 });
    raw.meta.old_extra = true;
    const result = applyChartSetup(JSON.stringify(raw), {
      ...DEFAULT_CHART_METADATA,
      title: "标题",
      artist: "作者",
      titleOriginal: "Original",
      version: "Hard 15",
      creator: "Charter",
      bpm: 135.5,
      offsetMs: -321.4,
      previewMs: 12345.2,
      extraMeta: { aimode: "", custom: { x: 1 } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = JSON.parse(result.text);
    expect(parsed.meta.song).toMatchObject({ title: "标题", artist: "作者", titleorg: "Original", bpm: 135.5 });
    expect(parsed.meta).not.toHaveProperty("old_extra");
    expect(parsed.meta.custom).toEqual({ x: 1 });
    expect(parsed.time.map((item: { bpm: number }) => item.bpm)).toEqual([135.5, 180]);
    expect(parsed.note[0].offset).toBe(-321);
    expect(metadataFromChart(result.chart).previewMs).toBe(12345);
  });

  it("rejects protected, dangerous and malformed advanced fields", () => {
    expect(validateChartMetadata({ ...DEFAULT_CHART_METADATA, extraMeta: { mode: 4 } }).ok).toBe(false);
    const dangerous = JSON.parse('{"__proto__":{"polluted":true}}');
    expect(validateChartMetadata({ ...DEFAULT_CHART_METADATA, extraMeta: dangerous }).ok).toBe(false);
    expect(validateChartMetadata({ ...DEFAULT_CHART_METADATA, bpm: 0 }).ok).toBe(false);
    expect(validateChartMetadata({
      ...DEFAULT_CHART_METADATA,
      extraMeta: { large: "谱".repeat(22_000) },
    }).ok).toBe(false);
  });

  it("patches only shared asset refs", () => {
    const original = buildBlankMc({ ...DEFAULT_CHART_METADATA, title: "Keep" });
    const patched = parseMc(patchChartAssetRefs(original, { audioName: "audio.wav", coverName: "cover.jpg" }));
    expect(metadataFromChart(patched).title).toBe("Keep");
    expect(patched.audioNote.sound).toBe("audio.wav");
  });
});
