import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { assignmentsFromJson, buildExportNotes, buildOnsets, mergeOnsets } from "@/lib/arrangement";
import { buildArrangedMc, parseMc } from "@/lib/mc";
import { managedSrc, type ManagedProjectRecord } from "@/lib/projects";
import { fingerprintFile } from "@/lib/server/managed-projects";
import { discoverAssetsIn, findRepoRoot, resolvePythonCommand, resolveSrc } from "@/lib/server/paths";
import { readRegistry, readState, saveRegistry, writeJsonAtomic } from "@/lib/server/store";
import { validateArrangedMcText } from "@/lib/server/validate-mc";

export const dynamic = "force-dynamic";

function atomicWrite(file: string, data: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try { fs.writeFileSync(temp, data); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.rmSync(temp, { force: true }); }
}

type BareAsset = { kind: "audio" | "cover"; source: string; target: string; data: Buffer };

function bareAssets(projectDir: string, mcTarget: string): BareAsset[] {
  const assets = discoverAssetsIn(projectDir);
  return ([
    ["audio", assets.audioPath],
    ["cover", assets.coverPath],
  ] as const).flatMap(([kind, source]) => source ? [{
    kind,
    source,
    target: path.join(path.dirname(mcTarget), path.basename(source)),
    data: fs.readFileSync(source),
  }] : []);
}

function conflictingBareAssets(project: ManagedProjectRecord, assets: BareAsset[]): string[] {
  return assets.flatMap((asset) => {
    if (!fs.existsSync(asset.target)) return [];
    const incoming = `sha256:${crypto.createHash("sha256").update(asset.data).digest("hex")}`;
    const actual = fingerprintFile(asset.target);
    if (actual === incoming) return [];
    const known = project.sourceAssets?.[asset.kind];
    return known?.fileName === path.basename(asset.target) && known.fingerprint === actual
      ? []
      : [asset.target];
  });
}

function syncBareMc(
  project: ManagedProjectRecord,
  target: string,
  mcText: string,
  overwriteAssets: boolean,
): { conflicts: string[]; sourceAssets: ManagedProjectRecord["sourceAssets"] } {
  const assets = bareAssets(path.join(findRepoRoot(), project.workspaceRel), target);
  const conflicts = conflictingBareAssets(project, assets);
  if (conflicts.length && !overwriteAssets) return { conflicts, sourceAssets: project.sourceAssets };
  const originals = new Map<string, Buffer | null>();
  for (const file of [target, ...assets.map((asset) => asset.target)]) {
    originals.set(file, fs.existsSync(file) ? fs.readFileSync(file) : null);
  }
  try {
    for (const asset of assets) {
      if (fs.existsSync(asset.target)) {
        const backup = `${asset.target}.orig`;
        if (!fs.existsSync(backup)) fs.copyFileSync(asset.target, backup);
      }
      atomicWrite(asset.target, asset.data);
    }
    atomicWrite(target, mcText);
  } catch (error) {
    for (const [file, data] of originals) {
      if (data) atomicWrite(file, data);
      else fs.rmSync(file, { force: true });
    }
    throw error;
  }
  const sourceAssets: ManagedProjectRecord["sourceAssets"] = {};
  for (const asset of assets) {
    sourceAssets![asset.kind] = {
      fileName: path.basename(asset.target),
      fingerprint: fingerprintFile(asset.target),
    };
  }
  return { conflicts: [], sourceAssets };
}

function materializeSavedState(src: string, file: string): void {
  const key = crypto.createHash("sha1").update(src).digest("hex").slice(0, 16);
  const state = readState(key);
  if (!state) return;
  const parsed = parseMc(fs.readFileSync(file, "utf-8"));
  const rawOnsets = mergeOnsets(buildOnsets(parsed.gameplay), state.addedOnsets ?? []);
  const deletedSet = new Set(state.deletedOnsetIds ?? []);
  const onsets = rawOnsets.filter((o) => !deletedSet.has(o.id));
  const built = buildExportNotes(onsets, assignmentsFromJson(state.assignments, onsets));
  atomicWrite(file, buildArrangedMc(parsed, built.notes, {
    bpm: state.ui.bpmOverride,
    offsetMs: state.ui.offsetOverride,
  }));
}

function uniqueManagedCopy(root: string, name: string): string {
  const dir = path.join(root, "artifacts", "arranger", "managed");
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let target = path.join(dir, name);
  for (let index = 2; fs.existsSync(target); index += 1) target = path.join(dir, `${stem}-${index}${ext}`);
  return target;
}

