import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { buildBlankMc } from "@/lib/chart-setup";
import { normalizeFileName } from "@/lib/project-names";
import { managedSrc } from "@/lib/projects";
import { discoverAssetsIn, findRepoRoot, resolveSrc } from "@/lib/server/paths";
import { readRegistry, saveRegistry } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sr = resolveSrc(req);
  if (!sr.ok) return NextResponse.json({ ok: false, error: sr.error }, { status: sr.status });
  if (!sr.managed) return NextResponse.json({ ok: false, error: "旧工程不能新增谱面" }, { status: 409 });
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "请求 JSON 无效" }, { status: 400 }); }
  const registry = readRegistry();
  const project = registry.managedProjects.find((item) => item.id === sr.managed?.projectId);
  if (!project) return NextResponse.json({ ok: false, error: "找不到受管工程" }, { status: 404 });
  if (project.sourceKind === "mc") {
    return NextResponse.json({ ok: false, error: "裸 .mc 工程只能包含一张谱；请新建独立 MC" }, { status: 409 });
  }
  const name = normalizeFileName(body.fileName, ".mc");
  if (!name.ok) return NextResponse.json({ ok: false, error: name.error }, { status: 400 });
  if (project.charts.some((chart) => chart.fileName.toLocaleLowerCase("en-US") === name.name.toLocaleLowerCase("en-US"))) {
    return NextResponse.json({ ok: false, conflict: true, error: `包内谱面名重复: ${name.name}` }, { status: 409 });
  }
  let assets: ReturnType<typeof discoverAssetsIn>;
  try { assets = discoverAssetsIn(sr.dir); }
  catch (error) { return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 422 }); }
  let text: string;
  try {
    text = buildBlankMc(body.metadata, {
      audioName: assets.audioPath ? path.basename(assets.audioPath) : "",
      coverName: assets.coverPath ? path.basename(assets.coverPath) : "",
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 400 });
  }
  const id = crypto.randomBytes(6).toString("hex");
  const file = path.join(findRepoRoot(), project.workspaceRel, name.name);
  try {
    fs.writeFileSync(file, text, { encoding: "utf-8", flag: "wx" });
    project.charts.push({ id, fileName: name.name, title: name.name.replace(/\.mc$/i, "") });
    project.updatedAt = new Date().toISOString();
    const nextSrc = managedSrc(project.id, id);
    registry.lastOpenedSrc = nextSrc;
    try { saveRegistry(registry); }
    catch (error) { fs.rmSync(file, { force: true }); throw error; }
    return NextResponse.json({ ok: true, src: nextSrc, chartId: id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: `新增谱面已回滚: ${(error as Error).message}` }, { status: 422 });
  }
}
