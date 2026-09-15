"use client";

import { useEffect, useState } from "react";

import { currentPackageOf, srcQuery, type ProjectPackage } from "@/lib/projects";

export default function ProjectManageDialog(props: {
  open: boolean;
  src: string;
  onClose(): void;
  onChanged(): void;
  onSave(): Promise<boolean>;
  onToast(message: string): void;
}) {
  const [project, setProject] = useState<ProjectPackage | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [sourceDir, setSourceDir] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [chartNames, setChartNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/projects?includeHidden=1");
      const data = await res.json();
      if (cancelled) return;
      const found = currentPackageOf((data.packages ?? []) as ProjectPackage[], props.src);
      setProject(found);
      setDisplayName(found?.title ?? "");
      const source = found?.sourcePath ?? "";
      const slash = Math.max(source.lastIndexOf("\\"), source.lastIndexOf("/"));
      setSourceDir(slash >= 0 ? source.slice(0, slash) : "");
      setSourceName(slash >= 0 ? source.slice(slash + 1) : source);
      setChartNames(Object.fromEntries((found?.charts ?? []).map((chart) => [chart.id ?? chart.src, chart.name ?? `${chart.title}.mc`])));
      setError(found?.managed ? null : "旧工程需从绝对路径重新打开后才能永久管理名称与位置。");
    })();
    return () => { cancelled = true; };
  }, [props.open, props.src]);

  if (!props.open) return null;

  const chooseFolder = async () => {
    const res = await fetch("/api/system-dialog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "folder", initialDir: sourceDir || null }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) setError(String(data.error ?? "目录选择失败"));
    else if (!data.cancelled && data.path) setSourceDir(String(data.path));
  };

  const submit = async () => {
    if (!project?.managed) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await props.onSave())) {
        setError("保存未完成，未执行重命名或移动。请先处理保存冲突。");
        return;
      }
      const res = await fetch(`/api/projects/manage${srcQuery(props.src)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName,
          chartNames,
          ...(project.sourceKind === "workspace" ? {} : { sourceDir, sourceName }),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(String(data.error ?? "管理操作失败"));
        return;
      }
      props.onToast("工程名称与位置已更新");
      props.onChanged();
      props.onClose();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/30">
      <div className="max-h-[88vh] w-[34rem] overflow-y-auto rounded-2xl bg-ivory p-5 text-xs text-olive shadow-whisper">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-base font-medium text-ink">管理名称与位置</h2>
          <button onClick={props.onClose} className="text-stone hover:text-ink">✕</button>
        </div>
        <p className="mt-2 leading-relaxed text-stone">这是永久修改入口。提交前会先显式保存；失败不会修改注册表。</p>
        <label className="mt-4 block">工程显示名<input className="mt-1 w-full rounded-lg bg-white px-3 py-2 shadow-ring" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
        {project?.sourceKind !== "workspace" && <><label className="mt-3 block">包/源文件所在目录<div className="mt-1 flex gap-2"><input className="min-w-0 flex-1 rounded-lg bg-white px-3 py-2 font-mono shadow-ring" value={sourceDir} onChange={(event) => setSourceDir(event.target.value)} /><button onClick={() => void chooseFolder()} className="rounded-lg bg-sand px-3 shadow-ring">浏览…</button></div></label>
        <label className="mt-3 block">{project?.sourceKind === "mcz" ? "MCZ 包文件名" : "MC 文件名"}<input className="mt-1 w-full rounded-lg bg-white px-3 py-2 font-mono shadow-ring" value={sourceName} onChange={(event) => setSourceName(event.target.value)} /></label></>}
        <div className="mt-4 text-stone">包内谱面文件名</div>
        <div className="mt-1 space-y-2">
          {(project?.charts ?? []).map((chart) => {
            const key = chart.id ?? chart.src;
            return <label key={key} className="block rounded-lg bg-white p-2 shadow-ring"><span className="block text-[10px] text-stone">{chart.title}</span><input className="mt-1 w-full bg-transparent font-mono text-ink outline-none" value={chartNames[key] ?? ""} onChange={(event) => setChartNames((previous) => ({ ...previous, [key]: event.target.value }))} /></label>;
          })}
        </div>
        {project?.sourceKind === "mc" && <p className="mt-2 text-[10px] text-stone">裸 .mc 的源文件名与唯一谱面名会保持同步。</p>}
        {error && <div className="mt-3 rounded-lg bg-err-wash p-2 text-err">{error}</div>}
        <div className="mt-4 flex justify-end gap-2"><button onClick={props.onClose} className="px-3 py-2 text-stone">取消</button><button disabled={busy || !project?.managed} onClick={() => void submit()} className="rounded-lg bg-clay px-4 py-2 font-semibold text-white disabled:opacity-40">{busy ? "保存并更新中…" : "保存并应用"}</button></div>
      </div>
    </div>
  );
}
