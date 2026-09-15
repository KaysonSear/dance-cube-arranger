/**
 * 采音点智能伪随机排键算法 (类似输入法智能联想):
 * 从 data/corpus/charts 下全部 1469 张人类谱面、769,462 个采音点中学习到的统计模型：
 * 包含 N-gram 转移矩阵 (Bigram, Trigram, Skipgram/双向插值)、双押与一长一短组合概率分布、
 * 以及不同时值密度 (fast / medium / slow) 与节拍强弱 (bar / beat / half / offbeat) 下的先验。
 *
 * 结合实时上下文、既有长条遮挡、未来音符防碰撞与人体工学硬约束，
 * 通过 Softmax 温度加权进行“假随机 / 智能联想”生成。
 *
 * 音符组合形态 (最多双押):
 * 1. 单击 (蓝键, single_tap)
 * 2. 单击长条 (single_hold)
 * 3. 双击 (双押, double_tap)
 * 4. 双击长条 (double_hold)
 * 5. 一长一短 (1个单击 + 1个长条, tap_and_hold)
 */

import {
  assignmentsAt,
  type Assignment,
  type AssignmentsMap,
  type Column,
  type Onset,
} from "./arrangement";
import { type Beat, beatToFloat, floatToBeat } from "./beat";
import corpusPatternsData from "./corpus-patterns.json";

export type SmartPatternType =
  | "single_tap"
  | "single_hold"
  | "double_tap"
  | "double_hold"
  | "tap_and_hold";

export interface GeneratedArrangement {
  assignments: Assignment[];
  patternType: SmartPatternType;
  description: string;
}

export interface SmartArrangerOptions {
  /** 可选随机数生成器 (单测注入, 默认 Math.random) */
  rng?: () => number;
  /** Softmax 温度系数 (默认 0.85; 越高越发散, 越低越偏向高分候选) */
  temperature?: number;
}

/** 舞立方模式列中文名称 */
const COLUMN_NAMES: Record<Column, string> = {
  0: "左上",
  1: "左中",
  2: "左下",
  3: "右下",
  4: "右中",
  5: "右上",
};

/** 舞立方手部分组: 左手 {0, 1, 2}, 右手 {3, 4, 5} */
function handOf(col: Column): "L" | "R" {
  return col <= 2 ? "L" : "R";
}

interface ScoredCandidate {
  patternType: SmartPatternType;
  assignments: Assignment[];
  score: number;
  description: string;
}

const EPS = 1e-4;

function getMetricBucket(beatFloat: number): "bar_downbeat" | "beat_downbeat" | "half_beat" | "offbeat" {
  if (Math.abs(beatFloat % 4) < EPS) return "bar_downbeat";
  if (Math.abs(beatFloat % 1) < EPS) return "beat_downbeat";
  if (Math.abs((beatFloat * 2) % 1) < EPS) return "half_beat";
  return "offbeat";
}

function getDeltaBucket(delta: number): "fast" | "medium" | "slow" {
  if (delta <= 0.35) return "fast";
  if (delta <= 0.75) return "medium";
  return "slow";
}

interface CorpusPatterns {
  type_priors: Record<string, Record<string, number>>;
  bigrams: Record<string, Record<string, number>>;
  trigrams: Record<string, Record<string, number>>;
  skipgrams: Record<string, Record<string, number>>;
  chord_pairs: Record<string, number>;
  chord_from_single: Record<string, Record<string, number>>;
  tap_and_hold_pairs: Record<string, number>;
}

const corpus: CorpusPatterns = corpusPatternsData as unknown as CorpusPatterns;

/**
 * 核心智能预测排键函数:
 * 输入全体采音点、当前排键图和目标采音点 ID，输出基于语料库学习与上下文特征的伪随机排键结果。
 */
