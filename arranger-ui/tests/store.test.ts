import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeJsonAtomic } from "../src/lib/server/store";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "arranger-store-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const errno = (code: string) => Object.assign(new Error(code), { code });

describe("writeJsonAtomic", () => {
  it("retries a transiently locked target and leaves no temp file", () => {
    const rename = fs.renameSync;
    let failures = 2;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (failures-- > 0) throw errno("EPERM");
      rename(from, to);
    });
    const file = path.join(dir, "registry.json");

    writeJsonAtomic(file, { schema: 3 });

    expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual({ schema: 3 });
    expect(fs.readdirSync(dir)).toEqual(["registry.json"]);
  });

  it("removes the temp file and keeps the previous content when the rename keeps failing", () => {
    const file = path.join(dir, "registry.json");
    fs.writeFileSync(file, '{"before":true}');
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw errno("ENOSPC");
    });

    expect(() => writeJsonAtomic(file, { after: true })).toThrow("ENOSPC");

    expect(fs.readFileSync(file, "utf-8")).toBe('{"before":true}');
    expect(fs.readdirSync(dir)).toEqual(["registry.json"]);
  });
});
