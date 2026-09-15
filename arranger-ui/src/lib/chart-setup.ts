/** Blank mode:9 chart creation and guarded metadata/asset-reference updates. */

import { parseMc, type ParsedChart } from "./mc";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface ChartMetadataInput {
  title: string;
  artist: string;
  titleOriginal: string;
  artistOriginal: string;
  version: string;
  creator: string;
  bpm: number;
  offsetMs: number;
  previewMs: number;
  extraMeta: Record<string, JsonValue>;
}

export const DEFAULT_CHART_METADATA: ChartMetadataInput = {
  title: "Untitled",
  artist: "",
  titleOriginal: "",
  artistOriginal: "",
  version: "New",
  creator: "",
  bpm: 120,
  offsetMs: 0,
  previewMs: 0,
  extraMeta: { mode_ext: { column: 0, bar_begin: 0, speed: 0 }, aimode: "" },
};

export const CONTROLLED_META_KEYS = new Set([
  "mode", "id", "song", "creator", "version", "preview", "background", "cover",
]);
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_TEXT = 240;
const MAX_EXTRA_BYTES = 64 * 1024;

type ValidationResult =
  | { ok: true; value: ChartMetadataInput }
  | { ok: false; error: string };

function stringField(value: unknown, label: string, required = false): string {
  if (typeof value !== "string") throw new Error(`${label}必须是文本`);
  const normalized = value.normalize("NFC").trim();
  if (required && !normalized) throw new Error(`${label}不能为空`);
  if (normalized.length > MAX_TEXT) throw new Error(`${label}不能超过 ${MAX_TEXT} 个字符`);
  if (/[\u0000-\u001f\u007f]/u.test(normalized)) throw new Error(`${label}不能包含控制字符`);
  return normalized;
}

