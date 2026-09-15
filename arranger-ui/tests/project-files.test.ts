import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  listProjectCharts,
  purgeChartFiles,
  purgeProjectFiles,
  resolveImportProject,
} from "../src/lib/server/project-files";

let root: string;
const projectRel = "artifacts/arranger/imports/test-project";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "arranger-delete-"));
  const project = path.join(root, projectRel);
  fs.mkdirSync(project, { recursive: true });
  for (const name of ["easy.mc", "hard.mc", "easy.mc.orig", "audio.ogg", "cover.jpg"]) {
    fs.writeFileSync(path.join(project, name), name);
  }
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("导入工程物理删除", () => {
  it("单谱删除保留兄弟谱和共享素材", () => {
    const result = purgeChartFiles(root, `${projectRel}/easy.mc`);
    expect(result.projectRemoved).toBe(false);
    expect(listProjectCharts(root, projectRel)).toEqual([`${projectRel}/hard.mc`]);
    expect(fs.existsSync(path.join(root, projectRel, "audio.ogg"))).toBe(true);
    expect(fs.existsSync(path.join(root, projectRel, "cover.jpg"))).toBe(true);
  });

  it("最后一谱删除清理整个工程", () => {
    purgeChartFiles(root, `${projectRel}/easy.mc`);
    expect(purgeChartFiles(root, `${projectRel}/hard.mc`).projectRemoved).toBe(true);
    expect(fs.existsSync(path.join(root, projectRel))).toBe(false);
  });

  it("整包删除清理所有真实文件", () => {
    purgeProjectFiles(root, projectRel);
    expect(fs.existsSync(path.join(root, projectRel))).toBe(false);
  });

  it("拒绝 WDA、越界与 imports 根本身", () => {
    expect(resolveImportProject(root, "WDA")).toBeNull();
    expect(resolveImportProject(root, "artifacts/arranger/imports/../outside")).toBeNull();
    expect(resolveImportProject(root, "artifacts/arranger/imports")).toBeNull();
  });
});
