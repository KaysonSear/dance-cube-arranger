import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let root: string;
beforeEach(() => {
  vi.resetModules();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dca-delete-"));
  fs.mkdirSync(path.join(root, "configs"));
  fs.writeFileSync(path.join(root, "configs/column_geometry.json"), "{}");
  vi.spyOn(process, "cwd").mockReturnValue(root);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith("dca-delete-")) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function entry(target: string, action: string, token?: string) {
  const { POST } = await import("../src/app/api/projects/entry/route");
  return (await POST(new Request("http://localhost/api/projects/entry", { method: "POST",
    body: JSON.stringify({ target, action, token, scope: target.startsWith("managed:") ? "chart" : "project" }) }))).json();
}

it("keeps hidden samples across scans, removes only the selected history and escalates the last chart", async () => {
  const { registerWorkspaceProject } = await import("../src/lib/server/managed-projects");
  const { projectKey } = await import("../src/lib/server/paths");
  const { projectDir } = await import("../src/lib/server/store");
  const { GET } = await import("../src/app/api/projects/route");
  const rel = "artifacts/arranger/imports/wda";
  const dir = path.join(root, rel);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ["a.mc", "b.mc", "audio.ogg"]) fs.writeFileSync(path.join(dir, name), name);
  const { project, src } = registerWorkspaceProject(rel, "WDA", ["a.mc", "b.mc"]);
  const sibling = `managed:${project.id}:${project.charts[1].id}`;
  for (const ref of [src, sibling]) fs.mkdirSync(path.join(projectDir(projectKey(ref)), "snapshots"), { recursive: true });
  expect((await entry(project.id, "hide")).ok).toBe(true);
  expect((await (await GET(new Request("http://localhost/api/projects"))).json()).packages).toHaveLength(0);
  expect((await entry(project.id, "unhide")).ok).toBe(true);
  const plan = await entry(src, "preview-purge");
  expect(plan.wholeProject).toBe(false);
  expect((await entry(src, "purge", plan.token)).ok).toBe(true);
  expect(fs.existsSync(projectDir(projectKey(src)))).toBe(false);
  expect(fs.existsSync(projectDir(projectKey(sibling)))).toBe(true);
  expect(fs.readdirSync(dir).sort()).toEqual(["audio.ogg", "b.mc"]);
  const last = await entry(sibling, "preview-purge");
  expect(last.wholeProject).toBe(true);
  expect((await entry(sibling, "purge", last.token)).ok).toBe(true);
  expect(fs.existsSync(dir)).toBe(false);
});

it("refuses a changed source, allows a moved source and retains shared media", async () => {
  const { openManagedPath } = await import("../src/lib/server/managed-projects");
  const external = path.join(root, "external");
  fs.mkdirSync(external);
  for (const name of ["first.mc", "second.mc", "music.ogg"]) fs.writeFileSync(path.join(external, name), name);
  const file = path.join(external, "first.mc");
  const { project } = await openManagedPath(file);
  const initial = await entry(project.id, "preview-purge");
  fs.appendFileSync(file, "external edit");
  expect((await entry(project.id, "purge", initial.token)).ok).toBe(false);
  const moved = path.join(root, "moved.mc");
  fs.renameSync(file, moved);
  const next = await entry(project.id, "preview-purge");
  expect((await entry(project.id, "purge", next.token)).ok).toBe(true);
  expect(fs.readdirSync(external).sort()).toEqual(["music.ogg", "second.mc"]);
  expect(fs.existsSync(moved)).toBe(true);
});
