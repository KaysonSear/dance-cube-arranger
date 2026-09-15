import { NextResponse } from "next/server";

import { APP_VERSION, compareVersions, DEFAULT_GITHUB_REPO, type UpdateInfo } from "@/lib/version";

export const dynamic = "force-dynamic";

interface CachedCheck {
  timestamp: number;
  data: UpdateInfo;
}

let cachedResult: CachedCheck | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5分钟内存缓存

export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const mockVersion = url.searchParams.get("mockVersion");

  const repo = process.env.ARRANGER_GITHUB_REPO?.trim() || DEFAULT_GITHUB_REPO;
  const now = Date.now();

  if (!force && !mockVersion && cachedResult && now - cachedResult.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({ ok: true, update: cachedResult.data, fromCache: true });
  }

  // 测试桩：允许通过 query 模拟特定版本，便于前端自测高亮
  if (mockVersion) {
    const hasUpdate = compareVersions(APP_VERSION, mockVersion) > 0;
    const mockData: UpdateInfo = {
      hasUpdate,
      currentVersion: APP_VERSION,
      latestVersion: mockVersion,
      releaseName: `舞立方编辑器更新 v${mockVersion} (模拟)`,
      releaseNotes: "## 新特性\n- 自动化便携打包支持\n- 修复长条重叠诊断\n- 新增模拟器键位设置",
      publishedAt: new Date().toISOString(),
      htmlUrl: `https://github.com/${repo}/releases/tag/${mockVersion}`,
      downloadUrl: `https://github.com/${repo}/releases/download/${mockVersion}/dance-cube-arranger-portable.zip`,
      repo,
    };
    return NextResponse.json({ ok: true, update: mockData, mock: true });
  }

  try {
    const ghRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Dance-Cube-Arranger-Client",
      },
      next: { revalidate: 300 },
    });

    if (ghRes.status === 404) {
      const fallback: UpdateInfo = {
        hasUpdate: false,
        currentVersion: APP_VERSION,
        latestVersion: APP_VERSION,
        releaseName: "暂无发布版本",
        releaseNotes: "当前仓库暂未创建 Release，您正在使用的是初始版本。",
        publishedAt: null,
        htmlUrl: `https://github.com/${repo}/releases`,
        downloadUrl: null,
        repo,
      };
      return NextResponse.json({ ok: true, update: fallback, notFound: true });
    }

    if (!ghRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `GitHub API 响应异常 (${ghRes.status})，可能是 API 请求频率受限或仓库私有。`,
          currentVersion: APP_VERSION,
        },
        { status: 502 },
      );
    }

    const release = (await ghRes.json()) as {
      tag_name?: string;
      name?: string;
      body?: string;
      published_at?: string;
      html_url?: string;
      assets?: Array<{ browser_download_url?: string; name?: string }>;
    };

    const latestTag = release.tag_name ?? APP_VERSION;
    const hasUpdate = compareVersions(APP_VERSION, latestTag) > 0;

    // 寻找 assets 中的 zip 压缩包
    const zipAsset = release.assets?.find((a) => a.name?.endsWith(".zip") || a.name?.endsWith(".mcz"));
    const downloadUrl = zipAsset?.browser_download_url ?? release.html_url ?? null;

    const data: UpdateInfo = {
      hasUpdate,
      currentVersion: APP_VERSION,
      latestVersion: latestTag.replace(/^v/i, ""),
      releaseName: release.name || latestTag,
      releaseNotes: release.body || "暂无版本说明。",
      publishedAt: release.published_at || null,
      htmlUrl: release.html_url || `https://github.com/${repo}/releases`,
      downloadUrl,
      repo,
    };

    cachedResult = { timestamp: now, data };
    return NextResponse.json({ ok: true, update: data });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `检查更新失败: ${(err as Error).message}`,
        currentVersion: APP_VERSION,
      },
      { status: 500 },
    );
  }
}
