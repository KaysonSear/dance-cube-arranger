import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { parseRangeHeader } from "@/lib/range";
import { discoverAssetsIn, resolveSrc } from "@/lib/server/paths";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

/** 工程目录内唯一音频文件;支持 HTTP Range(<audio> 秒级 seek 所需)。 */
export async function GET(req: Request) {
  const sr = resolveSrc(req);
  if (!sr.ok) return NextResponse.json({ error: sr.error }, { status: sr.status });
  const { audioPath } = discoverAssetsIn(sr.dir);
  if (!audioPath) {
    return NextResponse.json({ error: `工程目录无音频文件: ${sr.dir}` }, { status: 404 });
  }
  const size = fs.statSync(audioPath).size;
  const type = MIME[path.extname(audioPath).toLowerCase()] ?? "application/octet-stream";
  const range = parseRangeHeader(req.headers.get("range"), size);

  if (range) {
    const stream = fs.createReadStream(audioPath, { start: range.start, end: range.end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": type,
        "Accept-Ranges": "bytes",
        "Content-Length": String(range.end - range.start + 1),
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Cache-Control": "no-store",
      },
    });
  }
  const stream = fs.createReadStream(audioPath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Content-Length": String(size),
      "Cache-Control": "no-store",
    },
  });
}
