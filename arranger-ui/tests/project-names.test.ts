import { describe, expect, it } from "vitest";

import { normalizeFileName, validateUniqueChartNames } from "../src/lib/project-names";
import { managedSrc, parseManagedSrc } from "../src/lib/projects";
import { normalizeAbsolutePath } from "../src/lib/server/managed-projects";

describe("portable export names", () => {
  it("preserves Unicode and appends the requested extension", () => {
    expect(normalizeFileName("终章 Lv15", ".mc")).toEqual({ ok: true, name: "终章 Lv15.mc" });
    expect(normalizeFileName("舞立方.mcz", ".mcz")).toEqual({ ok: true, name: "舞立方.mcz" });
  });

  it.each(["../x", "a/b", "CON", "LPT1.mc", "tail. ", "bad?.mc"])("rejects %s", (name) => {
    expect(normalizeFileName(name, ".mc").ok).toBe(false);
  });

  it("rejects case-insensitive duplicate archive entries", () => {
    expect(validateUniqueChartNames(["Hard.mc", "hard.MC"])).toMatchObject({ ok: false });
  });
});

describe("opaque managed source refs", () => {
  it("round trips without a filesystem path", () => {
    const src = managedSrc("0123456789abcdef", "aabbccddeeff");
    expect(parseManagedSrc(src)).toEqual({ projectId: "0123456789abcdef", chartId: "aabbccddeeff" });
    expect(src).not.toContain("\\");
    expect(src).not.toContain("/");
  });
});

describe("absolute project paths", () => {
  it("accepts drive and UNC paths but rejects relative input", () => {
    expect(normalizeAbsolutePath("D:\\谱面\\song.mcz")).toEqual({ ok: true, path: "D:\\谱面\\song.mcz" });
    expect(normalizeAbsolutePath("\\\\server\\share\\song.mc").ok).toBe(true);
    expect(normalizeAbsolutePath("../song.mc").ok).toBe(false);
  });
});
