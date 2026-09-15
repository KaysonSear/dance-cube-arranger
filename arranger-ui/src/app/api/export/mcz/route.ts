import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { NextResponse } from "next/server";

import {
  assignmentsFromJson,
  buildExportNotes,
  buildOnsets,
  looksLikePlaceholder,
  mergeOnsets,
  seedAssignments,
} from "@/lib/arrangement";
import { buildArrangedMc, parseMc } from "@/lib/mc";
import { normalizeFileName, validateUniqueChartNames } from "@/lib/project-names";
import { managedSrc } from "@/lib/projects";
import { normalizeAbsolutePath } from "@/lib/server/managed-projects";
import { discoverAssetsIn, findRepoRoot, resolvePythonCommand, resolveSrc } from "@/lib/server/paths";
import { readRegistry, readState, saveRegistry, writeJsonAtomic } from "@/lib/server/store";
import { validateArrangedMcText } from "@/lib/server/validate-mc";

export const dynamic = "force-dynamic";
const BRIDGE_TIMEOUT_MS = 180_000;

type GoodSrc = Extract<ReturnType<typeof resolveSrc>, { ok: true }>;
type ChartItem = { src: string; abs: string; defaultName: string };

function stateKey(src: string): string {
  return crypto.createHash("sha1").update(src).digest("hex").slice(0, 16);
}

function projectCharts(sr: GoodSrc): ChartItem[] {
  if (sr.managed) {
    const registry = readRegistry();
    const project = registry.managedProjects.find((p) => p.id === sr.managed?.projectId);
    if (!project) throw new Error("找不到受管工程");
    const root = findRepoRoot();
    return project.charts.map((chart) => ({
      src: managedSrc(project.id, chart.id),
      abs: path.join(root, project.workspaceRel, chart.fileName),
      defaultName: chart.fileName,
    }));
  }
  const prefix = sr.rel.slice(0, sr.rel.lastIndexOf("/"));
  return fs.readdirSync(sr.dir)
    .filter((name) => name.toLowerCase().endsWith(".mc"))
    .sort()
    .map((name) => ({ src: `${prefix}/${name}`, abs: path.join(sr.dir, name), defaultName: name }));
}

function latestChartText(item: ChartItem, currentSrc: string, currentText: string): {
  text: string; assignedCount: number; unassignedCount: number; noteCount: number;
} {
  if (item.src === currentSrc) {
    const validated = validateArrangedMcText(currentText);
    if (!validated.ok) throw new Error(validated.errors.join("；"));
    const onsets = buildOnsets(parseMc(currentText).gameplay);
    return { text: currentText, assignedCount: onsets.length, unassignedCount: 0, noteCount: validated.noteCount };
  }
  const sourceText = fs.readFileSync(item.abs, "utf-8");
  const parsed = parseMc(sourceText);
  const state = readState(stateKey(item.src));
  const rawOnsets = mergeOnsets(buildOnsets(parsed.gameplay), state?.addedOnsets ?? []);
  const deletedSet = new Set(state?.deletedOnsetIds ?? []);
  const onsets = rawOnsets.filter((o) => !deletedSet.has(o.id));
  const mode = state?.sourceMode ?? (looksLikePlaceholder(parsed.gameplay) ? "placeholder" : "real");
  const assignments = state
    ? assignmentsFromJson(state.assignments, onsets)
    : seedAssignments(onsets, mode);
  const built = buildExportNotes(onsets, assignments);
  const text = buildArrangedMc(parsed, built.notes, {
    bpm: state?.ui.bpmOverride,
    offsetMs: state?.ui.offsetOverride,
  });
  return { text, assignedCount: built.assignedCount, unassignedCount: built.unassignedCount, noteCount: built.notes.length };
}

