import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import type { WorkingStateV1 } from "@/lib/persist-types";
import {
  applyHidden,
  dirOf,
  resolveLastOpenedSrc,
  shapePackageList,
  shapeProjectList,
  type ProjectAsset,
  managedSrc,
  parseManagedSrc,
} from "@/lib/projects";
import {
  ARTIFACTS_REL,
  findRepoRoot,
  IMPORTS_REL,
  listAssets,
  MC_EXTS,
  normalizeSrcRel,
  SOURCE_MC_REL,
  AUDIO_EXTS,
  COVER_EXTS,
} from "@/lib/server/paths";
import { PROJECT_MANIFEST, type ProjectManifestV1 } from "@/lib/server/imports";
import { readJsonIfExists, readRegistry, saveRegistry } from "@/lib/server/store";
import { isWritableRel } from "@/lib/writeback";
import { adoptLegacyHistory, isProtectedWda, openManagedPath, registerWorkspaceProject } from "@/lib/server/managed-projects";

export const dynamic = "force-dynamic";

/**
 * 工程列表。**一曲多包**:一个文件夹 = 一份歌曲 = 一个包,其中每个 `.mc` = 一张谱。
 * (旧实现用 `pickAsset` 的"恰好一个"语义,多谱文件夹会抛错并被整目录跳过。)
 * 同时保留扁平 `projects[]` 字段,老的启动页与既有测试不受影响。
 */
