/** Managed external projects: opaque ids, repository workspaces and optimistic fingerprints. */

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  managedSrc,
  type ManagedChartRecord,
  type ManagedProjectRecord,
  type ProjectRegistryV3,
} from "../projects";
import { parseMc } from "../mc";
import { normalizeFileName } from "../project-names";
import {
  AUDIO_EXTS,
  COVER_EXTS,
  findRepoRoot,
  projectKey,
  normalizeSrcRel,
  resolvePythonCommand,
  WORKSPACES_REL,
} from "./paths";
import { readJsonIfExists, readRegistry, saveRegistry, writeJsonAtomic } from "./store";

export type OpenPathResult = {
  project: ManagedProjectRecord;
  src: string;
  reused: boolean;
};

export function fingerprintFile(file: string): string {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

export function normalizeAbsolutePath(raw: unknown):
  | { ok: true; path: string }
  | { ok: false; error: string } {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "路径不能为空" };
  const value = raw.trim();
  if (!path.win32.isAbsolute(value)) return { ok: false, error: "必须使用绝对盘符或 UNC 路径" };
  return { ok: true, path: path.win32.normalize(value) };
}

export function managedProjectById(registry: ProjectRegistryV3, id: string): ManagedProjectRecord {
  const project = registry.managedProjects.find((candidate) => candidate.id === id);
  if (!project) throw new Error("找不到受管工程");
  return project;
}

function stableId(seed: string, length: number): string {
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, length);
}

function canonicalSource(file: string): string {
  const resolved = fs.realpathSync.native(file);
  return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}

function existingProject(registry: ProjectRegistryV3, canonical: string): ManagedProjectRecord | undefined {
  const bySource = registry.managedProjects.find((project) => {
    if (!project.sourcePath) return false;
    try { return canonicalSource(project.sourcePath) === canonical; } catch { return false; }
  });
  if (bySource) return bySource;
  // Copy-on-write and source renaming deliberately keep the original opaque id.
  const id = stableId(canonical, 16);
  const workspace = path.resolve(findRepoRoot(), WORKSPACES_REL, id);
  return registry.managedProjects.find((project) => {
    const candidate = path.resolve(findRepoRoot(), project.workspaceRel.replaceAll("\\", "/"));
    return project.id.toLowerCase() === id || (process.platform === "win32"
      ? candidate.toLowerCase() === workspace.toLowerCase()
      : candidate === workspace);
  });
}

function openedProject(project: ManagedProjectRecord, reused: boolean): OpenPathResult {
  const first = project.charts[0];
  if (!first) throw new Error("工程中没有可用的 mode:9 谱面");
  return { project, src: managedSrc(project.id, first.id), reused };
}

// Shared by route bundles and dev reloads in this server process.
const importState = globalThis as typeof globalThis & {
  __arrangerManagedImports?: Map<string, Promise<OpenPathResult>>;
};
const pendingImports = importState.__arrangerManagedImports ??= new Map<string, Promise<OpenPathResult>>();

function chartRecords(names: string[]): ManagedChartRecord[] {
  return names.map((fileName, index) => ({
    id: stableId(`${index}\0${fileName}`, 12),
    fileName,
    title: fileName.replace(/\.mc$/i, ""),
  }));
}

function bridgeBasename(value: unknown): string {
  return String(value).replace(/\\/g, "/").split("/").pop() ?? "";
}

function unpackMcz(root: string, source: string, workspace: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const child = spawn(
      resolvePythonCommand(root),
      [path.join(root, "scripts", "import_mcz.py"), "--mcz", source, "--out-dir", workspace],
      { cwd: root, windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 120_000);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("close", () => {
      clearTimeout(timer);
      const last = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
      try { resolve(JSON.parse(last)); }
      catch { resolve({ ok: false, error: stderr.slice(-1000) || "解包程序未返回有效结果" }); }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: String(error) });
    });
  });
}

