import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { NextResponse } from "next/server";

import { isLocalRequest } from "@/lib/server/local-request";
import { findRepoRoot } from "@/lib/server/paths";

export const dynamic = "force-dynamic";

export interface UpdateTaskStatus {
  stage: "idle" | "downloading" | "extracting" | "ready" | "applying" | "error";
  percent: number;
  message: string;
  error?: string;
}

let currentTask: UpdateTaskStatus = {
  stage: "idle",
  percent: 0,
  message: "就绪",
};

export async function GET() {
  return NextResponse.json({ ok: true, status: currentTask });
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

  const { downloadUrl, mock } = body;

  // 1. 模拟模式（用于无外网或演示测试）
  if (mock) {
    runMockUpdate();
    return NextResponse.json({ ok: true, status: currentTask, mock: true });
  }

  if (!downloadUrl || typeof downloadUrl !== "string") {
    return NextResponse.json({ ok: false, error: "缺少有效的新版下载链接 downloadUrl" }, { status: 400 });
  }

  // 2. 真实下载与更新流程
  runRealUpdate(downloadUrl);
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

async function runRealUpdate(downloadUrl: string) {
  currentTask = { stage: "downloading", percent: 0, message: "正在发起更新包下载..." };
  const root = findRepoRoot();
  const tempDir = path.join(os.tmpdir(), `dc-update-${Date.now()}`);
  const zipPath = path.join(tempDir, "update.zip");

  try {
    fs.mkdirSync(tempDir, { recursive: true });

    // 流式下载并计算进度
    const res = await fetch(downloadUrl, {
      headers: { "User-Agent": "Dance-Cube-Arranger-Updater" },
    });

    if (!res.ok || !res.body) {
      throw new Error(`下载失败 (HTTP ${res.status}): ${res.statusText}`);
    }

    const totalBytes = Number.parseInt(res.headers.get("content-length") || "0", 10);
    let downloadedBytes = 0;

    const fileStream = fs.createWriteStream(zipPath);
    const reader = res.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        fileStream.write(Buffer.from(value));
        downloadedBytes += value.length;
        if (totalBytes > 0) {
          const percent = Math.min(99, Math.round((downloadedBytes / totalBytes) * 100));
          currentTask = {
            stage: "downloading",
            percent,
            message: `正在下载更新包 (${(downloadedBytes / (1024 * 1024)).toFixed(1)}MB / ${(totalBytes / (1024 * 1024)).toFixed(1)}MB)...`,
          };
        }
      }
    }

    await new Promise<void>((resolve, reject) => {
      fileStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });

    // 解压更新包
    currentTask = { stage: "extracting", percent: 100, message: "下载完成，正在解压更新组件..." };
    const extractDir = path.join(tempDir, "unpacked");
    fs.mkdirSync(extractDir, { recursive: true });

    await extractZip(zipPath, extractDir);

    // 准备执行影子替换脚本
    currentTask = {
      stage: "ready",
      percent: 100,
      message: "更新包准备完成，正在启动后台热替换...",
    };

    const updaterBat = path.join(root, "scripts", "apply_update.bat");
    if (!fs.existsSync(updaterBat)) {
      throw new Error(`未找到热替换脚本: ${updaterBat}`);
    }

    // 异步拉起影子脚本（detached，脱钩于 Node 父进程）
    const child = spawn("cmd.exe", ["/c", updaterBat, extractDir, root], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();

    currentTask = {
      stage: "applying",
      percent: 100,
      message: "排键器正在重启，页面即将自动刷新...",
    };

    // 延迟 800ms 安全退出当前 Node 进程，释放文件锁供影子脚本覆盖
    setTimeout(() => {
      process.exit(0);
    }, 800);
  } catch (err) {
    currentTask = {
      stage: "error",
      percent: 0,
      message: "自动升级失败",
      error: (err as Error).message || "未知错误",
    };
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 忽略清理失败
    }
  }
}

function extractZip(zipPath: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // 优先使用 Windows 10/11 内置的 tar.exe (速度极快)
    const tar = spawn("tar.exe", ["-xf", zipPath, "-C", outDir], { windowsHide: true });
    tar.on("close", (code) => {
      if (code === 0) return resolve();
      // 回退使用 PowerShell Expand-Archive
      const ps = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${outDir}' -Force`,
        ],
        { windowsHide: true },
      );
      ps.on("close", (psCode) => {
        if (psCode === 0) resolve();
        else reject(new Error(`解包失败 (tar=${code}, ps=${psCode})`));
      });
      ps.on("error", reject);
    });
    tar.on("error", () => {
      // 若无 tar.exe，直接尝试 PowerShell
      const ps = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${outDir}' -Force`,
        ],
        { windowsHide: true },
      );
      ps.on("close", (psCode) => {
        if (psCode === 0) resolve();
        else reject(new Error(`PowerShell 解包失败 (code=${psCode})`));
      });
      ps.on("error", reject);
    });
  });
}
