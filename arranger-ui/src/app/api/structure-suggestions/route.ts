import { NextResponse } from "next/server";

import { discoverAssetsIn, resolveSrc } from "@/lib/server/paths";
import { suggestionsForAudio } from "@/lib/server/structure-suggestions";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sr = resolveSrc(req);
  if (!sr.ok) return NextResponse.json({ error: sr.error }, { status: sr.status });
  const { audioPath } = discoverAssetsIn(sr.dir);
  if (!audioPath) return NextResponse.json({ source: "fallback", sections: [] });
  const sections = suggestionsForAudio(audioPath);
  return NextResponse.json(
    { source: sections.length > 0 ? "skeleton" : "fallback", sections },
    { headers: { "Cache-Control": "no-store" } },
  );
}
