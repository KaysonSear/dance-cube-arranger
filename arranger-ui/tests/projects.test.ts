import { describe, expect, it } from "vitest";

import { shapeProjectList, srcQuery } from "../src/lib/projects";

describe("srcQuery", () => {
  it("URL-encodes slashes", () => {
    expect(srcQuery("WDA/WDA_Recorded.mc")).toBe("?src=WDA%2FWDA_Recorded.mc");
  });
});

describe("shapeProjectList", () => {
  const defaultSrc = "WDA/WDA_Recorded.mc";

  it("default card first, opened by updatedAt desc, never-opened imports last", () => {
    const list = shapeProjectList({
      defaultSrc,
      states: [
        { sourcePath: "artifacts/arranger/imports/b-0723/b.mc", updatedAt: "2026-07-23T10:00:00Z", assignedCount: 5 },
        { sourcePath: defaultSrc, updatedAt: "2026-07-22T09:00:00Z", assignedCount: 2 },
        { sourcePath: "artifacts/arranger/imports/a-0723/a.mc", updatedAt: "2026-07-23T11:00:00Z", assignedCount: 9 },
      ],
      importMcs: [
        { src: "artifacts/arranger/imports/zz-0723/zz.mc", title: "zz-0723" },
        { src: "artifacts/arranger/imports/b-0723/b.mc", title: "b-0723" },
      ],
    });
    expect(list[0]).toMatchObject({ src: defaultSrc, isDefault: true, assignedCount: 2 });
    expect(list.slice(1).map((p) => p.src)).toEqual([
      "artifacts/arranger/imports/a-0723/a.mc",
      "artifacts/arranger/imports/b-0723/b.mc",
      "artifacts/arranger/imports/zz-0723/zz.mc",
    ]);
    // 状态与导入合并去重:b 只出现一次,且带状态数据
    expect(list.filter((p) => p.src.includes("b-0723"))).toHaveLength(1);
    expect(list.find((p) => p.src.includes("b-0723"))?.assignedCount).toBe(5);
  });

  it("default card is present even with no state and no imports", () => {
    const list = shapeProjectList({ defaultSrc, states: [], importMcs: [] });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ src: defaultSrc, isDefault: true, updatedAt: null });
  });
});