function validateJson(value: unknown, path = "extraMeta"): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} 包含非法数字`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateJson(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object") throw new Error(`${path} 必须是 JSON 值`);
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) throw new Error(`${path} 包含危险键 ${key}`);
    validateJson(item, `${path}.${key}`);
  }
}

export function validateChartMetadata(raw: unknown): ValidationResult {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("元信息必须是对象");
    const rec = raw as Record<string, unknown>;
    const bpm = Number(rec.bpm);
    const offsetMs = Number(rec.offsetMs);
    const previewMs = Number(rec.previewMs);
    if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 1000) throw new Error("BPM 必须在 0–1000 之间");
    if (!Number.isFinite(offsetMs)) throw new Error("offset 必须是有限数字");
    if (!Number.isFinite(previewMs) || previewMs < 0) throw new Error("preview 必须是非负毫秒数");
    const extra = rec.extraMeta ?? {};
    if (!extra || typeof extra !== "object" || Array.isArray(extra)) throw new Error("高级元信息必须是 JSON 对象");
    validateJson(extra);
    for (const key of Object.keys(extra)) {
      if (CONTROLLED_META_KEYS.has(key)) throw new Error(`高级元信息不能覆盖受保护字段 ${key}`);
    }
    if (new TextEncoder().encode(JSON.stringify(extra)).byteLength > MAX_EXTRA_BYTES) {
      throw new Error("高级元信息不能超过 64KB");
    }
    return {
      ok: true,
      value: {
        title: stringField(rec.title, "歌曲标题", true),
        artist: stringField(rec.artist ?? "", "艺术家"),
        titleOriginal: stringField(rec.titleOriginal ?? "", "原始标题"),
        artistOriginal: stringField(rec.artistOriginal ?? "", "原始艺术家"),
        version: stringField(rec.version, "谱面版本", true),
        creator: stringField(rec.creator ?? "", "制作者"),
        bpm,
        offsetMs: Math.round(offsetMs),
        previewMs: Math.round(previewMs),
        extraMeta: structuredClone(extra as Record<string, JsonValue>),
      },
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export function metadataFromChart(chart: ParsedChart): ChartMetadataInput {
  const meta = chart.raw.meta && typeof chart.raw.meta === "object"
    ? chart.raw.meta as Record<string, unknown>
    : {};
  const song = meta.song && typeof meta.song === "object"
    ? meta.song as Record<string, unknown>
    : {};
  const extraMeta = Object.fromEntries(
    Object.entries(meta)
      .filter(([key]) => !CONTROLLED_META_KEYS.has(key))
      .map(([key, value]) => [key, structuredClone(value as JsonValue)]),
  );
  return {
    title: typeof song.title === "string" && song.title.trim() ? song.title : "Untitled",
    artist: typeof song.artist === "string" ? song.artist : "",
    titleOriginal: typeof song.titleorg === "string" ? song.titleorg : "",
    artistOriginal: typeof song.artistorg === "string" ? song.artistorg : "",
    version: typeof meta.version === "string" && meta.version.trim() ? meta.version : "New",
    creator: typeof meta.creator === "string" ? meta.creator : "",
    bpm: chart.timeMap[0]?.bpm ?? 120,
    offsetMs: chart.audioNote.offsetMs ?? 0,
    previewMs: typeof meta.preview === "number" && Number.isFinite(meta.preview) ? meta.preview : 0,
    extraMeta,
  };
}

export interface AssetRefs {
  audioName?: string | null;
  coverName?: string | null;
}

function applyToRaw(
  raw: Record<string, unknown>,
  metadata: ChartMetadataInput | null,
  refs: AssetRefs,
): Record<string, unknown> {
  const clone = structuredClone(raw);
  const meta = clone.meta && typeof clone.meta === "object"
    ? clone.meta as Record<string, unknown>
    : {};
  clone.meta = meta;
  const song = meta.song && typeof meta.song === "object"
    ? meta.song as Record<string, unknown>
    : {};
  meta.song = song;
  meta.mode = 9;
  if (metadata) {
    for (const key of Object.keys(meta)) {
      if (!CONTROLLED_META_KEYS.has(key)) delete meta[key];
    }
    Object.assign(meta, structuredClone(metadata.extraMeta));
    meta.creator = metadata.creator;
    meta.version = metadata.version;
    meta.preview = metadata.previewMs;
    song.title = metadata.title;
    song.artist = metadata.artist;
    if (metadata.titleOriginal) song.titleorg = metadata.titleOriginal;
    else delete song.titleorg;
    if (metadata.artistOriginal) song.artistorg = metadata.artistOriginal;
    else delete song.artistorg;
    song.bpm = metadata.bpm;
    const time = Array.isArray(clone.time) ? clone.time as Record<string, unknown>[] : [];
    if (!time.length) time.push({ beat: [0, 0, 1], bpm: metadata.bpm, delay: 0 });
    else time[0] = { ...time[0], bpm: metadata.bpm };
    clone.time = time;
  }
  if (refs.audioName !== undefined) song.file = refs.audioName ?? "";
  if (refs.coverName !== undefined) {
    meta.background = refs.coverName ?? "";
    meta.cover = refs.coverName ?? "";
  }
  const notes = Array.isArray(clone.note) ? clone.note as Record<string, unknown>[] : [];
  const audio = notes.find((note) => note.type === 1);
  if (!audio) throw new Error("谱面缺少唯一音频 note");
  if (refs.audioName !== undefined) audio.sound = refs.audioName ?? "";
  if (metadata) audio.offset = metadata.offsetMs;
  return clone;
}

export function applyChartSetup(
  text: string,
  metadataRaw: unknown,
  refs: AssetRefs = {},
): { ok: true; text: string; chart: ParsedChart; metadata: ChartMetadataInput } | { ok: false; error: string } {
  const validated = validateChartMetadata(metadataRaw);
  if (!validated.ok) return validated;
  try {
    const parsed = parseMc(text);
    const raw = applyToRaw(parsed.raw, validated.value, refs);
    const updated = parseMc(JSON.stringify(raw));
    return { ok: true, text: JSON.stringify(raw), chart: updated, metadata: validated.value };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export function patchChartAssetRefs(text: string, refs: AssetRefs): string {
  const parsed = parseMc(text);
  const raw = applyToRaw(parsed.raw, null, refs);
  return JSON.stringify(raw);
}

export function buildBlankMc(metadataRaw: unknown, refs: AssetRefs = {}): string {
  const validated = validateChartMetadata(metadataRaw);
  if (!validated.ok) throw new Error(validated.error);
  const metadata = validated.value;
  const audio = refs.audioName ?? "";
  const cover = refs.coverName ?? "";
  return JSON.stringify({
    meta: {
      id: 0,
      creator: metadata.creator,
      background: cover,
      cover,
      version: metadata.version,
      preview: metadata.previewMs,
      mode: 9,
      song: {
        id: 0,
        title: metadata.title,
        artist: metadata.artist,
        ...(metadata.titleOriginal ? { titleorg: metadata.titleOriginal } : {}),
        ...(metadata.artistOriginal ? { artistorg: metadata.artistOriginal } : {}),
        file: audio,
        bpm: metadata.bpm,
      },
      ...structuredClone(metadata.extraMeta),
    },
    time: [{ beat: [0, 0, 1], bpm: metadata.bpm, delay: 0 }],
    note: [{ beat: [0, 0, 1], type: 1, sound: audio, offset: metadata.offsetMs }],
    extra: null,
  });
}
