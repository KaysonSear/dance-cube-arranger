"use client";

/**
 * 薄壳:URL 即真相 —— `?src=<仓库相对 .mc 路径>` 决定当前工程;无 src 显示启动页
 * (工程列表 + 导入)。`key={src}` 重挂载 EditorSession = 工程间状态零残留;F5 保持工程。
 */

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import EditorSession from "./EditorSession";
import StartScreen from "./StartScreen";

function openProject(src: string | null) {
  window.history.replaceState(null, "", src ? `/?src=${encodeURIComponent(src)}` : "/");
}

export default function EditorShell() {
  const params = useSearchParams();
  const src = params.get("src");
  const [checkedLegacy, setCheckedLegacy] = useState<string | null>(null);
  const resume = params.get("resume") === "1";

  useEffect(() => {
    if (!resume || src) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/projects");
        const data = (await res.json()) as { lastOpenedSrc?: string | null };
        if (cancelled) return;
        openProject(data.lastOpenedSrc ?? null);
      } catch {
        if (!cancelled) {
          openProject(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resume, src]);

  useEffect(() => {
    if (!src || src.startsWith("managed:")) return;
    let cancelled = false;
    void (async () => {
      try {
        // Finish legacy adoption before chart/state requests start in EditorSession.
        await fetch("/api/projects");
        const response = await fetch(`/api/chart?src=${encodeURIComponent(src)}`);
        const chart = await response.json();
        if (cancelled) return;
        if (response.ok && typeof chart.path === "string" && chart.path.startsWith("managed:")) {
          openProject(chart.path);
          return;
        }
      } catch { /* The editor reports the concrete loading error. */ }
      if (!cancelled) setCheckedLegacy(src);
    })();
    return () => { cancelled = true; };
  }, [src]);

  if (src && !src.startsWith("managed:") && checkedLegacy !== src) {
    return <div className="min-h-screen bg-parchment p-8 text-sm text-stone">正在载入工程副本…</div>;
  }

  if (resume && !src) {
    return <div className="min-h-screen bg-parchment p-8 text-sm text-stone">正在恢复上次工程…</div>;
  }

  if (!src) {
    return <StartScreen onOpen={openProject} />;
  }
  return (
    <EditorSession
      key={src}
      src={src}
      onExit={() => openProject(null)}
      onOpenSrc={openProject}
    />
  );
}
