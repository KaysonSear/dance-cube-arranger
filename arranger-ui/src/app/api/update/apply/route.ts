import { spawn } from "node:child_process";
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import os from "node:os";
import path from "node:path";

import { NextResponse } from "next/server";

import { isLocalRequest } from "@/lib/server/local-request";
import { findRepoRoot } from "@/lib/server/paths";
import { diagnosticError } from "@/lib/server/diagnostics";
import { APP_VERSION, compareVersions, DEFAULT_GITHUB_REPO } from "@/lib/version";

export const dynamic = "force-dynamic";

export interface UpdateTaskStatus {
  stage: "idle" | "downloading" | "extracting" | "ready" | "applying" | "error";
  percent: number;
  message: string;
  error?: string;
  code?: string;
  diagnosticId?: string;
}

let currentTask: UpdateTaskStatus = {
  stage: "idle",
  percent: 0,
  message: "就绪",
};

export async function GET() {
  let status = currentTask;
  if (status.stage === "idle") {
    try {
      const file = path.join(findRepoRoot(), "artifacts", "arranger", "editor-update.status.json");
      const persisted = JSON.parse(fs.readFileSync(file, "utf8")) as UpdateTaskStatus;
      if (persisted.stage === "error") status = persisted;
    } catch { /* No previous update failure. */ }
  }
  return NextResponse.json({ ok: true, status }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!isLocalRequest(req)) {
    return NextResponse.json({ ok: false, error: "仅允许本机触发升级" }, { status: 403 });
  }

  if (currentTask.stage === "downloading" || currentTask.stage === "extracting" || currentTask.stage === "applying") {
    return NextResponse.json({ ok: false, error: "已有升级任务正在进行中", status: currentTask }, { status: 409 });
  }

  let body: { downloadUrl?: string; targetVersion?: string; mock?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "请求格式无效" }, { status: 400 });
  }

  const { downloadUrl, mock, targetVersion } = body;

  // 1. 模拟模式（用于无外网或演示测试）
  if (mock) {
    runMockUpdate();
    return NextResponse.json({ ok: true, status: currentTask, mock: true });
  }

  if (!downloadUrl || typeof downloadUrl !== "string") {
    return NextResponse.json({ ok: false, error: "缺少有效的新版下载链接 downloadUrl" }, { status: 400 });
  }

  const version = typeof targetVersion === "string" ? targetVersion.replace(/^v/i, "") : "";
  if (!/^\d{6}(?:\.\d+)?$/.test(version) || compareVersions(APP_VERSION, version) <= 0) {
    return diagnosticError("UPDATE_VERSION_INVALID", "更新版本无效，请重新检查更新", 400);
  }
  const repo = process.env.ARRANGER_GITHUB_REPO?.trim() || DEFAULT_GITHUB_REPO;
  const tag = `v${version}`;
  const name = `dance-cube-arranger-${version}.zip`;
  const expectedUrl = `https://github.com/${repo}/releases/download/${tag}/${name}`;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || downloadUrl !== expectedUrl) {
    return diagnosticError("UPDATE_ASSET_INVALID", "更新下载地址与官方发布包不符", 400);
  }
  const root = findRepoRoot();
  const script = path.join(root, "scripts", "apply_update.ps1");
  if (process.platform !== "win32" || !fs.existsSync(path.join(root, "server", "server.js")) || !fs.existsSync(script)) {
    return diagnosticError("UPDATE_UNSUPPORTED", "当前安装方式请通过发布页手动更新", 409);
  }
  void runRealUpdate(downloadUrl, repo, tag, name, root, script);
  return NextResponse.json({ ok: true, status: currentTask });
}

function runMockUpdate() {
  currentTask = { stage: "downloading", percent: 0, message: "正在连接更新服务器..." };

  let p = 0;
  const timer = setInterval(() => {
    p += 25;
    if (p < 100) {
      currentTask = {
        stage: "downloading",
        percent: p,
        message: `正在下载新版本组件 (${p}%)...`,
      };
    } else if (p === 100) {
      currentTask = {
        stage: "extracting",
        percent: 100,
        message: "下载完成，正在解压校验更新文件...",
      };
    } else {
      clearInterval(timer);
      currentTask = {
        stage: "ready",
        percent: 100,
        message: "更新包就绪，即将自动重启排键器服务...",
      };
      setTimeout(() => {
        currentTask = {
          stage: "applying",
          percent: 100,
          message: "正在重启服务并刷新页面...",
        };
      }, 1000);
    }
  }, 400);
}

