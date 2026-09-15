/** 工程列表整形与 ?src 查询串(纯函数,客户端/服务端共用;不得引入 node 模块)。 */

export function srcQuery(src: string): string {
  return `?src=${encodeURIComponent(src)}`;
}

export interface ProjectListItem {
  src: string;
  title: string;
  updatedAt: string | null;
  assignedCount: number | null;
  isDefault: boolean;
}

export interface ProjectAsset {
  path: string;
  dir: string;
  name: string;
}

export type ManagedSourceKind = "mc" | "mcz" | "workspace";

export interface ManagedChartRecord {
  legacySources?: string[];
  /** Stable opaque id; filenames may change without invalidating navigation/history. */
  id: string;
  fileName: string;
  title: string;
}

export interface ManagedSourceAssetRecord {
  fileName: string;
  fingerprint: string;
}

export interface ManagedProjectRecord {
  id: string;
  displayName: string;
  /** Repository-relative, server-owned directory under artifacts/arranger/workspaces/. */
  workspaceRel: string;
  sourceKind: ManagedSourceKind;
  /** Absolute backing path for mc/mcz; null for upload-only workspaces. */
  sourcePath: string | null;
  sourceFingerprint: string | null;
  /** Last explicitly synced sibling assets for bare .mc conflict detection. */
  sourceAssets?: Partial<Record<"audio" | "cover", ManagedSourceAssetRecord>>;
  charts: ManagedChartRecord[];
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
  /** Protected repository assets (notably WDA) become a normal copy on first mutation. */
  copyOnWrite: boolean;
}

export interface ProjectRegistryV3 {
  schema: 3;
  hiddenProjects: string[];
  hiddenCharts: string[];
  lastOpenedSrc: string | null;
  lastExportDir: string | null;
  managedProjects: ManagedProjectRecord[];
  updatedAt: string;
}

/** V1/V2 are kept losslessly: their path based entries remain usable while being adopted lazily. */
export function migrateProjectRegistry(raw: unknown): ProjectRegistryV3 {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const strings = (candidate: unknown) =>
    Array.isArray(candidate)
      ? [...new Set(candidate.filter((x): x is string => typeof x === "string"))].sort()
      : [];
  if (value.schema === 3) {
    const managedProjects = Array.isArray(value.managedProjects)
      ? value.managedProjects.filter((item): item is ManagedProjectRecord => {
        if (!item || typeof item !== "object") return false;
        const p = item as Partial<ManagedProjectRecord>;
        return typeof p.id === "string" && typeof p.workspaceRel === "string" &&
          Array.isArray(p.charts);
      })
      : [];
    return {
      schema: 3,
      hiddenProjects: strings(value.hiddenProjects),
      hiddenCharts: strings(value.hiddenCharts),
      lastOpenedSrc: typeof value.lastOpenedSrc === "string" ? value.lastOpenedSrc : null,
      lastExportDir: typeof value.lastExportDir === "string" ? value.lastExportDir : null,
      managedProjects,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    };
  }
  return {
    schema: 3,
    hiddenProjects: value.schema === 2 ? strings(value.hiddenProjects) : [],
    hiddenCharts: value.schema === 2 ? strings(value.hiddenCharts) : strings(value.hidden),
    lastOpenedSrc: typeof value.lastOpenedSrc === "string" ? value.lastOpenedSrc : null,
    lastExportDir: null,
    managedProjects: [],
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
  };
}

/** `managed:<project-id>:<chart-id>` is URL-safe and never reveals a local path. */
export function managedSrc(projectId: string, chartId: string): string {
  return `managed:${projectId}:${chartId}`;
}

export function parseManagedSrc(src: string): { projectId: string; chartId: string } | null {
  const match = /^managed:([a-f0-9]{16}):([a-f0-9]{12})$/i.exec(src);
  return match ? { projectId: match[1].toLowerCase(), chartId: match[2].toLowerCase() } : null;
}

export interface ProjectsInput {
  states: { sourcePath: string; updatedAt: string | null; assignedCount: number }[];
  importMcs: { src: string; title: string }[];
  defaultSrc: string;
}

