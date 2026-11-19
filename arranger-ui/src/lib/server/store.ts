/**
 * 工作状态 + 快照的服务端存储:artifacts/arranger/projects/<key>/{state.json, snapshots/}。
 * 原子写(tmp + rename,仿 src/editor/project.py);快照留最新 SNAPSHOT_KEEP 份。
 */

import fs from "node:fs";
import path from "node:path";

import type { Snapshot, SnapshotMeta, WorkingStateV1 } from "../persist-types";
import { migrateProjectRegistry, type ProjectRegistryV3 } from "../projects";
import { ARTIFACTS_REL, findRepoRoot } from "./paths";

export const SNAPSHOT_KEEP = 50;

/** Windows 上目标文件被杀毒/索引/另一请求短暂占用时 rename 会报这些码,稍后重试即可。 */
const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_ATTEMPTS = 5;
const RENAME_BACKOFF_MS = 50;

function renameWithRetry(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (attempt >= RENAME_ATTEMPTS || !TRANSIENT_RENAME_CODES.has(code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RENAME_BACKOFF_MS * attempt);
    }
  }
}

export function writeJsonAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    renameWithRetry(tmp, file);
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "写入失败，且无法清理临时文件", { cause: error });
    }
    throw error;
  }
}

export function readJsonIfExists<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

export function projectDir(key: string): string {
  return path.join(findRepoRoot(), ARTIFACTS_REL, "projects", key);
}

/** 条目注册表:记录"仅从列表移除"(不删文件)的谱面。 */
function registryPath(): string {
  return path.join(findRepoRoot(), ARTIFACTS_REL, "registry.json");
}

export function readRegistry(): ProjectRegistryV3 {
  return migrateProjectRegistry(readStoredJson(registryPath()));
}

function readStoredJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function saveRegistry(registry: ProjectRegistryV3): ProjectRegistryV3 {
  const ids = new Set<string>();
  const workspaces = new Set<string>();
  for (const project of registry.managedProjects) {
    const id = project.id.toLowerCase();
    const absolute = path.resolve(findRepoRoot(), project.workspaceRel.replaceAll("\\", "/"));
    const workspace = process.platform === "win32" ? absolute.toLowerCase() : absolute;
    if (ids.has(id)) throw new Error(`工程 ID 重复: ${project.id}`);
    if (workspaces.has(workspace)) throw new Error(`工程工作目录重复: ${project.workspaceRel}`);
    ids.add(id);
    workspaces.add(workspace);
  }
  const r: ProjectRegistryV3 = {
    ...registry,
    schema: 3,
    updatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(registryPath(), r);
  return r;
}

export function statePath(key: string): string {
  return path.join(projectDir(key), "state.json");
}

export function snapshotsDir(key: string): string {
  return path.join(projectDir(key), "snapshots");
}

export function readState(key: string): WorkingStateV1 | null {
  const state = readStoredJson(statePath(key)) as WorkingStateV1 | undefined;
  if (state === undefined) return null;
  if (state?.schema !== 1 || typeof state.sourcePath !== "string" ||
      typeof state.sourceSha1 !== "string" || !state.assignments ||
      typeof state.assignments !== "object" || Array.isArray(state.assignments)) {
    throw new Error("工作状态格式无效");
  }
  return state;
}

export function saveState(key: string, state: WorkingStateV1): void {
  writeJsonAtomic(statePath(key), state);
}

const SNAPSHOT_ID_RE = /^[0-9A-Za-z-]+$/;

export function makeSnapshotId(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function saveSnapshot(
  key: string,
  state: WorkingStateV1,
  label: string | null,
): SnapshotMeta {
  const dir = snapshotsDir(key);
  let id = makeSnapshotId();
  let suffix = 2;
  while (fs.existsSync(path.join(dir, `${id}.json`))) {
    id = `${makeSnapshotId()}-${suffix}`;
    suffix += 1;
  }
  const snap: Snapshot = {
    id,
    createdAt: new Date().toISOString(),
    label,
    assignedCount: Object.keys(state.assignments ?? {}).length,
    state,
  };
  writeJsonAtomic(path.join(dir, `${id}.json`), snap);
  pruneSnapshots(key);
  return {
    id: snap.id,
    createdAt: snap.createdAt,
    label: snap.label,
    assignedCount: snap.assignedCount,
  };
}

export function listSnapshots(key: string): SnapshotMeta[] {
  const dir = snapshotsDir(key);
  if (!fs.existsSync(dir)) return [];
  const metas: SnapshotMeta[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const snap = readJsonIfExists<Snapshot>(path.join(dir, name));
    if (snap) {
      metas.push({
        id: snap.id,
        createdAt: snap.createdAt,
        label: snap.label ?? null,
        assignedCount: snap.assignedCount ?? 0,
      });
    }
  }
  metas.sort((a, b) => (a.id < b.id ? 1 : -1));
  return metas;
}

export function readSnapshot(key: string, id: string): Snapshot | null {
  if (!SNAPSHOT_ID_RE.test(id)) return null; // 防路径穿越
  return readJsonIfExists<Snapshot>(path.join(snapshotsDir(key), `${id}.json`));
}

export function pruneSnapshots(key: string): void {
  const dir = snapshotsDir(key);
  if (!fs.existsSync(dir)) return;
  const files = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .reverse(); // id 即时间戳,倒序 = 新在前
  for (const name of files.slice(SNAPSHOT_KEEP)) {
    fs.unlinkSync(path.join(dir, name));
  }
}
