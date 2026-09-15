import { describe, expect, it } from "vitest";

import {
  currentPackageOf,
  resolveLastOpenedSrc,
  shapePackageList,
  type PackagesInput,
} from "../src/lib/projects";
import { GET } from "../src/app/api/projects/route";

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
    const res = await GET(new Request("http://localhost:3000/api/projects"));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.defaultSrc).toMatch(/^managed:/);
    expect(data.packages.length).toBeGreaterThan(0);
    const defaultPkg = data.packages.find((p: { isDefault: boolean }) => p.isDefault);
    expect(defaultPkg).toBeDefined();
    expect(defaultPkg.isExample).toBe(true);
  });
});