export function generateSmartOnsetArrangement(
  onsets: readonly Onset[],
  assignments: AssignmentsMap,
  targetOnsetId: string,
  options?: SmartArrangerOptions,
): GeneratedArrangement | null {
  const targetIndex = onsets.findIndex((o) => o.id === targetOnsetId);
  if (targetIndex < 0) return null;

  const targetOnset = onsets[targetIndex];
  const currBeat = targetOnset.beatFloat;
  const rng = options?.rng ?? Math.random;
  const temperature = Math.max(0.1, options?.temperature ?? 0.85);

  // 1. 扫描当前时刻被此前活动长条占用的列 (硬约束: 被长条按住的列绝对不可按)
  const activeHoldColumns = new Set<Column>();
  for (let i = 0; i < targetIndex; i++) {
    const prevO = onsets[i];
    const prevAssignments = assignmentsAt(assignments, prevO.id);
    for (const a of prevAssignments) {
      if (a.endbeat !== null && beatToFloat(a.endbeat) > currBeat + EPS) {
        activeHoldColumns.add(a.column);
      }
    }
  }

  // 可用空闲列
  const allColumns: Column[] = [0, 1, 2, 3, 4, 5];
  const availableColumns = allColumns.filter((col) => !activeHoldColumns.has(col));
  if (availableColumns.length === 0) return null;

  // 2. 提取邻近采音点与时值间隔上下文
  const prevOnset = targetIndex > 0 ? onsets[targetIndex - 1] : null;
  const prevDelta = prevOnset ? currBeat - prevOnset.beatFloat : 1.0;
  const prevAssignments = prevOnset ? assignmentsAt(assignments, prevOnset.id) : [];
  const prevCols = prevAssignments.map((a) => a.column);

  const prev2Onset = targetIndex > 1 ? onsets[targetIndex - 2] : null;
  const prev2Assignments = prev2Onset ? assignmentsAt(assignments, prev2Onset.id) : [];
  const prev2Cols = prev2Assignments.map((a) => a.column);

  const nextOnset = targetIndex < onsets.length - 1 ? onsets[targetIndex + 1] : null;
  const nextDelta = nextOnset ? nextOnset.beatFloat - currBeat : 1.0;
  const nextAssignments = nextOnset ? assignmentsAt(assignments, nextOnset.id) : [];
  const nextCols = nextAssignments.map((a) => a.column);

  const metricBucket = getMetricBucket(currBeat);
  const deltaBucket = getDeltaBucket(prevDelta);
  const isFastStream = prevDelta <= 0.35 || nextDelta <= 0.35;

  // 3. 扫描每列未来的首个音符起始时刻 (长条尾不能越过同列后续音符)
  const nextNoteOnColumnBeat = new Map<Column, number>();
  for (let i = targetIndex + 1; i < onsets.length; i++) {
    const o = onsets[i];
    const oAssignments = assignmentsAt(assignments, o.id);
    for (const a of oAssignments) {
      if (!nextNoteOnColumnBeat.has(a.column)) {
        nextNoteOnColumnBeat.set(a.column, o.beatFloat);
      }
    }
  }

  // 4. 计算某列长条的安全尾部 (Beat)
  function computeHoldEnd(col: Column): Beat | null {
    const futureBeat = nextNoteOnColumnBeat.get(col);
    let targetDur = nextDelta;
    if (targetDur < 0.25) {
      if (!futureBeat || futureBeat >= currBeat + 0.5 - EPS) targetDur = 0.5;
      else return null;
    } else if (targetDur > 1.0) {
      targetDur = 1.0;
    }

    if (futureBeat !== undefined) {
      if (futureBeat <= currBeat + 0.2) return null;
      if (currBeat + targetDur > futureBeat) {
        targetDur = futureBeat - currBeat;
      }
    }

    if (targetDur < 0.2) return null;

    const endFloat = currBeat + targetDur;
    const endbeat = floatToBeat(endFloat, targetDur <= 0.5 ? 8 : 4);
    if (beatToFloat(endbeat) <= currBeat + EPS) return null;
    return endbeat;
  }

  // 5. 从人类谱面语料中读取形态先验概率
  const priorKey = `${metricBucket}:${deltaBucket}`;
  const priors = corpus.type_priors[priorKey] || {};

  function getTypePriorScore(ptype: SmartPatternType): number {
    // 基础先验平滑，避免稀有形态概率下溢
    const p = priors[ptype] ?? (ptype === "single_tap" ? 0.5 : 0.05);
    return Math.log(Math.max(0.015, p));
  }

  // 6. 生成候选并打分
  const candidates: ScoredCandidate[] = [];

  // ── 候选 1: 单击 (single_tap) ──
  const singleTapPrior = getTypePriorScore("single_tap");
  for (const col of availableColumns) {
    let score = singleTapPrior;
    score += evaluateSingleColumn(col);
    candidates.push({
      patternType: "single_tap",
      assignments: [{ column: col, endbeat: null }],
      score,
      description: `单击 [${COLUMN_NAMES[col]}]`,
    });
  }

  // ── 候选 2: 单击长条 (single_hold) ──
  if (!isFastStream && nextDelta >= 0.28) {
    const singleHoldPrior = getTypePriorScore("single_hold");
    for (const col of availableColumns) {
      const endbeat = computeHoldEnd(col);
      if (!endbeat) continue;
      let score = singleHoldPrior;
      if (nextDelta >= 0.8) score += 0.8;
      score += evaluateSingleColumn(col);
      candidates.push({
        patternType: "single_hold",
        assignments: [{ column: col, endbeat }],
        score,
        description: `单击长条 [${COLUMN_NAMES[col]}]`,
      });
    }
  }

  // ── 候选 3: 双击 (double_tap) ──
  if (availableColumns.length >= 2) {
    const doubleTapPrior = getTypePriorScore("double_tap");
    for (let i = 0; i < availableColumns.length; i++) {
      for (let j = i + 1; j < availableColumns.length; j++) {
        const c1 = availableColumns[i];
        const c2 = availableColumns[j];
        if (!isErgonomicallyPlayablePair(c1, c2)) continue;

        let score = doubleTapPrior;
        score += evaluateChordPair(c1, c2);

        candidates.push({
          patternType: "double_tap",
          assignments: [
            { column: c1, endbeat: null },
            { column: c2, endbeat: null },
          ],
          score,
          description: `双押 [${COLUMN_NAMES[c1]}, ${COLUMN_NAMES[c2]}]`,
        });
      }
    }
  }

  // ── 候选 4: 双击长条 (double_hold) ──
  if (!isFastStream && availableColumns.length >= 2 && nextDelta >= 0.38) {
    const doubleHoldPrior = getTypePriorScore("double_hold");
    for (let i = 0; i < availableColumns.length; i++) {
      for (let j = i + 1; j < availableColumns.length; j++) {
        const c1 = availableColumns[i];
        const c2 = availableColumns[j];

        const end1 = computeHoldEnd(c1);
        const end2 = computeHoldEnd(c2);
        if (!end1 || !end2) continue;

        let score = doubleHoldPrior;
        if (nextDelta >= 0.8) score += 0.8;
        score += evaluateChordPair(c1, c2);

        candidates.push({
          patternType: "double_hold",
          assignments: [
            { column: c1, endbeat: end1 },
            { column: c2, endbeat: end2 },
          ],
          score,
          description: `双击长条 [${COLUMN_NAMES[c1]}, ${COLUMN_NAMES[c2]}]`,
        });
      }
    }
  }

  // ── 候选 5: 一长一短 (tap_and_hold: 1单击 + 1长条) ──
  if (!isFastStream && availableColumns.length >= 2 && nextDelta >= 0.35) {
    const tapHoldPrior = getTypePriorScore("tap_and_hold");
    for (let i = 0; i < availableColumns.length; i++) {
      for (let j = 0; j < availableColumns.length; j++) {
        if (i === j) continue;
        const cHold = availableColumns[i];
        const cTap = availableColumns[j];
        if (!isErgonomicallyPlayablePair(cHold, cTap)) continue;

        const endHold = computeHoldEnd(cHold);
        if (!endHold) continue;

        let score = tapHoldPrior;
        if (nextDelta >= 0.7) score += 0.6;

        // 从人类语料中读取一长一短偏好
        const tapHoldKey = `${cHold},${cTap}`;
        const humanProb = corpus.tap_and_hold_pairs[tapHoldKey] ?? 0.02;
        score += Math.log(Math.max(0.015, humanProb));

        // 基础双键搭配评分
        score += evaluateChordPair(Math.min(cHold, cTap) as Column, Math.max(cHold, cTap) as Column);

        if (nextCols.length === 1 && handOf(nextCols[0]) === handOf(cTap)) {
          score += 0.8;
        }

        const sortedAssignments: Assignment[] = [
          { column: cHold, endbeat: endHold },
          { column: cTap, endbeat: null },
        ].sort((a, b) => a.column - b.column);

        candidates.push({
          patternType: "tap_and_hold",
          assignments: sortedAssignments,
          score,
          description: `一长一短 [${COLUMN_NAMES[cHold]}(长条), ${COLUMN_NAMES[cTap]}]`,
        });
      }
    }
  }

  if (candidates.length === 0) return null;

  // 7. 基于语料 N-gram 的列评分
  function evaluateSingleColumn(col: Column): number {
    let bonus = 0;

    // 语料 Bigram: P(col | col_prev, delta)
    if (prevCols.length === 1) {
      const prevCol = prevCols[0];
      const bigramKey = `${prevCol}:${deltaBucket}`;
      const bigramProb = corpus.bigrams[bigramKey]?.[String(col)];
      if (bigramProb) {
        bonus += Math.log(Math.max(0.02, bigramProb));
      }

      // 语料 Trigram: P(col | col_prev2, col_prev1)
      if (prev2Cols.length === 1) {
        const prev2Col = prev2Cols[0];
        const trigramKey = `${prev2Col}->${prevCol}`;
        const trigramProb = corpus.trigrams[trigramKey]?.[String(col)];
        if (trigramProb) {
          bonus += Math.log(Math.max(0.02, trigramProb));
        }
      }

      // 语料 Skipgram (双向插值): P(col | col_prev, col_next)
      if (nextCols.length === 1) {
        const nextCol = nextCols[0];
        const skipgramKey = `${prevCol}<->${nextCol}`;
        const skipgramProb = corpus.skipgrams[skipgramKey]?.[String(col)];
        if (skipgramProb) {
          bonus += Math.log(Math.max(0.02, skipgramProb));
        }
      }

      // 叠键抑制 (极速 16 分同键连打在街机上容易手崩)
      if (col === prevCol) {
        if (prevDelta <= 0.26) bonus -= 4.0;
        else if (prevDelta <= 0.5) bonus -= 1.5;
      }
    }

    return bonus;
  }

  // 8. 基于语料双押对的评分
  function evaluateChordPair(c1: Column, c2: Column): number {
    let bonus = 0;
    const pairKey = `${c1},${c2}`;

    // 语料边缘概率 P(c1, c2)
    const pairProb = corpus.chord_pairs[pairKey];
    if (pairProb) {
      bonus += Math.log(Math.max(0.02, pairProb));
    }

    // 语料条件转移 P(c1, c2 | col_prev)
    if (prevCols.length === 1) {
      const prevCol = prevCols[0];
      const condProb = corpus.chord_from_single[String(prevCol)]?.[pairKey];
      if (condProb) {
        bonus += Math.log(Math.max(0.02, condProb));
      }
    }

    // 避免连续同列重复双押
    if (prevCols.length === 2 && prevDelta <= 0.5) {
      const prevSet = new Set(prevCols);
      if (prevSet.has(c1) && prevSet.has(c2)) {
        bonus -= 3.0;
      }
    }

    return bonus;
  }

  function isErgonomicallyPlayablePair(c1: Column, c2: Column): boolean {
    return c1 !== c2;
  }

  // 9. Softmax 加权概率采样 (假随机)
  const maxScore = Math.max(...candidates.map((c) => c.score));
  const expWeights = candidates.map((c) => Math.exp((c.score - maxScore) / temperature));
  const sumWeights = expWeights.reduce((acc, val) => acc + val, 0);

  let randomVal = rng() * sumWeights;
  let chosen = candidates[candidates.length - 1];

  for (let i = 0; i < candidates.length; i++) {
    randomVal -= expWeights[i];
    if (randomVal <= 0) {
      chosen = candidates[i];
      break;
    }
  }

  return {
    assignments: chosen.assignments,
    patternType: chosen.patternType,
    description: chosen.description,
  };
}

export interface KeyMatchEvent {
  key?: string;
  code?: string;
  keyCode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/**
 * 判断键盘按键事件是否触发随机排键 (R / Ctrl+R / 中文输入法下 Process 态等)。
 * 屏蔽 Alt 组合，支持 bare R、Ctrl+R、Cmd+R、以及在中文输入法激活时的 KeyR (key='Process')。
 */
export function isRandomizeKeyEvent(e: KeyMatchEvent): boolean {
  if (e.altKey) return false;
  const k = (e.key ?? "").toLowerCase();
  const code = (e.code ?? "").toLowerCase();
  const keyCode = e.keyCode ?? 0;
  return k === "r" || code === "keyr" || keyCode === 82;
}