export function isProtectedWda(source: string): boolean {
  const wda = path.resolve(findRepoRoot(), "WDA");
  const relative = path.relative(wda, source);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function copySiblingAssets(source: string, workspace: string): void {
  const sourceDir = path.dirname(source);
  for (const name of fs.readdirSync(sourceDir)) {
    const ext = path.extname(name).toLowerCase();
    if (![...AUDIO_EXTS, ...COVER_EXTS].includes(ext)) continue;
    const from = path.join(sourceDir, name);
    if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(workspace, name));
  }
}

function siblingAssetRecords(source: string): ManagedProjectRecord["sourceAssets"] {
  const dir = path.dirname(source);
  const names = fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isFile());
  const one = (extensions: string[]) => {
    const matches = names.filter((name) => extensions.includes(path.extname(name).toLowerCase()));
    if (matches.length !== 1) return undefined;
    return { fileName: matches[0], fingerprint: fingerprintFile(path.join(dir, matches[0])) };
  };
  return { audio: one(AUDIO_EXTS), cover: one(COVER_EXTS) };
}

/** Open or reuse an absolute .mc/.mcz as a server-owned workspace. */
export async function openManagedPath(
  rawPath: unknown,
  options: { updateLastOpened?: boolean; copySiblingAssets?: boolean } = {},
): Promise<OpenPathResult> {
  const normalized = normalizeAbsolutePath(rawPath);
  if (!normalized.ok) throw new Error(normalized.error);
  if (!fs.existsSync(normalized.path) || !fs.statSync(normalized.path).isFile()) {
    throw new Error(`文件不存在: ${normalized.path}`);
  }
  const ext = path.extname(normalized.path).toLowerCase();
  if (ext !== ".mc" && ext !== ".mcz") throw new Error("仅支持 .mc 或 .mcz 文件");
  const source = fs.realpathSync.native(normalized.path);
  const canonical = canonicalSource(source);
  const registry = readRegistry();
  const existing = existingProject(registry, canonical);
  if (existing) {
    const result = openedProject(existing, true);
    if (options.updateLastOpened !== false) {
      registry.lastOpenedSrc = result.src;
      saveRegistry(registry);
    }
    return result;
  }

  let pending = pendingImports.get(canonical);
  const joined = !!pending;
  if (!pending) {
    pending = importManagedSource(source, canonical, options);
    pendingImports.set(canonical, pending);
  }
  try {
    const imported = await pending;
    const latest = readRegistry();
    const result = openedProject(managedProjectById(latest, imported.project.id), joined || imported.reused);
    // A background scan must not overwrite navigation requested by a concurrent caller.
    if (options.updateLastOpened !== false) {
      latest.lastOpenedSrc = result.src;
      saveRegistry(latest);
    }
    return result;
  } finally {
    if (pendingImports.get(canonical) === pending) pendingImports.delete(canonical);
  }
}

async function importManagedSource(
  source: string,
  canonical: string,
  options: { copySiblingAssets?: boolean },
): Promise<OpenPathResult> {
  const ext = path.extname(source).toLowerCase();
  const id = stableId(canonical, 16);
  const workspaceRel = path.posix.join("artifacts", "arranger", "workspaces", id);
  const workspacesRoot = path.resolve(findRepoRoot(), WORKSPACES_REL);
  const workspace = path.join(workspacesRoot, id);
  if (fs.existsSync(workspace)) {
    throw new Error(`工作目录已存在，已保留文件，请先核对工程登记: ${workspaceRel}`);
  }
  fs.mkdirSync(workspacesRoot, { recursive: true });
  const staging = fs.mkdtempSync(path.join(workspacesRoot, `.import-${id}-`));
  try {
    let names: string[] = [];
    if (ext === ".mc") {
      const checked = normalizeFileName(path.basename(source), ".mc");
      if (!checked.ok) throw new Error(checked.error);
      fs.copyFileSync(source, path.join(staging, checked.name));
      if (options.copySiblingAssets !== false) copySiblingAssets(source, staging);
      names = [checked.name];
    } else {
      const report = await unpackMcz(findRepoRoot(), source, staging);
      if (!report.ok) throw new Error(String(report.error ?? "MCZ 解包失败"));
      names = Array.isArray(report.mcs) ? report.mcs.map(bridgeBasename).filter(Boolean) : [];
      if (!names.length) throw new Error("包内没有有效的 mode:9 谱面");
    }

    // No await between this read and commit: retain changes made during unpacking.
    const registry = readRegistry();
    const existing = existingProject(registry, canonical);
    if (existing) return openedProject(existing, true);
    if (fs.existsSync(workspace)) {
      throw new Error(`工作目录已存在，已保留文件，请先核对工程登记: ${workspaceRel}`);
    }
    const now = new Date().toISOString();
    const project: ManagedProjectRecord = {
      id,
      displayName: path.basename(source, ext),
      workspaceRel,
      sourceKind: ext.slice(1) as "mc" | "mcz",
      sourcePath: source,
      sourceFingerprint: fingerprintFile(source),
      sourceAssets: ext === ".mc" ? siblingAssetRecords(source) : undefined,
      charts: chartRecords(names),
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: now,
      copyOnWrite: isProtectedWda(source),
    };
    fs.renameSync(staging, workspace);
    registry.managedProjects.push(project);
    // If persistence fails, preserve the published workspace for recovery.
    saveRegistry(registry);
    return openedProject(project, false);
  } finally {
    const target = path.resolve(staging);
    if (path.dirname(target) !== workspacesRoot || !path.basename(target).startsWith(`.import-${id}-`)) {
      throw new Error("导入临时目录越界，拒绝清理");
    }
    fs.rmSync(target, { recursive: true, force: true });
  }
}

