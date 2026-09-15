import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { addHidden, dirOf, parseManagedSrc, removeHidden } from "@/lib/projects";
import {
  findRepoRoot,
  normalizeSrcRel,
  projectKey,
} from "@/lib/server/paths";
import {
  listProjectCharts,
  purgeChartFiles,
  purgeProjectFiles,
  resolveImportProject,
} from "@/lib/server/project-files";
import { projectDir, readRegistry, saveRegistry } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/**
 * 工程/谱面条目管理。普通删除只更新注册表；物理删除只允许 imports/<slug>/。
 */
export async function POST(req: Request) {
  let body: { scope?: unknown; target?: unknown; action?: unknown };
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
      : fs.existsSync(path.join(findRepoRoot(), chartRel));
    if (!exists) return NextResponse.json({ ok: false, error: "谱面不存在" }, { status: 404 });
    const saved = saveRegistry({ ...registry, lastOpenedSrc: chartRel });
    return NextResponse.json({ ok: true, lastOpenedSrc: saved.lastOpenedSrc });
  }

  if (action === "hide" || action === "unhide") {
    const key = chartRel ?? projectRel;
    const current = scope === "chart" ? registry.hiddenCharts : registry.hiddenProjects;
    const next = action === "hide" ? addHidden(current, key) : removeHidden(current, key);
    const saved = saveRegistry({
      ...registry,
      ...(scope === "chart" ? { hiddenCharts: next } : { hiddenProjects: next }),
    });
    return NextResponse.json({ ok: true, registry: saved });
  }

  if (action !== "purge") {
    return NextResponse.json({ ok: false, error: "未知 action" }, { status: 400 });
  }

  if (parseManagedSrc(chartRel ?? "") || registry.managedProjects.some((p) => p.id === projectRel)) {
    return NextResponse.json({ ok: false, error: "受管工程只能从历史隐藏；不会删除外部原文件" }, { status: 403 });
  }

  const root = findRepoRoot();
  const projectAbs = resolveImportProject(root, projectRel);
  if (!projectAbs) {
    return NextResponse.json(
      { ok: false, error: "内置或非导入工程只能从历史删除，不能彻底删除" },
      { status: 403 },
    );
  }
  if (!fs.existsSync(projectAbs) || !fs.statSync(projectAbs).isDirectory()) {
    return NextResponse.json({ ok: false, error: "工程不存在" }, { status: 404 });
  }

  let deleted: string[] = [];
  const chartSrcs = listProjectCharts(root, projectRel);

  if (scope === "project") {
    for (const src of chartSrcs) {
      fs.rmSync(projectDir(projectKey(src)), { recursive: true, force: true });
    }
    deleted = purgeProjectFiles(root, projectRel);
  } else if (chartRel) {
    const result = purgeChartFiles(root, chartRel);
    deleted = result.deleted;
    fs.rmSync(projectDir(projectKey(chartRel)), { recursive: true, force: true });
  }

  const removedSrcs = scope === "project" ? chartSrcs : chartRel ? [chartRel] : [];
  const saved = saveRegistry({
    ...registry,
    hiddenProjects: removeHidden(registry.hiddenProjects, projectRel),
    hiddenCharts: registry.hiddenCharts.filter((src) => !removedSrcs.includes(src)),
    lastOpenedSrc: removedSrcs.includes(registry.lastOpenedSrc ?? "")
      ? null
      : registry.lastOpenedSrc,
  });
  return NextResponse.json({ ok: true, deleted, registry: saved });
}
