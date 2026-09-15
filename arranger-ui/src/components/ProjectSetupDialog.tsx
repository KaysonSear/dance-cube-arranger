"use client";

import { forwardRef, useEffect, useRef, useState } from "react";

import ChartMetadataFields, {
  draftFromMetadata,
  metadataFromDraft,
  type ChartMetadataDraft,
} from "@/components/ChartMetadataFields";
import type { ChartMetadataInput } from "@/lib/chart-setup";
import { currentPackageOf, srcQuery, type ProjectPackage } from "@/lib/projects";

const AssetPicker = forwardRef<HTMLInputElement, { label: string; accept: string }>(
  function AssetPicker({ label, accept }, ref) {
    return <label className="block rounded-lg bg-cream/60 p-2"><span className="text-stone">{label}</span><input ref={ref} type="file" accept={accept} className="mt-1 block w-full text-[11px] text-olive file:mr-2 file:rounded file:border-0 file:bg-sand file:px-2 file:py-1"/></label>;
  },
);

export default function ProjectSetupDialog(props: {
  open: boolean;
  src: string;
  metadata: ChartMetadataInput;
  mcText: string;
  expectSha1: string;
  onClose(): void;
  onApplied(result: { text: string; sourceSha1: string; assetRevision: number; metadata: ChartMetadataInput }): void;
  onToast(message: string): void;
}) {
  const [draft, setDraft] = useState<ChartMetadataDraft>(() => draftFromMetadata(props.metadata));
  const [assets, setAssets] = useState<{ audio?: string | null; cover?: string | null }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLInputElement | null>(null);
  const coverRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    void fetch("/api/projects?includeHidden=1")
      .then((res) => res.json())
      .then((data) => {
        const current = currentPackageOf((data.packages ?? []) as ProjectPackage[], props.src);
        setAssets({ audio: current?.audio?.name ?? null, cover: current?.cover?.name ?? null });
      })
      .catch(() => setAssets({}));
  }, [props.metadata, props.open, props.src]);

  if (!props.open) return null;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      let metadata: ChartMetadataInput;
      try { metadata = metadataFromDraft(draft); }
      catch { setError("高级 meta JSON 不是有效对象"); return; }
      const form = new FormData();
      form.set("mcText", props.mcText);
      form.set("expectSha1", props.expectSha1);
      form.set("metadata", JSON.stringify(metadata));
      const audio = audioRef.current?.files?.[0];
      const cover = coverRef.current?.files?.[0];
      if (audio) form.set("audio", audio);
      if (cover) form.set("cover", cover);
      const res = await fetch(`/api/projects/setup${srcQuery(props.src)}`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || !data.ok) { setError(String(data.error ?? "配置保存失败")); return; }
      props.onApplied({
        text: String(data.text),
        sourceSha1: String(data.sourceSha1),
        assetRevision: Number(data.assetRevision) || Date.now(),
        metadata,
      });
      props.onToast(audio || cover ? "谱面信息与工程素材已更新" : "谱面信息已更新");
      props.onClose();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/30">
      <div className="max-h-[90vh] w-[40rem] overflow-y-auto rounded-2xl bg-ivory p-5 text-xs text-olive shadow-whisper">
        <div className="flex items-center justify-between"><h2 className="font-serif text-base text-ink">谱面信息与素材</h2><button onClick={props.onClose} className="text-stone">✕</button></div>
        <div className="mt-4 rounded-lg bg-cream p-3">
          <div className="font-medium text-ink">工程共享素材</div>
          <p className="mt-1 text-[11px] text-stone">当前：音频 {assets.audio ?? "缺失"} · 封面 {assets.cover ?? "缺失"}。新文件会规范命名，并更新本包全部谱面引用。保存成功后，删除原位置的文件不会影响工程。</p>
          <div className="mt-2 grid grid-cols-2 gap-2"><AssetPicker label="导入 / 替换音频（≤40MB）" accept=".mp3,.ogg,.wav" ref={audioRef}/><AssetPicker label="导入 / 替换封面（≤10MB）" accept=".jpg,.jpeg,.png" ref={coverRef}/></div>
        </div>
        <div className="mt-4"><ChartMetadataFields value={draft} onChange={setDraft}/></div>
        <p className="mt-3 text-[11px] text-stone">名称只写入 MC 元信息；不会重命名工程、包或包内文件。BPM 仅修改首段。</p>
        {error && <div className="mt-3 rounded-lg bg-err-wash p-2 text-err">{error}</div>}
        <div className="mt-4 flex justify-end gap-2"><button onClick={props.onClose} className="px-3 py-2 text-stone">取消</button><button disabled={busy} onClick={() => void submit()} className="rounded-lg bg-clay px-4 py-2 font-semibold text-white disabled:opacity-40">{busy ? "校验并保存中…" : "保存到工作区"}</button></div>
      </div>
    </div>
  );
}
