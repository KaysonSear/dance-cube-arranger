import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { buildBlankMc } from "@/lib/chart-setup";
import { normalizeFileName } from "@/lib/project-names";
import { isLocalRequest } from "@/lib/server/local-request";
import { normalizeAbsolutePath, openManagedPath } from "@/lib/server/managed-projects";

export const dynamic = "force-dynamic";

function writeNew(file: string, text: string): void {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temp, text, { encoding: "utf-8", flag: "wx" });
    if (fs.existsSync(file)) throw new Error("目标文件已存在");
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  }
}

export async function POST(req: Request) {
  if (!isLocalRequest(req)) {
    return NextResponse.json({ ok: false, error: "仅允许本机创建谱面" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "请求 JSON 无效" }, { status: 400 }); }
  const normalized = normalizeAbsolutePath(body.path);
  if (!normalized.ok) return NextResponse.json({ ok: false, error: normalized.error }, { status: 400 });
  const dir = path.dirname(normalized.path);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return NextResponse.json({ ok: false, error: `目标目录不存在: ${dir}` }, { status: 422 });
  }
  const checkedName = normalizeFileName(path.basename(normalized.path), ".mc");
  if (!checkedName.ok) return NextResponse.json({ ok: false, error: checkedName.error }, { status: 400 });
  const target = path.join(dir, checkedName.name);
  if (fs.existsSync(target)) {
    return NextResponse.json({ ok: false, conflict: true, error: `目标已存在: ${target}` }, { status: 409 });
  }
  let text: string;
  try { text = buildBlankMc(body.metadata); }
  catch (error) { return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 400 }); }
  let created = false;
  try {
    writeNew(target, text);
    created = true;
    const result = await openManagedPath(target, { copySiblingAssets: false });
    return NextResponse.json({
      ok: true,
      path: target,
      projectId: result.project.id,
      chartId: result.project.charts[0]?.id,
      src: result.src,
    }, { status: 201 });
  } catch (error) {
    if (created && fs.existsSync(target)) fs.rmSync(target, { force: true });
    return NextResponse.json({ ok: false, error: `创建已回滚: ${(error as Error).message}` }, { status: 422 });
  }
}