function titleOf(src: string): string {
  const base = src.split("/").pop() ?? src;
  return base.replace(/\.mc$/i, "");
}

/** posix dirname:`WDA/WDA_Recorded.mc` → `WDA`(工程包 = 文件夹)。 */
export function dirOf(src: string): string {
  const i = src.lastIndexOf("/");
  return i <= 0 ? "" : src.slice(0, i);
}

// ── 一曲多包:一个文件夹(= 一份歌曲)下可有多张 .mc ────────────────────────

export interface PackageChart {
  missing?: boolean;
  id?: string;
  src: string;
  path?: string;
  dir?: string;
  name?: string;
  title: string;
  updatedAt: string | null;
  assignedCount: number | null;
  hidden: boolean;
  isDefault: boolean;
}

export interface ProjectPackage {
  id?: string;
  dir: string;
  title: string;
  isDefault: boolean;
  isExample?: boolean;
  /** 包内各谱的最近修改时间取最大 */
  updatedAt: string | null;
  charts: PackageChart[];
  audio?: ProjectAsset | null;
  cover?: ProjectAsset | null;
  hidden?: boolean;
  canPurge?: boolean;
  assetError?: string | null;
  managed?: boolean;
  sourceKind?: ManagedSourceKind;
  sourcePath?: string | null;
}

export type EditorProject = ProjectPackage;

export interface PackagesInput {
  folders: {
    dir: string;
    title: string;
    isExample?: boolean;
    charts: { src: string; title: string; id?: string; name?: string; path?: string; missing?: boolean }[];
    audio?: ProjectAsset | null;
    cover?: ProjectAsset | null;
    canPurge?: boolean;
    assetError?: string | null;
    managed?: boolean;
    sourceKind?: ManagedSourceKind;
    sourcePath?: string | null;
  }[];
  /** 以 src 为键的工作状态 */
  states: Record<string, { updatedAt: string | null; assignedCount: number }>;
  hidden?: readonly string[];
  hiddenProjects?: readonly string[];
  defaultSrc: string;
}

/** 分组整形:默认包最前 → 其余按 updatedAt 降序 → 标题;包内谱按标题(默认谱置顶)。 */
export function shapePackageList(input: PackagesInput): ProjectPackage[] {
  const hidden = new Set(input.hidden ?? []);
  const hiddenProjects = new Set(input.hiddenProjects ?? []);
  const pkgs: ProjectPackage[] = input.folders.map((f) => {
    const charts: PackageChart[] = f.charts.map((c) => {
      const st = input.states[c.src];
      return {
        missing: c.missing,
        id: c.id,
        src: c.src,
        path: c.path ?? c.src,
        dir: f.dir,
        name: c.name ?? c.src.split("/").pop() ?? c.src,
        title: c.title,
        updatedAt: st?.updatedAt ?? null,
        assignedCount: st?.assignedCount ?? null,
        hidden: hidden.has(c.src),
        isDefault: c.src === input.defaultSrc,
      };
    });
    charts.sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
    });
    const stamps = charts.map((c) => c.updatedAt).filter((x): x is string => !!x);
    return {
      id: f.dir,
      dir: f.dir,
      title: f.title,
      isDefault: charts.some((c) => c.isDefault),
      isExample: f.isExample ?? false,
      updatedAt: stamps.length ? stamps.reduce((a, b) => (a > b ? a : b)) : null,
      charts,
      audio: f.audio ?? null,
      cover: f.cover ?? null,
      hidden: hiddenProjects.has(f.dir),
      canPurge: f.canPurge ?? false,
      assetError: f.assetError ?? null,
      managed: f.managed ?? false,
      sourceKind: f.sourceKind,
      sourcePath: f.sourcePath ?? null,
    };
  });
  pkgs.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (a.updatedAt && b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
    if (a.updatedAt) return -1;
    if (b.updatedAt) return 1;
    return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
  });
  return pkgs;
}

