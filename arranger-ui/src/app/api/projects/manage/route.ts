import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { NextResponse } from "next/server";

import { normalizeFileName, validateUniqueChartNames } from "@/lib/project-names";
import { managedSrc } from "@/lib/projects";
import { fingerprintFile, normalizeAbsolutePath } from "@/lib/server/managed-projects";
import { discoverAssetsIn, findRepoRoot, resolvePythonCommand, resolveSrc } from "@/lib/server/paths";
import { readRegistry, saveRegistry, writeJsonAtomic } from "@/lib/server/store";

export const dynamic = "force-dynamic";
const BRIDGE_TIMEOUT_MS = 180_000;

function relocateFile(source: string, target: string, keepSource: boolean): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  try {
    fs.copyFileSync(source, temp, fs.constants.COPYFILE_EXCL);
    fs.renameSync(temp, target);
    if (!keepSource) fs.unlinkSync(source);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  }
}

function repackageWorkspace(workspace: string, chartNames: string[], target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let assets: ReturnType<typeof discoverAssetsIn>;
    try { assets = discoverAssetsIn(workspace); }
    catch (error) { reject(error); return; }
    if (!assets.audioPath || !assets.coverPath) {
      reject(new Error("工程必须恰好包含一份音频和一份封面"));
      return;
    }
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "arranger-manage-"));
    const manifest = path.join(tempDir, "manifest.json");
    writeJsonAtomic(manifest, {
      charts: chartNames.map((name) => ({ path: path.join(workspace, name), name })),
      audio: assets.audioPath,
      cover: assets.coverPath,
      out: target,
    });
    const root = findRepoRoot();
    const child = spawn(
      resolvePythonCommand(root),
      [path.join(root, "scripts", "export_arranged_mcz.py"), "--manifest", manifest],
      { cwd: root, windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fs.rmSync(tempDir, { recursive: true, force: true });
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("MCZ 打包超时"));
    }, BRIDGE_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (error) => { finish(error); });
    child.on("close", (code) => {
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
      let report: Record<string, unknown> = {};
      try { report = JSON.parse(line); } catch { /* handled below */ }
      if (code === 0 && report.ok) finish();
      else finish(new Error(String(report.error ?? stderr.slice(-1000) ?? `打包退出码 ${code}`)));
    });
  });
}

