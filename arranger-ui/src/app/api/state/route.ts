import { NextResponse } from "next/server";

import type { WorkingStateV1 } from "@/lib/persist-types";
import { resolveSrc } from "@/lib/server/paths";
import { readRegistry, readState, saveRegistry, saveState } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sr = resolveSrc(req);
  if (!sr.ok) return NextResponse.json({ error: sr.error }, { status: sr.status });
  const state = readState(sr.key);
  if (!state) return new Response(null, { status: 204 });
  return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
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
  if (state?.schema !== 1 || typeof state.assignments !== "object") {
    return NextResponse.json({ error: "unsupported state schema" }, { status: 400 });
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