function runBridge(root: string, manifest: string): Promise<{
  code: number | null; stdout: string; stderr: string; timedOut: boolean;
}> {
  return new Promise((resolve) => {
    const child = spawn(
      resolvePythonCommand(root),
      [path.join(root, "scripts", "export_arranged_mcz.py"), "--manifest", manifest],
      { cwd: root, windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, BRIDGE_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}\n${String(error)}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

export async function GET(req: Request) {
  const sr = resolveSrc(req);
  if (!sr.ok) return NextResponse.json({ ok: false, error: sr.error }, { status: sr.status });
  try {
    const charts = projectCharts(sr).map((item) => {
      const latest = latestChartText(item, "", "");
      return {
        src: item.src,
        name: item.defaultName,
        noteCount: latest.noteCount,
        assignedCount: latest.assignedCount,
        unassignedCount: latest.unassignedCount,
      };
    });
    const registry = readRegistry();
    const packageName = sr.managed
      ? `${registry.managedProjects.find((p) => p.id === sr.managed?.projectId)?.displayName ?? "chart"}.mcz`
      : `${path.basename(sr.dir)}.mcz`;
    let assetError: string | null = null;
    try {
      const assets = discoverAssetsIn(sr.dir);
      const missing = [
        !assets.audioPath ? "缺少唯一音频" : null,
        !assets.coverPath ? "缺少唯一封面" : null,
      ].filter(Boolean);
      assetError = missing.length ? missing.join("；") : null;
    } catch (error) {
      assetError = (error as Error).message;
    }
    return NextResponse.json({
      ok: true,
      charts,
      packageName,
      lastExportDir: registry.lastExportDir,
      assetError,
      canExport: assetError === null,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 422 });
  }
}

export async function POST(req: Request) {
  const sr = resolveSrc(req);
  if (!sr.ok) return NextResponse.json({ ok: false, error: sr.error }, { status: sr.status });
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "请求 JSON 无效" }, { status: 400 }); }
  if (typeof body.mcText !== "string" || !body.mcText) {
    return NextResponse.json({ ok: false, error: "mcText (string) required" }, { status: 400 });
  }
  const normalizedDir = normalizeAbsolutePath(body.outputDir);
  if (!normalizedDir.ok) return NextResponse.json({ ok: false, error: normalizedDir.error }, { status: 400 });
  if (!fs.existsSync(normalizedDir.path) || !fs.statSync(normalizedDir.path).isDirectory()) {
    return NextResponse.json({ ok: false, error: `输出目录不存在: ${normalizedDir.path}` }, { status: 422 });
  }
  const packageName = normalizeFileName(body.packageName ?? body.mczName, ".mcz");
  if (!packageName.ok) return NextResponse.json({ ok: false, error: packageName.error }, { status: 400 });

  let items: ChartItem[];
  try { items = projectCharts(sr); }
  catch (error) { return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 422 }); }
  const rawMapping = body.chartNames ?? body.mcNames;
  const mapping = rawMapping && typeof rawMapping === "object"
    ? rawMapping as Record<string, unknown>
    : {};
  const checkedNames = validateUniqueChartNames(items.map((item) => mapping[item.src] ?? item.defaultName));
  if (!checkedNames.ok) return NextResponse.json({ ok: false, error: checkedNames.error }, { status: 400 });
  const target = path.join(normalizedDir.path, packageName.name);
  if (fs.existsSync(target) && body.overwrite !== true) {
    return NextResponse.json({ ok: false, conflict: true, path: target, error: "目标 MCZ 已存在" }, { status: 409 });
  }

  let assets: ReturnType<typeof discoverAssetsIn>;
  try { assets = discoverAssetsIn(sr.dir); }
  catch (error) { return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 422 }); }
  if (!assets.audioPath || !assets.coverPath) {
    return NextResponse.json({ ok: false, error: "工程必须恰好包含一份音频和一份封面" }, { status: 422 });
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "arranger-export-"));
  try {
    const reports = items.map((item, index) => {
      const latest = latestChartText(item, sr.rel, body.mcText as string);
      const file = path.join(tempDir, `chart-${index}.mc`);
      fs.writeFileSync(file, latest.text, "utf-8");
      return { ...latest, src: item.src, name: checkedNames.names[index], path: file };
    });
    const manifest = path.join(tempDir, "manifest.json");
    writeJsonAtomic(manifest, {
      charts: reports.map((report) => ({ path: report.path, name: report.name })),
      audio: assets.audioPath,
      cover: assets.coverPath,
      out: target,
    });
    const run = await runBridge(findRepoRoot(), manifest);
    const last = run.stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
    let bridge: Record<string, unknown> | null = null;
    try { bridge = JSON.parse(last); } catch { bridge = null; }
    if (run.timedOut || run.code !== 0 || !bridge?.ok) {
      return NextResponse.json({
        ok: false,
        error: run.timedOut ? "MCZ 导出超时" : String(bridge?.error ?? `导出桥退出码 ${run.code}`),
        stderr: run.stderr.slice(-2000),
      }, { status: 500 });
    }
    const registry = readRegistry();
    registry.lastExportDir = normalizedDir.path;
    saveRegistry(registry);
    return NextResponse.json({
      ok: true,
      mczPath: target,
      charts: reports.map((report) => ({
        src: report.src,
        name: report.name,
        noteCount: report.noteCount,
        assignedCount: report.assignedCount,
        unassignedCount: report.unassignedCount,
      })),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 422 });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
