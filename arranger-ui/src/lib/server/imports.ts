/** 导入工程:slug 生成、文件名净化与三件套落盘(artifacts/arranger/imports/<slug>/)。 */

import fs from "node:fs";
import path from "node:path";

import { findRepoRoot, IMPORTS_REL } from "./paths";

export const PROJECT_MANIFEST = "arranger-project.v1.json";

export interface ProjectManifestV1 {
  schema: 1;
  name: string;
  importedFrom: string;
  importedAt: string;
}

export function writeProjectManifest(dirAbs: string, name: string, importedFrom: string): void {
  const manifest: ProjectManifestV1 = {
    schema: 1,
    name,
    importedFrom,
    importedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(dirAbs, PROJECT_MANIFEST),
    JSON.stringify(manifest, null, 2),
    "utf-8",
  );
}

/** 小写-连字符 slug;非 ASCII(如纯中文名)落到 "import" 兜底。 */
export function slugify(input: string): string {
  const s = input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return s || "import";
}

/** 工程 slug 基名:<slug>-MMDD。 */
export function importSlug(nameOrStem: string, now: Date): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${slugify(nameOrStem)}-${mm}${dd}`;
}

/** 撞名追加 -2/-3…(纯,注入 exists 以便测试)。 */
export function uniqueSlug(base: string, exists: (s: string) => boolean): string {
  if (!exists(base)) return base;
  for (let i = 2; i <= 99; i++) {
    const s = `${base}-${i}`;
    if (!exists(s)) return s;
  }
  throw new Error(`slug 冲突过多: ${base}`);
}

/** 仅保留 basename;白名单外字符 → _;去前导点;截断保扩展名。 */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  let s = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  if (s.length > 80) {
    const ext = path.posix.extname(s);
    s = s.slice(0, 80 - ext.length) + ext;
  }
  return s || "file";
}

/**
 * Python 桥跑在 **Windows venv** 上,回传的是反斜杠路径;Linux 的 `path.basename` 不认 `\`,
 * 直接取会拼出 `.../imports/<slug>/artifacts\...\chart.mc`(本会话已被咬过一次)。
 */
export function bridgeBasename(p: string): string {
  return String(p).replace(/\\/g, "/").split("/").pop() ?? "";
}

/** 把桥回传的 `mcs[]` 整形成可直接用作 `?src` 的仓库相对路径 + 标题。 */
export function packageChartsFrom(
  mcs: unknown,
  dirRel: string,
): { src: string; title: string }[] {
  if (!Array.isArray(mcs)) return [];
  return mcs
    .map((p) => bridgeBasename(String(p)))
    .filter(Boolean)
    .map((name) => ({ src: `${dirRel}/${name}`, title: name.replace(/\.mc$/i, "") }));
}

export interface ImportFile {
  name: string;
  data: Buffer;
}

/** 创建 imports/<uniqueSlug>/ 并写入三件套;返回仓库相对目录(POSIX 分隔)。 */
export function writeImport(opts: { slugBase: string; files: ImportFile[] }): { dirRel: string } {
  const root = findRepoRoot();
  const importsAbs = path.join(root, IMPORTS_REL);
  fs.mkdirSync(importsAbs, { recursive: true });
  const slug = uniqueSlug(opts.slugBase, (s) => fs.existsSync(path.join(importsAbs, s)));
  const dirAbs = path.join(importsAbs, slug);
  fs.mkdirSync(dirAbs);
  for (const f of opts.files) {
    fs.writeFileSync(path.join(dirAbs, f.name), f.data);
  }
  return { dirRel: `artifacts/arranger/imports/${slug}` };
}
