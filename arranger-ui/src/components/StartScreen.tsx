"use client";

/**
 * 启动页:V3 受管工程列表 + 原生/手输绝对路径打开 + 兼容性的复制导入。
 */

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";

import BlankChartDialog from "@/components/BlankChartDialog";
import HelpDialog from "@/components/HelpDialog";
import UpdateDialog from "@/components/UpdateDialog";
import { useAppUpdate } from "@/hooks/useAppUpdate";
import {
  assetDisplayRows,
  type ProjectAsset,
  type ProjectPackage,
} from "@/lib/projects";

export interface StartScreenProps {
  onOpen(src: string): void;
}

const FileRow = forwardRef<
  HTMLInputElement,
  { label: string; accept: string }
>(function FileRow({ label, accept }, ref) {
  return (
    <label className="flex items-center gap-3 text-xs text-olive">
      <span className="w-20 shrink-0">{label}</span>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="min-w-0 flex-1 text-xs text-olive file:mr-3 file:rounded-lg file:border-0 file:bg-sand file:px-3 file:py-1.5 file:text-xs file:text-charcoal file:shadow-ring hover:file:bg-sand-deep"
      />
    </label>
  );
});

const ACCEPTS = {
  mcz: ".mcz",
  mc: ".mc",
  audio: ".mp3,.ogg,.wav",
  cover: ".jpg,.jpeg,.png",
} as const;
const MAX = {
  mcz: 60 * 1024 * 1024,
  mc: 2 * 1024 * 1024,
  audio: 40 * 1024 * 1024,
  cover: 10 * 1024 * 1024,
} as const;

