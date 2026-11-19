import fs from "node:fs";
import { NextResponse } from "next/server";

import type { WorkingStateV1 } from "@/lib/persist-types";
import { resolveSrc, sha1Hex } from "@/lib/server/paths";
import { readRegistry, readState, saveRegistry, saveState } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sr = resolveSrc(req);
  if (!sr.ok) return NextResponse.json({ error: sr.error }, { status: sr.status });
  try {
    const state = readState(sr.key);
    if (!state) return new Response(null, { status: 204 });
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: `无法读取已有工作状态：${(error as Error).message}` }, { status: 500 });
  }
}

/** POST(而非 PUT)以兼容 pagehide 时的 navigator.sendBeacon 兜底保存。 */
export async function POST(req: Request) {
  const sr = resolveSrc(req);
  if (!sr.ok) return NextResponse.json({ error: sr.error }, { status: sr.status });
  let state: WorkingStateV1;
  try {
    state = JSON.parse(await req.text()) as WorkingStateV1;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (state?.schema !== 1 || !state.assignments || typeof state.assignments !== "object" ||
      Array.isArray(state.assignments) || typeof state.sourceSha1 !== "string" || typeof state.sourcePath !== "string") {
    return NextResponse.json({ error: "unsupported state schema" }, { status: 400 });
  }
  try {
    readState(sr.key);
    if (sr.managed && (state.sourcePath !== sr.rel || state.sourceSha1 !== sha1Hex(fs.readFileSync(sr.abs)))) {
      return NextResponse.json({ error: "工作副本已变更，请重新载入" }, { status: 409 });
    }
  } catch (error) {
    return NextResponse.json({ error: `无法读取已有工作状态：${(error as Error).message}` }, { status: 500 });
  }
  state.updatedAt = new Date().toISOString();
  saveState(sr.key, state);
  const registry = readRegistry();
  if (registry.lastOpenedSrc !== sr.rel) {
    registry.lastOpenedSrc = sr.rel;
    saveRegistry(registry);
  }
  return NextResponse.json({ ok: true, savedAt: state.updatedAt });
}
