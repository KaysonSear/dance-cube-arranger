"use client";

/**
 * 薄壳:URL 即真相 —— `?src=<仓库相对 .mc 路径>` 决定当前工程;无 src 显示启动页
 * (工程列表 + 导入)。`key={src}` 重挂载 EditorSession = 工程间状态零残留;F5 保持工程。
 */

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { loadProjectCatalog, PROJECT_LOAD_TIMEOUT_MS, type ProjectLoadIssue } from "@/lib/project-catalog";

import EditorSession from "./EditorSession";
import StartScreen from "./StartScreen";

function showProject(src: string | null) {
  // The page reads the query client-side. A history update needs no RSC navigation.
  window.history.replaceState(null, "", src ? `/?src=${encodeURIComponent(src)}` : "/");
}

export default function EditorShell() {
  const params = useSearchParams();
  const src = params.get("src");
  const [checkedLegacy, setCheckedLegacy] = useState<string | null>(null);
  const resume = params.get("resume") === "1";

  const resumeRequest = useRef<AbortController | null>(null);
  const [resumeIssue, setResumeIssue] = useState<ProjectLoadIssue>();

  useEffect(() => {
    if (!resume || src) return;
    const controller = new AbortController();
    resumeRequest.current = controller;
    void loadProjectCatalog("resume", controller.signal).then((result) => {
      if (controller.signal.aborted || result.status === "cancelled") return;
      if (result.status === "failed") setResumeIssue(result.issue);
      const recent = result.status === "loaded" ? result.data.lastOpenedSrc : null;
      if (result.status === "loaded" && !recent && result.warning) setResumeIssue(result.warning);
      showProject(recent);
    });
    return () => {
      controller.abort();
      if (resumeRequest.current === controller) resumeRequest.current = null;
    };
  }, [resume, src]);

  function skipResume() {
    resumeRequest.current?.abort();
    showProject(null);
  }

  useEffect(() => {
    if (!src || src.startsWith("managed:")) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROJECT_LOAD_TIMEOUT_MS);
    let cancelled = false;
    void (async () => {
      try {
        // Finish legacy adoption before chart/state requests start in EditorSession.
        await fetch("/api/projects", { signal: controller.signal });
        const response = await fetch(`/api/chart?src=${encodeURIComponent(src)}`, { signal: controller.signal });
        const chart = await response.json();
        if (cancelled) return;
        if (response.ok && typeof chart.path === "string" && chart.path.startsWith("managed:")) {
          showProject(chart.path);
          return;
        }
      } catch { /* The editor reports the concrete loading error. */ }
      finally { clearTimeout(timeout); }
      if (!cancelled) setCheckedLegacy(src);
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [src]);

  if (src && !src.startsWith("managed:") && checkedLegacy !== src) {
    return <div className="min-h-screen bg-parchment p-8 text-sm text-stone">正在载入工程副本…</div>;
  }

  if (resume && !src) {
    return (
      <div className="min-h-screen bg-parchment p-8 text-sm text-stone">
        <p role="status">正在恢复上次工程…</p>
        <button type="button" className="mt-3 rounded-lg bg-sand px-3 py-1.5 text-ink" onClick={skipResume}>
          进入工程列表
        </button>
      </div>
    );
  }

  if (!src) {
    return (
      <StartScreen
        resumeIssue={resumeIssue}
        onOpen={(s) => {
          setResumeIssue(undefined);
          showProject(s);
        }}
      />
    );
  }
  return (
    <EditorSession
      key={src}
      src={src}
      onExit={() => showProject(null)}
      onOpenSrc={showProject}
    />
  );
}
