import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { diagnosticError } from "@/lib/server/diagnostics";

import { findRepoRoot } from "@/lib/server/paths";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // configs/column_geometry.json 是键位几何唯一权威 —— 运行时读取,绝不硬编码。
    const p = path.join(findRepoRoot(), "configs", "column_geometry.json");
    const json = JSON.parse(fs.readFileSync(p, "utf-8"));
    return NextResponse.json(json, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return diagnosticError("GEOMETRY_READ_FAILED", "读取键位配置失败，请检查 configs/column_geometry.json", 500, error);
  }
}
