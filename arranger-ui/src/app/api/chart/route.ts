import fs from "node:fs";

import { NextResponse } from "next/server";

import { diagnosticError } from "@/lib/server/diagnostics";

import { resolveSrc, sha1Hex } from "@/lib/server/paths";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const sr = resolveSrc(req);
    if (!sr.ok) return diagnosticError("PROJECT_SOURCE_UNAVAILABLE", "找不到可读取的工程谱面", sr.status, sr.error);
    const text = fs.readFileSync(sr.abs, "utf-8");
    return NextResponse.json(
      { path: sr.rel, text, sourceSha1: sha1Hex(text) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return diagnosticError("CHART_READ_FAILED", "谱面文件无法读取，请检查工程文件和目录权限", 500, error);
  }
}
