import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { addHidden, dirOf, parseManagedSrc, removeHidden } from "@/lib/projects";
import {
  findRepoRoot,
  normalizeSrcRel,
} from "@/lib/server/paths";
import { isLocalRequest } from "@/lib/server/local-request";
import { purgeEntry } from "@/lib/server/project-purge";
import { readRegistry, saveRegistry } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/**
 * 工程/谱面条目管理。普通删除只更新注册表；物理删除使用服务端生成的确认清单。
 */
export async function POST(req: Request) {
  if (!isLocalRequest(req)) return NextResponse.json({ ok: false, error: "仅支持本地请求" }, { status: 403 });
  let body: { scope?: unknown; target?: unknown; action?: unknown; token?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const scope = String(body.scope ?? "chart");
  const action = String(body.action ?? "");
  if (scope !== "chart" && scope !== "project") {
    return NextResponse.json({ ok: false, error: "未知 scope" }, { status: 400 });
  }

  const rawTarget = String(body.target ?? "");
  let chartRel: string | null = null;
  let projectRel: string;
  if (scope === "chart") {
    const managed = parseManagedSrc(rawTarget);
    if (managed) {
      chartRel = rawTarget;
      projectRel = managed.projectId;
    } else {
      const n = normalizeSrcRel(rawTarget);
      if (!n.ok) return NextResponse.json({ ok: false, error: n.error }, { status: 400 });
      chartRel = n.rel;
      projectRel = dirOf(chartRel);
    }
  } else {
    if (!rawTarget || rawTarget.includes("\\") || path.posix.isAbsolute(rawTarget)) {
      return NextResponse.json({ ok: false, error: "工程路径不合法" }, { status: 400 });
    }
    projectRel = path.posix.normalize(rawTarget);
    if (projectRel === ".." || projectRel.startsWith("../") || projectRel === ".") {
      return NextResponse.json({ ok: false, error: "工程路径越界" }, { status: 400 });
    }
  }

  const registry = readRegistry();

  if (action === "touch") {
    if (!chartRel) return NextResponse.json({ ok: false, error: "touch 仅支持谱面" }, { status: 400 });
    const managed = parseManagedSrc(chartRel);
    const exists = managed
      ? registry.managedProjects.some((p) => p.id === managed.projectId && p.charts.some((c) => c.id === managed.chartId))
      : fs.existsSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ findRepoRoot(), chartRel));
    if (!exists) return NextResponse.json({ ok: false, error: "谱面不存在" }, { status: 404 });
    const saved = saveRegistry({ ...registry, lastOpenedSrc: chartRel });
    return NextResponse.json({ ok: true, lastOpenedSrc: saved.lastOpenedSrc });
  }

  if (action === "hide" || action === "unhide") {
    const key = chartRel ?? projectRel;
    const current = scope === "chart" ? registry.hiddenCharts : registry.hiddenProjects;
    const next = action === "hide" ? addHidden(current, key) : removeHidden(current, key);
    const last = registry.lastOpenedSrc;
    const lastProject = last && (parseManagedSrc(last)?.projectId ?? dirOf(last));
    const clearLast = action === "hide" && (chartRel ? chartRel === last : projectRel === lastProject);
    const saved = saveRegistry({
      ...registry, lastOpenedSrc: clearLast ? null : last,
      ...(scope === "chart" ? { hiddenCharts: next } : { hiddenProjects: next }),
    });
    return NextResponse.json({ ok: true, registry: saved });
  }

  if (action !== "purge" && action !== "preview-purge") {
    return NextResponse.json({ ok: false, error: "未知 action" }, { status: 400 });
  }
  if (action === "purge" && typeof body.token !== "string") {
    return NextResponse.json({ ok: false, error: "请先确认删除清单" }, { status: 409 });
  }
  try {
    const plan = purgeEntry(registry, projectRel, chartRel, action === "purge" ? String(body.token) : undefined);
    return NextResponse.json({ ok: true, ...plan });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 409 });
  }
}
