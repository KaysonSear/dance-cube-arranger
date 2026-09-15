import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ root: "" }));
vi.mock("../src/lib/server/paths", async (original) => ({
  ...await original<typeof import("../src/lib/server/paths")>(),
  findRepoRoot: () => fixture.root,
}));
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

import { spawn } from "node:child_process";
import { managedSrc, type ManagedProjectRecord } from "../src/lib/projects";
import { openManagedPath } from "../src/lib/server/managed-projects";
import { readRegistry, saveRegistry } from "../src/lib/server/store";

let completions: ((ok?: boolean) => void)[];

function source(name: string): string {
  const file = path.join(fixture.root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "source bytes");
  return file;
}

function record(file: string): ManagedProjectRecord {
  const canonical = fs.realpathSync.native(file);
  const id = crypto.createHash("sha256")
    .update(process.platform === "win32" ? canonical.toLowerCase() : canonical).digest("hex").slice(0, 16);
  return {
    id, workspaceRel: `artifacts/arranger/workspaces/${id}`, displayName: "Edited project",
    sourcePath: file, sourceKind: "mcz", sourceFingerprint: "saved fingerprint",
    charts: [{ id: "123456789abc", fileName: "renamed.mc", title: "My chart" }],
    createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T01:00:00Z",
    lastSyncedAt: "2026-09-08T01:00:00Z", copyOnWrite: false,
  };
}

function seed(project: ManagedProjectRecord) {
  const workspace = path.join(fixture.root, project.workspaceRel);
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "renamed.mc"), "unique edited chart");
  const registry = readRegistry();
  registry.managedProjects.push(project);
  registry.hiddenProjects = [project.id];
  registry.hiddenCharts = [managedSrc(project.id, project.charts[0].id)];
  registry.lastOpenedSrc = "managed:aaaaaaaaaaaaaaaa:bbbbbbbbbbbb";
  saveRegistry(registry);
  return workspace;
}

beforeEach(() => {
  fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), "arranger-registration-"));
  completions = [];
  vi.mocked(spawn).mockReset();
  vi.mocked(spawn).mockImplementation(((_exe: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
    });
    const output = args[args.indexOf("--out-dir") + 1];
    completions.push((ok = true) => {
      if (ok) fs.writeFileSync(path.join(output, "chart.mc"), "imported chart");
      child.stdout.write(JSON.stringify(ok
        ? { ok: true, mcs: [path.join(output, "chart.mc")] }
        : { ok: false, error: "test unpack failure" }));
      child.emit("close", ok ? 0 : 1);
    });
    return child;
  }) as typeof spawn);
});

afterEach(() => {
  vi.restoreAllMocks();
  // Only the exact temporary fixture created above may be removed.
  const target = path.resolve(fixture.root);
  if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith("arranger-registration-")) {
    throw new Error("Unexpected fixture cleanup path");
  }
  fs.rmSync(target, { recursive: true, force: true });
});