export function updateManagedProject(
  id: string,
  mutate: (project: ManagedProjectRecord, registry: ProjectRegistryV3) => void,
): ManagedProjectRecord {
  const registry = readRegistry();
  const project = managedProjectById(registry, id);
  mutate(project, registry);
  project.updatedAt = new Date().toISOString();
  saveRegistry(registry);
  return project;
}

/** Adopt an existing repository workspace (legacy upload/import) without moving its files. */
export function registerWorkspaceProject(
  workspaceRel: string,
  displayName: string,
  chartNames: string[],
  options: { updateLastOpened?: boolean } = {},
): OpenPathResult {
  const registry = readRegistry();
  const normalizedRel = workspaceRel.split(path.sep).join("/");
  const existing = registry.managedProjects.find((project) => project.workspaceRel === normalizedRel);
  if (existing) {
    const src = managedSrc(existing.id, existing.charts[0].id);
    migrateLegacyStateRefs(registry, existing, normalizedRel);
    saveRegistry(registry);
    return { project: existing, src, reused: true };
  }
  const id = stableId(`workspace\0${normalizedRel}`, 16);
  const now = new Date().toISOString();
  const project: ManagedProjectRecord = {
    id,
    displayName,
    workspaceRel: normalizedRel,
    sourceKind: "workspace",
    sourcePath: null,
    sourceFingerprint: null,
    charts: chartRecords(chartNames),
    createdAt: now,
    updatedAt: now,
    lastSyncedAt: null,
    copyOnWrite: false,
  };
  registry.managedProjects.push(project);
  migrateLegacyStateRefs(registry, project, normalizedRel);
  const src = managedSrc(project.id, project.charts[0].id);
  if (options.updateLastOpened !== false) registry.lastOpenedSrc = src;
  saveRegistry(registry);
  return { project, src, reused: false };
}

