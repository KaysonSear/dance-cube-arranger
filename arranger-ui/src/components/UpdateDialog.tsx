"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { APP_VERSION, type UpdateInfo } from "@/lib/version";
import ProjectLoadNotice from "./ProjectLoadNotice";

export interface UpdateDialogProps {
  open: boolean;
  onClose(): void;
  updateInfo: UpdateInfo | null;
  loading?: boolean;
  error?: string | null;
  onCheckAgain?(): void;
}

type UpdateStage = "idle" | "downloading" | "extracting" | "ready" | "applying" | "restarting" | "error";

interface UpgradeProgress {
  stage: UpdateStage;
  percent: number;
  message: string;
  error?: string;
  code?: string;
  diagnosticId?: string;
}

export default function UpdateDialog({
  open,
  onClose,
  updateInfo,
  loading = false,
  error = null,
  onCheckAgain,
}: UpdateDialogProps) {
  const [progress, setProgress] = useState<UpgradeProgress>({
    stage: "idle",
    percent: 0,
    message: "",
  });
  const [isRestarting, setIsRestarting] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);

  const handleClose = useCallback(() => {
    requestRef.current?.abort();
    setProgress({ stage: "idle", percent: 0, message: "" });
    setIsRestarting(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && progress.stage !== "downloading" && progress.stage !== "extracting" && !isRestarting) {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, progress.stage, isRestarting, handleClose]);

  if (!open) return null;

  const handleAutoUpgrade = async () => {
    if (!updateInfo || requestRef.current) return;
    const operation = new AbortController();
    requestRef.current = operation;
    const started = performance.now();
    const version = updateInfo.latestVersion.replace(/^v/i, "");
    const boundedFetch = (url: string, init?: RequestInit) =>
      fetch(url, { ...init, signal: AbortSignal.any([operation.signal, AbortSignal.timeout(4500)]) });
    const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    setProgress({ stage: "downloading", percent: 0, message: "正在发起更新任务" });

    try {
      const res = await boundedFetch("/api/update/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          downloadUrl: updateInfo.downloadUrl,
          targetVersion: updateInfo.latestVersion,
          mock: updateInfo.downloadUrl?.includes("mock") || false,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setProgress({ stage: "error", message: "更新失败", percent: 0, error: data.error, code: data.code, diagnosticId: data.diagnosticId });
        return;
      }
      let failedPolls = 0;
      while (!operation.signal.aborted && performance.now() - started < 32 * 60_000) {
        await pause(600);
        try {
          const reply = await boundedFetch("/api/update/apply");
          if (!reply.ok) throw new Error(`HTTP ${reply.status}`);
          const { status } = await reply.json() as { status: UpgradeProgress };
          if (operation.signal.aborted) return;
          setProgress(status);
          if (status.stage === "error") return;
          if (status.stage === "applying") break;
          failedPolls = 0;
        } catch {
          if (++failedPolls >= 3) break;
        }
      }
      if (operation.signal.aborted) return;
      setIsRestarting(true);
      const restartDeadline = performance.now() + 120_000;
      while (!operation.signal.aborted && performance.now() < restartDeadline) {
        await pause(1000);
        try {
          const reply = await boundedFetch("/api/health");
          if (!reply.ok) continue;
          const health = await reply.json() as { version?: string };
          if (health.version === version) { window.location.reload(); return; }
          const stateReply = await boundedFetch("/api/update/apply");
          if (!stateReply.ok) continue;
          const { status } = await stateReply.json() as { status: UpgradeProgress };
          if (status.stage === "error") { setProgress(status); return; }
        } catch { /* Server is between processes. */ }
      }
      if (!operation.signal.aborted) {
        setProgress({ stage: "error", percent: 0, code: "UPDATE_RESTART_TIMEOUT",
          message: "更新未确认", error: "请查看 editor-update.log，或下载 ZIP 手动更新" });
      }
    } catch {
      if (!operation.signal.aborted) setProgress({ stage: "error", percent: 0, code: "UPDATE_CONNECTION_FAILED",
        message: "更新失败", error: "无法连接更新服务，请重试或下载 ZIP 手动更新" });
    } finally {
      if (requestRef.current === operation) requestRef.current = null;
      if (!operation.signal.aborted) setIsRestarting(false);
    }
  };

  const hasUpdate = updateInfo?.hasUpdate ?? false;
  const isUpgrading = progress.stage === "downloading" || progress.stage === "extracting" || progress.stage === "ready" || isRestarting;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (!isUpgrading && e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="relative flex w-full max-w-lg flex-col rounded-2xl border border-cream bg-ivory shadow-2xl overflow-hidden">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between border-b border-cream bg-parchment/60 px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">{hasUpdate ? "🚀" : "✨"}</span>
            <div>
              <h2 className="text-sm font-bold text-ink" id="update-dialog-title">
                {isRestarting ? "正在重启服务..." : hasUpdate ? "发现新版本可用" : "软件版本信息"}
              </h2>
              <p className="text-[11px] text-stone">
                当前版本：v{updateInfo?.currentVersion ?? APP_VERSION}
              </p>
            </div>
          </div>
          {!isUpgrading && (
            <button
              type="button"
              onClick={handleClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-stone hover:bg-sand hover:text-ink transition-colors cursor-pointer"
              aria-label="关闭更新窗口"
            >
              ✕
            </button>
          )}
        </div>

        {/* 内容主体 */}
        <div className="max-h-[65vh] overflow-y-auto p-6 space-y-4 text-xs text-charcoal">
          {/* 升级进行中的进度视图 */}
          {isUpgrading && (
            <div className="space-y-4 py-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-ink flex items-center gap-2">
                  <span className="animate-spin text-base">⏳</span>
                  <span>{progress.message || "正在升级中..."}</span>
                </span>
                <span className="font-mono font-bold text-clay">{progress.percent}%</span>
              </div>

              {/* 进度条 */}
              <div className="h-2 w-full overflow-hidden rounded-full bg-sand">
                <div
                  className="h-full rounded-full bg-clay transition-all duration-300 ease-out"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>

              {isRestarting ? (
                <div className="rounded-xl border border-coral/30 bg-warn-wash p-3.5 text-center space-y-1 animate-pulse">
                  <div className="text-sm font-bold text-ink">正在确认新版服务是否就绪</div>
                  <p className="text-[11px] text-stone">
                    浏览器已在自动探活重连，页面将自动刷新，请勿关闭浏览器窗口。
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-cream bg-parchment/60 p-3 text-[11px] text-stone space-y-1">
                  <p>💡 <b>全自动无缝升级中：</b></p>
                  <p>• 下载并校验官方便携包；</p>
                  <p>• 自动保护您的 <code className="font-mono text-ink">artifacts/</code> 目录（历史工程与排键数据 100% 保留）；</p>
                  <p>• 升级完成后自动重新拉起服务并刷新页面。</p>
                </div>
              )}
            </div>
          )}

          {!isUpgrading && loading && (
            <div className="flex flex-col items-center justify-center py-8 text-stone space-y-2">
              <span className="animate-spin text-2xl">⏳</span>
              <p>正在连接 GitHub 检查最新发布版本…</p>
            </div>
          )}

          {!isUpgrading && !loading && (error || progress.stage === "error") && (
            <div className="rounded-xl bg-err-wash p-4 text-err space-y-2">
              <div className="font-semibold flex items-center gap-1.5">
                <span>⚠</span>
                <span>{progress.error ? "自动升级出错" : "无法连接更新服务器"}</span>
              </div>
              <ProjectLoadNotice issue={{
                stage: "update", code: "NETWORK_ERROR", detailCode: progress.code ?? "UPDATE_CHECK_FAILED",
                diagnosticId: progress.diagnosticId, status: null, elapsedMs: 0,
              }} reason={progress.error || error || "请重试或手动更新"} />
              <p className="text-[11px] text-stone">
                提示：若自动升级因网络或代理受限，可选择“前往 GitHub 下载”手动获取便携压缩包。
              </p>
            </div>
          )}

          {!isUpgrading && !loading && !error && updateInfo && progress.stage !== "error" && (
            <>
              {hasUpdate ? (
                <div className="rounded-xl border border-coral/30 bg-warn-wash/60 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 rounded-full bg-clay px-2.5 py-0.5 text-[11px] font-semibold text-white">
                      NEW v{updateInfo.latestVersion}
                    </span>
                    {updateInfo.publishedAt && (
                      <span className="text-[10px] text-stone">
                        发布于 {new Date(updateInfo.publishedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold text-ink text-sm">
                    {updateInfo.releaseName}
                  </h3>
                </div>
              ) : (
                <div className="rounded-xl border border-cream bg-ok-wash/60 p-4 text-center space-y-1">
                  <div className="text-base font-semibold text-ok-ink">
                    ✔ 当前已是最新版本 (v{updateInfo.currentVersion})
                  </div>
                  <p className="text-[11px] text-stone">
                    没有检测到更高版本，您可以放心使用。
                  </p>
                </div>
              )}

              {/* 更新日志详情 */}
              {hasUpdate && updateInfo.releaseNotes && (
                <div className="space-y-1.5">
                  <h4 className="font-semibold text-ink text-[11px]">更新内容说明：</h4>
                  <div className="rounded-xl border border-cream bg-white p-3 font-mono text-[11px] leading-relaxed text-charcoal whitespace-pre-wrap max-h-40 overflow-y-auto">
                    {updateInfo.releaseNotes}
                  </div>
                </div>
              )}

              {/* 懒人无缝升级提示 */}
              {hasUpdate && (
                <div className="rounded-xl border border-coral/20 bg-parchment/60 p-3 text-[11px] space-y-1 text-olive">
                  <div className="font-semibold text-ink flex items-center gap-1">
                    <span>⚡</span>
                    <span>无需任何手动操作</span>
                  </div>
                  <p className="leading-relaxed">
                    点击下方<b>【一键全自动升级】</b>，系统将自动在后台下载最新版本、保护并继承现有全部谱面工程，随后自动重启并刷新页面！
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* 底部按钮栏 */}
        <div className="flex items-center justify-between border-t border-cream bg-parchment/40 px-6 py-3">
          <div>
            {!isUpgrading && onCheckAgain && (
              <button
                type="button"
                disabled={loading}
                onClick={onCheckAgain}
                className="rounded-lg bg-sand px-3 py-1.5 text-xs text-charcoal shadow-ring hover:bg-sand-deep transition-colors disabled:opacity-40 cursor-pointer"
              >
                {loading ? "检查中…" : "重新检查"}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isUpgrading && hasUpdate && (
              <button
                type="button"
                onClick={() => void handleAutoUpgrade()}
                className="rounded-xl bg-clay px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-coral transition-colors flex items-center gap-1.5 cursor-pointer shadow-ring-focus"
              >
                <span>⚡ 一键全自动升级</span>
              </button>
            )}

            {!isUpgrading && hasUpdate && updateInfo?.htmlUrl && (
              <a
                href={updateInfo.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-cream bg-white px-3 py-1.5 text-xs text-stone hover:text-ink hover:bg-sand transition-colors flex items-center gap-1 cursor-pointer"
                title="手动在 GitHub 页面下载"
              >
                <span>前往 GitHub</span>
                <span>↗</span>
              </a>
            )}

            {!isUpgrading && (
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-cream bg-white px-3 py-1.5 text-xs text-stone hover:text-ink hover:bg-sand transition-colors cursor-pointer"
              >
                关闭
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