export async function POST(req: Request) {
  const sr = resolveSrc(req);
  if (!sr.ok) return NextResponse.json({ ok: false, error: sr.error }, { status: sr.status });
  if (!sr.managed) {
    return NextResponse.json({ ok: false, error: "旧工程请先从绝对路径重新打开" }, { status: 409 });
  }
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "请求 JSON 无效" }, { status: 400 }); }

  const registry = readRegistry();
  const project = registry.managedProjects.find((candidate) => candidate.id === sr.managed?.projectId);
  if (!project) return NextResponse.json({ ok: false, error: "找不到工程" }, { status: 404 });
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : project.displayName;
  if (!displayName || /[\u0000-\u001f]/u.test(displayName)) {
    return NextResponse.json({ ok: false, error: "工程显示名无效" }, { status: 400 });
  }

  const map = body.chartNames && typeof body.chartNames === "object"
    ? body.chartNames as Record<string, unknown>
    : {};
  const sourceDirInput = body.sourceDir;
  const sourceNameInput = body.sourceName;
  const desired = project.charts.map((chart) => map[chart.id] ?? map[managedSrc(project.id, chart.id)] ?? chart.fileName);
  const checkedCharts = validateUniqueChartNames(desired);
  if (!checkedCharts.ok) return NextResponse.json({ ok: false, error: checkedCharts.error }, { status: 400 });
  if (project.sourceKind === "mc" && project.charts.length === 1) {
    const synchronized = normalizeFileName(sourceNameInput ?? checkedCharts.names[0], ".mc");
    if (!synchronized.ok) return NextResponse.json({ ok: false, error: synchronized.error }, { status: 400 });
    checkedCharts.names[0] = synchronized.name;
  }

  let newSource = project.sourcePath;
  const requestedSourceName = sourceNameInput ?? (
    project.sourceKind === "mc" && checkedCharts.names[0] !== project.charts[0]?.fileName
      ? checkedCharts.names[0]
      : null
  );
  if (sourceDirInput != null || requestedSourceName != null) {
    if (!project.sourcePath || project.sourceKind === "workspace") {
      return NextResponse.json({ ok: false, error: "该工程没有可移动的外部原文件" }, { status: 409 });
    }
    const dirResult = normalizeAbsolutePath(sourceDirInput ?? path.dirname(project.sourcePath));
    if (!dirResult.ok) return NextResponse.json({ ok: false, error: dirResult.error }, { status: 400 });
    if (!fs.existsSync(dirResult.path) || !fs.statSync(dirResult.path).isDirectory()) {
      return NextResponse.json({ ok: false, error: `目标目录不存在: ${dirResult.path}` }, { status: 422 });
    }
    const ext = project.sourceKind === "mcz" ? ".mcz" : ".mc";
    const nameResult = normalizeFileName(requestedSourceName ?? path.basename(project.sourcePath), ext);
    if (!nameResult.ok) return NextResponse.json({ ok: false, error: nameResult.error }, { status: 400 });
    newSource = path.join(dirResult.path, nameResult.name);
    if (path.resolve(newSource).toLocaleLowerCase("en-US") !== path.resolve(project.sourcePath).toLocaleLowerCase("en-US") && fs.existsSync(newSource)) {
      return NextResponse.json({ ok: false, conflict: true, error: `目标已存在: ${newSource}` }, { status: 409 });
    }
  }

  const workspace = path.join(findRepoRoot(), project.workspaceRel);
  const renamePairs = project.charts
    .map((chart, index) => ({ chart, from: chart.fileName, to: checkedCharts.names[index] }))
    .filter((pair) => pair.from !== pair.to);
  const staged: { temp: string; target: string; original: string }[] = [];
  const movedAssets: { from: string; to: string; keptSource: boolean }[] = [];
  let sourceMoved = false;
  try {
    if (newSource && project.sourcePath && path.resolve(newSource).toLocaleLowerCase("en-US") !== path.resolve(project.sourcePath).toLocaleLowerCase("en-US")) {
      if (!project.copyOnWrite) {
        const actual = fingerprintFile(project.sourcePath);
        if (project.sourceFingerprint && actual !== project.sourceFingerprint) {
          return NextResponse.json({ ok: false, conflict: true, error: "原文件已被其他程序修改" }, { status: 409 });
        }
      }
      if (project.sourceKind === "mc") {
        const assetMoves = Object.values(project.sourceAssets ?? {}).flatMap((record) => {
          if (!record) return [];
          const from = path.join(path.dirname(project.sourcePath!), record.fileName);
          const to = path.join(path.dirname(newSource!), record.fileName);
          return fs.existsSync(from) && path.resolve(from).toLocaleLowerCase("en-US") !== path.resolve(to).toLocaleLowerCase("en-US")
            ? [{ from, to }]
            : [];
        });
        const conflict = assetMoves.find(({ from, to }) => fs.existsSync(to) && fingerprintFile(to) !== fingerprintFile(from));
        if (conflict) {
          return NextResponse.json({ ok: false, conflict: true, error: `目标素材已存在: ${conflict.to}` }, { status: 409 });
        }
        for (const { from, to } of assetMoves) {
          if (fs.existsSync(to)) continue;
          relocateFile(from, to, project.copyOnWrite);
          movedAssets.push({ from, to, keptSource: project.copyOnWrite });
        }
      }
      relocateFile(project.sourcePath, newSource, project.copyOnWrite);
      sourceMoved = true;
    }
    for (const [index, pair] of renamePairs.entries()) {
      const original = path.join(workspace, pair.from);
      const temp = path.join(workspace, `.rename-${process.pid}-${index}.tmp`);
      fs.renameSync(original, temp);
      staged.push({ temp, target: path.join(workspace, pair.to), original });
    }
    for (const item of staged) fs.renameSync(item.temp, item.target);
    if (project.sourceKind === "mcz" && newSource) {
      await repackageWorkspace(workspace, checkedCharts.names, newSource);
    }
  } catch (error) {
    for (const item of [...staged].reverse()) {
      const current = fs.existsSync(item.target) ? item.target : item.temp;
      if (fs.existsSync(current) && !fs.existsSync(item.original)) fs.renameSync(current, item.original);
    }
    for (const asset of [...movedAssets].reverse()) {
      try {
        if (asset.keptSource) fs.rmSync(asset.to, { force: true });
        else if (fs.existsSync(asset.to) && !fs.existsSync(asset.from)) relocateFile(asset.to, asset.from, false);
      } catch { /* retain recoverable copy for manual recovery */ }
    }
    if (sourceMoved && newSource && project.sourcePath && !project.copyOnWrite && fs.existsSync(newSource) && !fs.existsSync(project.sourcePath)) {
      try { relocateFile(newSource, project.sourcePath, false); } catch { /* retain both paths for manual recovery */ }
    }
    return NextResponse.json({ ok: false, error: `管理操作已回滚: ${(error as Error).message}` }, { status: 422 });
  }

  renamePairs.forEach((pair) => { pair.chart.fileName = pair.to; pair.chart.title = pair.to.replace(/\.mc$/i, ""); });
  project.displayName = displayName;
  if (newSource) project.sourcePath = newSource;
  if (sourceMoved || project.copyOnWrite) project.copyOnWrite = false;
  if (project.sourcePath && fs.existsSync(project.sourcePath)) project.sourceFingerprint = fingerprintFile(project.sourcePath);
  project.updatedAt = new Date().toISOString();
  saveRegistry(registry);
  return NextResponse.json({ ok: true, src: sr.rel, projectId: project.id });
}