export async function GET(req: Request) {
  const root = findRepoRoot();
  const includeHidden = new URL(req.url).searchParams.get("includeHidden") === "1";
  // V2 imports are adopted in place into V3; files, states and snapshots remain untouched.
  const importsAbs = path.join(root, IMPORTS_REL);
  if (fs.existsSync(importsAbs)) {
    for (const sub of fs.readdirSync(importsAbs)) {
      const dirAbs = path.join(importsAbs, sub);
      if (!fs.statSync(dirAbs).isDirectory()) continue;
      const charts = listAssets(fs.readdirSync(dirAbs), MC_EXTS);
      if (!charts.length) continue;
      const manifest = readJsonIfExists<ProjectManifestV1>(path.join(dirAbs, PROJECT_MANIFEST));
      registerWorkspaceProject(
        `artifacts/arranger/imports/${sub}`,
        manifest?.schema === 1 && manifest.name ? manifest.name : sub,
        charts,
        { updateLastOpened: false },
      );
    }
  }
  const wdaDir = path.join(root, "WDA");
  if (fs.existsSync(wdaDir)) {
    for (const name of fs.readdirSync(wdaDir).filter((item) => item.toLowerCase().endsWith(".mcz"))) {
      try { await openManagedPath(path.join(wdaDir, name), { updateLastOpened: false }); }
      catch { /* invalid historical package stays invisible instead of breaking the start page */ }
    }
  }
  await adoptLegacyHistory();
  const registry = readRegistry();

  // ① 已有工作状态的谱面
  const states: Record<string, { updatedAt: string | null; assignedCount: number }> = {};
  const flatStates: { sourcePath: string; updatedAt: string | null; assignedCount: number }[] = [];
  const projectsDir = path.join(root, ARTIFACTS_REL, "projects");
  if (fs.existsSync(projectsDir)) {
    for (const sub of fs.readdirSync(projectsDir)) {
      const st = readJsonIfExists<WorkingStateV1>(path.join(projectsDir, sub, "state.json"));
      if (!st?.sourcePath) continue;
      if (!parseManagedSrc(st.sourcePath) && !normalizeSrcRel(st.sourcePath).ok) continue;
      const managed = parseManagedSrc(st.sourcePath);
      if (managed) {
        const p = registry.managedProjects.find((candidate) => candidate.id === managed.projectId);
        const c = p?.charts.find((candidate) => candidate.id === managed.chartId);
        if (!p || !c || !fs.existsSync(path.join(root, p.workspaceRel, c.fileName))) continue;
      } else if (registry.managedProjects.some((p) => p.charts.some((c) => c.legacySources?.includes(st.sourcePath)))) continue;
      const entry = {
        updatedAt: st.updatedAt ?? null,
        assignedCount: Object.keys(st.assignments ?? {}).length,
      };
      states[st.sourcePath] = entry;
      flatStates.push({ sourcePath: st.sourcePath, ...entry });
    }
  }

  // ② 文件夹集合:默认 WDA 目录 ∪ 所有导入包 ∪ 有状态的谱面所在目录
  const dirs = new Set<string>();
  if (SOURCE_MC_REL && fs.existsSync(path.join(root, SOURCE_MC_REL))) dirs.add(dirOf(SOURCE_MC_REL));
  for (const src of Object.keys(states)) if (!parseManagedSrc(src)) dirs.add(dirOf(src));

  const folders: {
    dir: string;
    title: string;
    isExample?: boolean;
    charts: { src: string; title: string; id?: string; name?: string; path?: string; missing?: boolean }[];
    audio: ProjectAsset | null;
    cover: ProjectAsset | null;
    canPurge: boolean;
    assetError: string | null;
    managed?: boolean;
    sourceKind?: "mc" | "mcz" | "workspace";
    sourcePath?: string | null;
  }[] = [];
  const importMcs: { src: string; title: string }[] = [];
  for (const dir of dirs) {
    const dirAbs = path.join(root, dir);
    const names = fs.existsSync(dirAbs) && fs.statSync(dirAbs).isDirectory() ? fs.readdirSync(dirAbs) : [];
    const historical = Object.keys(states).filter((src) => !parseManagedSrc(src) && dirOf(src) === dir)
      .map((src) => path.posix.basename(src));
    const mcNames = [...new Set([...listAssets(names, MC_EXTS), ...historical])];
    if (mcNames.length === 0) continue;
    const charts = mcNames.map((n) => ({
      missing: !fs.existsSync(path.join(dirAbs, n)),
      src: `${dir}/${n}`,
      title: n.replace(/\.mc$/i, ""),
    }));
    const manifest = readJsonIfExists<ProjectManifestV1>(path.join(dirAbs, PROJECT_MANIFEST));
    const asset = (matches: string[]): ProjectAsset | null => {
      if (matches.length !== 1) return null;
      return { path: `${dir}/${matches[0]}`, dir, name: matches[0] };
    };
    const audioNames = listAssets(names, AUDIO_EXTS);
    const coverNames = listAssets(names, COVER_EXTS);
    const errors: string[] = [];
    if (audioNames.length > 1) errors.push(`音频歧义: ${audioNames.join(", ")}`);
    if (coverNames.length > 1) errors.push(`封面歧义: ${coverNames.join(", ")}`);
    folders.push({
      dir,
      title: manifest?.schema === 1 && manifest.name ? manifest.name : (dir.split("/").pop() ?? dir),
      charts,
      audio: asset(audioNames),
      cover: asset(coverNames),
      canPurge: dir.startsWith(`${IMPORTS_REL.split(path.sep).join("/")}/`),
      assetError: errors.length ? errors.join("；") : null,
    });
    for (const c of charts) importMcs.push(c);
  }

  // ③ V3 受管工程：URL 只返回 managed:<project-id>:<chart-id>，绝不暴露绝对源路径。
  for (const project of registry.managedProjects) {
    const dirAbs = path.join(root, project.workspaceRel);
    if (!fs.existsSync(dirAbs)) continue;
    const names = fs.readdirSync(dirAbs);
    const audioNames = listAssets(names, AUDIO_EXTS);
    const coverNames = listAssets(names, COVER_EXTS);
    const asset = (matches: string[]): ProjectAsset | null => matches.length === 1
      ? { path: path.join(dirAbs, matches[0]), dir: dirAbs, name: matches[0] }
      : null;
    const errors: string[] = [];
    if (audioNames.length !== 1) errors.push(audioNames.length ? `音频歧义: ${audioNames.join(", ")}` : "缺少音频");
    if (coverNames.length !== 1) errors.push(coverNames.length ? `封面歧义: ${coverNames.join(", ")}` : "缺少封面");
    const isWda = (project.sourcePath && isProtectedWda(project.sourcePath)) || project.copyOnWrite || /wda/i.test(project.displayName);
    folders.push({
      dir: project.id,
      title: project.displayName,
      isExample: isWda,
      charts: project.charts.map((chart) => ({
        missing: !fs.existsSync(path.join(dirAbs, chart.fileName)),
        src: managedSrc(project.id, chart.id),
        title: chart.title,
        id: chart.id,
        name: chart.fileName,
        path: path.join(dirAbs, chart.fileName),
      })),
      audio: asset(audioNames),
      cover: asset(coverNames),
      canPurge: false,
      assetError: errors.length ? errors.join("；") : null,
      managed: true,
      sourceKind: project.sourceKind,
      sourcePath: project.sourcePath,
    });
    for (const chart of project.charts) {
      importMcs.push({ src: managedSrc(project.id, chart.id), title: chart.title });
    }
  }

  // 寻找活跃的 WDA 官方示例工程首张谱面作为首次打开时的默认项
  const wdaProject = registry.managedProjects.find((p) =>
    !registry.hiddenProjects.includes(p.id) && p.sourcePath && isProtectedWda(p.sourcePath)
  ) ?? registry.managedProjects.find((p) =>
    p.sourcePath && isProtectedWda(p.sourcePath)
  );
  if (wdaProject && registry.hiddenProjects.includes(wdaProject.id)) {
    registry.hiddenProjects = registry.hiddenProjects.filter((id) => id !== wdaProject.id);
  }
  const wdaDefaultSrc = wdaProject && wdaProject.charts.length > 0
    ? managedSrc(wdaProject.id, wdaProject.charts[0].id)
    : "";

  const defaultSrc = wdaDefaultSrc || (SOURCE_MC_REL && fs.existsSync(path.join(root, SOURCE_MC_REL))
    ? SOURCE_MC_REL
    : "");
  const all = shapePackageList({
    folders,
    states,
    hidden: registry.hiddenCharts,
    hiddenProjects: registry.hiddenProjects,
    defaultSrc,
  });
  const packages = includeHidden
    ? all
    : applyHidden(all, registry.hiddenCharts, registry.hiddenProjects);
  const visibleSrcs = new Set(
    applyHidden(all, registry.hiddenCharts, registry.hiddenProjects).flatMap((p) =>
      p.charts.map((c) => c.src),
    ),
  );
  const activeFlat = flatStates.filter((s) => visibleSrcs.has(s.sourcePath));
  const activeImports = importMcs.filter((c) => visibleSrcs.has(c.src));

  const lastOpenedSrc = resolveLastOpenedSrc(registry.lastOpenedSrc, all, defaultSrc);
  // 首次打开：若用户下载后从未打开过任何工程，将默认谱面记录为上次打开，后续启动恢复上次工程
  if (!registry.lastOpenedSrc && lastOpenedSrc) {
    registry.lastOpenedSrc = lastOpenedSrc;
    saveRegistry(registry);
  }

  return NextResponse.json(
    {
      projects: shapeProjectList({ states: activeFlat, importMcs: activeImports, defaultSrc })
        .filter((p) => visibleSrcs.has(p.src)),
      packages,
      hidden: registry.hiddenCharts,
      hiddenCharts: registry.hiddenCharts,
      hiddenProjects: registry.hiddenProjects,
      lastOpenedSrc,
      writableRoots: ["WDA", "artifacts"],
      defaultSrc,
      writable: Object.fromEntries(importMcs.map((c) => [c.src, parseManagedSrc(c.src) ? true : isWritableRel(c.src)])),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
