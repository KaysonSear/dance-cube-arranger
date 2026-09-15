/**
 * 仓库路径、?src 工程参数校验与资产发现(仅服务端)。
 * V3 受管工程以不透明 `managed:<project>:<chart>` 定位工作区；旧仓库相对路径继续只读兼容。
 * 严格校验(拒绝越界/绝对/盘符/反斜杠),自动写入限定 artifacts/arranger/ 之下 ——
 * WDA/ 与 data/corpus/ 只读。
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { managedSrc, migrateProjectRegistry, parseManagedSrc } from "../projects";

/** Legacy source default is intentionally empty: every chart is now opened through a project id. */
export const SOURCE_MC_REL = "";
export const ARTIFACTS_REL = path.join("artifacts", "arranger");
export const IMPORTS_REL = path.join(ARTIFACTS_REL, "imports");
export const WORKSPACES_REL = path.join(ARTIFACTS_REL, "workspaces");

let cachedRoot: string | null = null;

/** 自 cwd 向上找到包含 configs/column_geometry.json 的目录(= 仓库根)。 */
export function findRepoRoot(start = process.cwd()): string {
  if (cachedRoot) return cachedRoot;
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "configs", "column_geometry.json"))) {
      cachedRoot = dir;
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `repo root not found: no configs/column_geometry.json upward from ${start} — ` +
      "run the dev server from inside the dance-cube-arranger repo",
  );
}

export const AUDIO_EXTS = [".mp3", ".ogg", ".wav"];
export const COVER_EXTS = [".jpg", ".jpeg", ".png"];
export const MC_EXTS = [".mc"];

/**
 * 解析可用的 Python 解释器命令。
 * 优先级：
 * 1. 环境变量 PYTHON_EXECUTABLE 或 ARRANGING_PYTHON
 * 2. 项目内 .venv / .venv311 (若存在)
 * 3. 系统 PATH 中的 python
 */
export function resolvePythonCommand(root = findRepoRoot()): string {
  if (process.env.PYTHON_EXECUTABLE) return process.env.PYTHON_EXECUTABLE;
  if (process.env.ARRANGING_PYTHON) return process.env.ARRANGING_PYTHON;

  const binPythonDir = path.join(root, "bin", "python", "python.exe");
  if (fs.existsSync(binPythonDir)) return binPythonDir;

  const binPythonExe = path.join(root, "bin", "python.exe");
  if (fs.existsSync(binPythonExe)) return binPythonExe;

  const venv311 = path.join(root, ".venv311", "Scripts", "python.exe");
  if (fs.existsSync(venv311)) return venv311;

  const venv = path.join(root, ".venv", "Scripts", "python.exe");
  if (fs.existsSync(venv)) return venv;

  return "python";
}

/**
 * ingest 式资产发现:目录内「恰好一个」候选文件。0 个 → null;多个 → 抛错(歧义,
 * 不猜)。纯函数,注入文件名列表以便测试。
 */
export function pickAsset(names: string[], exts: string[]): string | null {
  const matches = names.filter((n) => exts.includes(path.extname(n).toLowerCase())).sort();
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(`ambiguous assets: ${matches.join(", ")} — expected exactly one ${exts.join("/")}`);
  }
  return matches[0];
}

/**
 * 目录内**全部**匹配文件(排序)。与 `pickAsset` 的「恰好一个」语义并存 ——
 * 一曲多包的文件夹里会有多张 `.mc`,不能再当成歧义而整目录跳过。
 */
export function listAssets(names: string[], exts: string[]): string[] {
  return names.filter((n) => exts.includes(path.extname(n).toLowerCase())).sort();
}

/** 在指定目录内发现唯一音频/封面(适用于 WDA/ 与 imports/<slug>/)。 */
export function discoverAssetsIn(dir: string): {
  audioPath: string | null;
  coverPath: string | null;
} {
  const names = fs
    .readdirSync(dir)
    .filter((n) => fs.statSync(path.join(dir, n)).isFile());
  const audio = pickAsset(names, AUDIO_EXTS);
  const cover = pickAsset(names, COVER_EXTS);
  return {
    audioPath: audio ? path.join(dir, audio) : null,
    coverPath: cover ? path.join(dir, cover) : null,
  };
}

export type SrcNormalization = { ok: true; rel: string } | { ok: false; error: string };

