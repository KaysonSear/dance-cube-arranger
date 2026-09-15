import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { applyChartSetup, patchChartAssetRefs } from "@/lib/chart-setup";
import { validateAssetUpload } from "@/lib/server/project-assets";
import {
  AUDIO_EXTS,
  COVER_EXTS,
  findRepoRoot,
  listAssets,
  resolveSrc,
  sha1Hex,
} from "@/lib/server/paths";
import { readRegistry, readState, saveRegistry, saveState } from "@/lib/server/store";
import { validateArrangedMcText } from "@/lib/server/validate-mc";

export const dynamic = "force-dynamic";

function atomicWrite(file: string, data: string | Buffer): void {
  const temp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try { fs.writeFileSync(temp, data); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.rmSync(temp, { force: true }); }
}

function filesWithExtensions(dir: string, extensions: string[]): string[] {
  return listAssets(
    fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isFile()),
    extensions,
  );
}

export async function POST(req: Request) {
  const sr = resolveSrc(req);
  if (!sr.ok) return NextResponse.json({ ok: false, error: sr.error }, { status: sr.status });
  if (!sr.managed) {
    return NextResponse.json({ ok: false, error: "旧工程请先从绝对路径重新打开" }, { status: 409 });
  }
  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ ok: false, error: "multipart 请求无效" }, { status: 400 }); }
  const mcText = form.get("mcText");
  const metadataText = form.get("metadata");
  const expectSha1 = form.get("expectSha1");
  if (typeof mcText !== "string" || !mcText || typeof metadataText !== "string") {
    return NextResponse.json({ ok: false, error: "mcText 与 metadata 必填" }, { status: 400 });
  }
  if (typeof expectSha1 === "string" && expectSha1 && expectSha1 !== sha1Hex(fs.readFileSync(sr.abs))) {
    return NextResponse.json({ ok: false, conflict: true, error: "谱面已被另一标签页修改，请重新载入" }, { status: 409 });
  }
  let metadata: unknown;
  try { metadata = JSON.parse(metadataText); }
  catch { return NextResponse.json({ ok: false, error: "元信息 JSON 无效" }, { status: 400 }); }
  const rawAudio = form.get("audio");
  const rawCover = form.get("cover");
  let audio: Awaited<ReturnType<typeof validateAssetUpload>> | null = null;
  let cover: Awaited<ReturnType<typeof validateAssetUpload>> | null = null;
  try {
    if (rawAudio instanceof File) audio = await validateAssetUpload("audio", rawAudio);
    if (rawCover instanceof File) cover = await validateAssetUpload("cover", rawCover);
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 422 });
  }

  const registry = readRegistry();
  const project = registry.managedProjects.find((item) => item.id === sr.managed?.projectId);
  if (!project) return NextResponse.json({ ok: false, error: "找不到受管工程" }, { status: 404 });
  const workspace = path.join(findRepoRoot(), project.workspaceRel);
  const oldAudioNames = filesWithExtensions(workspace, AUDIO_EXTS);
  const oldCoverNames = filesWithExtensions(workspace, COVER_EXTS);
  if (!audio && oldAudioNames.length > 1) {
    return NextResponse.json({ ok: false, error: `音频素材不唯一: ${oldAudioNames.join(", ")}` }, { status: 422 });
  }
  if (!cover && oldCoverNames.length > 1) {
    return NextResponse.json({ ok: false, error: `封面素材不唯一: ${oldCoverNames.join(", ")}` }, { status: 422 });
  }
  const refs = {
    audioName: audio?.name ?? oldAudioNames[0] ?? null,
    coverName: cover?.name ?? oldCoverNames[0] ?? null,
  };
  const originals = new Map<string, Buffer>();
  const updates = new Map<string, string>();
  try {
    for (const chart of project.charts) {
      const file = path.join(workspace, chart.fileName);
      const original = fs.readFileSync(file);
      originals.set(file, original);
      const source = chart.id === sr.managed.chartId ? mcText : original.toString("utf-8");
      if (chart.id === sr.managed.chartId) {
        const result = applyChartSetup(source, metadata, refs);
        if (!result.ok) throw new Error(result.error);
        updates.set(file, result.text);
      } else if (audio || cover) {
        updates.set(file, patchChartAssetRefs(source, {
          ...(audio ? { audioName: refs.audioName } : {}),
          ...(cover ? { coverName: refs.coverName } : {}),
        }));
      }
    }
    for (const text of updates.values()) {
      const checked = validateArrangedMcText(text);
      if (!checked.ok) throw new Error(checked.errors.join("；"));
    }
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 422 });
  }

  const oldAssets = new Map<string, Buffer>();
  for (const name of [...oldAudioNames, ...oldCoverNames]) {
    const file = path.join(workspace, name);
    oldAssets.set(file, fs.readFileSync(file));
  }
  try {
    if (audio) {
      for (const name of oldAudioNames) fs.rmSync(path.join(workspace, name), { force: true });
      atomicWrite(path.join(workspace, audio.name), audio.data);
    }
    if (cover) {
      for (const name of oldCoverNames) fs.rmSync(path.join(workspace, name), { force: true });
      atomicWrite(path.join(workspace, cover.name), cover.data);
    }
    for (const [file, text] of updates) atomicWrite(file, text);
    project.updatedAt = new Date().toISOString();
    saveRegistry(registry);
  } catch (error) {
    for (const file of updates.keys()) {
      const original = originals.get(file);
      if (original) atomicWrite(file, original);
    }
    if (audio) for (const name of filesWithExtensions(workspace, AUDIO_EXTS)) fs.rmSync(path.join(workspace, name), { force: true });
    if (cover) for (const name of filesWithExtensions(workspace, COVER_EXTS)) fs.rmSync(path.join(workspace, name), { force: true });
    for (const [file, data] of oldAssets) atomicWrite(file, data);
    return NextResponse.json({ ok: false, error: `配置更新已回滚: ${(error as Error).message}` }, { status: 422 });
  }

  const currentText = updates.get(sr.abs) ?? mcText;
  const sourceSha1 = sha1Hex(currentText);
  const state = readState(sr.key);
  if (state && state.sourcePath === sr.rel) {
    state.sourceSha1 = sourceSha1;
    // The workspace and registry are already committed. A stale/missing editor-state
    // cache must not turn that successful transaction into a misleading HTTP failure.
    try { saveState(sr.key, state); } catch { /* the next autosave recreates this cache */ }
  }
  return NextResponse.json({
    ok: true,
    text: currentText,
    sourceSha1,
    assets: { audio: refs.audioName, cover: refs.coverName },
    assetRevision: Date.now(),
  });
}
