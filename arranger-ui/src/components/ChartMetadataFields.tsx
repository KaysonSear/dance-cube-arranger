"use client";

import type { ChartMetadataInput } from "@/lib/chart-setup";

export interface ChartMetadataDraft extends Omit<ChartMetadataInput, "extraMeta"> {
  extraMetaText: string;
}

export function draftFromMetadata(value: ChartMetadataInput): ChartMetadataDraft {
  const { extraMeta, ...fields } = value;
  return { ...fields, extraMetaText: JSON.stringify(extraMeta, null, 2) };
}

export function metadataFromDraft(value: ChartMetadataDraft): ChartMetadataInput {
  return { ...value, extraMeta: JSON.parse(value.extraMetaText || "{}") } as ChartMetadataInput;
}

export default function ChartMetadataFields(props: {
  value: ChartMetadataDraft;
  onChange(next: ChartMetadataDraft): void;
}) {
  const { value } = props;
  const text = (key: keyof ChartMetadataDraft, label: string, placeholder = "") => (
    <label className="block">
      <span className="text-stone">{label}</span>
      <input
        value={String(value[key])}
        placeholder={placeholder}
        onChange={(event) => props.onChange({ ...value, [key]: event.target.value })}
        className="mt-1 w-full rounded-lg bg-white px-2 py-1.5 text-ink shadow-ring"
      />
    </label>
  );
  const number = (key: "bpm" | "offsetMs" | "previewMs", label: string, step: number) => (
    <label className="block">
      <span className="text-stone">{label}</span>
      <input
        type="number"
        step={step}
        value={value[key]}
        onChange={(event) => props.onChange({ ...value, [key]: Number(event.target.value) })}
        className="mt-1 w-full rounded-lg bg-white px-2 py-1.5 font-mono text-ink shadow-ring"
      />
    </label>
  );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {text("title", "歌曲标题")}
        {text("artist", "艺术家")}
        {text("titleOriginal", "原始标题（可选）")}
        {text("artistOriginal", "原始艺术家（可选）")}
        {text("version", "谱面版本 / 难度名")}
        {text("creator", "制作者")}
        {number("bpm", "BPM", 0.001)}
        {number("offsetMs", "offset（ms）", 1)}
        {number("previewMs", "preview 起点（ms）", 1)}
      </div>
      <label className="block">
        <span className="text-stone">高级 meta JSON（仅额外字段）</span>
        <textarea
          rows={6}
          spellCheck={false}
          value={value.extraMetaText}
          onChange={(event) => props.onChange({ ...value, extraMetaText: event.target.value })}
          className="mt-1 w-full rounded-lg bg-white px-2 py-1.5 font-mono text-[11px] text-ink shadow-ring"
        />
      </label>
    </div>
  );
}
