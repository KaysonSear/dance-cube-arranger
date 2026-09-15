import { describe, expect, it } from "vitest";

import {
  addHidden,
  applyHidden,
  assetDisplayRows,
  currentPackageOf,
  dirOf,
  migrateProjectRegistry,
  removeHidden,
  resolveLastOpenedSrc,
  shapePackageList,
  type PackagesInput,
} from "../src/lib/projects";

const DEFAULT_SRC = "WDA/WDA_Recorded.mc";

function input(over: Partial<PackagesInput> = {}): PackagesInput {
  return {
    defaultSrc: DEFAULT_SRC,
    states: {},
    folders: [
      { dir: "WDA", title: "WDA", charts: [{ src: DEFAULT_SRC, title: "WDA_Recorded" }] },
      {
        dir: "artifacts/arranger/imports/multi-0724",
        title: "multi-0724",
        charts: [
          { src: "artifacts/arranger/imports/multi-0724/hard.mc", title: "hard" },
          { src: "artifacts/arranger/imports/multi-0724/easy.mc", title: "easy" },
          { src: "artifacts/arranger/imports/multi-0724/insane.mc", title: "insane" },
        ],
      },
    ],
    ...over,
  };
}

describe("dirOf", () => {
  it("取 posix 目录", () => {
    expect(dirOf("WDA/WDA_Recorded.mc")).toBe("WDA");
    expect(dirOf("artifacts/arranger/imports/x/y.mc")).toBe("artifacts/arranger/imports/x");
    expect(dirOf("bare.mc")).toBe("");
  });
});

describe("shapePackageList(一曲多包)", () => {
  it("一个文件夹 3 张 .mc → 1 个包 3 张谱(旧实现会整目录跳过 —— 本次回归)", () => {
    const pkgs = shapePackageList(input());
    const multi = pkgs.find((p) => p.dir.endsWith("multi-0724"));
    expect(multi).toBeDefined();
    expect(multi!.charts).toHaveLength(3);
    expect(multi!.charts.map((c) => c.title)).toEqual(["easy", "hard", "insane"]); // 按标题排序
  });

  it("默认包最前,且默认谱在包内置顶", () => {
    const pkgs = shapePackageList(input());
    expect(pkgs[0].isDefault).toBe(true);
    expect(pkgs[0].charts[0].src).toBe(DEFAULT_SRC);
  });

  it("包的 updatedAt 取包内最大值", () => {
    const pkgs = shapePackageList(
      input({
        states: {
          "artifacts/arranger/imports/multi-0724/easy.mc": {
            updatedAt: "2026-07-24T01:00:00Z",
            assignedCount: 3,
          },
          "artifacts/arranger/imports/multi-0724/hard.mc": {
            updatedAt: "2026-07-24T09:00:00Z",
            assignedCount: 7,
          },
        },
      }),
    );
    const multi = pkgs.find((p) => p.dir.endsWith("multi-0724"))!;
    expect(multi.updatedAt).toBe("2026-07-24T09:00:00Z");
    expect(multi.charts.find((c) => c.title === "hard")!.assignedCount).toBe(7);
  });

  it("标记隐藏条目", () => {
    const hidden = ["artifacts/arranger/imports/multi-0724/easy.mc"];
    const pkgs = shapePackageList(input({ hidden }));
    const multi = pkgs.find((p) => p.dir.endsWith("multi-0724"))!;
    expect(multi.charts.find((c) => c.title === "easy")!.hidden).toBe(true);
  });
});

