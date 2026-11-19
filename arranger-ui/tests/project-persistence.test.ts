import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildBlankMc, DEFAULT_CHART_METADATA } from "../src/lib/chart-setup";
import { DEFAULT_UI, type WorkingStateV1 } from "../src/lib/persist-types";
import { managedSrc } from "../src/lib/projects";

let root: string;
const chartText = buildBlankMc(DEFAULT_CHART_METADATA);
const prettyChart = JSON.stringify(JSON.parse(chartText), null, 2);
const request = (src: string, body?: unknown) => new Request(`http://localhost/api?src=${encodeURIComponent(src)}`,
  body ? { method: "POST", body: JSON.stringify(body) } : undefined);

beforeEach(() => {
  vi.resetModules();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "arranger-persistence-"));
  fs.mkdirSync(path.join(root, "configs"));
  fs.writeFileSync(path.join(root, "configs/column_geometry.json"), "{}");
  vi.spyOn(process, "cwd").mockReturnValue(root);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("arranger-persistence-")) {
    throw new Error("Unexpected temporary fixture");
  }
  fs.rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const { registerWorkspaceProject } = await import("../src/lib/server/managed-projects");
  const { projectKey, sha1Hex } = await import("../src/lib/server/paths");
  const store = await import("../src/lib/server/store");
  const dir = "artifacts/arranger/imports/test";
  const workspace = path.join(root, dir);
  fs.mkdirSync(workspace, { recursive: true });
  const files = ["first.mc", "second.mc"];
  for (const name of files) fs.writeFileSync(path.join(workspace, name), prettyChart);
  const { project, src } = registerWorkspaceProject(dir, "Test", files);
  const charts = project.charts.map((chart) => {
    const ref = managedSrc(project.id, chart.id);
    const key = projectKey(ref);
    const state: WorkingStateV1 = { schema: 1, sourcePath: ref, sourceMode: "real", sourceSha1: sha1Hex(prettyChart),
      assignments: {}, ui: DEFAULT_UI, updatedAt: "2026-01-01" };
    store.saveState(key, state);
    return { ref, file: path.join(workspace, chart.fileName), key, state };
  });
  return { project, src, charts, workspace, store, sha1Hex };
}

describe("workspace persistence", () => {
  it("rejects a stale state submission after a newer writeback", async () => {
    const { src, charts, store } = await fixture();
    const { POST: write } = await import("../src/app/api/writeback/route");
    const { POST: save } = await import("../src/app/api/state/route");
    const old = charts[0].state;
    expect((await write(request(src, { mcText: chartText, expectSha1: old.sourceSha1 }))).status).toBe(200);
    expect((await save(request(src, old))).status).toBe(409);
    expect(store.readState(charts[0].key)?.sourceSha1).not.toBe(old.sourceSha1);
  });

  it("returns the written SHA and synchronizes working states for every saved chart", async () => {
    const { src, charts, store, sha1Hex } = await fixture();
    const { POST } = await import("../src/app/api/projects/save/route");
    const result = await POST(request(src, { mcText: chartText }));
    expect(await result.json()).toMatchObject({ ok: true, sourceSha1: sha1Hex(chartText) });
    for (const { key, file } of charts) {
      expect(store.readState(key)?.sourceSha1).toBe(sha1Hex(fs.readFileSync(file)));
      expect(fs.readFileSync(file, "utf-8")).not.toBe(prettyChart);
    }
  });

  it.each([0, 1])("detects changes to chart %s before writing any workspace bytes", async (index) => {
    const { src, charts, store } = await fixture();
    fs.writeFileSync(charts[index].file, prettyChart + "\n");
    const { POST } = await import("../src/app/api/projects/save/route");
    const result = await POST(request(src, { mcText: chartText, expectSha1: charts[0].state.sourceSha1 }));
    expect(result.status).toBe(409);
    charts.forEach(({ file, key, state }, i) => {
      expect(fs.readFileSync(file, "utf-8")).toBe(i === index ? prettyChart + "\n" : prettyChart);
      expect(store.readState(key)).toEqual(state);
    });
  });

  it("rolls back uploaded assets, both charts, and SHA updates if the registry write fails", async () => {
    const { src, charts, workspace, store } = await fixture();
    const form = new FormData();
    form.set("mcText", prettyChart);
    form.set("metadata", JSON.stringify(DEFAULT_CHART_METADATA));
    form.set("audio", new File(["ID3audio"], "replacement.mp3"));
    const { POST } = await import("../src/app/api/projects/setup/route");
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to).endsWith("registry.json")) throw new Error("Disk full");
      rename(from, to);
    });
    const result = await POST(new Request(request(src), { method: "POST", body: form }));
    expect(result.status).toBe(422);
    expect(fs.existsSync(path.join(workspace, "audio.mp3"))).toBe(false);
    for (const { file, key, state } of charts) {
      expect(fs.readFileSync(file, "utf-8")).toBe(prettyChart);
      expect(store.readState(key)).toEqual(state);
    }
    vi.restoreAllMocks();
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const success = await POST(new Request(request(src), { method: "POST", body: form }));
    expect(success.status).toBe(200);
    const { sha1Hex } = await import("../src/lib/server/paths");
    for (const { file, key } of charts) expect(store.readState(key)?.sourceSha1).toBe(sha1Hex(fs.readFileSync(file)));
  });

  it("treats only a missing state as new and keeps unreadable states intact", async () => {
    const { src, charts, store } = await fixture();
    const { GET, POST } = await import("../src/app/api/state/route");
    const file = store.statePath(charts[0].key);
    fs.unlinkSync(file);
    expect((await GET(request(src))).status).toBe(204);
    for (const data of ["{incomplete", "null", "{}"]) {
      fs.writeFileSync(file, data);
      expect((await GET(request(src))).status).toBe(500);
      expect((await POST(request(src, charts[0].state))).status).toBe(500);
      expect(fs.readFileSync(file, "utf-8")).toBe(data);
    }
    fs.unlinkSync(file);
    fs.mkdirSync(file);
    expect((await GET(request(src))).status).toBe(500);
  });

  it("keeps the protected source, fingerprint and copy flag on display-only management", async () => {
    const { src, project, store, charts } = await fixture();
    const registry = store.readRegistry();
    const external = path.join(root, "WDA", "example.mcz");
    fs.mkdirSync(path.dirname(external));
    fs.writeFileSync(external, "Externally edited");
    Object.assign(registry.managedProjects[0], { sourceKind: "mcz", sourcePath: external, sourceFingerprint: "prior", copyOnWrite: true });
    store.saveRegistry(registry);
    const { POST } = await import("../src/app/api/projects/manage/route");
    const result = await POST(request(src, { displayName: "New", sourceDir: path.dirname(external),
      sourceName: path.basename(external), chartNames: Object.fromEntries(project.charts.map((chart) => [chart.id, chart.fileName])) }));
    expect(result.status).toBe(200);
    expect(store.readRegistry().managedProjects[0]).toMatchObject({
      displayName: "New", sourceFingerprint: "prior", copyOnWrite: true, sourcePath: external,
    });
    const rename = await POST(request(src, { chartNames: { [project.charts[0].id]: "renamed.mc" } }));
    expect(rename.status).toBe(409);
    expect(fs.readFileSync(external, "utf-8")).toBe("Externally edited");
    expect(fs.readFileSync(charts[0].file, "utf-8")).toBe(prettyChart);
  });
});
