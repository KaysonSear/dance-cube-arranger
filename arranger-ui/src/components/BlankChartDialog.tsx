"use client";

import { useEffect, useRef, useState } from "react";

import ChartMetadataFields, {
  draftFromMetadata,
  metadataFromDraft,
  type ChartMetadataDraft,
} from "@/components/ChartMetadataFields";
import { DEFAULT_CHART_METADATA, type ChartMetadataInput } from "@/lib/chart-setup";
import { srcQuery } from "@/lib/projects";
import { ProjectRequestError, requestProjectData } from "@/lib/project-request";
import ProjectLoadNotice from "./ProjectLoadNotice";

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

  const picker = useRef<AbortController | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [pickerError, setPickerError] = useState<ProjectRequestError | null>(null);
  useEffect(() => () => picker.current?.abort(), []);

  if (!props.open) return null;
  const setNameDefault = (value: string) => {
    if (metadata.title !== "Untitled") return;
    const name = value.replace(/\\/g, "/").split("/").pop()?.replace(/\.mc$/i, "").trim();
    if (name) setMetadata((current) => ({ ...current, title: name }));
  };
  const choosePath = async () => {
    if (picker.current) return;
    const controller = new AbortController();
    picker.current = controller;
    setPickerError(null);
    setChoosing(true);
    try {
      const result = await requestProjectData("save-dialog", "/api/system-dialog", controller.signal, async (response) => {
        const data = await response.json();
        if (data?.ok !== true ||
          (data.cancelled !== true && (data.cancelled !== false || typeof data.path !== "string"))) {
          throw new Error("Invalid picker response");
        }
        return data as { cancelled: boolean; path: string | null };
      }, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "save-mc", initialDir: target }),
        timeoutMs: 185_000,
      });
      if (result.path && !result.cancelled) {
        setTarget(result.path);
        setNameDefault(result.path);
      }
    } catch (cause) {
      if (!controller.signal.aborted && cause instanceof ProjectRequestError) setPickerError(cause);
    } finally {
      if (picker.current === controller) {
        picker.current = null;
        setChoosing(false);
      }
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
          <label className="mt-4 block"><span className="text-stone">外部 .mc 绝对路径</span><div className="mt-1 flex gap-2"><input value={target} onBlur={() => setNameDefault(target)} onChange={(event) => setTarget(event.target.value)} placeholder="D:\\Charts\\New.mc" className="min-w-0 flex-1 rounded-lg bg-white px-2 py-1.5 font-mono shadow-ring"/><button type="button" disabled={choosing || busy} onClick={() => void choosePath()} className="rounded-lg bg-sand px-3 shadow-ring">浏览…</button></div></label>
        ) : (
          <label className="mt-4 block"><span className="text-stone">包内 .mc 文件名</span><input value={fileName} onBlur={() => setNameDefault(fileName)} onChange={(event) => setFileName(event.target.value)} className="mt-1 w-full rounded-lg bg-white px-2 py-1.5 font-mono shadow-ring"/></label>
        )}
        <div className="mt-4"><ChartMetadataFields value={metadata} onChange={setMetadata}/></div>
        <p className="mt-3 text-[11px] text-stone">空白谱包含 0 个玩法音符；音频和封面可进入编辑器后再导入。</p>
        {choosing && (
          <div className="mt-3 flex items-center gap-3">
            <p role="status">正在等待 Windows「另存为」窗口</p>
            <button type="button" className="underline" onClick={() => picker.current?.abort()}>取消选择</button>
          </div>
        )}
        {pickerError && (
          <ProjectLoadNotice issue={pickerError.issue} reason={pickerError.reason ?? "请重试或手动输入保存路径"} />
        )}
        {error && <div className="mt-3 rounded-lg bg-err-wash p-2 text-err">{error}</div>}
        <div className="mt-4 flex justify-end gap-2"><button onClick={props.onClose} className="px-3 py-2 text-stone">取消</button><button disabled={busy || choosing || (props.mode === "standalone" ? !target.trim() : !fileName.trim())} onClick={() => void submit()} className="rounded-lg bg-clay px-4 py-2 font-semibold text-white disabled:opacity-40">{busy ? "创建中…" : "创建并打开"}</button></div>
      </div>
    </div>
  );
}
