import { NextResponse } from "next/server";

import { diagnosticError } from "@/lib/server/diagnostics";

import { discoverAssetsIn, resolveSrc } from "@/lib/server/paths";
import { suggestionsForAudio } from "@/lib/server/structure-suggestions";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const sr = resolveSrc(req);
    if (!sr.ok) return diagnosticError("PROJECT_SOURCE_UNAVAILABLE", "找不到可读取的工程谱面", sr.status, sr.error);
    const { audioPath } = discoverAssetsIn(sr.dir);
    if (!audioPath) return NextResponse.json({ source: "fallback", sections: [] });
    const sections = suggestionsForAudio(audioPath);
    return NextResponse.json(
      { source: sections.length > 0 ? "skeleton" : "fallback", sections },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return diagnosticError("SUGGESTIONS_READ_FAILED", "结构建议暂时不可用", 500, error);
  }
}
