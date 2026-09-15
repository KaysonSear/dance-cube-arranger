import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { buildOnsets } from "@/lib/arrangement";
import { parseMc, type ParsedChart } from "@/lib/mc";
import {
  importSlug,
  sanitizeFilename,
  uniqueSlug,
  writeImport,
  writeProjectManifest,
} from "@/lib/server/imports";
import { AUDIO_EXTS, COVER_EXTS, findRepoRoot, IMPORTS_REL, resolvePythonCommand } from "@/lib/server/paths";
import { registerWorkspaceProject } from "@/lib/server/managed-projects";

export const dynamic = "force-dynamic";

const MC_MAX = 2 * 1024 * 1024;
const AUDIO_MAX = 40 * 1024 * 1024;
const COVER_MAX = 10 * 1024 * 1024;
const MCZ_MAX = 60 * 1024 * 1024;

/** 调用 Python 桥解包 .mcz(stdlib zipfile,零新依赖;cwd=仓库根 + 相对路径)。 */
function unpackMcz(root: string, mczRel: string, outRel: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const child = spawn(
      resolvePythonCommand(root),
      ["scripts/import_mcz.py", "--mcz", mczRel, "--out-dir", outRel],
      { cwd: root },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", () => {
      clearTimeout(timer);
      const last = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
      try {
        resolve(JSON.parse(last));
      } catch {
        resolve({ ok: false, error: stderr.slice(-500) || "解包失败" });
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: String(err) });
    });
  });
}

function extOf(f: File): string {
  const i = f.name.lastIndexOf(".");
  return i >= 0 ? f.name.slice(i).toLowerCase() : "";
}

