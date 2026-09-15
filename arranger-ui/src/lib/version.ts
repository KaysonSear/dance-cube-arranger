/**
 * 舞立方谱面编辑器版本与更新配置。
 */

export const APP_VERSION = "260915";

/** 默认 GitHub 仓库 (owner/repo)，若开源后地址变动可通过环境变量 ARRANGER_GITHUB_REPO 覆盖 */
export const DEFAULT_GITHUB_REPO = "KaysonSear/dance-cube-arranger";

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string | null;
  htmlUrl: string;
  downloadUrl: string | null;
  repo: string;
}

/**
 * 比较两个版本号字符串（如 "260915" vs "260920" 或 "v1.2.0" vs "v1.2.1"）。
 * 返回 >0 表示 target > current（存在更新）；0 表示相等；<0 表示 target <= current。
 */
export function compareVersions(current: string, target: string): number {
  const clean = (v: string) => v.trim().replace(/^v/i, "");
  const c = clean(current);
  const t = clean(target);

  if (c === t) return 0;

  // 纯数字日期版本号比较 (例如 "260915" vs "260920")
  if (/^\d+$/.test(c) && /^\d+$/.test(t)) {
    const numC = Number.parseInt(c, 10);
    const numT = Number.parseInt(t, 10);
    if (!Number.isNaN(numC) && !Number.isNaN(numT)) {
      return numT - numC;
    }
  }

  // 语义化版本号分割比较 (例如 "1.2.3")
  const partsC = c.split(/[.-]/).map((p) => Number.parseInt(p, 10) || 0);
  const partsT = t.split(/[.-]/).map((p) => Number.parseInt(p, 10) || 0);
  const len = Math.max(partsC.length, partsT.length);

  for (let i = 0; i < len; i++) {
    const pc = partsC[i] ?? 0;
    const pt = partsT[i] ?? 0;
    if (pt > pc) return 1;
    if (pt < pc) return -1;
  }

  return t.localeCompare(c);
}
