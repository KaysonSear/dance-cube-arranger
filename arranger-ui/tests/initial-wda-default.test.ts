import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  currentPackageOf,
  resolveLastOpenedSrc,
  shapePackageList,
  type PackagesInput,
  type ProjectRegistryV3,
} from "../src/lib/projects";

// GET /api/projects writes the registry and adopts WDA packages, so it must never run
// against the real repository's artifacts/arranger/ (live user data).
let root: string;

beforeEach(() => {
  vi.resetModules();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "arranger-wda-default-"));
  fs.mkdirSync(path.join(root, "configs"));
  fs.writeFileSync(path.join(root, "configs/column_geometry.json"), "{}");
  vi.spyOn(process, "cwd").mockReturnValue(root);
});

afterEach(() => {
  vi.restoreAllMocks();
  const target = path.resolve(root);
  if (
    path.dirname(target) !== path.resolve(os.tmpdir()) ||
    !path.basename(target).startsWith("arranger-wda-default-")
  ) {
    throw new Error("Unsafe fixture path");
  }
  fs.rmSync(target, { recursive: true, force: true });
});

/** A registered WDA example workspace, as left behind by a previous first launch. */
function seedWdaProject(): string {
  const id = "fcbb062741c9ef65";
  const workspaceRel = `artifacts/arranger/workspaces/${id}`;
  const workspace = path.join(root, workspaceRel);
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "chart.mc"), "{}");
  fs.writeFileSync(path.join(workspace, "audio.ogg"), "audio");
  fs.writeFileSync(path.join(workspace, "cover.jpg"), "cover");
  const now = new Date(0).toISOString();
  const registry: ProjectRegistryV3 = {
    schema: 3,
    hiddenProjects: [],
    hiddenCharts: [],
    lastOpenedSrc: null,
    lastExportDir: null,
    updatedAt: now,
    managedProjects: [
      {
        id,
        displayName: "WDA",
        workspaceRel,
        sourceKind: "mcz",
        // Only path containment under <root>/WDA matters; the package itself is not needed.
        sourcePath: path.join(root, "WDA", "demo.mcz"),
        sourceFingerprint: null,
        charts: [{ id: "cbe0d7c28c87", fileName: "chart.mc", title: "chart" }],
        createdAt: now,
        updatedAt: now,
        lastSyncedAt: now,
        copyOnWrite: true,
      },
    ],
  };
  fs.writeFileSync(path.join(root, "artifacts/arranger/registry.json"), JSON.stringify(registry));
  return `managed:${id}:cbe0d7c28c87`;
}

describe("首次启动默认 WDA 示例谱面与后续记忆", () => {
  const WDA_SRC = "managed:fcbb062741c9ef65:cbe0d7c28c87";
  const USER_SRC = "managed:1234567812345678:abcdef123456";

  const folders: PackagesInput["folders"] = [
    {
      dir: "fcbb062741c9ef65",
      title: "WDA_(Whole_Different_Animal)_(feat._G-DRAGON)",
      isExample: true,
      charts: [{ src: WDA_SRC, title: "chart" }],
    },
    {
      dir: "1234567812345678",
      title: "User_Custom_Project",
      charts: [{ src: USER_SRC, title: "chart" }],
    },
  ];

  it("下载后的首次启动（lastOpenedSrc 为 null）：自动命中 WDA 默认示例谱面", () => {
    const packages = shapePackageList({
      folders,
      states: {},
      defaultSrc: WDA_SRC,
    });

    const resolved = resolveLastOpenedSrc(null, packages, WDA_SRC);
    expect(resolved).toBe(WDA_SRC);

    // 并且 WDA 工程包被标记为 isDefault 与 isExample
    const wdaPkg = currentPackageOf(packages, WDA_SRC);
    expect(wdaPkg).toBeDefined();
    expect(wdaPkg!.isDefault).toBe(true);
    expect(wdaPkg!.isExample).toBe(true);
  });

  it("第二、三、四次打开编辑器：仍以上次关闭时工程为准，不重置回 WDA", () => {
    const packages = shapePackageList({
      folders,
      states: {},
      defaultSrc: WDA_SRC,
    });

    // 用户上次关闭时打开的是自制工程 USER_SRC
    const resolved = resolveLastOpenedSrc(USER_SRC, packages, WDA_SRC);
    expect(resolved).toBe(USER_SRC);
    expect(resolved).not.toBe(WDA_SRC);
  });

  it("GET /api/projects 返回中包含 WDA 默认谱面与 isExample 标识", async () => {
    const wdaSrc = seedWdaProject();
    const { GET } = await import("../src/app/api/projects/route");
    const res = await GET(new Request("http://localhost:3000/api/projects"));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.defaultSrc).toBe(wdaSrc);
    expect(data.packages.length).toBeGreaterThan(0);
    const defaultPkg = data.packages.find((p: { isDefault: boolean }) => p.isDefault);
    expect(defaultPkg).toBeDefined();
    expect(defaultPkg.isExample).toBe(true);

    // First launch records the default as last opened — in the fixture registry only.
    const saved = JSON.parse(
      fs.readFileSync(path.join(root, "artifacts/arranger/registry.json"), "utf-8"),
    ) as ProjectRegistryV3;
    expect(saved.lastOpenedSrc).toBe(wdaSrc);
  });
});
