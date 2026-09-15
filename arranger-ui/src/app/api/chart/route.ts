import fs from "node:fs";

import { NextResponse } from "next/server";

import { resolveSrc, sha1Hex } from "@/lib/server/paths";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sr = resolveSrc(req);
  if (!sr.ok) return NextResponse.json({ error: sr.error }, { status: sr.status });
  const text = fs.readFileSync(sr.abs, "utf-8");
  return NextResponse.json(
    { path: sr.rel, text, sourceSha1: sha1Hex(text) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
