"use client";

/**
 * 薄壳:URL 即真相 —— `?src=<仓库相对 .mc 路径>` 决定当前工程;无 src 显示启动页
 * (工程列表 + 导入)。`key={src}` 重挂载 EditorSession = 工程间状态零残留;F5 保持工程。
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import EditorSession from "./EditorSession";
import StartScreen from "./StartScreen";

export default function EditorShell() {
  const params = useSearchParams();
  const router = useRouter();
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
        if (data.lastOpenedSrc) {
          router.replace(`/?src=${encodeURIComponent(data.lastOpenedSrc)}`);
        } else {
          router.replace("/");
        }
      } catch {
        if (!cancelled) {
          router.replace("/");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resume, router, src]);

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
          router.replace(`/?src=${encodeURIComponent(chart.path)}`);
          return;
        }
      } catch { /* The editor reports the concrete loading error. */ }
      if (!cancelled) setCheckedLegacy(src);
    })();
    return () => { cancelled = true; };
  }, [src, router]);

  if (src && !src.startsWith("managed:") && checkedLegacy !== src) {
    return <div className="min-h-screen bg-parchment p-8 text-sm text-stone">正在载入工程副本…</div>;
  }

  if (resume && !src) {
    return <div className="min-h-screen bg-parchment p-8 text-sm text-stone">正在恢复上次工程…</div>;
  }

  if (!src) {
    return <StartScreen onOpen={(s) => router.replace(`/?src=${encodeURIComponent(s)}`)} />;
  }
  return (
    <EditorSession
      key={src}
      src={src}
      onExit={() => router.replace("/")}
      onOpenSrc={(s) => router.replace(`/?src=${encodeURIComponent(s)}`)}
    />
  );
}
