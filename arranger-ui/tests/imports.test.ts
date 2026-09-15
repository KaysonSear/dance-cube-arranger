import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  importSlug,
  PROJECT_MANIFEST,
  sanitizeFilename,
  slugify,
  uniqueSlug,
  writeProjectManifest,
} from "../src/lib/server/imports";

describe("slugify / importSlug", () => {
  it("lowercases, dashes runs, trims, caps length", () => {
    expect(slugify("My Song  Name")).toBe("my-song-name");
    expect(slugify("--Hello__World!!")).toBe("hello-world");
    expect(slugify("a".repeat(60)).length).toBeLessThanOrEqual(40);
  });

  it("CJK-only input falls back", () => {
    expect(slugify("中文歌名")).toBe("import");
  });

  it("importSlug appends MMDD", () => {
    expect(importSlug("Foo", new Date("2026-07-23T12:00:00Z"))).toMatch(/^foo-\d{4}$/);
  });
});

describe("uniqueSlug", () => {
  it("returns base when free, else -2, -3 …", () => {
    expect(uniqueSlug("foo", () => false)).toBe("foo");
    const taken = new Set(["foo", "foo-2"]);
    expect(uniqueSlug("foo", (s) => taken.has(s))).toBe("foo-3");
  });
});

describe("工程元数据", () => {
  it("保留用户工程名与原始导入来源", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arranger-project-"));
    try {
      writeProjectManifest(dir, "中文工程名", "source.mcz");
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, PROJECT_MANIFEST), "utf-8"));
      expect(manifest).toMatchObject({ schema: 1, name: "中文工程名", importedFrom: "source.mcz" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("sanitizeFilename", () => {
  it("strips paths, weird chars, leading dots; preserves extension", () => {
    expect(sanitizeFilename("C:\\dir\\My Song.mc")).toBe("My_Song.mc");
    expect(sanitizeFilename("a/b/c.ogg")).toBe("c.ogg");
    expect(sanitizeFilename(".hidden.jpg")).toBe("hidden.jpg");
    expect(sanitizeFilename("中文.mc")).toBe("__.mc");
    const long = sanitizeFilename(`${"x".repeat(120)}.jpg`);
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith(".jpg")).toBe(true);
  });
});