export default function StartScreen({ onOpen }: StartScreenProps) {
  const [projects, setProjects] = useState<ProjectPackage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"mcz" | "files">("mcz");
  const [showDeleted, setShowDeleted] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [blankOpen, setBlankOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const { currentVersion, updateInfo, loading: updateLoading, error: updateError, hasUpdate, latestVersion, checkUpdate } = useAppUpdate();
  const mczRef = useRef<HTMLInputElement | null>(null);
  const mcRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLInputElement | null>(null);
  const coverRef = useRef<HTMLInputElement | null>(null);

  const refreshProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects?includeHidden=1");
      const data = (await res.json()) as { packages: ProjectPackage[] };
      setProjects(data.packages ?? []);
    } catch {
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    // Fetch completion initializes the external project catalog asynchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    // 每次启动默认弹出使用说明窗口（若未被用户勾选“不再默认弹出”）
    try {
      const suppress = localStorage.getItem("arranger:suppress-startup-help");
      if (suppress !== "1") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setHelpOpen(true);
      }
    } catch {}
  }, []);

  const openAbsolutePath = async (selected: string) => {
    if (!selected.trim()) { setError("请输入 .mc/.mcz 的绝对路径"); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects/open-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selected }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) setError(String(data.error ?? "打开工程失败"));
      else onOpen(String(data.src));
    } catch (cause) {
      setError(`打开工程失败：${(cause as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const chooseAndOpen = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/system-dialog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "open" }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) setError(String(data.error ?? "文件选择失败"));
      else if (!data.cancelled && data.path) {
        setPathInput(String(data.path));
        await openAbsolutePath(String(data.path));
      }
    } finally {
      setBusy(false);
    }
  };

  const manageEntry = async (
    scope: "project" | "chart",
    target: string,
    action: "hide" | "unhide" | "purge",
    paths: string[],
  ) => {
    const label = scope === "project" ? "工程" : "谱面";
    const message = action === "purge"
      ? `彻底删除${label}？此操作不可恢复。\n\n${paths.join("\n")}`
      : action === "hide"
        ? `从工程历史删除此${label}？真实文件、编辑状态和快照都会保留。`
        : null;
    if (message && !window.confirm(message)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, target, action }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) setError(String(data.error ?? "工程操作失败"));
      else await refreshProjects();
    } finally {
      setBusy(false);
    }
  };

  const renderProject = (project: ProjectPackage, deleted = false) => {
    const chartAssets: ProjectAsset[] = project.charts.map((chart) => ({
      path: chart.path ?? chart.src,
      dir: chart.dir ?? project.dir,
      name: chart.name ?? chart.src.split("/").pop() ?? chart.src,
    }));
    const display = assetDisplayRows({
      charts: chartAssets,
      audio: project.audio ?? null,
      cover: project.cover ?? null,
    });
    const visibleCharts = deleted ? project.charts : project.charts.filter((chart) => !chart.hidden);
    const projectPaths = [
      ...chartAssets.map((asset) => asset.path),
      project.audio?.path,
      project.cover?.path,
    ].filter((path): path is string => !!path);
    return (
      <article key={project.dir} className="group/project rounded-xl bg-ivory p-4 shadow-ring">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-2 text-sm font-medium text-ink">
              <span>{project.title}</span>
              {(project.isExample || project.isDefault || /wda/i.test(project.title) || project.title.includes("示例")) && (
                <span className="rounded bg-sand-deep px-1.5 py-0.5 font-sans text-[10px] font-medium text-olive shadow-sm">
                  示例
                </span>
              )}
              {project.hidden && <span className="text-[10px] text-err">已删除</span>}
            </h3>
            {display.commonDir && (
              <div className="mt-1 break-all font-mono text-[10px] text-stone">
                路径：{display.commonDir}/
              </div>
            )}
            {project.sourcePath && <div className="mt-1 break-all font-mono text-[10px] text-stone">来源：{project.sourcePath}</div>}
            <div className="mt-2 grid grid-cols-[3rem_1fr] gap-x-2 gap-y-1 text-[11px] text-olive">
              <span>谱面</span><span className="break-all font-mono">{display.charts.join(" · ")}</span>
              <span>音频</span><span className="break-all font-mono">{display.audio}</span>
              <span>封面</span><span className="break-all font-mono">{display.cover}</span>
            </div>
            {project.assetError && <div className="mt-2 text-[11px] text-err">{project.assetError}</div>}
          </div>
          {(!deleted || project.hidden) && <div className="flex shrink-0 gap-2 text-[11px]">
            {project.hidden ? (
              <button className="text-clay hover:text-coral" onClick={() => void manageEntry("project", project.dir, "unhide", [])}>恢复工程</button>
            ) : (
              <button
                aria-label="从历史移除工程"
                title="从历史移除工程（保留文件，可恢复）"
                className="pointer-events-none inline-flex h-7 w-7 items-center justify-center rounded-lg text-lg leading-none text-stone opacity-0 transition-opacity hover:bg-cream hover:text-ink focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/project:pointer-events-auto group-hover/project:opacity-100"
                onClick={() => void manageEntry("project", project.dir, "hide", projectPaths)}
              >×</button>
            )}
            <button
              aria-label="永久删除工程文件"
              disabled={busy || !project.canPurge}
              title={project.canPurge ? "删除工程全部真实文件" : "内置或非导入工程不可彻底删除"}
              className="pointer-events-none inline-flex h-7 w-7 items-center justify-center rounded-lg border border-err/30 text-lg font-semibold leading-none text-err opacity-0 transition-opacity hover:bg-err-wash focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/project:pointer-events-auto group-hover/project:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
              onClick={() => void manageEntry("project", project.dir, "purge", projectPaths)}
            >×</button>
          </div>}
        </div>
        <div className="mt-3 space-y-1">
          {visibleCharts.map((chart) => (
            <div key={chart.src} className="group/chart flex items-center gap-2 rounded-lg bg-cream/60 px-3 py-2">
              <button
                disabled={busy || project.hidden || chart.missing}
                className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => onOpen(chart.src)}
              >
                <span className="block truncate text-xs text-ink">{chart.title}</span>
                {chart.missing && <span className="block text-xs text-err">原谱面缺失，需重新提供（编辑状态已保留）</span>}
                <span className="block truncate font-mono text-[10px] text-stone">{chart.name ?? chart.src.split("/").pop()}</span>
              </button>
              {chart.assignedCount !== null && <span className="text-[10px] text-stone">已排 {chart.assignedCount}</span>}
              {!project.hidden && (chart.hidden ? (
                <button className="text-[10px] text-clay" onClick={() => void manageEntry("chart", chart.src, "unhide", [])}>恢复</button>
              ) : (
                <button
                  aria-label={`从历史移除谱面 ${chart.title}`}
                  title="从历史移除谱面（保留文件，可恢复）"
                  className="pointer-events-none inline-flex h-6 w-6 items-center justify-center rounded-lg text-base leading-none text-stone opacity-0 transition-opacity hover:bg-cream hover:text-ink focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/chart:pointer-events-auto group-hover/chart:opacity-100"
                  onClick={() => void manageEntry("chart", chart.src, "hide", [chart.src])}
                >×</button>
              ))}
              {!project.hidden && <button
                aria-label={`永久删除谱面文件 ${chart.title}`}
                disabled={busy || !project.canPurge}
                title={project.canPurge ? "删除谱面真实文件（不可恢复）" : "内置或非导入工程不可彻底删除"}
                className="pointer-events-none inline-flex h-6 w-6 items-center justify-center rounded-lg border border-err/30 text-base font-semibold leading-none text-err opacity-0 transition-opacity hover:bg-err-wash focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/chart:pointer-events-auto group-hover/chart:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
                onClick={() => void manageEntry("chart", chart.src, "purge", [chart.src])}
              >×</button>}
            </div>
          ))}
        </div>
      </article>
    );
  };

  const doImport = async () => {
    setError(null);
    const form = new FormData();

    if (mode === "mcz") {
      const mcz = mczRef.current?.files?.[0];
      if (!mcz) {
        setError("请选择一个 .mcz 文件");
        return;
      }
      if (mcz.size > MAX.mcz) {
        setError("文件过大(.mcz ≤ 60MB)");
        return;
      }
      form.set("mcz", mcz);
    } else {
      const mc = mcRef.current?.files?.[0];
      const audio = audioRef.current?.files?.[0];
      const cover = coverRef.current?.files?.[0];
      if (!mc) {
        setError("请至少选择一个 .mc 谱面文件");
        return;
      }
      if (
        mc.size > MAX.mc ||
        (audio && audio.size > MAX.audio) ||
        (cover && cover.size > MAX.cover)
      ) {
        setError("文件过大(mc ≤ 2MB,音频 ≤ 40MB,封面 ≤ 10MB)");
        return;
      }
      form.set("mc", mc);
      if (audio) form.set("audio", audio);
      if (cover) form.set("cover", cover);
    }
    if (name.trim()) form.set("name", name.trim());
    setBusy(true);
    try {
      const res = await fetch("/api/import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(String(data.error ?? `导入失败 (${res.status})`));
        return;
      }
      onOpen(data.src as string);
    } catch (e) {
      setError(`导入请求失败:${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-parchment">
      <main className="mx-auto max-w-2xl px-6 py-14">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <h1 className="font-serif text-3xl font-medium leading-tight text-ink">
              舞立方谱面编辑器
            </h1>
            <span
              onClick={() => setUpdateOpen(true)}
              className="font-mono text-xs text-stone hover:text-ink cursor-pointer transition-colors"
              title="点击查看版本信息与检查更新"
            >
              v{currentVersion}
            </span>
            {hasUpdate && (
              <button
                type="button"
                onClick={() => setUpdateOpen(true)}
                className="animate-pulse inline-flex items-center gap-1.5 rounded-full bg-clay px-2.5 py-0.5 text-xs font-semibold text-white shadow-xs hover:bg-coral transition-colors cursor-pointer"
                title="发现新版本可用，点击查看详情并下载"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />
                <span>✨ 发现新版 v{latestVersion}</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setUpdateOpen(true)}
              className="flex items-center gap-1 rounded-xl border border-cream bg-ivory px-3 py-1.5 text-xs font-medium text-stone shadow-ring hover:text-ink hover:bg-sand-deep transition-colors cursor-pointer"
              title="在线检测软件版本与更新"
            >
              🔄 检查更新
            </button>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="flex items-center gap-1.5 rounded-xl bg-linear-to-r from-clay to-coral px-3.5 py-1.5 text-xs font-bold text-white shadow-md shadow-clay/25 ring-1 ring-white/30 hover:brightness-110 hover:shadow-lg hover:shadow-clay/35 active:scale-95 transition-all cursor-pointer"
              title="查看使用说明与机制指南"
            >
              <span className="text-sm leading-none">📖</span>
              <span>使用说明</span>
            </button>
          </div>
        </div>
        <section className="mt-8">
          <h2 className="font-serif text-lg font-medium text-ink">工程</h2>
          <div className="mt-3 space-y-3">
            {projects === null && <div className="text-xs text-stone">加载工程列表…</div>}
            {projects?.filter((project) => !project.hidden && project.charts.some((chart) => !chart.hidden)).map((project) => renderProject(project))}
          </div>
          {projects?.some((project) => project.hidden || project.charts.some((chart) => chart.hidden)) && (
            <div className="mt-4">
              <button className="text-xs text-stone hover:text-ink" onClick={() => setShowDeleted((value) => !value)}>
                {showDeleted ? "收起已删除工程/谱面" : "显示已删除工程/谱面"}
              </button>
              {showDeleted && (
                <div className="mt-3 space-y-3">
                  {projects.filter((project) => project.hidden || project.charts.some((chart) => chart.hidden)).map((project) =>
                    renderProject({
                      ...project,
                      charts: project.hidden ? project.charts : project.charts.filter((chart) => chart.hidden),
                    }, true),
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="mt-10 rounded-2xl bg-ivory p-5 shadow-whisper">
          <h2 className="font-serif text-lg font-medium text-ink">打开本机工程</h2>
          <p className="mt-1 text-xs leading-relaxed text-stone">直接登记任意位置的 .mc/.mcz；地址栏仅保存不透明工程 ID。编辑自动进入工作区，Ctrl/⌘+S 才同步原文件。</p>
          <div className="mt-3 flex gap-2">
            <input value={pathInput} onChange={(event) => setPathInput(event.target.value)} placeholder="D:\\Charts\\song.mcz 或 \\\\server\\share\\chart.mc" className="min-w-0 flex-1 rounded-lg bg-white px-3 py-2 font-mono text-xs shadow-ring" />
            <button disabled={busy} onClick={() => void openAbsolutePath(pathInput)} className="rounded-lg bg-sand px-3 py-2 text-xs text-charcoal shadow-ring disabled:opacity-40">按路径打开</button>
            <button disabled={busy} onClick={() => void chooseAndOpen()} className="rounded-lg bg-clay px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">浏览…</button>
          </div>
          {error && <div className="mt-3 rounded-lg bg-err-wash p-2 text-xs text-err">{error}</div>}
        </section>

        <section className="mt-6 rounded-2xl bg-ivory p-5 shadow-whisper">
          <div className="flex items-center justify-between gap-4">
            <div><h2 className="font-serif text-lg font-medium text-ink">新建空白谱面</h2><p className="mt-1 text-xs leading-relaxed text-stone">在任意绝对路径创建具有 0 个玩法音符的 mode:9 `.mc`；音频、封面和谱面信息可稍后补充。</p></div>
            <button onClick={() => setBlankOpen(true)} className="shrink-0 rounded-xl bg-clay px-4 py-2 text-xs font-semibold text-white hover:bg-coral">新建空白 MC…</button>
          </div>
        </section>

        <section className="mt-6 rounded-2xl bg-ivory p-5 shadow-whisper">
          <h2 className="font-serif text-lg font-medium text-ink">复制导入工程</h2>
          <p className="mt-1 text-xs leading-relaxed text-stone">
            <b>.mcz</b> 单文件即可(内含谱面+音频+封面,自动解包);或分别选择 <b>.mc</b>
            (音频/封面可选 —— 缺少任一素材时仍可编辑，但不能导出 .mcz)。上传后存到
            artifacts/arranger/imports/,与其它工程互不干扰。
          </p>
          <div className="mt-3 flex gap-2 text-xs">
            {(["mcz", "files"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={
                  mode === m
                    ? "rounded-lg bg-clay px-3 py-1 font-semibold text-white"
                    : "rounded-lg bg-sand px-3 py-1 text-charcoal shadow-ring hover:bg-sand-deep"
                }
              >
                {m === "mcz" ? "① 导入 .mcz(推荐)" : "② 分别选择文件"}
              </button>
            ))}
          </div>
          <div className="mt-4 space-y-3">
            {mode === "mcz" ? (
              <FileRow ref={mczRef} label=".mcz 谱面包" accept={ACCEPTS.mcz} />
            ) : null}
            {mode === "files"
              ? <FileRow ref={mcRef} label="谱面 .mc" accept={ACCEPTS.mc} />
              : null}
            {mode === "files"
              ? <FileRow ref={audioRef} label="音频(可选)" accept={ACCEPTS.audio} />
              : null}
            {mode === "files"
              ? <FileRow ref={coverRef} label="封面(可选)" accept={ACCEPTS.cover} />
              : null}
            <label className="flex items-center gap-3 text-xs text-olive">
              <span className="w-20 shrink-0">工程名(可选)</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="默认取 .mc 文件名"
                className="min-w-0 flex-1 rounded-lg bg-white px-2 py-1.5 text-xs text-ink shadow-ring focus:shadow-ring-focus focus:outline-none"
              />
            </label>
          </div>
          {error && <div className="mt-3 rounded-lg bg-err-wash p-2 text-xs text-err">{error}</div>}
          <div className="mt-4 flex justify-end">
            <button
              disabled={busy}
              onClick={() => void doImport()}
              className="rounded-xl bg-clay px-5 py-2 text-xs font-semibold text-white hover:bg-coral disabled:opacity-40"
            >
              {busy ? "导入中…" : "导入并打开"}
            </button>
          </div>
        </section>

        <p className="mt-8 text-[11px] leading-relaxed text-stone">
          封面会以高透明度垫在主工作区背景;音频/封面用于预览与 .mcz 打包(缺任一则无法导出 .mcz)。
          仅支持 mode:9(Cube)谱面。
        </p>
      </main>
      {blankOpen && <BlankChartDialog
        open={blankOpen}
        mode="standalone"
        onClose={() => setBlankOpen(false)}
        onCreated={onOpen}
        onToast={(message) => sessionStorage.setItem("arranger:pending-toast", message)}
      />}
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <UpdateDialog
        open={updateOpen}
        onClose={() => setUpdateOpen(false)}
        updateInfo={updateInfo}
        loading={updateLoading}
        error={updateError}
        onCheckAgain={() => void checkUpdate(true)}
      />
    </div>
  );
}
