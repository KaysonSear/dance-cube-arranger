import { NextResponse } from "next/server";

import { isLocalRequest } from "@/lib/server/local-request";
import { openManagedPath } from "@/lib/server/managed-projects";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isLocalRequest(req)) {
    return NextResponse.json({ ok: false, error: "仅允许本机打开路径" }, { status: 403 });
  }
  let rawPath: unknown;
  try { ({ path: rawPath } = await req.json()); }
  catch { return NextResponse.json({ ok: false, error: "请求 JSON 无效" }, { status: 400 }); }
  try {
    const result = await openManagedPath(rawPath);
    return NextResponse.json({
      ok: true,
      projectId: result.project.id,
      chartId: result.project.charts[0]?.id,
      src: result.src,
      reused: result.reused,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 422 });
  }
}