async function runRealUpdate(url: string, repo: string, tag: string, name: string, root: string, script: string) {
  const diagnosticId = randomUUID();
  let code = "UPDATE_DOWNLOAD_FAILED";
  let tempDir: string | undefined;
  currentTask = { stage: "downloading", percent: 0, message: "正在核对 GitHub 发布资产" };
  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dca-update-"));
    const zipFile = path.join(tempDir, "update.zip");
    const release = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
      cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (!release.ok) throw new Error(`Release HTTP ${release.status}`);
    const { assets } = await release.json() as {
      assets: { name: string; digest?: string; size: number; browser_download_url: string }[];
    };
    const asset = assets.find((candidate) => candidate.name === name && candidate.browser_download_url === url);
    if (!asset?.digest || !/^sha256:[a-f0-9]{64}$/.test(asset.digest) || asset.size <= 0) {
      code = "UPDATE_ASSET_INVALID";
      throw new Error("Missing official archive checksum");
    }
    const deadline = AbortSignal.timeout(30 * 60_000);
    const response = await fetch(url, { signal: deadline });
    if (!response.ok || !response.body) throw new Error(`Download HTTP ${response.status}`);
    const hash = createHash("sha256");
    let bytes = 0;
    await pipeline(Readable.fromWeb(response.body as ReadableStream<Uint8Array>), new Transform({
      transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length;
        if (bytes > asset.size) { done(new Error("Download exceeds published size")); return; }
        hash.update(chunk);
        currentTask = {
          stage: "downloading", percent: Math.min(99, Math.round(bytes * 100 / asset.size)),
          message: "正在下载更新包",
        };
        done(null, chunk);
      },
    }), fs.createWriteStream(zipFile, { flags: "wx" }), { signal: deadline });
    code = "UPDATE_CHECKSUM_MISMATCH";
    if (bytes !== asset.size || `sha256:${hash.digest("hex")}` !== asset.digest) throw new Error("Zip digest mismatch");

    code = "UPDATE_EXTRACT_FAILED";
    currentTask = { stage: "extracting", percent: 100, message: "正在解压并校验更新包" };
    const unpacked = path.join(tempDir, "unpacked");
    fs.mkdirSync(unpacked);
    await extractZip(zipFile, unpacked);
    const source = path.join(unpacked, "dance-cube-arranger");
    code = "UPDATE_LAYOUT_INVALID";
    for (const relative of ["VERSION.txt", "server/server.js", "server/.next/BUILD_ID", "configs/column_geometry.json", "scripts/editor_server.ps1"]) {
      if (!fs.lstatSync(path.join(source, relative)).isFile()) throw new Error(`Missing ${relative}`);
    }
    const version = tag.slice(1);
    const packagedVersion = fs.readFileSync(path.join(source, "VERSION.txt"), "utf8");
    if (!packagedVersion.split(/\r?\n/).includes(`版本: ${version}`)) throw new Error("Package version mismatch");

    code = "UPDATE_HANDOFF_FAILED";
    const job = path.join(tempDir, "job.json");
    fs.writeFileSync(job, JSON.stringify({
      source, root, tempDir, version, diagnosticId, pid: process.pid, port: Number(process.env.PORT || 3000),
    }), { flag: "wx" });
    const worker = path.join(tempDir, "apply-update.ps1");
    fs.copyFileSync(script, worker);
    const child = spawn(windowsPowerShell(), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", worker], {
      detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, ARRANGER_UPDATE_JOB: job },
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.on("error", reject);
    });
    child.unref();
    const accepted = path.join(tempDir, "accepted");
    // The worker validates each destination before asking the running editor to exit.
    // On Windows this can take several seconds for a full portable package.
    const handoffDeadline = Date.now() + 60_000;
    while (!fs.existsSync(accepted) && Date.now() < handoffDeadline) {
      if (child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!fs.existsSync(accepted)) {
      child.kill();
      throw new Error("Update worker did not acknowledge the job");
    }
    currentTask = { stage: "applying", percent: 100, message: "更新包已验证，正在交接和重启", diagnosticId };
    setTimeout(() => process.exit(0), 1200);
  } catch (cause) {
    console.error(`[${diagnosticId}] ${code}`, cause);
    currentTask = {
      stage: "error", percent: 0, message: "自动更新失败", code, diagnosticId,
      error: "请查看 editor-update.log 或下载 ZIP 手动更新",
    };
    try {
      fs.appendFileSync(path.join(root, "artifacts", "arranger", "editor-update.log"),
        `[${diagnosticId}] ${code}: ${String(cause)}\n`, "utf8");
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (cleanupError) { console.warn(`[${diagnosticId}] UPDATE_CLEANUP_FAILED`, cleanupError); }
  }
}

function windowsPowerShell() {
  return process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
}

function runExtractor(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: "ignore", env });
    const timer = setTimeout(() => child.kill(), 120_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Extractor exit ${code}`));
    });
  });
}

async function extractZip(zipFile: string, directory: string) {
  try {
    await runExtractor("tar.exe", ["-xf", zipFile, "-C", directory]);
  } catch {
    const command = Buffer.from("$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath $env:ARRANGER_UPDATE_ZIP -DestinationPath $env:ARRANGER_UPDATE_DIR -Force", "utf16le").toString("base64");
    await runExtractor(windowsPowerShell(), ["-NoProfile", "-NonInteractive", "-EncodedCommand", command], {
      ...process.env, ARRANGER_UPDATE_ZIP: zipFile, ARRANGER_UPDATE_DIR: directory,
    });
  }
}
