/** 工作状态与快照的持久化 schema(artifacts/arranger/projects/<key>/ 下的 JSON)。 */

import type { AssignmentsJson, SourceMode } from "./arrangement";
import type { Beat } from "./beat";
import type { PersistedSegmentStructure } from "./segments";

export interface UiPrefs {
  playheadSec: number;
  leadInSec: number;
  /** 预览视觉迁移版本；缺失表示使用旧版小球预览。 */
  previewVisualVersion?: number;
  snapDenom: number;
  /** 仅预览的 AV 微调(ms),绝不写回 .mc。 */
  nudgeMs: number;
  pxPerSec: number;
  scrollSec: number;
  selectedOnsetId: string | null;
  playbackRate: number;
  /** 音乐音量 0–1。 */
  musicVol: number;
  /** kick 打点音量 0–1(0 = 静音)。 */
  kickVol: number;
  /** kick 听感微调(ms,正=推迟);用于抵消残余恒定偏差,不写回 .mc。 */
  kickOffsetMs: number;
  /** 点击时间轴吸附到最近节拍 + 试听(默认开)。 */
  snapClickEnabled: boolean;
  /** 打点音色 id(见 audio-engine KICK_SOUNDS)。 */
  kickSound: string;
  /** 手动修正的 BPM(null = 用源谱面值);会写入保存/导出包内的 .mc。 */
  bpmOverride: number | null;
  /** 手动修正的 offset(ms,null = 用源值);会写入保存/导出包内的 .mc。 */
  offsetOverride: number | null;
  /** 自动写回源 .mc;null = 按路径默认(见 writeback.ts)。 */
  writeBackEnabled: boolean | null;
  /** 外接 BELKZJ 六键模拟器模式，按工程记忆。 */
  simulatorMode: boolean;
}

export interface WorkingStateV1 {
  schema: 1;
  /** V3 不透明 managed ref；旧状态也可保留仓库相对路径。 */
  sourcePath: string;
  /** 源文件 sha1;不匹配 → 警告(继续 / 重新播种)。 */
  sourceSha1: string;
  sourceMode: SourceMode;
  assignments: AssignmentsJson;
  /** 用户新增的采音点(源采音点之外);可选 → 旧状态文件照常加载。 */
  addedOnsets?: Beat[];
  /** 用户删除的采音点 id (包含被删除的源谱采音点及手动点); 可选 → 旧状态文件照常加载。 */
  deletedOnsetIds?: string[];
  /** 编辑器内的结构 clip；不写入源 .mc。V1 读取后自动迁移为稀疏 V2。 */
  structure?: PersistedSegmentStructure;
  ui: UiPrefs;
  updatedAt: string;
}

export interface SnapshotMeta {
  id: string;
  createdAt: string;
  label: string | null;
  assignedCount: number;
}

export interface Snapshot extends SnapshotMeta {
  state: WorkingStateV1;
}

export const PREVIEW_VISUAL_VERSION = 7;

export const DEFAULT_UI: UiPrefs = {
  playheadSec: 0,
  leadInSec: 0.75,
  previewVisualVersion: PREVIEW_VISUAL_VERSION,
  snapDenom: 4,
  nudgeMs: 0,
  pxPerSec: 120,
  scrollSec: 0,
  selectedOnsetId: null,
  playbackRate: 1,
  musicVol: 1,
  kickVol: 0.5,
  kickOffsetMs: 0,
  snapClickEnabled: true,
  kickSound: "kick",
  bpmOverride: null,
  offsetOverride: null,
  writeBackEnabled: null,
  simulatorMode: false,
};

/**
 * Upgrade legacy saved states once. A state carrying the current version keeps the user's
 * lead-in preference, including values different from the new default.
 */
export function normalizeUiPrefs(saved?: Partial<UiPrefs> | null): UiPrefs {
  const current = saved?.previewVisualVersion === PREVIEW_VISUAL_VERSION;
  return {
    ...DEFAULT_UI,
    ...saved,
    leadInSec: current && typeof saved?.leadInSec === "number" ? saved.leadInSec : 0.75,
    previewVisualVersion: PREVIEW_VISUAL_VERSION,
  };
}

// 三连音感知档位(移植旧采音器),最细 1/32
export const SNAP_DENOMS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32] as const;