/** 纯校验:?src 必须是仓库相对的 .mc 路径;拒绝越界/绝对/盘符/反斜杠。 */
export function normalizeSrcRel(raw: string): SrcNormalization {
  if (!raw || typeof raw !== "string") return { ok: false, error: "src 不能为空" };
  if (raw.includes("\\")) return { ok: false, error: "src 不允许反斜杠路径" };
  if (/^[A-Za-z]:/.test(raw)) return { ok: false, error: "src 不允许盘符路径" };
  if (path.posix.isAbsolute(raw)) return { ok: false, error: "src 必须是仓库相对路径" };
  const norm = path.posix.normalize(raw);
  if (norm === ".." || norm.startsWith("../")) return { ok: false, error: "src 越界" };
  if (!norm.toLowerCase().endsWith(".mc")) return { ok: false, error: "src 必须指向 .mc 文件" };
  return { ok: true, rel: norm };
}

export type SrcResolution =
  | {
    ok: true;
    /** Opaque managed ref, or a legacy repository-relative path. */
    rel: string;
    abs: string;
    dir: string;
    key: string;
    managed: { projectId: string; chartId: string } | null;
  }
  | { ok: false; status: 400 | 404; error: string };

/** 从请求解析工程；managed ref 与旧相对路径均做 containment；缺参数 → 400。 */
export function resolveSrc(req: Request): SrcResolution {
  const raw = new URL(req.url).searchParams.get("src");
  if (!raw) return { ok: false, status: 400, error: "缺少工程谱面 ID" };
  if (!parseManagedSrc(raw)) {
    const normalized = normalizeSrcRel(raw);
    if (!normalized.ok) return { ok: false, status: 400, error: normalized.error };
    try {
      const registry = migrateProjectRegistry(JSON.parse(fs.readFileSync(
        path.join(findRepoRoot(), ARTIFACTS_REL, "registry.json"), "utf-8",
      )));
      for (const project of registry.managedProjects) {
        const chart = project.charts.find((c) => c.legacySources?.includes(normalized.rel) ||
          `${project.workspaceRel}/${c.fileName}` === normalized.rel);
        if (chart) {
          const url = new URL(req.url);
          url.searchParams.set("src", managedSrc(project.id, chart.id));
          return resolveSrc(new Request(url));
        }
      }
    } catch { /* No registered alias; retain legacy path validation below. */ }
  }
  const managed = parseManagedSrc(raw);
  if (managed) {
    const root = findRepoRoot();
    const registryFile = path.join(root, ARTIFACTS_REL, "registry.json");
    let registryRaw: unknown = null;
    try {
      registryRaw = JSON.parse(fs.readFileSync(registryFile, "utf-8"));
    } catch {
      return { ok: false, status: 404, error: "找不到受管工程注册表" };
    }
    const registry = migrateProjectRegistry(registryRaw);
    const project = registry.managedProjects.find((p) => p.id === managed.projectId);
    const chart = project?.charts.find((c) => c.id === managed.chartId);
    if (!project || !chart) return { ok: false, status: 404, error: "找不到工程或谱面" };
    const workspace = path.resolve(root, project.workspaceRel);
    const abs = path.resolve(workspace, chart.fileName);
    const containment = path.relative(workspace, abs);
    if (containment.startsWith("..") || path.isAbsolute(containment)) {
      return { ok: false, status: 400, error: "工作区谱面路径越界" };
    }
    if (!fs.existsSync(abs)) return { ok: false, status: 404, error: `找不到谱面: ${chart.fileName}` };
    return { ok: true, rel: raw, abs, dir: workspace, key: projectKey(raw), managed };
  }
  const n = normalizeSrcRel(raw);
  if (!n.ok) return { ok: false, status: 400, error: n.error };
  const root = findRepoRoot();
  const abs = path.resolve(root, n.rel);
  const relCheck = path.relative(root, abs);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    return { ok: false, status: 400, error: "src 越界" };
  }
  if (!fs.existsSync(abs)) return { ok: false, status: 404, error: `找不到谱面: ${n.rel}` };
  return { ok: true, rel: n.rel, abs, dir: path.dirname(abs), key: projectKey(n.rel), managed: null };
}

/** 工程持久化目录键:sha1(源相对路径) 前 16 位(仿 src/editor/project.py)。 */
export function projectKey(sourceRelPath: string): string {
  return crypto.createHash("sha1").update(sourceRelPath).digest("hex").slice(0, 16);
}

export function sha1Hex(data: string | Buffer): string {
  return crypto.createHash("sha1").update(data).digest("hex");
}
