"use client";

/**
 * 右侧栏工程面板:显式保存 / 永久名称位置管理 / 包内谱面切换 / 其它工程包。
 *
 * 一曲多包:一个文件夹 = 一份歌曲 = 一个包,内含多张 `.mc`。切换谱面 = 换 `?src=`,
 * `EditorSession key={src}` 会干净重挂载。普通叉号仅移除条目(文件保留、可恢复),
 * 红色带框叉号才删除真实文件。
 */

import { useCallback, useEffect, useState } from "react";

import { currentPackageOf, type ProjectPackage } from "@/lib/projects";

export interface ProjectPanelProps {
  src: string;
  saveStamp: string | null;
  writeBackEnabled: boolean;
  writeBackAt: string | null;
  writeBackBackup: string | null;
  writeBackError: string | null;
  onToggleWriteBack(on: boolean): void;
  onSaveNow(): Promise<boolean> | boolean;
  onManage(): void;
  onSetup(): void;
  onAddChart(): void;
  buildMcText(): { text: string } | null;
  onOpen(src: string): void;
  onExit(): void;
  onToast(msg: string): void;
}

interface ProjectsResponse {
  packages: ProjectPackage[];
  hidden: string[];
  defaultSrc: string;
}

export default function ProjectPanel(props: ProjectPanelProps) {
  const { src } = props;
  const [data, setData] = useState<ProjectsResponse | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects${showHidden ? "?includeHidden=1" : ""}`);
      setData((await res.json()) as ProjectsResponse);
    } catch {
      setData({ packages: [], hidden: [], defaultSrc: "" });
    }
  }, [showHidden]);

  useEffect(() => {
    // Fetch completion initializes external project-list state asynchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const pkgs = data?.packages ?? [];
  const current = currentPackageOf(pkgs, src);
  const others = pkgs.filter((p) => p.dir !== current?.dir);

  const doDelete = async (
    scope: "project" | "chart",
    target: string,
    action: "hide" | "unhide" | "purge",
  ) => {
    setBusy(true);
    try {
      const res = await fetch("/api/projects/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, target, action }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        props.onToast(String(j.error ?? "删除失败"));
        return;
      }
      props.onToast(
        action === "purge" ? "已彻底删除文件" : action === "unhide" ? "已恢复" : "已从列表移除(文件保留)",
      );
      setConfirming(null);
      if (scope === "project" && target === current?.dir) {
        props.onExit();
        return;
      }
      if (scope === "chart" && target === src && action !== "unhide") {
        // 删掉的是当前打开的谱 → 切到同包其它谱,否则退回启动页
        const sibling = current?.charts.find((c) => c.src !== target && !c.missing && !c.hidden);
        if (sibling) props.onOpen(sibling.src);
        else props.onExit();
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const rowCls = (isCurrent: boolean) =>
    `group/chart flex items-center gap-2 rounded-lg px-2 py-1 text-xs ${
      isCurrent ? "bg-cream text-ink" : "text-olive hover:bg-cream/60"
    }`;

  const chartRows = (pkg: ProjectPackage) =>
    pkg.charts.map((c) => (
      <div key={c.src}>
        <div className={rowCls(c.src === src)}>
          <button
            disabled={c.missing}
            className="min-w-0 flex-1 truncate text-left disabled:opacity-50"
            onClick={() => (c.src === src ? undefined : props.onOpen(c.src))}
            title={c.src}
          >
            {c.title}
            {c.missing && <span className="ml-1 text-err">原谱面缺失，需重新提供</span>}
            {c.src === src && <span className="ml-1.5 text-[10px] text-clay">当前</span>}
            {c.hidden && <span className="ml-1.5 text-[10px] text-stone">已隐藏</span>}
          </button>
          {c.assignedCount !== null && (
            <span className="shrink-0 text-[10px] text-stone">已排 {c.assignedCount}</span>
          )}
          {c.hidden ? (
            <button className="shrink-0 px-1 text-clay" onClick={() => void doDelete("chart", c.src, "unhide")}>恢复</button>
          ) : (
            <button
              className="pointer-events-none shrink-0 px-1 text-stone opacity-0 transition-opacity hover:text-err focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/chart:pointer-events-auto group-hover/chart:opacity-100"
              title="删除谱面"
              onClick={() => setConfirming(confirming === c.src ? null : c.src)}
            >✕</button>
          )}
        </div>
        {confirming === c.src && (
          <div className="mt-1 rounded-lg bg-warn-wash p-2 text-[11px] text-warn-ink">
            <div>删除「{c.title}」?</div>
            <div className="mt-1 break-all font-mono text-stone">{c.src}</div>
            <div className="mt-1 text-stone">“删除”仅移出历史且可恢复；“彻底删除”会删除真实文件。</div>
            <div className="mt-2 flex justify-end gap-2">
              <button className="px-2 text-stone hover:text-ink" onClick={() => setConfirming(null)}>
                取消
              </button>
              <button
                disabled={busy}
                aria-label="从历史移除此谱面"
                title="从历史移除（保留文件，可恢复）"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-clay text-lg font-semibold leading-none text-white hover:bg-coral disabled:opacity-40"
                onClick={() => void doDelete("chart", c.src, "hide")}
              >×</button>
              <button
                disabled={busy || !pkg.canPurge}
                aria-label="永久删除此谱面文件"
                title={pkg.canPurge ? "不可恢复" : "内置或非导入工程不可彻底删除"}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-err text-lg font-semibold leading-none text-white disabled:opacity-30"
                onClick={() => {
                  if (window.confirm(`彻底删除谱面？此操作不可恢复。\n\n${c.src}`)) {
                    void doDelete("chart", c.src, "purge");
                  }
                }}
              >×</button>
            </div>
          </div>
        )}
      </div>
    ));

  return (
    <div className="space-y-3 border-b border-cream p-3 text-xs">
      {/* ── 保存 ── */}
      <div>
        <div className="group/project flex items-center gap-2">
          <span className="font-serif text-sm font-medium text-ink">工程</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-stone" title={src}>
            {current?.title ?? src}
          </span>
          {(current?.isExample || current?.isDefault || current?.title?.includes("示例") || current?.title?.includes("WDA")) && (
            <span className="shrink-0 rounded bg-sand-deep px-1.5 py-0.5 text-[10px] font-medium text-olive shadow-sm">
              示例
            </span>
          )}
          <button
            className="rounded-lg bg-sand px-2 py-0.5 text-charcoal shadow-ring hover:bg-sand-deep"
            onClick={props.onSaveNow}
            title="立即保存 (Ctrl+S)"
          >
            立即保存
          </button>
          {current && (
            <>
              <button
                aria-label="从历史移除当前工程"
                title="从历史移除工程（保留文件，可恢复）"
                className="pointer-events-none inline-flex h-6 w-6 items-center justify-center rounded-lg text-base leading-none text-stone opacity-0 transition-opacity hover:bg-cream hover:text-ink focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/project:pointer-events-auto group-hover/project:opacity-100"
                onClick={() => void doDelete("project", current.dir, "hide")}
              >×</button>
              <button
                disabled={!current.canPurge}
                aria-label="永久删除当前工程文件"
                title={current.canPurge ? "删除工程全部真实文件（不可恢复）" : "内置或非导入工程不可彻底删除"}
                className="pointer-events-none inline-flex h-6 w-6 items-center justify-center rounded-lg border border-err/30 text-base font-semibold leading-none text-err opacity-0 transition-opacity hover:bg-err-wash focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/project:pointer-events-auto group-hover/project:opacity-100 disabled:opacity-30"
                onClick={() => {
                  if (window.confirm(`彻底删除整个工程？包内全部谱面、音频、封面与编辑历史都会删除。\n\n${current.dir}`)) {
                    void doDelete("project", current.dir, "purge");
                  }
                }}
              >×</button>
            </>
          )}
        </div>
        <div className="mt-1 text-[11px] text-stone">
          {props.saveStamp ? `自动保存 ${props.saveStamp}` : "自动保存:待首次编辑"}
        </div>
        {!current?.managed && <label className="mt-1.5 flex items-start gap-1.5" title="把排键实时写回源 .mc 文件">
          <input
            type="checkbox"
            checked={props.writeBackEnabled}
            onChange={(e) => props.onToggleWriteBack(e.target.checked)}
            className="mt-0.5 accent-clay"
          />
          <span className="text-olive">
            自动写回源 .mc(直接改原文件)
            {!props.writeBackEnabled && (
              <span className="block text-stone">关闭时只保存工作状态,源文件不动</span>
            )}
          </span>
        </label>}
        {current?.managed && <div className="mt-1.5 text-[11px] leading-relaxed text-olive">编辑会自动保存到工作区；Ctrl/⌘+S 或“立即保存”才同步原始 {current.sourceKind === "mcz" ? ".mcz 包" : ".mc 文件"}。</div>}
        {props.writeBackAt && (
          <div className="mt-1 text-[10px] text-stone">
            最近写回 {props.writeBackAt}
            {props.writeBackBackup && (
              <>
                {" · 备份 "}
                <span className="font-mono">{props.writeBackBackup}</span>
              </>
            )}
          </div>
        )}
        {props.writeBackError && (
          <div className="mt-1 rounded-lg bg-err-wash p-1.5 text-[11px] text-err">
            已停止写回:{props.writeBackError}
          </div>
        )}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button disabled={busy || !current?.managed} className="rounded-lg bg-sand px-2 py-1 text-charcoal shadow-ring hover:bg-sand-deep disabled:opacity-40" onClick={props.onSetup}>谱面信息与素材…</button>
          <button disabled={busy} className="rounded-lg bg-sand px-2 py-1 text-charcoal shadow-ring hover:bg-sand-deep disabled:opacity-40" onClick={props.onManage}>管理名称与位置…</button>
          <button
            disabled={busy || !current?.managed || current.sourceKind === "mc"}
            title={current?.sourceKind === "mc" ? "裸 .mc 只能包含一张谱；请从启动页新建独立 MC" : "向当前包添加一张空白谱面"}
            className="col-span-2 rounded-lg bg-sand px-2 py-1 text-charcoal shadow-ring hover:bg-sand-deep disabled:opacity-40"
            onClick={props.onAddChart}
          >
            添加包内空白谱面…
          </button>
        </div>
      </div>

      {/* ── 本包谱面 ── */}
      {current && (
        <div>
          <div className="mb-1 text-[11px] text-olive">
            本包谱面 ({current.charts.length})
          </div>
          <div className="space-y-0.5">{chartRows(current)}</div>
        </div>
      )}

      {/* ── 其它工程包 ── */}
      {others.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[11px] text-olive">
            其它工程包 ({others.length})
          </summary>
          <div className="mt-1 space-y-2">
            {others.map((p) => (
              <div key={p.dir}>
                <div className="truncate text-[11px] text-stone" title={p.dir}>
                  {p.title} ({p.charts.length})
                </div>
                <div className="space-y-0.5">{chartRows(p)}</div>
              </div>
            ))}
          </div>
        </details>
      )}

      <label className="flex items-center gap-1.5 text-[11px] text-stone">
        <input
          type="checkbox"
          checked={showHidden}
          onChange={(e) => setShowHidden(e.target.checked)}
          className="accent-clay"
        />
        显示已隐藏的条目
      </label>
    </div>
  );
}
