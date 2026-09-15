import { describe, expect, it } from "vitest";

import { looksLikePlaceholder } from "../src/lib/arrangement";
import type { SourceNote } from "../src/lib/mc";
import { bridgeBasename, packageChartsFrom } from "../src/lib/server/imports";

const sn = (column: number): SourceNote => ({
  beat: [0, 0, 1],
  beatFloat: 0,
  column,
  endbeat: null,
  endbeatFloat: null,
});

describe("bridgeBasename(Windows 反斜杠路径)", () => {
  it("反斜杠 / posix / 裸文件名都取到文件名", () => {
    expect(bridgeBasename("artifacts\\arranger\\imports\\x\\chart.mc")).toBe("chart.mc");
    expect(bridgeBasename("artifacts/arranger/imports/x/chart.mc")).toBe("chart.mc");
    expect(bridgeBasename("chart.mc")).toBe("chart.mc");
  });
});

describe("packageChartsFrom", () => {
  it("整形成 ?src 可用的相对路径 + 标题", () => {
    expect(
      packageChartsFrom(["out\\easy.mc", "out\\hard.mc"], "artifacts/arranger/imports/m-0724"),
    ).toEqual([
      { src: "artifacts/arranger/imports/m-0724/easy.mc", title: "easy" },
      { src: "artifacts/arranger/imports/m-0724/hard.mc", title: "hard" },
    ]);
  });

  it("非数组输入 → 空列表(桥回传异常不应崩)", () => {
    expect(packageChartsFrom(undefined, "d")).toEqual([]);
    expect(packageChartsFrom("nope", "d")).toEqual([]);
  });
});

describe("looksLikePlaceholder(打开对话框的占位默认值)", () => {
  it("列全同或空 → 视为占位", () => {
    expect(looksLikePlaceholder([])).toBe(true);
    expect(looksLikePlaceholder([sn(5), sn(5), sn(5)])).toBe(true);
    expect(looksLikePlaceholder([sn(5)])).toBe(true);
  });

  it("已排键(多列) → 不是占位", () => {
    expect(looksLikePlaceholder([sn(0), sn(2), sn(3)])).toBe(false);
  });
});