function packageWorkspace(projectDir: string, names: string[], target: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let assets: ReturnType<typeof discoverAssetsIn>;
    try { assets = discoverAssetsIn(projectDir); }
    catch (error) { resolve({ ok: false, error: (error as Error).message }); return; }
    if (!assets.audioPath || !assets.coverPath) {
      resolve({ ok: false, error: "工程必须恰好包含一份音频和一份封面" });
      return;
    }
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "arranger-save-"));
    const manifest = path.join(tempDir, "manifest.json");
    writeJsonAtomic(manifest, {
      charts: names.map((name) => ({ path: path.join(projectDir, name), name })),
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
    const timer = setTimeout(() => child.kill(), 180_000);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      fs.rmSync(tempDir, { recursive: true, force: true });
      resolve({ ok: false, error: String(error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      fs.rmSync(tempDir, { recursive: true, force: true });
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
      try {
        const report = JSON.parse(line) as Record<string, unknown>;
        resolve(code === 0 ? report : { ok: false, error: report.error ?? stderr.slice(-1000) });
      } catch { resolve({ ok: false, error: stderr.slice(-1000) || `打包退出码 ${code}` }); }
    });
  });
}

export async function POST(req: Request) {
  const sr = resolveSrc(req);
  if (!sr.ok) return NextResponse.json({ ok: false, error: sr.error }, { status: sr.status });
  if (!sr.managed) {
    return NextResponse.json({ ok: false, error: "旧工程请先从绝对路径重新打开以启用显式同步" }, { status: 409 });
  }
  let mcText: unknown;
  let overwriteAssets: unknown;
  try { ({ mcText, overwriteAssets } = await req.json()); }
  catch { return NextResponse.json({ ok: false, error: "请求 JSON 无效" }, { status: 400 }); }
  if (typeof mcText !== "string" || !mcText) {
    return NextResponse.json({ ok: false, error: "mcText (string) required" }, { status: 400 });
  }
  const checked = validateArrangedMcText(mcText);
  if (!checked.ok) return NextResponse.json({ ok: false, errors: checked.errors }, { status: 422 });

  const registry = readRegistry();
  const project = registry.managedProjects.find((p) => p.id === sr.managed?.projectId);
  const chart = project?.charts.find((c) => c.id === sr.managed?.chartId);
  if (!project || !chart) {
    return NextResponse.json({ ok: false, error: "找不到受管工程谱面" }, { status: 404 });
  }
  const savedAt = new Date().toISOString();
  try {
    atomicWrite(sr.abs, mcText);
    for (const sibling of project.charts) {
      if (sibling.id === chart.id) continue;
      materializeSavedState(
        managedSrc(project.id, sibling.id),
        path.join(findRepoRoot(), project.workspaceRel, sibling.fileName),
      );
    }
    project.updatedAt = savedAt;
    saveRegistry(registry);
  } catch (error) {
    return NextResponse.json({ ok: false, error: `工程保存未完成: ${(error as Error).message}` }, { status: 500 });
  }
  if (project.sourceKind === "workspace" || !project.sourcePath) {
    return NextResponse.json({ ok: true, workspaceOnly: true, savedAt });
  }
  if (!fs.existsSync(project.sourcePath)) {
    return NextResponse.json({
      ok: true, workspaceOnly: true, syncSkippedReason: "source_missing", savedAt,
    });
  }

  let target = project.sourcePath;
  let copyCreated = false;
  if (project.copyOnWrite) {
    target = uniqueManagedCopy(findRepoRoot(), path.basename(project.sourcePath));
    copyCreated = true;
  } else {
    if (!fs.existsSync(target)) {
      return NextResponse.json({ ok: true, workspaceOnly: true, syncSkippedReason: "source_missing", savedAt });
    }
    const actual = fingerprintFile(target);
    if (project.sourceFingerprint && actual !== project.sourceFingerprint) {
      return NextResponse.json({ ok: false, conflict: true, error: "原文件已被其他程序修改，未覆盖" }, { status: 409 });
    }
    const backup = `${target}.orig`;
    if (!fs.existsSync(backup)) fs.copyFileSync(target, backup);
  }

  if (project.sourceKind === "mc") {
    let synced: ReturnType<typeof syncBareMc>;
    try { synced = syncBareMc(project, target, mcText, overwriteAssets === true); }
    catch (error) {
      return NextResponse.json({ ok: false, error: `素材同步已回滚: ${(error as Error).message}` }, { status: 422 });
    }
    if (synced.conflicts.length) {
      return NextResponse.json({
        ok: false,
        conflict: true,
        assetConflicts: synced.conflicts,
        error: "目标目录存在未知或被外部修改的同名素材",
      }, { status: 409 });
    }
    project.sourceAssets = synced.sourceAssets;
  } else {
    const report = await packageWorkspace(sr.dir, project.charts.map((candidate) => candidate.fileName), target);
    if (!report.ok) return NextResponse.json({ ok: false, error: String(report.error ?? "回包失败") }, { status: 422 });
  }
  project.sourcePath = target;
  project.sourceFingerprint = fingerprintFile(target);
  project.copyOnWrite = false;
  project.lastSyncedAt = new Date().toISOString();
  project.updatedAt = project.lastSyncedAt;
  saveRegistry(registry);
  return NextResponse.json({
    ok: true,
    copiedFromProtectedAsset: copyCreated,
    sourceKind: project.sourceKind,
    syncedAt: project.lastSyncedAt,
    backupCreated: !copyCreated,
  });
}