describe("managed project registration", () => {
  it("reuses a WDA project after copy-on-write without touching edits or navigation", async () => {
    const original = source("WDA/song.mcz");
    const project = record(original);
    project.sourcePath = source("artifacts/arranger/managed/song.mcz");
    const workspace = seed(project);
    const before = readRegistry();
    const pending = openManagedPath(original, { updateLastOpened: false });
    completions.forEach((complete) => complete());
    const result = await pending;
    expect(result).toEqual({ project, src: managedSrc(project.id, project.charts[0].id), reused: true });
    expect(spawn).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(workspace, "renamed.mc"), "utf8")).toBe("unique edited chart");
    expect(readRegistry()).toEqual(before);
  });

  it("reopens the renamed current source with the original ids", async () => {
    const original = source("before.mcz");
    const project = record(original);
    const renamed = path.join(fixture.root, "after.mcz");
    fs.renameSync(original, renamed);
    project.sourcePath = renamed;
    seed(project);
    const result = await openManagedPath(renamed);
    expect(result.project).toEqual(project);
    expect(readRegistry().lastOpenedSrc).toBe(managedSrc(project.id, project.charts[0].id));
    expect(spawn).not.toHaveBeenCalled();
  });

  it("coalesces concurrent imports and honors the explicit caller's navigation", async () => {
    const file = source("song.mcz");
    const a = openManagedPath(file, { updateLastOpened: false });
    const b = openManagedPath(file);
    const calls = completions.length;
    completions.forEach((complete) => complete());
    const [first, second] = await Promise.all([a, b]);
    expect(calls).toBe(1);
    expect(first.src).toBe(second.src);
    expect(readRegistry().managedProjects).toHaveLength(1);
    expect(readRegistry().lastOpenedSrc).toBe(second.src);
  });

  it("preserves registry updates made while another source is unpacking", async () => {
    const a = openManagedPath(source("a.mcz"), { updateLastOpened: false });
    const b = openManagedPath(source("b.mcz"), { updateLastOpened: false });
    const current = readRegistry();
    current.hiddenProjects = ["keep-hidden"];
    current.lastOpenedSrc = "keep-current";
    saveRegistry(current);
    completions[1]();
    await b;
    completions[0]();
    await a;
    expect(readRegistry().managedProjects).toHaveLength(2);
    expect(readRegistry().hiddenProjects).toEqual(["keep-hidden"]);
    expect(readRegistry().lastOpenedSrc).toBe("keep-current");
  });

  it("refuses an occupied unregistered workspace without deleting its files", async () => {
    const file = source("song.mcz");
    const project = record(file);
    const workspace = path.join(fixture.root, project.workspaceRel);
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, "evidence.txt"), "keep");
    const pending = openManagedPath(file);
    completions.forEach((complete) => complete());
    await expect(pending).rejects.toThrow(/工作目录已存在/);
    expect(fs.readFileSync(path.join(workspace, "evidence.txt"), "utf8")).toBe("keep");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("cleans only its staging directory on failure and allows retry", async () => {
    const file = source("song.mcz");
    const sibling = path.join(fixture.root, "artifacts/arranger/workspaces/keep");
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(sibling, "evidence.txt"), "keep");
    const failed = openManagedPath(file);
    completions[0](false);
    await expect(failed).rejects.toThrow("test unpack failure");
    expect(fs.readdirSync(path.dirname(sibling))).toEqual(["keep"]);
    expect(readRegistry().managedProjects).toHaveLength(0);
    const retry = openManagedPath(file);
    completions[1]();
    await retry;
    expect(readRegistry().managedProjects).toHaveLength(1);
    expect(fs.readFileSync(path.join(sibling, "evidence.txt"), "utf8")).toBe("keep");
  });

  it("rechecks registration after unpacking and discards only its own staging files", async () => {
    const file = source("song.mcz");
    const pending = openManagedPath(file, { updateLastOpened: false });
    const project = record(file);
    const workspace = seed(project);
    const before = readRegistry();
    completions[0]();
    expect((await pending).project).toEqual(project);
    expect(readRegistry()).toEqual(before);
    expect(fs.readFileSync(path.join(workspace, "renamed.mc"), "utf8")).toBe("unique edited chart");
    expect(fs.readdirSync(path.dirname(workspace))).toEqual([project.id]);
  });

  it("preserves a workspace created by another caller during unpacking", async () => {
    const file = source("song.mcz");
    const pending = openManagedPath(file);
    const project = record(file);
    const workspace = path.join(fixture.root, project.workspaceRel);
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(workspace, "evidence.txt"), "keep");
    completions[0]();
    await expect(pending).rejects.toThrow(/工作目录已存在/);
    expect(fs.readFileSync(path.join(workspace, "evidence.txt"), "utf8")).toBe("keep");
    expect(fs.readdirSync(path.dirname(workspace))).toEqual([project.id]);
    expect(readRegistry().managedProjects).toHaveLength(0);
  });

  it("preserves published files if registry persistence fails", async () => {
    const file = source("song.mcz");
    const pending = openManagedPath(file);
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to).endsWith("registry.json")) throw new Error("test registry write failure");
      return rename(from, to);
    });
    completions[0]();
    await expect(pending).rejects.toThrow("test registry write failure");
    const workspace = path.join(fixture.root, record(file).workspaceRel);
    expect(fs.readFileSync(path.join(workspace, "chart.mc"), "utf8")).toBe("imported chart");
    expect(readRegistry().managedProjects).toHaveLength(0);
    await expect(openManagedPath(file)).rejects.toThrow(/工作目录已存在/);
  });

  it.each(["id", "workspace"])("rejects duplicate %s before changing the registry file", (field) => {
    const a = record(source("a.mcz"));
    seed(a);
    const b = record(source("b.mcz"));
    if (field === "id") b.id = a.id;
    else b.workspaceRel = a.workspaceRel.replaceAll("/", "\\").toUpperCase();
    const file = path.join(fixture.root, "artifacts/arranger/registry.json");
    const before = fs.readFileSync(file);
    const registry = readRegistry();
    registry.managedProjects.push(b);
    expect(() => saveRegistry(registry)).toThrow(/重复/);
    expect(fs.readFileSync(file)).toEqual(before);
  });
});
