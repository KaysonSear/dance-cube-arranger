import { NextResponse } from "next/server";

import type { WorkingStateV1 } from "@/lib/persist-types";
import { resolveSrc } from "@/lib/server/paths";
import { listSnapshots, readState, saveSnapshot } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sr = resolveSrc(req);
  if (!sr.ok) return NextResponse.json({ error: sr.error }, { status: sr.status });
  return NextResponse.json(
    { snapshots: listSnapshots(sr.key) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** body: { label?: string, state?: WorkingStateV1 } —— 缺 state 时用当前已保存状态。 */
export async function POST(req: Request) {
  const sr = resolveSrc(req);
  if (!sr.ok) return NextResponse.json({ error: sr.error }, { status: sr.status });
  let body: { label?: string; state?: WorkingStateV1 };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const state = body.state ?? readState(sr.key);
  if (!state) {
    return NextResponse.json({ error: "no saved state to snapshot" }, { status: 400 });
  }
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : null;
  const meta = saveSnapshot(sr.key, state, label);
  return NextResponse.json({ ok: true, ...meta });
}
