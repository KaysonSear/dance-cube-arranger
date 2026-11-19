import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { applyChartSetup, patchChartAssetRefs } from "@/lib/chart-setup";
import { managedSrc } from "@/lib/projects";
import { validateAssetUpload } from "@/lib/server/project-assets";
import {
  AUDIO_EXTS,
  COVER_EXTS,
  findRepoRoot,
  listAssets,
  resolveSrc,
  sha1Hex,
} from "@/lib/server/paths";
import { readRegistry, saveRegistry } from "@/lib/server/store";
import { atomicWrite, commitWorkspaceCharts, readWorkspaceChart, WorkspaceConflict, type WorkspaceChange } from "@/lib/server/workspace-charts";
import { validateArrangedMcText } from "@/lib/server/validate-mc";

export const dynamic = "force-dynamic";

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
  const changes: WorkspaceChange[] = [];
  let currentText = mcText;
  try {
    for (const chart of project.charts) {
      const active = chart.id === sr.managed.chartId;
      if (!active && !audio && !cover) continue;
      const file = path.join(workspace, chart.fileName);
      const entry = readWorkspaceChart(file, managedSrc(project.id, chart.id),
        active && typeof expectSha1 === "string" && expectSha1 ? expectSha1 : undefined);
      if (active) {
        const result = applyChartSetup(mcText, metadata, refs);
        if (!result.ok) throw new Error(result.error);
        currentText = result.text;
        changes.push({ ...entry, text: result.text });
      } else {
        const text = patchChartAssetRefs(entry.original.toString("utf-8"), {
          ...(audio ? { audioName: refs.audioName } : {}),
          ...(cover ? { coverName: refs.coverName } : {}),
        });
        changes.push({ ...entry, text });
      }
    }
    for (const { text } of changes) {
      const checked = validateArrangedMcText(text);
      if (!checked.ok) throw new Error(checked.errors.join("；"));
    }
  } catch (error) {
    if (error instanceof WorkspaceConflict) {
      return NextResponse.json({ ok: false, conflict: true, error: error.message }, { status: 409 });
    }
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
    project.updatedAt = new Date().toISOString();
    commitWorkspaceCharts(changes, () => saveRegistry(registry));
  } catch (error) {
    if (audio) for (const name of filesWithExtensions(workspace, AUDIO_EXTS)) fs.rmSync(path.join(workspace, name), { force: true });
    if (cover) for (const name of filesWithExtensions(workspace, COVER_EXTS)) fs.rmSync(path.join(workspace, name), { force: true });
    for (const [file, data] of oldAssets) atomicWrite(file, data);
    return NextResponse.json({ ok: false, error: `配置更新已回滚: ${(error as Error).message}` }, { status: 422 });
  }

  const sourceSha1 = sha1Hex(currentText);
  return NextResponse.json({
    ok: true,
    text: currentText,
    sourceSha1,
    assets: { audio: refs.audioName, cover: refs.coverName },
    assetRevision: Date.now(),
  });
}
