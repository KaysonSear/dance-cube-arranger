import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBlankMc, DEFAULT_CHART_METADATA } from "../src/lib/chart-setup";

const repo = path.resolve(__dirname, "../..");
let root: string;
const text = buildBlankMc(DEFAULT_CHART_METADATA, { audioName: "audio.wav", coverName: "cover.png" });
const request = (src: string, body?: unknown) => new Request(`http://localhost/api?src=${encodeURIComponent(src)}`, body ? {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
} : undefined);

beforeEach(() => {
  vi.resetModules();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "arranger-independent-"));
  fs.mkdirSync(path.join(root, "configs"));
  fs.writeFileSync(path.join(root, "configs/column_geometry.json"), "{}");
  vi.spyOn(process, "cwd").mockReturnValue(root);
});
afterEach(() => {
  vi.restoreAllMocks();
  const target = path.resolve(root);
  if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith("arranger-independent-")) throw new Error("Unsafe fixture path");
  fs.rmSync(target, { recursive: true, force: true });
});

async function opened() {
  const dir = path.join(root, "original");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "chart.mc"), text);
  fs.writeFileSync(path.join(dir, "audio.wav"), "RIFF0000WAVEoriginal audio");
  fs.writeFileSync(path.join(dir, "cover.png"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const { openManagedPath } = await import("../src/lib/server/managed-projects");
  return { ...await openManagedPath(path.join(dir, "chart.mc")), dir };
}

describe("projects survive removal of external originals", () => {
  it.each(["audio.wav", "cover.png", "chart.mc", "directory"])("reads and saves after deleting %s", async (removed) => {
    const project = await opened();
    if (removed === "directory") fs.rmSync(project.dir, { recursive: true });
    else fs.unlinkSync(path.join(project.dir, removed));
    const { GET: chart } = await import("../src/app/api/chart/route");
    const { GET: audio } = await import("../src/app/api/audio/route");
    const { GET: cover } = await import("../src/app/api/cover/route");
    expect((await (await chart(request(project.src))).json()).text).toBe(text);
    const ranged = new Request(request(project.src), { headers: { Range: "bytes=0-3" } });
    const response = await audio(ranged);
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("RIFF");
    expect((await cover(request(project.src))).status).toBe(200);
    const { POST: save } = await import("../src/app/api/projects/save/route");
    const result = await save(request(project.src, { mcText: text }));
    expect(result.status).toBe(200);
    const data = await result.json();
    if (removed === "directory" || removed === "chart.mc") {
      expect(data).toMatchObject({ ok: true, workspaceOnly: true, syncSkippedReason: "source_missing" });
      expect(data.savedAt).toBeTruthy();
      expect(data.syncedAt).toBeUndefined();
      expect(fs.existsSync(path.join(project.dir, "chart.mc"))).toBe(false);
      const { readRegistry } = await import("../src/lib/server/store");
      expect(readRegistry().managedProjects[0].lastSyncedAt).toBe(project.project.lastSyncedAt);
    }
    vi.resetModules();
    const restarted = await import("../src/app/api/chart/route");
    expect((await (await restarted.GET(request(project.src))).json()).text).toBe(text);
  });

  it("keeps external conflict protection when a deleted source reappears", async () => {
    const project = await opened();
    fs.unlinkSync(path.join(project.dir, "chart.mc"));
    const { POST } = await import("../src/app/api/projects/save/route");
    expect((await POST(request(project.src, { mcText: text }))).status).toBe(200);
    fs.writeFileSync(path.join(project.dir, "chart.mc"), "external edits");
    expect((await POST(request(project.src, { mcText: text }))).status).toBe(409);
    expect(fs.readFileSync(path.join(project.dir, "chart.mc"), "utf8")).toBe("external edits");
  });

  it("persists replacement uploads and updates every sibling chart", async () => {
    const project = await opened();
    const { readRegistry, saveRegistry } = await import("../src/lib/server/store");
    const registry = readRegistry();
    registry.managedProjects[0].charts.push({ id: "aaaaaaaaaaaa", fileName: "sibling.mc", title: "sibling" });
    const workspace = path.join(root, project.project.workspaceRel);
    fs.writeFileSync(path.join(workspace, "sibling.mc"), text);
    saveRegistry(registry);
    const form = new FormData();
    form.set("mcText", text);
    form.set("metadata", JSON.stringify(DEFAULT_CHART_METADATA));
    form.set("audio", new File(["ID3replacement"], "selected.mp3"));
    const image = Buffer.from([0xff, 0xd8, 0xff, 42]);
    form.set("cover", new File([image], "selected.jpg"));
    const { POST } = await import("../src/app/api/projects/setup/route");
    const result = await POST(new Request(request(project.src), { method: "POST", body: form }));
    expect(result.status).toBe(200);
    fs.rmSync(project.dir, { recursive: true });
    vi.resetModules();
    const { GET: audio } = await import("../src/app/api/audio/route");
    const { GET: cover } = await import("../src/app/api/cover/route");
    expect(await (await audio(request(project.src))).text()).toBe("ID3replacement");
    expect(Buffer.from(await (await cover(request(project.src))).arrayBuffer())).toEqual(image);
    for (const name of ["chart.mc", "sibling.mc"]) {
      const content = fs.readFileSync(path.join(workspace, name), "utf8");
      expect(content).toContain("audio.mp3");
      expect(content).toContain("cover.jpg");
    }
  });

  it("does not report success when workspace writes fail", async () => {
    const project = await opened();
    const { POST } = await import("../src/app/api/projects/save/route");
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw new Error("disk full"); });
    const result = await POST(request(project.src, { mcText: text }));
    expect(result.status).toBe(500);
    expect((await result.json()).ok).toBe(false);
  });

  it("migrates legacy history, snapshots and links once; retains missing entries", async () => {
    const dir = path.join(root, "legacy");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "chart.mc"), text);
    const { projectKey, resolveSrc } = await import("../src/lib/server/paths");
    const { saveState, saveSnapshot, readRegistry, saveRegistry, readState, listSnapshots } = await import("../src/lib/server/store");
    const { DEFAULT_UI } = await import("../src/lib/persist-types");
    const state = { schema: 1 as const, sourcePath: "legacy/chart.mc", sourceSha1: "test", sourceMode: "real" as const, assignments: {}, ui: DEFAULT_UI, updatedAt: "2026-01-01" };
    saveState(projectKey(state.sourcePath), state);
    saveSnapshot(projectKey(state.sourcePath), state, "before migration");
    saveState(projectKey("lost/chart.mc"), { ...state, sourcePath: "lost/chart.mc" });
    saveRegistry({ ...readRegistry(), hiddenCharts: [state.sourcePath], hiddenProjects: ["legacy"], lastOpenedSrc: state.sourcePath });
    const { GET } = await import("../src/app/api/projects/route");
    const listed = await (await GET(new Request("http://localhost/api/projects?includeHidden=1"))).json();
    expect(listed.packages.find((p: { dir: string }) => p.dir === "lost").charts[0].missing).toBe(true);
    const registry = readRegistry();
    expect(registry.managedProjects).toHaveLength(1);
    const resolved = resolveSrc(request(state.sourcePath));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error(resolved.error);
    expect(resolved.managed).toBeTruthy();
    expect(readState(resolved.key)?.sourcePath).toBe(resolved.rel);
    expect(listSnapshots(resolved.key)).toHaveLength(1);
    expect(registry.hiddenCharts).toContain(resolved.rel);
    expect(registry.hiddenProjects).toContain(registry.managedProjects[0].id);
    expect(registry.lastOpenedSrc).toBe(resolved.rel);
    fs.unlinkSync(path.join(dir, "chart.mc"));
    expect(resolveSrc(request(state.sourcePath)).ok).toBe(true);
    await GET(new Request("http://localhost/api/projects"));
    expect(readRegistry().managedProjects).toHaveLength(1);
    expect(readState(projectKey("lost/chart.mc"))).toBeTruthy();
  });

  it("exports an actual MCZ using only workspace assets, then survives deleting that MCZ", async () => {
    const project = await opened();
    fs.cpSync(path.join(repo, "scripts"), path.join(root, "scripts"), { recursive: true });
    const workspace = path.join(root, project.project.workspaceRel);
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "0.1", path.join(workspace, "audio.wav")], { windowsHide: true, stdio: "pipe" });
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=16x16", "-frames:v", "1", path.join(workspace, "cover.png")], { windowsHide: true, stdio: "pipe" });
    fs.rmSync(project.dir, { recursive: true });
    const { POST } = await import("../src/app/api/export/mcz/route");
    const result = await POST(request(project.src, { mcText: text, outputDir: root, packageName: "export.mcz" }));
    expect(await result.json()).toMatchObject({ ok: true });
    const { openManagedPath } = await import("../src/lib/server/managed-projects");
    const imported = await openManagedPath(path.join(root, "export.mcz"));
    fs.unlinkSync(path.join(root, "export.mcz"));
    const { POST: save } = await import("../src/app/api/projects/save/route");
    expect(await (await save(request(imported.src, { mcText: text }))).json()).toMatchObject({ ok: true, syncSkippedReason: "source_missing" });
  }, 30_000);

  it("merges old snapshots without replacing existing managed edits", async () => {
    const project = await opened();
    const { DEFAULT_UI } = await import("../src/lib/persist-types");
    const { projectKey } = await import("../src/lib/server/paths");
    const { saveState, saveSnapshot, readState, listSnapshots, readSnapshot } = await import("../src/lib/server/store");
    const state = { schema: 1 as const, sourcePath: "original/chart.mc", sourceSha1: "old", sourceMode: "real" as const, assignments: {}, ui: DEFAULT_UI, updatedAt: "2026-01-01" };
    saveState(projectKey(state.sourcePath), state);
    saveSnapshot(projectKey(state.sourcePath), state, "legacy snapshot");
    saveState(projectKey(project.src), { ...state, sourcePath: project.src, sourceSha1: "newer" });
    const { adoptLegacyHistory } = await import("../src/lib/server/managed-projects");
    await adoptLegacyHistory();
    await adoptLegacyHistory();
    expect(readState(projectKey(project.src))?.sourceSha1).toBe("newer");
    const snapshots = listSnapshots(projectKey(project.src));
    expect(snapshots).toHaveLength(1);
    expect(readSnapshot(projectKey(project.src), snapshots[0].id)?.state.sourcePath).toBe(project.src);
  });
});