describe("applyHidden / currentPackageOf", () => {
  it("隐藏某谱后它从列表消失", () => {
    const pkgs = applyHidden(shapePackageList(input()), [
      "artifacts/arranger/imports/multi-0724/easy.mc",
    ]);
    const multi = pkgs.find((p) => p.dir.endsWith("multi-0724"))!;
    expect(multi.charts.map((c) => c.title)).toEqual(["hard", "insane"]);
  });

  it("整包被隐藏 → 连包一起去掉", () => {
    const all = [
      "artifacts/arranger/imports/multi-0724/easy.mc",
      "artifacts/arranger/imports/multi-0724/hard.mc",
      "artifacts/arranger/imports/multi-0724/insane.mc",
    ];
    const pkgs = applyHidden(shapePackageList(input()), all);
    expect(pkgs.some((p) => p.dir.endsWith("multi-0724"))).toBe(false);
    expect(pkgs).toHaveLength(1); // WDA 仍在
  });

  it("工程级隐藏不需要逐张写 hiddenCharts", () => {
    const pkgs = shapePackageList(input({ hiddenProjects: ["artifacts/arranger/imports/multi-0724"] }));
    expect(
      applyHidden(pkgs, [], ["artifacts/arranger/imports/multi-0724"]).map((project) => project.dir),
    ).toEqual(["WDA"]);
  });

  it("currentPackageOf 定位当前谱所在包", () => {
    const pkgs = shapePackageList(input());
    expect(currentPackageOf(pkgs, "artifacts/arranger/imports/multi-0724/hard.mc")?.dir).toBe(
      "artifacts/arranger/imports/multi-0724",
    );
    expect(currentPackageOf(pkgs, "nope/x.mc")).toBeNull();
  });
});

describe("addHidden / removeHidden", () => {
  it("去重、排序、可逆", () => {
    const a = addHidden([], "b.mc");
    expect(addHidden(a, "b.mc")).toEqual(["b.mc"]); // 幂等
    expect(addHidden(a, "a.mc")).toEqual(["a.mc", "b.mc"]); // 排序
    expect(removeHidden(a, "b.mc")).toEqual([]);
  });
});

describe("工程资产展示", () => {
  it("三类资产同目录时只显示一次路径", () => {
    expect(
      assetDisplayRows({
        charts: [
          { path: "imports/song/easy.mc", dir: "imports/song", name: "easy.mc" },
          { path: "imports/song/hard.mc", dir: "imports/song", name: "hard.mc" },
        ],
        audio: { path: "imports/song/audio.ogg", dir: "imports/song", name: "audio.ogg" },
        cover: { path: "imports/song/cover.jpg", dir: "imports/song", name: "cover.jpg" },
      }),
    ).toEqual({
      commonDir: "imports/song",
      charts: ["easy.mc", "hard.mc"],
      audio: "audio.ogg",
      cover: "cover.jpg",
    });
  });

  it("路径不同时逐项保留完整路径", () => {
    const rows = assetDisplayRows({
      charts: [{ path: "charts/a.mc", dir: "charts", name: "a.mc" }],
      audio: { path: "audio/a.ogg", dir: "audio", name: "a.ogg" },
      cover: null,
    });
    expect(rows.commonDir).toBeNull();
    expect(rows.charts).toEqual(["charts/a.mc"]);
    expect(rows.audio).toBe("audio/a.ogg");
    expect(rows.cover).toBe("缺失");
  });
});

describe("工程注册表迁移", () => {
  it("v1 hidden 谱面无损迁移到 v3", () => {
    expect(
      migrateProjectRegistry({
        schema: 1,
        hidden: ["b.mc", "a.mc"],
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    ).toEqual({
      schema: 3,
      hiddenProjects: [],
      hiddenCharts: ["a.mc", "b.mc"],
      lastOpenedSrc: null,
      lastExportDir: null,
      managedProjects: [],
      updatedAt: "2026-01-01T00:00:00Z",
    });
  });
});

describe("最近打开谱面", () => {
  it("仅恢复仍可见的精确谱面", () => {
    const projects = shapePackageList(input({ hidden: ["artifacts/arranger/imports/multi-0724/easy.mc"] }));
    expect(resolveLastOpenedSrc(DEFAULT_SRC, projects)).toBe(DEFAULT_SRC);
    expect(resolveLastOpenedSrc("artifacts/arranger/imports/multi-0724/easy.mc", projects)).toBeNull();
    expect(resolveLastOpenedSrc("missing.mc", projects)).toBeNull();
  });

  it("首次启动（lastOpenedSrc 为空）时，自动回退到默认示例谱面", () => {
    const projects = shapePackageList(input());
    expect(resolveLastOpenedSrc(null, projects, DEFAULT_SRC)).toBe(DEFAULT_SRC);
  });

  it("非首次启动（已有 lastOpenedSrc）时，始终以用户上次工程为准，不回退到默认谱面", () => {
    const projects = shapePackageList(input());
    const userSrc = "artifacts/arranger/imports/multi-0724/hard.mc";
    expect(resolveLastOpenedSrc(userSrc, projects, DEFAULT_SRC)).toBe(userSrc);
  });
});