function migrateLegacyStateRefs(
  registry: ProjectRegistryV3,
  project: ManagedProjectRecord,
  workspaceRel: string,
): void {
  const stateRoot = path.join(findRepoRoot(), "artifacts", "arranger", "projects");
  for (const chart of project.charts) {
    const defaultRef = `${workspaceRel}/${chart.fileName}`;
    chart.legacySources = [...new Set([...(chart.legacySources ?? []), defaultRef])];
    for (const oldRef of chart.legacySources) {
      const newRef = managedSrc(project.id, chart.id);
      const oldDir = path.join(stateRoot, projectKey(oldRef));
      const newDir = path.join(stateRoot, projectKey(newRef));
      if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) fs.renameSync(oldDir, newDir);
      else if (fs.existsSync(oldDir)) {
        // Keep newer managed edits; retain any legacy history alongside them.
        const oldState = path.join(oldDir, "state.json");
        const currentState = path.join(newDir, "state.json");
        if (fs.existsSync(oldState) && !fs.existsSync(currentState)) fs.copyFileSync(oldState, currentState);
        const oldSnapshots = path.join(oldDir, "snapshots");
        if (fs.existsSync(oldSnapshots)) {
          const destination = path.join(newDir, "snapshots");
          fs.mkdirSync(destination, { recursive: true });
          for (const name of fs.readdirSync(oldSnapshots).filter((item) => item.endsWith(".json"))) {
            const target = path.join(destination, `${projectKey(oldRef)}-${name}`);
            if (!fs.existsSync(target)) fs.copyFileSync(path.join(oldSnapshots, name), target);
          }
        }
      }
      const stateFile = path.join(newDir, "state.json");
      const state = readJsonIfExists<Record<string, unknown>>(stateFile);
      if (state?.sourcePath === oldRef) {
        state.sourcePath = newRef;
        writeJsonAtomic(stateFile, state);
      }
      const snapshots = path.join(newDir, "snapshots");
      if (fs.existsSync(snapshots)) {
        for (const name of fs.readdirSync(snapshots).filter((item) => item.endsWith(".json"))) {
          const file = path.join(snapshots, name);
          const snapshot = readJsonIfExists<Record<string, unknown>>(file);
          const nested = snapshot?.state;
          if (nested && typeof nested === "object" && (nested as Record<string, unknown>).sourcePath === oldRef) {
            (nested as Record<string, unknown>).sourcePath = newRef;
            snapshot!.id = name.slice(0, -5);
            writeJsonAtomic(file, snapshot);
          }
        }
      }
      registry.hiddenCharts = registry.hiddenCharts.map((entry) => entry === oldRef ? newRef : entry);
      if (registry.lastOpenedSrc === oldRef) registry.lastOpenedSrc = newRef;
    }
  }
  registry.hiddenProjects = registry.hiddenProjects.map((entry) => entry === workspaceRel ? project.id : entry);
}

/** Adopt intact legacy history without depending on the external files afterwards. */
export async function adoptLegacyHistory(): Promise<void> {
  const root = findRepoRoot();
  const stateRoot = path.join(root, "artifacts", "arranger", "projects");
  const refs = new Set<string>();
  const initial = readRegistry();
  if (initial.lastOpenedSrc) refs.add(initial.lastOpenedSrc);
  for (const ref of initial.hiddenCharts) refs.add(ref);
  for (const project of initial.managedProjects) {
    for (const chart of project.charts) for (const ref of chart.legacySources ?? []) refs.add(ref);
  }
  if (fs.existsSync(stateRoot)) {
    for (const name of fs.readdirSync(stateRoot)) {
      const state = readJsonIfExists<{ sourcePath?: string }>(path.join(stateRoot, name, "state.json"));
      if (state?.sourcePath) refs.add(state.sourcePath);
    }
  }
  for (const ref of refs) {
    const normalized = normalizeSrcRel(ref);
    if (!normalized.ok) continue;
    const registry = readRegistry();
    const known = registry.managedProjects.find((p) => p.charts.some((c) => c.legacySources?.includes(ref)));
    if (known) {
      migrateLegacyStateRefs(registry, known, path.posix.dirname(normalized.rel));
      saveRegistry(registry);
      continue;
    }
    const absolute = path.resolve(root, normalized.rel);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    try {
      const parsed = parseMc(fs.readFileSync(absolute, "utf-8"));
      if ((parsed.raw.meta as Record<string, unknown>)?.mode !== 9) continue;
      const opened = await openManagedPath(absolute, { updateLastOpened: false });
      const latest = readRegistry();
      const project = managedProjectById(latest, opened.project.id);
      const chart = project.charts[0];
      chart.legacySources = [...new Set([...(chart.legacySources ?? []), ref])];
      saveRegistry(latest); // Persist the alias before moving history; retries can finish adoption.
      migrateLegacyStateRefs(latest, project, path.posix.dirname(normalized.rel));
      saveRegistry(latest);
    } catch {
      // Retain legacy data and its visible entry if adoption cannot finish.
    }
  }
}
