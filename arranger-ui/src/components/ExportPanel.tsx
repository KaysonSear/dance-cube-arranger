"use client";

import { useEffect, useState } from "react";

import { srcQuery } from "@/lib/projects";

export interface ExportPanelProps {
  open: boolean;
  src: string;
  onClose(): void;
  onManage(): void;
  buildMcText(): {
    text: string;
    noteCount: number;
    assignedCount: number;
    unassignedCount: number;
  } | null;
  onToast(msg: string): void;
}

interface ChartRow {
  src: string;
  name: string;
  noteCount: number;
  assignedCount: number;
  unassignedCount: number;
}

export default function ExportPanel(props: ExportPanelProps) {
  const { open, src } = props;
  const [charts, setCharts] = useState<ChartRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [outputDir, setOutputDir] = useState("");
  const [packageName, setPackageName] = useState("");
  const [confirmPlaceholder, setConfirmPlaceholder] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/export/mcz${srcQuery(src)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setResult({ ok: false, detail: String(data.error ?? "无法读取导出信息") });
          return;
        }
        const rows = (data.charts ?? []) as ChartRow[];
        setCharts(rows);
        setNames(Object.fromEntries(rows.map((row) => [row.src, row.name])));
        setPackageName(String(data.packageName ?? "chart.mcz"));
        setOutputDir(String(data.lastExportDir ?? ""));
        setAssetError(typeof data.assetError === "string" ? data.assetError : null);
        setResult(null);
        setConfirmPlaceholder(false);
      } catch (error) {
        if (!cancelled) setResult({ ok: false, detail: (error as Error).message });
      }
    })();
    return () => { cancelled = true; };
  }, [open, src]);

  if (!open) return null;
  const built = props.buildMcText();
  if (!built) return null;
  const shownCharts = charts.map((row) => row.src === src ? {
    ...row,
    noteCount: built.noteCount,
    assignedCount: built.assignedCount,
    unassignedCount: built.unassignedCount,
  } : row);
  const totalUnassigned = shownCharts.reduce((sum, row) => sum + row.unassignedCount, 0);
  const needConfirm = totalUnassigned > 0 && !confirmPlaceholder;

  const chooseFolder = async () => {
    const res = await fetch("/api/system-dialog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "folder", initialDir: outputDir || null }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) props.onToast(String(data.error ?? "目录选择失败"));
    else if (!data.cancelled && data.path) setOutputDir(String(data.path));
  };

  const exportMcz = async (overwrite = false) => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/export/mcz${srcQuery(src)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mcText: built.text,
          outputDir,
          packageName,
          chartNames: names,
          overwrite,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.conflict && !overwrite) {
        if (window.confirm(`${data.path}\n已存在，是否原子替换？`)) await exportMcz(true);
        return;
      }
      if (!res.ok || !data.ok) {
        setResult({ ok: false, detail: String(data.error ?? (data.errors ?? []).join("；") ?? "导出失败") });
        return;
      }
      setResult({ ok: true, detail: `已导出：${data.mczPath}` });
      props.onToast(`MCZ 导出成功（${shownCharts.length} 张谱面）`);
    } catch (error) {
      setResult({ ok: false, detail: `请求失败：${(error as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25">
      <div className="max-h-[88vh] w-[34rem] overflow-y-auto rounded-2xl bg-ivory p-5 text-sm text-olive shadow-whisper">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-base font-medium text-ink">导出 .mcz</h2>
          <button className="text-stone hover:text-ink" onClick={props.onClose}>✕</button>
        </div>

        <div className="mt-3 rounded-lg bg-cream p-3 text-xs leading-relaxed text-olive">
          这里的包名和谱面名只影响本次导出，不会改变当前工程。
          <button className="ml-2 font-semibold text-clay hover:text-coral" onClick={props.onManage}>
            永久重命名工程/谱面…
          </button>
        </div>

        <label className="mt-4 block text-xs">
          <span className="text-stone">输出目录（绝对路径）</span>
          <div className="mt-1 flex gap-2">
            <input value={outputDir} onChange={(event) => setOutputDir(event.target.value)} className="min-w-0 flex-1 rounded-lg bg-white px-3 py-2 font-mono text-xs shadow-ring" placeholder="D:\\Charts\\Exports" />
            <button disabled={busy} onClick={() => void chooseFolder()} className="rounded-lg bg-sand px-3 text-charcoal shadow-ring">浏览…</button>
          </div>
        </label>
        <label className="mt-3 block text-xs">
          <span className="text-stone">MCZ 包名</span>
          <input value={packageName} onChange={(event) => setPackageName(event.target.value)} className="mt-1 w-full rounded-lg bg-white px-3 py-2 font-mono text-xs shadow-ring" />
        </label>

        <div className="mt-4 text-xs text-stone">包内 mode:9 谱面（全部导出）</div>
        <div className="mt-1 space-y-2">
          {shownCharts.map((chart) => (
            <div key={chart.src} className="rounded-lg bg-white p-2 shadow-ring">
              <input
                value={names[chart.src] ?? chart.name}
                onChange={(event) => setNames((previous) => ({ ...previous, [chart.src]: event.target.value }))}
                className="w-full bg-transparent font-mono text-xs text-ink outline-none"
              />
              <div className="mt-1 text-[10px] text-stone">
                音符 {chart.noteCount} · 已排 {chart.assignedCount} · 未排 {chart.unassignedCount}
                {chart.src === src ? " · 当前内存版本" : " · 最新工作状态"}
              </div>
            </div>
          ))}
        </div>

        {totalUnassigned > 0 && (
          <label className="mt-3 flex items-start gap-2 rounded-lg bg-warn-wash p-2 text-xs text-warn-ink">
            <input type="checkbox" checked={confirmPlaceholder} onChange={(event) => setConfirmPlaceholder(event.target.checked)} className="mt-0.5 accent-clay" />
            <span>{totalUnassigned} 个采音点未指派，将保留其源占位排布；我确认继续导出。</span>
          </label>
        )}

        {assetError && (
          <div className="mt-3 rounded-lg bg-err-wash p-2 text-xs text-err">
            无法导出：{assetError}
          </div>
        )}

        <button
          disabled={busy || needConfirm || !!assetError || !outputDir.trim() || charts.length === 0}
          onClick={() => void exportMcz()}
          className="mt-4 w-full rounded-xl bg-clay px-3 py-2 text-xs font-semibold text-white hover:bg-coral disabled:opacity-40"
        >
          {busy ? "打包中…（音频转码可能需要十余秒）" : "导出 .mcz（可导入 Malody V）"}
        </button>

        {result && <pre className={`mt-3 max-h-36 overflow-auto whitespace-pre-wrap rounded-lg p-2 text-[11px] ${result.ok ? "bg-ok-wash text-ok-ink" : "bg-err-wash text-err"}`}>{result.detail}</pre>}
        <p className="mt-3 text-[11px] leading-relaxed text-stone">不会生成或保留独立 .mc 中间文件；最终包在写入前会完整校验。</p>
      </div>
    </div>
  );
}
