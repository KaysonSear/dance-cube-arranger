"use client";

import { useState } from "react";

import ChartMetadataFields, {
  draftFromMetadata,
  metadataFromDraft,
  type ChartMetadataDraft,
} from "@/components/ChartMetadataFields";
import { DEFAULT_CHART_METADATA, type ChartMetadataInput } from "@/lib/chart-setup";
import { srcQuery } from "@/lib/projects";

export default function BlankChartDialog(props: {
  open: boolean;
  mode: "standalone" | "internal";
  src?: string;
  defaults?: ChartMetadataInput;
  onClose(): void;
  onCreated(src: string): void;
  onToast(message: string): void;
}) {
  const [target, setTarget] = useState("");
  const [fileName, setFileName] = useState("New.mc");
  const [metadata, setMetadata] = useState<ChartMetadataDraft>(() => draftFromMetadata(DEFAULT_CHART_METADATA));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!props.open) return null;
  const setNameDefault = (value: string) => {
    if (metadata.title !== "Untitled") return;
    const name = value.replace(/\\/g, "/").split("/").pop()?.replace(/\.mc$/i, "").trim();
    if (name) setMetadata((current) => ({ ...current, title: name }));
  };
  const choosePath = async () => {
    const slash = Math.max(target.lastIndexOf("\\"), target.lastIndexOf("/"));
    const initialDir = slash > 0 ? target.slice(0, slash) : null;
    const res = await fetch("/api/system-dialog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "save-mc", initialDir }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) setError(String(data.error ?? "保存位置选择失败"));
    else if (!data.cancelled && data.path) {
      setTarget(String(data.path));
      setNameDefault(String(data.path));
    }
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      let bodyMetadata: ChartMetadataInput;
      try { bodyMetadata = metadataFromDraft(metadata); }
      catch { setError("高级 meta JSON 不是有效对象"); return; }
      const url = props.mode === "standalone"
        ? "/api/projects/create"
        : `/api/projects/charts${srcQuery(props.src ?? "")}`;
      const body = props.mode === "standalone"
        ? { path: target, metadata: bodyMetadata }
        : { fileName, metadata: bodyMetadata };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) { setError(String(data.error ?? "创建失败")); return; }
      props.onToast(props.mode === "standalone" ? "空白 MC 创建成功" : "已新增包内空白谱面");
      props.onCreated(String(data.src));
      props.onClose();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/30">
      <div className="max-h-[90vh] w-[38rem] overflow-y-auto rounded-2xl bg-ivory p-5 text-xs text-olive shadow-whisper">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-base text-ink">{props.mode === "standalone" ? "新建空白 MC" : "添加包内空白谱面"}</h2>
          <button onClick={props.onClose} className="text-stone">✕</button>
        </div>
        {props.mode === "standalone" ? (
          <label className="mt-4 block"><span className="text-stone">外部 .mc 绝对路径</span><div className="mt-1 flex gap-2"><input value={target} onBlur={() => setNameDefault(target)} onChange={(event) => setTarget(event.target.value)} placeholder="D:\\Charts\\New.mc" className="min-w-0 flex-1 rounded-lg bg-white px-2 py-1.5 font-mono shadow-ring"/><button onClick={() => void choosePath()} className="rounded-lg bg-sand px-3 shadow-ring">浏览…</button></div></label>
        ) : (
          <label className="mt-4 block"><span className="text-stone">包内 .mc 文件名</span><input value={fileName} onBlur={() => setNameDefault(fileName)} onChange={(event) => setFileName(event.target.value)} className="mt-1 w-full rounded-lg bg-white px-2 py-1.5 font-mono shadow-ring"/></label>
        )}
        <div className="mt-4"><ChartMetadataFields value={metadata} onChange={setMetadata}/></div>
        <p className="mt-3 text-[11px] text-stone">空白谱包含 0 个玩法音符；音频和封面可进入编辑器后再导入。</p>
        {error && <div className="mt-3 rounded-lg bg-err-wash p-2 text-err">{error}</div>}
        <div className="mt-4 flex justify-end gap-2"><button onClick={props.onClose} className="px-3 py-2 text-stone">取消</button><button disabled={busy || (props.mode === "standalone" ? !target.trim() : !fileName.trim())} onClick={() => void submit()} className="rounded-lg bg-clay px-4 py-2 font-semibold text-white disabled:opacity-40">{busy ? "创建中…" : "创建并打开"}</button></div>
      </div>
    </div>
  );
}
