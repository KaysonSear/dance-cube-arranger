import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { dirOf, managedSrc, parseManagedSrc, type ProjectRegistryV3 } from "../projects";
import { activeProjectWrites, fingerprintFile, isProtectedWda } from "./managed-projects";
import { ARTIFACTS_REL, findRepoRoot, IMPORTS_REL, normalizeSrcRel, projectKey, resolvePythonCommand, WORKSPACES_REL } from "./paths";
import { projectDir, readJsonIfExists, saveRegistry } from "./store";

function checkPath(file: string) {
  for (let cur = path.resolve(file); ; cur = path.dirname(cur)) {
    if (fs.lstatSync(cur, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`路径含链接：${cur}`);
    if (cur === path.dirname(cur)) break;
  }
}

function child(dir: string, name: string) {
  if (!name || path.basename(name) !== name || name === "." || name === ".." || name.includes(":")) {
    throw new Error("登记的文件名不合法");
  }
  return path.join(dir, name);
}

function checkFingerprint(file: string, expected: string | null) {
  checkPath(file);
  if (fs.existsSync(file) && (!expected || fingerprintFile(file) !== expected)) throw new Error(`原文件已被修改：${file}`);
}

export function purgeEntry(registry: ProjectRegistryV3, projectId: string, chartRef: string | null, confirmToken?: string) {
  if (activeProjectWrites.size) throw new Error("工程正在保存，请稍后重试");
  const root = findRepoRoot();
  const project = registry.managedProjects.find((p) => p.id === projectId);
  const targets = new Set<string>();
  const paths: string[] = [];
  const refs = new Set<string>();
  let wholeProject = true;
  let rewrite: string | null = null;
  let selectedName = "";
  let archiveEntry = "";
  const preserved = new Set<string>();
  for (const other of registry.managedProjects) {
    if (other.id === projectId || !other.sourcePath) continue;
    preserved.add(path.resolve(other.sourcePath).toLowerCase());
    for (const asset of Object.values(other.sourceAssets ?? {})) {
      preserved.add(child(path.dirname(other.sourcePath), asset.fileName).toLowerCase());
    }
    // Older bare-chart records may have no asset inventory.
    if (project && other.sourceKind === "mc" && path.resolve(other.sourcePath).toLowerCase().startsWith(
      path.resolve(root, project.workspaceRel).toLowerCase() + path.sep) && fs.existsSync(path.dirname(other.sourcePath))) {
      for (const name of fs.readdirSync(path.dirname(other.sourcePath))) {
        if (/\.(?:ogg|wav|mp3|jpe?g|png)$/i.test(name)) preserved.add(path.join(path.dirname(other.sourcePath), name).toLowerCase());
      }
    }
  }
  const add = (file: string, directory = false): void => {
    if (preserved.has(file.toLowerCase())) return;
    checkPath(file);
    const info = fs.statSync(file, { throwIfNoEntry: false });
    if (!info) return;
    if (directory !== info.isDirectory()) throw new Error(`文件类型已变化：${file}`);
    if (directory && [...preserved].some((p) => p.startsWith(file.toLowerCase() + path.sep))) {
      for (const name of fs.readdirSync(file)) {
        const item = child(file, name);
        add(item, fs.lstatSync(item).isDirectory());
      }
      return;
    }
    targets.add(file);
    paths.push(file);
    if (directory) {
      for (const item of fs.readdirSync(file, { recursive: true, encoding: "utf8" })) {
        const nested = path.join(file, item);
        checkPath(nested);
        paths.push(nested);
      }
    }
  };
  if (project) {
    const workspace = path.resolve(root, project.workspaceRel);
    if (![IMPORTS_REL, WORKSPACES_REL].some((rel) => path.dirname(workspace) === path.resolve(root, rel))) {
      throw new Error("工作目录超出工程范围");
    }
    const charts = project.charts.filter((c) => !chartRef || managedSrc(project.id, c.id) === chartRef);
    if (!charts.length) throw new Error("找不到登记的谱面");
    wholeProject = charts.length === project.charts.length;
    for (const chart of charts) {
      refs.add(managedSrc(project.id, chart.id));
      for (const ref of chart.legacySources ?? []) refs.add(ref);
      if (!wholeProject) add(child(workspace, chart.fileName));
    }
    if (wholeProject) add(workspace, true);
    const source = project.sourcePath;
    if (source && !preserved.has(source.toLowerCase())) {
      if (!path.isAbsolute(source) || path.extname(source).toLowerCase() !== "." + project.sourceKind) {
        throw new Error("登记的来源路径不合法");
      }
      checkFingerprint(source, project.sourceFingerprint);
      const sourceDir = path.dirname(source);
      const others = registry.managedProjects.filter((p) => p.id !== project.id && p.sourcePath);
      if (wholeProject) {
        add(source);
        if (project.sourceKind === "mc" && fs.existsSync(sourceDir)) {
          const shared = fs.readdirSync(sourceDir).some((name) =>
            /\.mc$/i.test(name) && path.relative(source, path.join(sourceDir, name)) !== "") ||
            others.some((p) => path.relative(sourceDir, path.dirname(p.sourcePath!)) === "");
          if (!shared) for (const asset of Object.values(project.sourceAssets ?? {})) {
            const file = child(sourceDir, asset.fileName);
            checkFingerprint(file, asset.fingerprint);
            add(file);
          }
        }
      } else if (fs.existsSync(source) && project.sourceKind === "mcz" && charts[0].archiveEntry !== null) {
        rewrite = source;
        selectedName = charts[0].fileName;
        archiveEntry = charts[0].archiveEntry ?? "";
        paths.push(`${source}（仅移除谱面 ${archiveEntry || selectedName}）`);
      }
    }
  } else {
    // Only persisted legacy records are addressable. Never delete their parent directory.
    const history = path.join(root, ARTIFACTS_REL, "projects");
    let count = 0;
    for (const key of fs.existsSync(history) ? fs.readdirSync(history) : []) {
      const state = readJsonIfExists<{ sourcePath: string; sourceSha1: string }>(path.join(history, key, "state.json"));
      if (!state?.sourcePath || parseManagedSrc(state.sourcePath) || projectKey(state.sourcePath) !== key) continue;
      const n = normalizeSrcRel(state.sourcePath);
      if (!n.ok || dirOf(n.rel) !== projectId) continue;
      count++;
      if (chartRef && chartRef !== n.rel) continue;
      const file = path.resolve(root, n.rel);
      if (path.extname(file).toLowerCase() !== ".mc") throw new Error("来源类型不合法");
      checkPath(file);
      if (fs.existsSync(file) && crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex") !== state.sourceSha1) {
        throw new Error(`原文件已被修改：${file}`);
      }
      add(file);
      refs.add(n.rel);
    }
    if (!refs.size) throw new Error("找不到登记的工程或谱面");
    wholeProject = count === refs.size;
  }
  for (const ref of refs) add(projectDir(projectKey(ref)), true);
  const token = crypto.createHash("sha256").update(JSON.stringify([projectId, chartRef, [...refs], paths.sort(), project?.sourceFingerprint])).digest("hex");
  if (confirmToken === undefined) return { wholeProject, paths, token };
  if (token !== confirmToken) throw new Error("删除清单已变化，请重新确认");

  const suffix = ".purge-" + crypto.randomUUID();
  const staged: { from: string; temp: string }[] = [];
  const replacement = rewrite ? rewrite + suffix + ".new" : null;
  let replaced = false;
  try {
    if (rewrite && replacement && project) {
      const mapping: Record<string, string> = JSON.parse(execFileSync(resolvePythonCommand(root),
        [path.join(root, "scripts", "remove_mcz_chart.py"), rewrite, replacement, selectedName, archiveEntry],
        { encoding: "utf8", windowsHide: true, timeout: 120000 }));
      if (fs.existsSync(replacement)) {
        checkFingerprint(rewrite, project.sourceFingerprint);
        targets.add(rewrite);
        for (const c of project.charts) if (c.archiveEntry === undefined) c.archiveEntry = mapping[c.fileName] ?? null;
      }
    }
    for (const from of targets) {
      if ([...targets].some((parent) => parent !== from && from.toLowerCase().startsWith(parent.toLowerCase() + path.sep))) continue;
      const temp = from + suffix;
      fs.renameSync(from, temp);
      staged.push({ from, temp });
    }
    if (rewrite && replacement && project && fs.existsSync(replacement)) {
      fs.renameSync(replacement, rewrite);
      replaced = true;
      project.sourceFingerprint = fingerprintFile(rewrite);
    }
    if (project) {
      if (wholeProject) {
        const workspace = path.resolve(root, project.workspaceRel);
        if (path.dirname(workspace) === path.resolve(root, IMPORTS_REL) && fs.existsSync(workspace)) {
          registry.purgedImportDirs = [...new Set([...(registry.purgedImportDirs ?? []), path.basename(workspace).toLowerCase()])];
        }
        registry.managedProjects = registry.managedProjects.filter((p) => p !== project);
        const sampleDir = path.join(root, "WDA");
        const samples = fs.existsSync(sampleDir) ? fs.readdirSync(sampleDir).filter((n) => /\.mcz$/i.test(n)) : [];
        // A saved example may point at its copy while retaining its original path-based id.
        const sampleNames = samples.filter((n) => {
          const original = fs.realpathSync.native(path.join(sampleDir, n));
          return crypto.createHash("sha256").update(process.platform === "win32" ? original.toLowerCase() : original).digest("hex").slice(0, 16) === project.id;
        });
        if (project.sourcePath && isProtectedWda(project.sourcePath)) sampleNames.push(path.basename(project.sourcePath));
        if (sampleNames.length) registry.purgedExamples = [...new Set([...(registry.purgedExamples ?? []), ...sampleNames.map((n) => n.toLowerCase())])];
      } else {
        project.charts = project.charts.filter((c) => !refs.has(managedSrc(project.id, c.id)));
        project.updatedAt = new Date().toISOString();
      }
    }
    if (wholeProject) registry.hiddenProjects = registry.hiddenProjects.filter((id) => id !== projectId);
    registry.hiddenCharts = registry.hiddenCharts.filter((ref) => !refs.has(ref));
    if (refs.has(registry.lastOpenedSrc ?? "")) registry.lastOpenedSrc = null;
    saveRegistry(registry);
  } catch (error) {
    if (rewrite && replaced) fs.unlinkSync(rewrite);
    for (const item of staged.reverse()) fs.renameSync(item.temp, item.from);
    throw error;
  } finally {
    if (replacement) fs.rmSync(replacement, { force: true });
  }
  for (const { from, temp } of staged) {
    if (path.dirname(temp) !== path.dirname(from) || temp !== from + suffix) throw new Error("删除路径越界");
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
  }
  return { wholeProject, paths, token };
}
