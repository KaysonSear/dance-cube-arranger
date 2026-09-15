/** 物理删除导入工程的边界校验与文件操作；接受 root 以便临时目录测试。 */

import fs from "node:fs";
import path from "node:path";

import { dirOf } from "../projects";
import { backupRelFor } from "../writeback";
import { IMPORTS_REL, listAssets, MC_EXTS } from "./paths";

export function resolveImportProject(root: string, projectRel: string): string | null {
  const importsRoot = path.resolve(root, IMPORTS_REL);
  const projectAbs = path.resolve(root, projectRel);
  const relative = path.relative(importsRoot, projectAbs);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || relative.includes(path.sep)) {
    return null;
  }
  return projectAbs;
}

export function listProjectCharts(root: string, projectRel: string): string[] {
  const projectAbs = resolveImportProject(root, projectRel);
  if (!projectAbs || !fs.existsSync(projectAbs) || !fs.statSync(projectAbs).isDirectory()) return [];
  return listAssets(fs.readdirSync(projectAbs), MC_EXTS).map((name) => `${projectRel}/${name}`);
}

export function purgeChartFiles(root: string, chartRel: string): {
  deleted: string[];
  projectRemoved: boolean;
} {
  const projectRel = dirOf(chartRel);
  const projectAbs = resolveImportProject(root, projectRel);
  const chartAbs = path.resolve(root, chartRel);
  if (!projectAbs || path.dirname(chartAbs) !== projectAbs) throw new Error("谱面不属于可删除的导入工程");
  const deleted: string[] = [];
  if (fs.existsSync(chartAbs)) {
    fs.rmSync(chartAbs, { force: true });
    deleted.push(chartRel);
  }
  const backupRel = backupRelFor(chartRel);
  const backupAbs = path.resolve(root, backupRel);
  if (fs.existsSync(backupAbs)) {
    fs.rmSync(backupAbs, { force: true });
    deleted.push(backupRel);
  }
  const remaining = listAssets(fs.readdirSync(projectAbs), MC_EXTS);
  if (remaining.length > 0) return { deleted, projectRemoved: false };
  fs.rmSync(projectAbs, { recursive: true, force: true });
  deleted.push(`${projectRel}/`);
  return { deleted, projectRemoved: true };
}

export function purgeProjectFiles(root: string, projectRel: string): string[] {
  const projectAbs = resolveImportProject(root, projectRel);
  if (!projectAbs || !fs.existsSync(projectAbs) || !fs.statSync(projectAbs).isDirectory()) {
    throw new Error("工程不存在或不允许彻底删除");
  }
  fs.rmSync(projectAbs, { recursive: true, force: true });
  return [`${projectRel}/`];
}