/**
 * 导入新工程,两种方式:
 *  1. **`.mcz` 单文件**(推荐)—— 经 Python 桥(stdlib zipfile)解包出 mc+音频+封面;
 *  2. 分别选择 **`.mc`(必需)+ 音频/封面(可选)**;缺素材仍可编辑但不能导出 .mcz。
 * 写入 artifacts/arranger/imports/<slug>/,返回可直接作为 ?src 的仓库相对路径。
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "multipart 解析失败" }, { status: 400 });
  }
  const mcz = form.get("mcz");
  const mc = form.get("mc");
  const audio = form.get("audio");
  const cover = form.get("cover");
  const name = form.get("name");

  // ── 分支一:导入 .mcz(单文件即可,内含 mc+音频+封面)──
  if (mcz instanceof File) {
    if (extOf(mcz) !== ".mcz") {
      return NextResponse.json({ ok: false, error: "请选择 .mcz 文件" }, { status: 415 });
    }
    if (mcz.size > MCZ_MAX) {
      return NextResponse.json({ ok: false, error: "文件过大(.mcz ≤ 60MB)" }, { status: 413 });
    }
    const root = findRepoRoot();
    const stem = mcz.name.replace(/\.mcz$/i, "");
    const projectName = typeof name === "string" && name.trim() ? name.trim() : stem;
    const importsAbs = path.join(root, IMPORTS_REL);
    fs.mkdirSync(importsAbs, { recursive: true });
    const slug = uniqueSlug(importSlug(projectName, new Date()), (sg: string) =>
      fs.existsSync(path.join(importsAbs, sg)),
    );
    const dirAbs = path.join(importsAbs, slug);
    fs.mkdirSync(dirAbs, { recursive: true });
    const tmpAbs = path.join(dirAbs, "__upload.mcz");
    fs.writeFileSync(tmpAbs, Buffer.from(await mcz.arrayBuffer()));

    const report = await unpackMcz(
      root,
      path.relative(root, tmpAbs).split(path.sep).join("/"),
      path.relative(root, dirAbs).split(path.sep).join("/"),
    );
    fs.rmSync(tmpAbs, { force: true }); // 解包后不留上传件
    if (!report.ok) {
      fs.rmSync(dirAbs, { recursive: true, force: true }); // 失败不留空工程
      return NextResponse.json(
        { ok: false, error: String(report.error ?? ".mcz 解包失败") },
        { status: 422 },
      );
    }
    writeProjectManifest(dirAbs, projectName, mcz.name);
    // Python 桥跑在 Windows venv 上,回传的是反斜杠路径;Linux 的 path.basename 不认 \,
    // 必须先归一化再取文件名,否则 src 会拼成 ".../imports/<slug>/artifacts\...\chart.mc"。
    const mcName = String(report.mc).replace(/\\/g, "/").split("/").pop() ?? "chart.mc";
    const dirRel = `artifacts/arranger/imports/${slug}`;
    const chartNames = Array.isArray(report.mcs)
      ? report.mcs.map((item) => String(item).replace(/\\/g, "/").split("/").pop() ?? "").filter(Boolean)
      : [mcName];
    const src = registerWorkspaceProject(dirRel, projectName, chartNames).src;
    return NextResponse.json({
      ok: true,
      src,
      name: projectName,
      noteCount: report.n_notes ?? null,
      bpm: report.bpm ?? null,
      offsetMs: report.offset ?? null,
      hasAudio: report.audio != null,
      hasCover: report.cover != null,
    });
  }

  // ── 分支二:分别选择 mc(必需)+ 音频/封面(可选)──
  if (!(mc instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "请提供 .mcz,或至少提供一个 .mc 谱面文件" },
      { status: 400 },
    );
  }
  const hasAudio = audio instanceof File;
  const hasCover = cover instanceof File;
  if (
    mc.size > MC_MAX ||
    (hasAudio && audio.size > AUDIO_MAX) ||
    (hasCover && cover.size > COVER_MAX)
  ) {
    return NextResponse.json(
      { ok: false, error: "文件过大(mc ≤ 2MB,音频 ≤ 40MB,封面 ≤ 10MB)" },
      { status: 413 },
    );
  }
  if (extOf(mc) !== ".mc") {
    return NextResponse.json({ ok: false, error: "谱面必须是 .mc 文件" }, { status: 415 });
  }
  if (hasAudio && !AUDIO_EXTS.includes(extOf(audio))) {
    return NextResponse.json({ ok: false, error: "音频仅支持 mp3/ogg/wav" }, { status: 415 });
  }
  if (hasCover && !COVER_EXTS.includes(extOf(cover))) {
    return NextResponse.json({ ok: false, error: "封面仅支持 jpg/jpeg/png" }, { status: 415 });
  }

  let parsed: ParsedChart;
  try {
    parsed = parseMc(await mc.text());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `谱面解析失败:${(e as Error).message}` },
      { status: 422 },
    );
  }
  const mode = (parsed.raw.meta as Record<string, unknown> | undefined)?.mode;
  if (mode !== 9) {
    return NextResponse.json({ ok: false, error: "仅支持 mode:9(Cube)谱面" }, { status: 422 });
  }

  const stem = mc.name.replace(/\.mc$/i, "");
  const projectName = typeof name === "string" && name.trim() ? name.trim() : stem;
  const files = [
    { name: sanitizeFilename(mc.name), data: Buffer.from(await mc.arrayBuffer()) },
  ];
  if (hasAudio) {
    files.push({ name: sanitizeFilename(audio.name), data: Buffer.from(await audio.arrayBuffer()) });
  }
  if (hasCover) {
    files.push({ name: sanitizeFilename(cover.name), data: Buffer.from(await cover.arrayBuffer()) });
  }
  const { dirRel } = writeImport({ slugBase: importSlug(projectName, new Date()), files });
  writeProjectManifest(path.join(findRepoRoot(), dirRel), projectName, "separate-files");
  const src = registerWorkspaceProject(dirRel, projectName, [files[0].name]).src;

  return NextResponse.json({
    ok: true,
    src,
    name: projectName,
    noteCount: parsed.gameplay.length,
    onsetCount: buildOnsets(parsed.gameplay).length,
    bpm: parsed.timeMap[0]?.bpm ?? null,
    offsetMs: parsed.audioNote.offsetMs,
    hasAudio,
    hasCover,
  });
}
