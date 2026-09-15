import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { discoverAssetsIn, resolveSrc } from "@/lib/server/paths";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

export async function GET(req: Request) {
  const sr = resolveSrc(req);
  if (!sr.ok) return NextResponse.json({ error: sr.error }, { status: sr.status });
  const { coverPath } = discoverAssetsIn(sr.dir);
  if (!coverPath) {
    return NextResponse.json({ error: `工程目录无封面图片: ${sr.dir}` }, { status: 404 });
  }
  const buf = fs.readFileSync(coverPath);
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": MIME[path.extname(coverPath).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
    },
  });
}
