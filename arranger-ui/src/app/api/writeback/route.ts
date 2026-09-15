import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { findRepoRoot, resolveSrc, sha1Hex } from "@/lib/server/paths";
import { readState, saveState } from "@/lib/server/store";
import { validateArrangedMcText } from "@/lib/server/validate-mc";
import { backupRelFor, isWritableRel } from "@/lib/writeback";

export const dynamic = "force-dynamic";

/**
 * 把排键结果**写回源 .mc**(用户明确授权的"自动保存改原文件")。
 *
 * 安全链:白名单(仅 WDA/ 与 artifacts/,`data/corpus/` 永远只读)→ 结构校验(绝不把损坏
 * 谱面写到源文件上)→ `expectSha1` 乐观锁(外部/多标签页改动 → 409,不静默覆盖)→
 * **首次覆写前备份 `<name>.mc.orig`** → 原子写 → 顺手把 state.json 的 sourceSha1 同步为新哈希
 * (否则每次写回都会改变文件哈希,重载时误报"源文件已被外部修改")。
 */
export async function POST(req: Request) {
  const sr = resolveSrc(req);
  if (!sr.ok) return NextResponse.json({ ok: false, error: sr.error }, { status: sr.status });

  if (!isWritableRel(sr.rel)) {
    return NextResponse.json(
      { ok: false, error: "该路径不可写(仅 WDA/ 与 artifacts/;data/corpus/ 只读)" },
      { status: 403 },
    );
  }

  let mcText: unknown;
  let expectSha1: unknown;
  try {
    ({ mcText, expectSha1 } = await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof mcText !== "string" || !mcText) {
    return NextResponse.json({ ok: false, error: "mcText (string) required" }, { status: 400 });
  }

  const v = validateArrangedMcText(mcText);
  if (!v.ok) return NextResponse.json({ ok: false, errors: v.errors }, { status: 422 });

  const root = findRepoRoot();
  const diskSha1 = sha1Hex(fs.readFileSync(sr.abs));
  if (typeof expectSha1 === "string" && expectSha1 && expectSha1 !== diskSha1) {
    return NextResponse.json(
      { ok: false, error: "源文件已被外部修改(或另一标签页写入),已停止写回", sha1: diskSha1 },
      { status: 409 },
    );
  }

  // 首次覆写前备份原件(.mc.orig 刻意不以 .mc 结尾,不会被当成包内的"影子谱")
  const backupRel = sr.managed ? null : backupRelFor(sr.rel);
  const backupAbs = backupRel ? path.join(root, backupRel) : null;
  let backupCreated = false;
  if (backupAbs && !fs.existsSync(backupAbs)) {
    fs.copyFileSync(sr.abs, backupAbs);
    backupCreated = true;
  }

  const tmp = `${sr.abs}.tmp`;
  fs.writeFileSync(tmp, mcText, "utf-8");
  fs.renameSync(tmp, sr.abs);
  const newSha1 = sha1Hex(mcText);

  // 服务端同步 sha:客户端即使在此刻崩溃,重载也不会误报"源已变更"
  const st = readState(sr.key);
  if (st && st.sourcePath === sr.rel && st.sourceSha1 !== newSha1) {
    st.sourceSha1 = newSha1;
    saveState(sr.key, st);
  }

  return NextResponse.json({
    ok: true,
    path: sr.rel,
    sha1: newSha1,
    backup: backupRel,
    backupCreated,
    noteCount: v.noteCount,
    warnings: v.warnings,
  });
}
