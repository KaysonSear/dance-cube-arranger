import { NextResponse } from "next/server";

import { resolveSrc } from "@/lib/server/paths";
import { readSnapshot } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sr = resolveSrc(req);
  if (!sr.ok) return NextResponse.json({ error: sr.error }, { status: sr.status });
  const { id } = await params;
  const snap = readSnapshot(sr.key, id);
  if (!snap) return NextResponse.json({ error: `snapshot not found: ${id}` }, { status: 404 });
  return NextResponse.json(snap, { headers: { "Cache-Control": "no-store" } });
}