/** 过滤隐藏条目;整包都被隐藏则连包一起去掉。 */
export function applyHidden(
  pkgs: ProjectPackage[],
  hidden: readonly string[],
  hiddenProjects: readonly string[] = [],
): ProjectPackage[] {
  const set = new Set(hidden);
  const projectSet = new Set(hiddenProjects);
  return pkgs
    .filter((p) => !projectSet.has(p.dir))
    .map((p) => ({ ...p, charts: p.charts.filter((c) => !set.has(c.src)) }))
    .filter((p) => p.charts.length > 0);
}

export interface AssetDisplayRows {
  commonDir: string | null;
  charts: string[];
  audio: string;
  cover: string;
}

/** 工程卡片路径展示：全部同目录时只打印一次目录，否则逐项打印完整路径。 */
export function assetDisplayRows(input: {
  charts: ProjectAsset[];
  audio: ProjectAsset | null;
  cover: ProjectAsset | null;
}): AssetDisplayRows {
  const present = [...input.charts, input.audio, input.cover].filter(
    (x): x is ProjectAsset => x !== null,
  );
  const commonDir = present.length > 0 && present.every((x) => x.dir === present[0].dir)
    ? present[0].dir
    : null;
  const label = (asset: ProjectAsset | null) =>
    asset ? (commonDir ? asset.name : asset.path) : "缺失";
  return {
    commonDir,
    charts: input.charts.map((asset) => (commonDir ? asset.name : asset.path)),
    audio: label(input.audio),
    cover: label(input.cover),
  };
}

export function currentPackageOf(pkgs: ProjectPackage[], src: string): ProjectPackage | null {
  return pkgs.find((p) => p.charts.some((c) => c.src === src)) ?? null;
}

export function resolveLastOpenedSrc(
  lastOpenedSrc: string | null,
  projects: ProjectPackage[],
  defaultSrc?: string | null,
): string | null {
  if (lastOpenedSrc) {
    const project = currentPackageOf(projects, lastOpenedSrc);
    if (!project || project.hidden) return null;
    const chart = project.charts.find((candidate) => candidate.src === lastOpenedSrc);
    return chart && !chart.hidden && !chart.missing ? chart.src : null;
  }
  if (defaultSrc) {
    const project = currentPackageOf(projects, defaultSrc);
    if (!project || project.hidden) return null;
    const chart = project.charts.find((candidate) => candidate.src === defaultSrc);
    return chart && !chart.hidden && !chart.missing ? chart.src : null;
  }
  return null;
}

export function addHidden(list: readonly string[], src: string): string[] {
  return list.includes(src) ? [...list] : [...list, src].sort();
}

export function removeHidden(list: readonly string[], src: string): string[] {
  return list.filter((x) => x !== src);
}

/** 合并去重:可选旧版默认项最前 → 已打开工程按 updatedAt 降序 → 未打开工程按标题。 */
export function shapeProjectList(input: ProjectsInput): ProjectListItem[] {
  const bySrc = new Map<string, ProjectListItem>();
  for (const im of input.importMcs) {
    bySrc.set(im.src, {
      src: im.src,
      title: im.title,
      updatedAt: null,
      assignedCount: null,
      isDefault: im.src === input.defaultSrc,
    });
  }
  for (const st of input.states) {
    const existing = bySrc.get(st.sourcePath);
    bySrc.set(st.sourcePath, {
      src: st.sourcePath,
      title: existing?.title ?? titleOf(st.sourcePath),
      updatedAt: st.updatedAt,
      assignedCount: st.assignedCount,
      isDefault: st.sourcePath === input.defaultSrc,
    });
  }
  if (input.defaultSrc && !bySrc.has(input.defaultSrc)) {
    bySrc.set(input.defaultSrc, {
      src: input.defaultSrc,
      title: titleOf(input.defaultSrc),
      updatedAt: null,
      assignedCount: null,
      isDefault: true,
    });
  }
  const items = [...bySrc.values()];
  items.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (a.updatedAt && b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
    if (a.updatedAt) return -1;
    if (b.updatedAt) return 1;
    return a.title < b.title ? -1 : 1;
  });
  return items;
}
