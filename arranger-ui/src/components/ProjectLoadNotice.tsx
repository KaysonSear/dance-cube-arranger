"use client";

import { useState } from "react";

import type { ProjectLoadCode, ProjectLoadIssue } from "@/lib/project-catalog";
import { APP_VERSION } from "@/lib/version";

const reasons: Record<ProjectLoadCode, string> = {
  REQUEST_TIMEOUT: "等待本机服务响应超时",
  NETWORK_ERROR: "无法连接本机服务",
  HTTP_ERROR: "本机服务返回错误",
  INVALID_RESPONSE: "本机服务返回了无效的工程数据",
  WDA_IMPORT_FAILED: "WDA 示例工程导入失败",
};

export default function ProjectLoadNotice({ issue }: { issue: ProjectLoadIssue }) {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const phase = issue.stage === "resume" ? "恢复上次工程" : "加载工程列表";
  const message = issue.code === "WDA_IMPORT_FAILED"
    ? reasons[issue.code]
    : `${phase}失败：${reasons[issue.code]}`;
  const details = [
    `版本 v${APP_VERSION}`,
    `阶段 ${phase}`,
    `错误码 ${issue.code}`,
    `HTTP 状态 ${issue.status ?? "未收到响应"}`,
    `耗时 ${issue.elapsedMs} ms`,
  ].join("\n");

  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(details);
      setCopyStatus("已复制");
    } catch {
      setCopyStatus("可展开诊断信息并手动复制");
    }
  }

  return (
    <div className="rounded-lg bg-err-wash p-3 text-xs text-err">
      <p role="status">{message}</p>
      <div className="mt-2 flex flex-wrap items-start gap-3">
        <button type="button" className="underline" onClick={() => void copyDetails()}>
          复制诊断信息
        </button>
        {copyStatus && <span role="status">{copyStatus}</span>}
        <details>
          <summary className="cursor-pointer">诊断信息</summary>
          <pre className="mt-1 whitespace-pre-wrap">{details}</pre>
        </details>
      </div>
    </div>
  );
}
