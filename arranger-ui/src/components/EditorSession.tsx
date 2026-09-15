"use client";

/**
 * 编排中枢(单工程会话,由 EditorShell 以 key=src 挂载):加载(geometry/chart/state
 * 并行,按 ?src 定位工程)→ 播种或恢复 → 编辑状态机 → 自动保存/快照 → 导出。
 * 所有编辑判定走 src/lib/arrangement 纯函数;本组件只做编排与事件接线。
 *
 * 编辑对象**由播放头派生**(已废除选中态):播放头落在哪个采音点的命中窗口(±0.09s)内,
 * 那个就是当前编辑对象 —— 与预览"此刻正在打的音符"完全一致。
 *   普通点击键 → 未指派则 assign;已指派单点则取消;已指派长条则改回单点。
 *   **Shift+点击键** → 把该键在播放头之前最近一次指派延伸成长条(尾落在吸附拍位)。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAudioClock } from "@/hooks/useAudioClock";
import type { KickSoundId } from "@/lib/audio-engine";
import {
  assign,
  assignAllToColumn,
  assignmentsAt,
  assignmentsFromJson,
  assignmentsToJson,
  buildExportNotes,
  buildOnsets,
  clearOnsets,
  isKeyCEvent,
  isKeyVEvent,
  isMirrorKeyEvent,
  looksLikePlaceholder,
  makeAddedOnset,
  mergeOnsets,
  mirrorAssignments,
  move,
  replaceOnsetAssignments,
  seedAssignments,
  setHoldEnd,
  swapOnsetAssignments,
  unassign,
  validate,
  validateTriples,
  type AssignmentsMap,
  type Column,
  type EditResult,
  type Onset,
  type SourceMode,
} from "@/lib/arrangement";
import { fmtTime } from "@/lib/format";
import { buildArrangedMc, parseMc, type ParsedChart } from "@/lib/mc";
import { metadataFromChart, type ChartMetadataInput } from "@/lib/chart-setup";
import { tickId, type Beat } from "@/lib/beat";
import { parseGeometry, type Geometry } from "@/lib/geometry";
import {
  ARRANGEMENT_CLIPBOARD_MIME,
  buildArrangementClipboard,
  parseArrangementClipboard,
  pasteArrangementClipboard,
  serializeArrangementClipboard,
} from "@/lib/segment-clipboard";
import {
  generateSmartOnsetArrangement,
  isRandomizeKeyEvent,
} from "@/lib/random-arranger";
import {
  DEFAULT_UI,
  normalizeUiPrefs,
  type UiPrefs,
  type WorkingStateV1,
} from "@/lib/persist-types";
import { srcQuery } from "@/lib/projects";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  deriveSegments,
  EMPTY_SEGMENT_STRUCTURE,
  ensureRelation,
  formatClipTime,
  createClipFromRange,
  createSuggestedStructure,
  mergeClips,
  partitionTimedPoints,
  removeClip,
  restoreSegmentStructure,
  type PersistedSegmentStructure,
  type SuggestedSection,
  type SegmentStructureV3,
} from "@/lib/segments";
import { nearestOnsetByTime, nextOnsetByTime, onsetAtOrBefore } from "@/lib/timeline";
import { resolveWriteBack } from "@/lib/writeback";
import {
  audioSecToBeat,
  beatToAudioSec,
  snapBeatFloat,
  snapToBeat,
  type TimingContext,
} from "@/lib/timemap";
import { UndoStack } from "@/lib/undo";
import { deleteOnsetFromSnapshot, nextSnapshot, type EditorSnapshot } from "@/lib/editor-state";
import {
  loadStoredSimulatorKeymap,
  navigateSimulatorGesture,
  pressSimulatorLane,
  releaseSimulatorLane,
  saveStoredSimulatorKeymap,
  simulatorAdvanceIndex,
  simulatorCaptureShouldRefocus,
  simulatorColumnForEvent,
  simulatorColumnForKeyboard,
  simulatorColumnForText,
  simulatorGestureHoldReady,
  simulatorHeldLong,
  simulatorOnsetDirection,
  shouldCommitSimulatorText,
  startSimulatorGesture,
  type SimulatorCommit,
  type SimulatorGesture,
  type SimulatorKeymap,
} from "@/lib/simulator-input";

import BlankChartDialog from "./BlankChartDialog";
import ExportPanel from "./ExportPanel";
import HelpDialog from "./HelpDialog";
import HexPreview from "./HexPreview";
import InspectorPanel from "./InspectorPanel";
import ProjectPanel from "./ProjectPanel";
import ProjectManageDialog from "./ProjectManageDialog";
import ProjectSetupDialog from "./ProjectSetupDialog";
import SegmentsPanel from "./SegmentsPanel";
import { SimulatorKeymapModal } from "./SimulatorKeymapModal";
import LoadDialog from "./LoadDialog";
import SnapshotsPanel from "./SnapshotsPanel";
import Timeline, { type TimelineView } from "./Timeline";
import TimingBar from "./TimingBar";
import TransportBar from "./TransportBar";

type Phase = "loading" | "dialog" | "ready" | "error";

const EPS = 1e-6;
const EXACT_ONSET_SEC = 0.025;

export interface EditorSessionProps {
  src: string;
  onExit(): void;
  /** 切换到另一张谱面(?src=) */
  onOpenSrc(src: string): void;
}

function clipboardTargetIsTextInput(
  target: EventTarget | null,
  simulatorCapture: HTMLInputElement | null,
): boolean {
  if (!(target instanceof HTMLElement) || target === simulatorCapture) return false;
  const editable = target.closest("input, textarea, [contenteditable]");
  return (
    editable !== null &&
    editable !== simulatorCapture &&
    (editable.tagName === "INPUT" || editable.tagName === "TEXTAREA" ||
      (editable instanceof HTMLElement && editable.isContentEditable))
  );
}

export default function EditorSession({ src, onExit, onOpenSrc }: EditorSessionProps) {
  const q = srcQuery(src);

  // ── 加载产物 ──
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [chart, setChart] = useState<ParsedChart | null>(null);
  const rawMeta = chart?.raw.meta && typeof chart.raw.meta === "object"
    ? chart.raw.meta as Record<string, unknown>
    : null;
  const rawSong = rawMeta?.song && typeof rawMeta.song === "object"
    ? rawMeta.song as Record<string, unknown>
    : null;
  const projectTitle = chart
    ? [rawSong?.title, rawMeta?.version].filter((value): value is string => typeof value === "string" && !!value).join(" · ") || "未命名谱面"
    : "正在加载工程…";
  const [sourceInfo, setSourceInfo] = useState<{ path: string; sha1: string } | null>(null);
  const [savedState, setSavedState] = useState<WorkingStateV1 | null>(null);
  const [suggestedSections, setSuggestedSections] = useState<SuggestedSection[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shaMismatch, setShaMismatch] = useState(false);

  // ── 编辑状态 ──
  const [sourceMode, setSourceMode] = useState<SourceMode>("placeholder");
  const [assignments, setAssignments] = useState<AssignmentsMap>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectionSet, setSelectionSet] = useState<Set<string>>(new Set()); // 框选批量(不持久化)
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<string>>(new Set());
  const [pendingInSec, setPendingInSec] = useState<number | null>(null);
  const [markedSwapOnsetId, setMarkedSwapOnsetId] = useState<string | null>(null);
  const [addedOnsets, setAddedOnsets] = useState<Beat[]>([]); // 用户新增采音点(持久化)
  const [deletedOnsetIds, setDeletedOnsetIds] = useState<string[]>([]); // 用户删除的采音点(持久化)
  const [structure, setStructure] = useState<SegmentStructureV3>(EMPTY_SEGMENT_STRUCTURE);
  const [ui, setUi] = useState<UiPrefs>(DEFAULT_UI);
  const [hint, setHint] = useState<string | null>(null);
  const [saveStamp, setSaveStamp] = useState<string | null>(null);
  const [writeBackAt, setWriteBackAt] = useState<string | null>(null);
  const [writeBackBackup, setWriteBackBackup] = useState<string | null>(null);
  const [writeBackError, setWriteBackError] = useState<string | null>(null);
  const [snapsOpen, setSnapsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [addChartOpen, setAddChartOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [assetRevision, setAssetRevision] = useState(0);
  const [manageRevision, setManageRevision] = useState(0);
  const [undoTick, setUndoTick] = useState(0); // 仅驱动按钮禁用态刷新
  const [structureUndoTick, setStructureUndoTick] = useState(0);
  const [simulatorGesture, setSimulatorGesture] = useState<SimulatorGesture | null>(null);
  const [simulatorNowMs, setSimulatorNowMs] = useState(0);
  const [lastSimulatorColumns, setLastSimulatorColumns] = useState<Column[]>([]);
  const [simulatorCaptureReady, setSimulatorCaptureReady] = useState(false);
  const [simulatorKeymap, setSimulatorKeymap] = useState<SimulatorKeymap>(loadStoredSimulatorKeymap);
  const [showKeymapModal, setShowKeymapModal] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null); // 可聚焦编辑器根:点击后收回焦点,保 Q/E 生效
  const simulatorKeymapRef = useRef(simulatorKeymap);
  simulatorKeymapRef.current = simulatorKeymap;
  const simulatorTextCaptureRef = useRef<HTMLInputElement | null>(null);
  const lastSimulatorTextRef = useRef<{ column: Column; atMs: number } | null>(null);
  const simulatorFocusFrameRef = useRef<number | null>(null);
  const clock = useAudioClock(`/api/audio${q}&assetRevision=${assetRevision}`);

  // ── 派生 ──
  const sourceOnsets = useMemo(() => (chart ? buildOnsets(chart.gameplay) : []), [chart]);
  const onsets = useMemo(() => {
    const deletedSet = new Set(deletedOnsetIds);
    return mergeOnsets(sourceOnsets, addedOnsets).filter((o) => !deletedSet.has(o.id));
  }, [sourceOnsets, addedOnsets, deletedOnsetIds]);
  /** 源采音点 id 集合:GC 判定「哪些是新增点(可回收)」的依据 */
  const sourceIds = useMemo(() => new Set(sourceOnsets.map((o) => o.id)), [sourceOnsets]);
  const onsetsById = useMemo(() => new Map(onsets.map((o) => [o.id, o])), [onsets]);
  // 手动 BPM/offset 修正:null = 用源值。多 BPM 谱面只覆盖首段(UI 有标注)。
  const timing: TimingContext | null = useMemo(() => {
    if (!chart) return null;
    const timeMap =
      ui.bpmOverride != null && chart.timeMap.length > 0
        ? [{ ...chart.timeMap[0], bpm: ui.bpmOverride }, ...chart.timeMap.slice(1)]
        : chart.timeMap;
    return {
      timeMap,
      offsetMs: ui.offsetOverride ?? chart.audioNote.offsetMs,
      nudgeMs: ui.nudgeMs,
    };
  }, [chart, ui.nudgeMs, ui.bpmOverride, ui.offsetOverride]);
  const effectiveMetadata = useMemo<ChartMetadataInput | null>(() => {
    if (!chart || !timing) return null;
    const base = metadataFromChart(chart);
    return {
      ...base,
      bpm: timing.timeMap[0]?.bpm ?? base.bpm,
      offsetMs: timing.offsetMs ?? 0,
    };
  }, [chart, timing]);
  const newChartMetadata = useMemo(
    () => effectiveMetadata ? { ...effectiveMetadata, version: "New" } : undefined,
    [effectiveMetadata],
  );
  const warnings = useMemo(() => validate(onsets, assignments), [onsets, assignments]);
  const tripleWarnings = useMemo(
    () => validateTriples(onsets, assignments),
    [onsets, assignments],
  );
  const audioDuration = clock.duration();
  const segmentRanges = useMemo(() => deriveSegments(structure), [structure]);
  const timedOnsets = useMemo(
    () =>
      timing
        ? onsets.map((onset) => ({
            id: onset.id,
            atSec: beatToAudioSec(onset.beatFloat, timing),
          }))
        : [],
    [onsets, timing],
  );
  const selectedOnset = selectedId ? (onsetsById.get(selectedId) ?? null) : null;
  const selectedIndex = useMemo(
    () => (selectedId ? onsets.findIndex((o) => o.id === selectedId) : -1),
    [onsets, selectedId],
  );
  const assignedCount = useMemo(
    () => onsets.reduce((n, o) => n + (assignmentsAt(assignments, o.id).length > 0 ? 1 : 0), 0),
    [onsets, assignments],
  );
  const onsetOrder = useMemo(
    () => new Map(onsets.map((onset, index) => [onset.id, index])),
    [onsets],
  );
  const simulatorPreviewAssignments = useMemo(() => {
    if (!simulatorGesture) return assignments;
    const head = onsetsById.get(simulatorGesture.headOnsetId);
    const headIndex = onsetOrder.get(simulatorGesture.headOnsetId) ?? -1;
    const cursorIndex = onsetOrder.get(simulatorGesture.cursorOnsetId) ?? -1;
    if (!head) return assignments;
    const draft = simulatorGesture.lanes.map((lane) => {
      const dynamicTailId =
        lane.down &&
        (lane.holdIntent || simulatorHeldLong(lane, simulatorNowMs)) &&
        cursorIndex > headIndex
          ? simulatorGesture.cursorOnsetId
          : null;
      const tailId = lane.tailOnsetId ?? dynamicTailId;
      const tail = tailId ? onsetsById.get(tailId) : null;
      return { column: lane.column, endbeat: tail?.beat ?? null };
    });
    const result = replaceOnsetAssignments(assignments, head, draft);
    return result.ok ? result.map : assignments;
  }, [assignments, onsetOrder, onsetsById, simulatorGesture, simulatorNowMs]);

  // ── refs(供稳定事件闭包读取最新值) ──
  const undoRef = useRef<UndoStack<EditorSnapshot> | null>(null);
  const structureUndoRef = useRef<UndoStack<SegmentStructureV3> | null>(null);
  const assignmentsRef = useRef(assignments);
  assignmentsRef.current = assignments;
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const timingRef = useRef(timing);
  timingRef.current = timing;
  const onsetsRef = useRef(onsets);
  onsetsRef.current = onsets;
  const timedOnsetsRef = useRef(timedOnsets);
  timedOnsetsRef.current = timedOnsets;
  const addedOnsetsRef = useRef(addedOnsets);
  addedOnsetsRef.current = addedOnsets;
  const deletedOnsetIdsRef = useRef(deletedOnsetIds);
  deletedOnsetIdsRef.current = deletedOnsetIds;
  const structureRef = useRef(structure);
  structureRef.current = structure;
  const pendingInSecRef = useRef(pendingInSec);
  pendingInSecRef.current = pendingInSec;
  const selectedSegmentIdsRef = useRef(selectedSegmentIds);
  selectedSegmentIdsRef.current = selectedSegmentIds;
  const clipCounterRef = useRef(1);
  const relationCounterRef = useRef(1);
  const setInPointRef = useRef<() => void>(() => {});
  const completeOutPointRef = useRef<() => void>(() => {});
  const copyHandlerRef = useRef<(event: ClipboardEvent) => void>(() => {});
  const pasteHandlerRef = useRef<(event: ClipboardEvent) => void>(() => {});
  const onStructureChangeRef = useRef<(next: SegmentStructureV3) => void>(() => {});
  const pendingStructureRef = useRef<PersistedSegmentStructure | null>(null);
  const sourceIdsRef = useRef(sourceIds);
  sourceIdsRef.current = sourceIds;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const markedSwapOnsetIdRef = useRef(markedSwapOnsetId);
  markedSwapOnsetIdRef.current = markedSwapOnsetId;

  const focusSimulatorCapture = useCallback(() => {
    if (
      phaseRef.current !== "ready" ||
      !uiRef.current.simulatorMode ||
      document.visibilityState !== "visible" ||
      !document.hasFocus()
    ) {
      setSimulatorCaptureReady(false);
      return;
    }
    const capture = simulatorTextCaptureRef.current;
    if (!capture) {
      setSimulatorCaptureReady(false);
      return;
    }
    const active = document.activeElement;
    if (active !== capture && active instanceof HTMLElement) {
      const focusTarget = active.closest("input, textarea, select, [contenteditable='true']");
      if (
        focusTarget instanceof HTMLElement &&
        !simulatorCaptureShouldRefocus({
          tagName: focusTarget.tagName,
          inputType: focusTarget instanceof HTMLInputElement ? focusTarget.type : null,
          isContentEditable: focusTarget.isContentEditable,
        })
      ) {
        setSimulatorCaptureReady(false);
        return;
      }
    }
    capture.focus({ preventScroll: true });
    setSimulatorCaptureReady(document.activeElement === capture);
  }, []);

  const scheduleSimulatorCaptureFocus = useCallback(() => {
    if (simulatorFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(simulatorFocusFrameRef.current);
    }
    simulatorFocusFrameRef.current = window.requestAnimationFrame(() => {
      simulatorFocusFrameRef.current = null;
      focusSimulatorCapture();
    });
  }, [focusSimulatorCapture]);
  const sourceModeRef = useRef(sourceMode);
  sourceModeRef.current = sourceMode;
  const chartRef = useRef(chart);
  chartRef.current = chart;
  const sourceInfoRef = useRef(sourceInfo);
  sourceInfoRef.current = sourceInfo;
  const simulatorGestureRef = useRef(simulatorGesture);
  simulatorGestureRef.current = simulatorGesture;
  const simulatorTimersRef = useRef<number[]>([]);
  const snapDirtyRef = useRef(false);
  /** 本会话是否发生过真实编辑 —— 只打开不修改的工程绝不触碰源文件 */
  const editedRef = useRef(false);
  /** 最近一次成功写回的内容 —— 纯 UI 变化(滚动/音量)不应重复写文件 */
  const lastWrittenRef = useRef<string | null>(null);
  /** 写回遇到结构性错误(403/409/422)后停手,避免反复失败 */
  const writeBackOffRef = useRef(false);
  const firstDirtyAt = useRef<number | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const hintTimer = useRef<number | null>(null);

  const toast = useCallback((msg: string) => {
    setHint(msg);
    if (hintTimer.current) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), 2600);
  }, []);

  const clearSimulatorTimers = useCallback(() => {
    for (const timer of simulatorTimersRef.current) window.clearTimeout(timer);
    simulatorTimersRef.current = [];
  }, []);

  const publishSimulatorGesture = useCallback((next: SimulatorGesture | null) => {
    simulatorGestureRef.current = next;
    setSimulatorGesture(next);
    setSimulatorNowMs(typeof performance === "undefined" ? 0 : performance.now());
  }, []);

  const cancelSimulatorGesture = useCallback(
    (announce = false) => {
      if (!simulatorGestureRef.current) return;
      clearSimulatorTimers();
      publishSimulatorGesture(null);
      if (announce) toast("已取消模拟器手势");
    },
    [clearSimulatorTimers, publishSimulatorGesture, toast],
  );

  // ── 初始加载:geometry + chart + state 并行(chart/state 按工程 ?src) ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [geoRes, chartRes, stateRes, suggestionsRes] = await Promise.all([
          fetch("/api/geometry"),
          fetch(`/api/chart${q}`),
          fetch(`/api/state${q}`),
          fetch(`/api/structure-suggestions${q}`).catch(() => null),
        ]);
        if (!geoRes.ok) throw new Error(`geometry 加载失败 (${geoRes.status})`);
        if (!chartRes.ok) {
          const err = await chartRes.json().catch(() => null);
          throw new Error(String(err?.error ?? `谱面加载失败 (${chartRes.status})`));
        }
        const geo = parseGeometry(await geoRes.json());
        const { path, text, sourceSha1 } = (await chartRes.json()) as {
          path: string;
          text: string;
          sourceSha1: string;
        };
        const parsed = parseMc(text);
        let saved: WorkingStateV1 | null = null;
        if (stateRes.status === 200) saved = (await stateRes.json()) as WorkingStateV1;
        let suggestions: SuggestedSection[] = [];
        if (suggestionsRes?.ok) {
          const body = (await suggestionsRes.json()) as { sections?: SuggestedSection[] };
          if (Array.isArray(body.sections)) suggestions = body.sections;
        }
        if (cancelled) return;
        setGeometry(geo);
        setChart(parsed);
        setSourceInfo({ path, sha1: sourceSha1 });
        setSavedState(saved);
        setSuggestedSections(suggestions);
        if (saved && saved.sourceSha1 === sourceSha1) {
          hydrate(parsed, saved);
          setPhase("ready");
        } else if (!saved && parsed.gameplay.length === 0) {
          setSourceMode("real");
          setAssignments({});
          undoRef.current = new UndoStack<EditorSnapshot>({ assignments: {}, addedOnsets: [], deletedOnsetIds: [] });
          setPhase("ready");
        } else {
          setShaMismatch(saved !== null);
          setPhase("dialog");
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError((e as Error).message);
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function hydrate(parsed: ParsedChart, saved: WorkingStateV1) {
    // 顺序关键:必须先把新增采音点并入并剔除被删除采音点,否则其上的指派会被当作"未知 onsetId"净化丢弃
    const added = saved.addedOnsets ?? [];
    const deleted = saved.deletedOnsetIds ?? [];
    const deletedSet = new Set(deleted);
    const os = mergeOnsets(buildOnsets(parsed.gameplay), added).filter((o) => !deletedSet.has(o.id));
    setAddedOnsets(added);
    setDeletedOnsetIds(deleted);
    pendingStructureRef.current = saved.structure ?? null;
    structureRef.current = EMPTY_SEGMENT_STRUCTURE;
    setStructure(EMPTY_SEGMENT_STRUCTURE);
    structureUndoRef.current = new UndoStack(EMPTY_SEGMENT_STRUCTURE);
    setPendingInSec(null);
    setSelectedSegmentIds(new Set());
    const map = assignmentsFromJson(saved.assignments, os);
    setSourceMode(saved.sourceMode);
    setAssignments(map);
    undoRef.current = new UndoStack<EditorSnapshot>({ assignments: map, addedOnsets: added, deletedOnsetIds: deleted });
    const mergedUi = normalizeUiPrefs(saved.ui);
    setUi(mergedUi);
    setSelectedId(mergedUi.selectedOnsetId);
    pendingSeekRef.current = mergedUi.playheadSec || 0;
  }

  const startFresh = useCallback((placeholder: boolean) => {
    const mode: SourceMode = placeholder ? "placeholder" : "real";
    setAddedOnsets([]); // 重新播种 → 一并清掉此前新增与删除的采音点
    setDeletedOnsetIds([]);
    structureRef.current = EMPTY_SEGMENT_STRUCTURE;
    setStructure(EMPTY_SEGMENT_STRUCTURE);
    structureUndoRef.current = new UndoStack(EMPTY_SEGMENT_STRUCTURE);
    pendingStructureRef.current = null;
    setPendingInSec(null);
    setSelectedSegmentIds(new Set());
    const rawOnsets = chartRef.current ? buildOnsets(chartRef.current.gameplay) : [];
    const map = seedAssignments(rawOnsets, mode);
    setSourceMode(mode);
    setAssignments(map);
    undoRef.current = new UndoStack<EditorSnapshot>({ assignments: map, addedOnsets: [], deletedOnsetIds: [] });
    setPhase("ready");
  }, []);

  const resumeSaved = useCallback(() => {
    const parsed = chartRef.current;
    if (parsed && savedState) {
      hydrate(parsed, savedState);
      setPhase("ready");
    }
  }, [savedState]);

  // ── 编辑核心 ──
  const applyEdit = useCallback(
    (fn: (m: AssignmentsMap) => EditResult, opts?: { addOnset?: Beat }) => {
      const prev: EditorSnapshot = {
        assignments: assignmentsRef.current,
        addedOnsets: addedOnsetsRef.current,
        deletedOnsetIds: deletedOnsetIdsRef.current,
      };
      const step = nextSnapshot(prev, fn(prev.assignments), {
        addOnset: opts?.addOnset ?? null,
        sourceIds: sourceIdsRef.current,
      });
      if (!step.ok) {
        toast(step.error);
        return false;
      }
      // 无变化的编辑不入栈:否则撤销会撞上 React 的 Object.is 空转,那一次 Z 看似失灵
      if (!step.changed) return true;
      undoRef.current?.push(step.snapshot);
      snapDirtyRef.current = true;
      editedRef.current = true;
      setAssignments(step.snapshot.assignments);
      setAddedOnsets(step.snapshot.addedOnsets);
      setDeletedOnsetIds(step.snapshot.deletedOnsetIds ?? []);
      setUndoTick((n) => n + 1);
      return true;
    },
    [toast],
  );

  const exactOnsetAtPlayhead = useCallback((): Onset | null => {
    const tm = timingRef.current;
    if (!tm) return null;
    const candidates = [clock.getNavigationTime(), clock.getTime()];
    for (const sec of candidates) {
      const nearest = nearestOnsetByTime(onsetsRef.current, tm, sec);
      if (nearest && Math.abs(beatToAudioSec(nearest.beatFloat, tm) - sec) <= EXACT_ONSET_SEC) {
        return nearest;
      }
    }
    // 容差备选：若播放头正处于当前右侧栏聚焦/最近的采音点附近 (≤ 35ms)，也视为该采音点
    const selId = selectedRef.current;
    if (selId) {
      const sel = onsetsRef.current.find((x) => x.id === selId);
      if (sel) {
        const selSec = beatToAudioSec(sel.beatFloat, tm);
        for (const sec of candidates) {
          if (Math.abs(selSec - sec) <= 0.035) {
            return sel;
          }
        }
      }
    }
    return null;
  }, [clock]);

  const deleteCurrentOnset = useCallback(() => {
    const target = exactOnsetAtPlayhead();
    if (!target) {
      toast("播放头未处于采音点上，无法删除");
      return;
    }

    if (clock.playing) clock.pause();
    cancelSimulatorGesture();

    const targetId = target.id;
    const idx = onsetsRef.current.findIndex((o) => o.id === targetId) + 1;

    const prev: EditorSnapshot = {
      assignments: assignmentsRef.current,
      addedOnsets: addedOnsetsRef.current,
      deletedOnsetIds: deletedOnsetIdsRef.current,
    };

    const next = deleteOnsetFromSnapshot(prev, targetId);
    if (!next.changed) {
      toast(`采音点 #${idx} (${targetId}) 已被删除`);
      return;
    }

    undoRef.current?.push(next.snapshot);
    snapDirtyRef.current = true;
    editedRef.current = true;
    setAssignments(next.snapshot.assignments);
    setAddedOnsets(next.snapshot.addedOnsets);
    setDeletedOnsetIds(next.snapshot.deletedOnsetIds ?? []);
    setUndoTick((n) => n + 1);

    if (markedSwapOnsetIdRef.current === targetId) {
      markedSwapOnsetIdRef.current = null;
      setMarkedSwapOnsetId(null);
    }
    const tm = timingRef.current;
    if (tm) {
      const remaining = onsetsRef.current.filter((o) => o.id !== targetId);
      const nextActive = onsetAtOrBefore(remaining, tm, clock.getTime());
      setSelectedId(nextActive?.id ?? null);
    }

    toast(`✓ 已删除采音点 #${idx} (${targetId}) (按 Ctrl+Z 撤销)`);
  }, [cancelSimulatorGesture, clock, exactOnsetAtPlayhead, toast]);

  const randomizeTargetOnset = useCallback(
    (target?: Onset | null) => {
      const selId = selectedRef.current;
      const activeOnset = selId ? onsetsRef.current.find((x) => x.id === selId) : null;
      const onset = target ?? exactOnsetAtPlayhead() ?? activeOnset;
      if (!onset) {
        toast("当前工程没有可指派的采音点");
        return;
      }
      if (clock.playing) clock.pause();
      cancelSimulatorGesture();
      const generated = generateSmartOnsetArrangement(
        onsetsRef.current,
        assignmentsRef.current,
        onset.id,
      );
      if (!generated) {
        toast("当前采音点没有可用空闲键位");
        return;
      }
      const applied = applyEdit((m) => replaceOnsetAssignments(m, onset, generated.assignments));
      if (applied) {
        toast(`✓ 已随机排键: ${generated.description}`);
      }
    },
    [applyEdit, cancelSimulatorGesture, clock, exactOnsetAtPlayhead, toast],
  );

  const mirrorSelectedClips = useCallback(() => {
    const selected = [...selectedSegmentIdsRef.current];
    if (selected.length === 0) {
      if (pendingInSecRef.current != null) {
        toast("已设起点 I，请先按 O 完成 clip 创建与选中再按 Ctrl+M 镜像");
      } else {
        toast("请先通过 I/O 设点或在列表中选中 clip 再按 Ctrl+M 镜像");
      }
      return;
    }

    const segments = deriveSegments(structureRef.current);
    const partition = partitionTimedPoints(segments, timedOnsetsRef.current);
    const targetOnsetIds = new Set<string>();

    for (const id of selected) {
      const segIndex = segments.findIndex((s) => s.id === id);
      if (segIndex >= 0) {
        for (const onsetId of partition.bySegment[segIndex] ?? []) {
          targetOnsetIds.add(onsetId);
        }
      }
    }

    if (targetOnsetIds.size === 0) {
      toast("选中的 clip 内没有采音点");
      return;
    }

    const currentAssignments = assignmentsRef.current;
    let assignedOnsetCount = 0;
    for (const id of targetOnsetIds) {
      if ((currentAssignments[id]?.length ?? 0) > 0) {
        assignedOnsetCount += 1;
      }
    }

    if (assignedOnsetCount === 0) {
      toast("选中的 clip 内没有已排键的音符");
      return;
    }

    if (clock.playing) clock.pause();
    cancelSimulatorGesture();

    const mirrorResult = mirrorAssignments(assignmentsRef.current, targetOnsetIds);
    if (!mirrorResult.changed) {
      toast("选中的 clip 内排键本身左右对称，镜像后无变化");
      return;
    }

    const applied = applyEdit(() => mirrorResult);
    if (applied) {
      toast(
        `✓ 已水平镜像选中 clip 内的 ${mirrorResult.mirroredOnsetCount} 个采音点 (${mirrorResult.mirroredNoteCount} 个音符，Ctrl+Z 撤销)`,
      );
    }
  }, [applyEdit, cancelSimulatorGesture, clock, toast]);

  const markSwapPointA = useCallback(() => {
    const selId = selectedRef.current;
    const activeOnset = selId ? onsetsRef.current.find((x) => x.id === selId) : null;
    const onset = exactOnsetAtPlayhead() ?? activeOnset;
    if (!onset) {
      toast("播放头未处于采音点上，无法标记点 A");
      return;
    }
    markedSwapOnsetIdRef.current = onset.id;
    setMarkedSwapOnsetId(onset.id);
    const idx = onsetsRef.current.findIndex((o) => o.id === onset.id) + 1;
    const assigned = assignmentsAt(assignmentsRef.current, onset.id);
    const desc = assigned.length === 0 ? "未排键" : `${assigned.length} 个音符`;
    toast(`已标记采音点 A (#${idx}，${desc})；移动播放头至点 B 按 Alt+V 互换排键`);
  }, [exactOnsetAtPlayhead, toast]);

  const swapWithMarkedPointA = useCallback(() => {
    const markedId = markedSwapOnsetIdRef.current;
    if (!markedId) {
      toast("尚未标记采音点 A，请先在某采音点上按 Alt+C 标记点 A");
      return;
    }
    const onsetA = onsetsRef.current.find((o) => o.id === markedId);
    if (!onsetA) {
      markedSwapOnsetIdRef.current = null;
      setMarkedSwapOnsetId(null);
      toast("先前标记的采音点 A 已不存在");
      return;
    }
    const selId = selectedRef.current;
    const activeOnset = selId ? onsetsRef.current.find((x) => x.id === selId) : null;
    const onsetB = exactOnsetAtPlayhead() ?? activeOnset;
    if (!onsetB) {
      toast("播放头未处于采音点上，无法互换");
      return;
    }
    if (onsetA.id === onsetB.id) {
      toast("当前采音点与已标记的采音点 A 相同，请移动至其他采音点 B 再按 Alt+V 互换");
      return;
    }

    if (clock.playing) clock.pause();
    cancelSimulatorGesture();

    const swapResult = swapOnsetAssignments(assignmentsRef.current, onsetA, onsetB);
    if (!swapResult.ok) {
      toast(swapResult.error);
      return;
    }
    if (!swapResult.changed) {
      toast("采音点 A 与 B 均未排键或排键完全相同，无需互换");
      return;
    }

    const applied = applyEdit(() => swapResult);
    if (applied) {
      markedSwapOnsetIdRef.current = null;
      setMarkedSwapOnsetId(null);
      const idxA = onsetsRef.current.findIndex((o) => o.id === onsetA.id) + 1;
      const idxB = onsetsRef.current.findIndex((o) => o.id === onsetB.id) + 1;
      toast(`✓ 已互换采音点 A (#${idxA}) 与 B (#${idxB}) 的排键 (Ctrl+Z 撤销)`);
    }
  }, [applyEdit, cancelSimulatorGesture, clock, exactOnsetAtPlayhead, toast]);

  copyHandlerRef.current = (event: ClipboardEvent) => {
    if (
      phaseRef.current !== "ready" ||
      clipboardTargetIsTextInput(event.target, simulatorTextCaptureRef.current)
    ) {
      return;
    }

    const selected = [...selectedSegmentIdsRef.current];
    let sourceOnsetIds: string[];
    let sourceLabel: string;
    if (selected.length > 1) {
      event.preventDefault();
      toast("已选中多个 clip；请只保留一个后再复制");
      return;
    }
    if (selected.length === 1) {
      const segments = deriveSegments(structureRef.current);
      const segmentIndex = segments.findIndex((segment) => segment.id === selected[0]);
      if (segmentIndex < 0) {
        event.preventDefault();
        toast("选中的 clip 已不存在");
        return;
      }
      sourceOnsetIds = partitionTimedPoints(segments, timedOnsetsRef.current).bySegment[
        segmentIndex
      ];
      sourceLabel = segments[segmentIndex].code;
    } else {
      const onset = exactOnsetAtPlayhead();
      if (!onset) {
        event.preventDefault();
        toast("未选 clip；请将播放头停在采音点上再复制");
        return;
      }
      sourceOnsetIds = [onset.id];
      sourceLabel = `采音点 #${onsetsRef.current.findIndex((item) => item.id === onset.id) + 1}`;
    }

    const copied = buildArrangementClipboard(
      onsetsRef.current,
      assignmentsRef.current,
      sourceOnsetIds,
    );
    if (!copied.ok) {
      event.preventDefault();
      toast(copied.error);
      return;
    }
    if (!event.clipboardData) {
      toast("系统剪贴板不可用，复制失败");
      return;
    }
    const serialized = serializeArrangementClipboard(copied.payload);
    try {
      event.clipboardData.setData("text/plain", serialized);
      try {
        event.clipboardData.setData(ARRANGEMENT_CLIPBOARD_MIME, serialized);
      } catch {
        // Some browsers strip custom MIME types; text/plain remains cross-window compatible.
      }
      event.preventDefault();
      toast(`✓ 已复制 ${sourceLabel}：${sourceOnsetIds.length} 个采音点`);
    } catch {
      toast("系统剪贴板写入失败");
    }
  };

  pasteHandlerRef.current = (event: ClipboardEvent) => {
    if (
      phaseRef.current !== "ready" ||
      clipboardTargetIsTextInput(event.target, simulatorTextCaptureRef.current)
    ) {
      return;
    }
    event.preventDefault();
    const clipboard = event.clipboardData;
    const raw =
      clipboard?.getData(ARRANGEMENT_CLIPBOARD_MIME) || clipboard?.getData("text/plain") || "";
    const parsed = parseArrangementClipboard(raw);
    if (!parsed.ok) {
      toast(parsed.error);
      return;
    }
    const target = exactOnsetAtPlayhead();
    if (!target) {
      toast("请将播放头停在目标采音点上再粘贴");
      return;
    }
    const pasted = pasteArrangementClipboard(
      onsetsRef.current,
      assignmentsRef.current,
      target.id,
      parsed.payload,
    );
    if (!pasted.ok) {
      toast(pasted.error);
      return;
    }
    cancelSimulatorGesture();
    const applied = applyEdit(() => ({ ok: true, map: pasted.map }));
    if (applied) toast(`✓ 已粘贴 ${pasted.onsetCount} 个采音点`);
  };

  const scheduleSimulatorThreshold = useCallback((column: Column, pressedAtMs: number) => {
    const timer = window.setTimeout(() => {
      const gesture = simulatorGestureRef.current;
      const lane = gesture?.lanes.find((item) => item.column === column);
      if (lane?.down && lane.pressedAtMs === pressedAtMs) setSimulatorNowMs(performance.now());
    }, 351);
    simulatorTimersRef.current.push(timer);
  }, []);

  const commitSimulatorInput = useCallback(
    (commit: SimulatorCommit) => {
      const list = onsetsRef.current;
      const headIndex = list.findIndex((onset) => onset.id === commit.headOnsetId);
      const head = headIndex >= 0 ? list[headIndex] : null;
      const tm = timingRef.current;
      if (!head || !tm) return;
      const specs = commit.lanes.map((lane) => ({
        column: lane.column,
        endbeat: lane.tailOnsetId
          ? (list.find((onset) => onset.id === lane.tailOnsetId)?.beat ?? null)
          : null,
      }));
      if (!applyEdit((map) => replaceOnsetAssignments(map, head, specs))) return;

      clearSimulatorTimers();
      setLastSimulatorColumns(commit.lanes.map((lane) => lane.column));
      const order = new Map(list.map((onset, index) => [onset.id, index]));
      const advance = simulatorAdvanceIndex(commit, order, list.length);
      if (!advance) return;
      const { farthestIndex, nextIndex } = advance;
      const next = nextIndex === null ? null : list[nextIndex];
      if (next) {
        clock.shuttleTo(beatToAudioSec(next.beatFloat, tm));
        if (commit.usedHoldFallback) toast("未选择更晚尾点，已按单点写入并前进");
      } else {
        const last = list[farthestIndex];
        if (last) clock.shuttleTo(beatToAudioSec(last.beatFloat, tm));
        toast(
          commit.usedHoldFallback
            ? "未选择更晚尾点，已按单点写入；当前已是最后采音点"
            : "已写入；当前已是最后采音点",
        );
      }
    },
    [applyEdit, clearSimulatorTimers, clock, toast],
  );

  /**
   * 某些可编程键盘把单键配置成 Unicode 文本注入：文本框能收到 z，但页面没有 keydown/up。
   * 这种输入没有可用的按住/松开边界，只作为短按提交；标准键盘事件仍走完整长条手势。
   */
  const commitSimulatorText = useCallback(
    (text: string) => {
      const column = simulatorColumnForText(text, simulatorKeymapRef.current);
      if (column === null || simulatorGestureRef.current) return;
      const nowMs = typeof performance === "undefined" ? Date.now() : performance.now();
      const previous = lastSimulatorTextRef.current;
      // compositionupdate → beforeinput → input may carry the same character in quick succession.
      if (!shouldCommitSimulatorText(previous, column, nowMs)) return;
      lastSimulatorTextRef.current = { column, atMs: nowMs };
      const tm = timingRef.current;
      if (!tm) return;
      const head = nearestOnsetByTime(onsetsRef.current, tm, clock.getNavigationTime());
      if (!head) {
        toast("当前工程没有可指派的采音点");
        return;
      }
      if (clock.playing) clock.pause();
      commitSimulatorInput({
        headOnsetId: head.id,
        lanes: [{ column, tailOnsetId: null }],
        usedHoldFallback: false,
      });
    },
    [clock, commitSimulatorInput, toast],
  );

  /** 撤销/重做:必须同时还原 assignments 与 addedOnsets / deletedOnsetIds(见 editor-state.ts 注释)。 */
  const restoreState = useCallback((s: EditorSnapshot) => {
    snapDirtyRef.current = true;
    editedRef.current = true;
    setAssignments(s.assignments);
    setAddedOnsets(s.addedOnsets);
    setDeletedOnsetIds(s.deletedOnsetIds ?? []);
    setUndoTick((n) => n + 1);
  }, []);

  const doUndo = useCallback(() => {
    const s = undoRef.current?.undo();
    if (s === null || s === undefined) {
      toast("没有可回退的操作");
      return;
    }
    restoreState(s);
  }, [toast, restoreState]);

  const doRedo = useCallback(() => {
    const s = undoRef.current?.redo();
    if (s === null || s === undefined) {
      toast("没有可重做的操作");
      return;
    }
    restoreState(s);
  }, [toast, restoreState]);

  /** 时间轴 seek:请求试听 → audition(播一小段停回落点,吸附后默认暂停);否则直接 seek。 */
  const timelineSeek = useCallback(
    (sec: number, audition?: boolean) => {
      cancelSimulatorGesture();
      if (audition) clock.audition(sec, false);
      else clock.seek(sec);
    },
    [cancelSimulatorGesture, clock],
  );

  const holdOverlapCursorRef = useRef(-1);
  const tripleCursorRef = useRef(-1);

  const jumpToHoldOverlap = useCallback(() => {
    if (warnings.length === 0) return;
    const t = timingRef.current;
    if (!t) return;
    const nextIdx = (holdOverlapCursorRef.current + 1) % warnings.length;
    holdOverlapCursorRef.current = nextIdx;
    const w = warnings[nextIdx];
    const list = onsetsRef.current;
    const targetOnset =
      list.find((o) => o.id === w.overlappedOnsetId) ?? list.find((o) => o.id === w.onsetId);
    if (!targetOnset) return;
    const sec = beatToAudioSec(targetOnset.beatFloat, t);
    cancelSimulatorGesture();
    if (clock.playing) clock.pause();
    clock.seek(sec);
    const onsetIdx = list.findIndex((o) => o.id === targetOnset.id);
    toast(
      `长条重叠 ${nextIdx + 1}/${warnings.length} · ${fmtTime(sec)} · 通道 ${w.column}${
        onsetIdx >= 0 ? ` · 采音点 #${onsetIdx + 1}` : ""
      }`,
    );
  }, [cancelSimulatorGesture, clock, toast, warnings]);

  const jumpToTriple = useCallback(() => {
    if (tripleWarnings.length === 0) return;
    const t = timingRef.current;
    if (!t) return;
    const nextIdx = (tripleCursorRef.current + 1) % tripleWarnings.length;
    tripleCursorRef.current = nextIdx;
    const w = tripleWarnings[nextIdx];
    const sec = beatToAudioSec(w.beatFloat, t);
    cancelSimulatorGesture();
    if (clock.playing) clock.pause();
    clock.seek(sec);
    const list = onsetsRef.current;
    const onsetIdx = w.onsetId ? list.findIndex((o) => o.id === w.onsetId) : -1;
    const details: string[] = [];
    if (w.startingColumns.length > 0) details.push(`起:${w.startingColumns.join(",")}`);
    if (w.endingColumns.length > 0) details.push(`尾:${w.endingColumns.join(",")}`);
    if (w.holdingColumns.length > 0) details.push(`持:${w.holdingColumns.join(",")}`);
    const detailStr = details.length > 0 ? ` [${details.join(" ")}]` : "";
    toast(
      `三押及以上 ${nextIdx + 1}/${tripleWarnings.length} · ${fmtTime(sec)} · ${w.totalCount}键 (通道 ${w.columns.join(", ")})${detailStr}${
        onsetIdx >= 0 ? ` · 采音点 #${onsetIdx + 1}` : ""
      }`,
    );
  }, [cancelSimulatorGesture, clock, toast, tripleWarnings]);

  /** 右键/框选清空:一次 applyEdit(单个 / 批量)。 */
  const clearOnsetIds = useCallback(
    (ids: Iterable<string>) => {
      applyEdit((m) => ({ ok: true, map: clearOnsets(m, ids) }));
    },
    [applyEdit],
  );

  /**
   * Q/E:把**播放头**平滑穿梭移到相对当前播放头的上/下一采音点(播放中默认暂停，抵达后试听落点音频),**不改选中**。
   * 这样在采音点 i 选中键 K 后按 E,播放头到 i+1 而 i 仍选中 → 设长条尾徽标保留,可点键把长条拉到 i+1。切换选中用 Ctrl+点击。
   */
  const stepOnset = useCallback(
    (dir: 1 | -1, auditionOnArrival = true) => {
      const t = timingRef.current;
      if (!t) return;
      const target = nextOnsetByTime(onsetsRef.current, t, clock.getNavigationTime(), dir);
      if (!target) {
        if (clock.playing) clock.pause();
        return;
      }
      const targetSec = beatToAudioSec(target.beatFloat, t);
      if (auditionOnArrival) clock.shuttleToAndAudition(targetSec, false);
      else clock.shuttleTo(targetSec);
    },
    [clock],
  );

  /**
   * 键位点击:编辑对象**由播放头派生**(无选中态)。
   * - 普通点击 → 在播放头所在采音点上 指派 / 取消 / 长条改回单点。
   * - **Shift+点击** → 把该键在播放头**之前**最近一次指派延伸成长条,尾落在当前播放头(吸附)。
   */
  const onKeyClick = useCallback(
    (col: Column, shift = false, ctrl = false) => {
      const t = timingRef.current;
      if (!t) return;
      const pFloat = snapBeatFloat(audioSecToBeat(clock.getTime(), t), uiRef.current.snapDenom);

      if (shift) {
        const list = onsetsRef.current;
        let anchor: Onset | null = null;
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].beatFloat >= pFloat - EPS) continue;
          if (assignmentsAt(assignmentsRef.current, list[i].id).some((a) => a.column === col)) {
            anchor = list[i];
            break;
          }
        }
        if (!anchor) {
          toast(`键 ${col} 在播放头之前没有可延伸的音符`);
          return;
        }
        applyEdit((m) =>
          setHoldEnd(m, anchor!, col, snapToBeat(pFloat, uiRef.current.snapDenom)),
        );
        toast(`长条尾已设 @ ${pFloat.toFixed(2)}拍`);
        return;
      }

      // 目标采音点:Ctrl → 播放头之前最近的一个;否则 → 吸附格上的采音点(没有就新建)
      const snapped = snapToBeat(pFloat, uiRef.current.snapDenom);
      const snappedId = tickId(snapped);
      const o: Onset | null = ctrl
        ? onsetAtOrBefore(onsetsRef.current, t, clock.getTime())
        : (onsetsRef.current.find((x) => x.id === snappedId) ?? null);

      if (!o && ctrl) {
        toast("播放头之前没有采音点");
        return;
      }
      if (!o) {
        // 吸附格上没有采音点 → 新建 + 指派,**一个快照原子完成**(撤销可一步还原;
        // 指派失败也不会留下空采音点)
        const created = makeAddedOnset(snapped);
        applyEdit((m) => assign(m, created, col), { addOnset: snapped });
        toast(`已新建采音点 @ ${pFloat.toFixed(2)}拍`);
        return;
      }

      const existing = assignmentsAt(assignmentsRef.current, o.id).find((a) => a.column === col);
      if (!existing) applyEdit((m) => assign(m, o, col));
      else if (existing.endbeat) {
        applyEdit((m) => setHoldEnd(m, o, col, null));
        toast("已改回单点");
      } else applyEdit((m) => unassign(m, o, col));
    },
    [applyEdit, clock, toast],
  );

  const onKeyRightClick = useCallback(
    (col: Column) => {
      const selId = selectedRef.current;
      const o = selId ? onsetsRef.current.find((x) => x.id === selId) : null;
      if (!o) return;
      if (assignmentsAt(assignmentsRef.current, o.id).some((a) => a.column === col)) {
        applyEdit((m) => unassign(m, o, col));
      }
    },
    [applyEdit],
  );

  /** 拖拽画面上的音符换列(实机直接操作)。 */
  const onNoteMove = useCallback(
    (onsetId: string, from: Column, to: Column) => {
      const o = onsetsRef.current.find((x) => x.id === onsetId);
      if (!o) return;
      applyEdit((m) => move(m, o, from, to));
    },
    [applyEdit],
  );

  /** 右击画面上的音符 → 删除该键。 */
  const onNoteDelete = useCallback(
    (onsetId: string, column: Column) => {
      const o = onsetsRef.current.find((x) => x.id === onsetId);
      if (!o) return;
      applyEdit((m) => unassign(m, o, column));
    },
    [applyEdit],
  );

  const stepSimulatorTail = useCallback(
    (dir: 1 | -1) => {
      const gesture = simulatorGestureRef.current;
      const tm = timingRef.current;
      if (!gesture || !tm) return;
      const list = onsetsRef.current;
      const headIndex = list.findIndex((onset) => onset.id === gesture.headOnsetId);
      const cursorIndex = list.findIndex((onset) => onset.id === gesture.cursorOnsetId);
      if (headIndex < 0 || cursorIndex < 0) return;
      const targetIndex = Math.max(headIndex, Math.min(list.length - 1, cursorIndex + dir));
      if (targetIndex === cursorIndex) {
        toast(dir < 0 ? "长条尾不能早于头部" : "已经是最后采音点");
        return;
      }
      const target = list[targetIndex];
      const next = navigateSimulatorGesture(gesture, target.id);
      publishSimulatorGesture(next);
      clock.shuttleToAndAudition(beatToAudioSec(target.beatFloat, tm), false);
    },
    [clock, publishSimulatorGesture, toast],
  );

  const copyCurrentTimePoint = useCallback(async () => {
    const t = clock.getTime();
    const formatted = formatClipTime(t);
    const ok = await copyTextToClipboard(formatted);
    if (ok) {
      toast(`已复制当前时间点：${formatted}`);
    } else {
      toast("复制失败，请检查剪贴板权限");
    }
  }, [clock, toast]);

  // ── 键盘(handlers 经 ref,绑定一次) ──
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const keyUpHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    if (phase !== "ready" || !ui.simulatorMode) {
      if (simulatorFocusFrameRef.current !== null) {
        window.cancelAnimationFrame(simulatorFocusFrameRef.current);
        simulatorFocusFrameRef.current = null;
      }
      return;
    }

    const onWindowFocus = () => scheduleSimulatorCaptureFocus();
    const onWindowBlur = () => setSimulatorCaptureReady(false);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleSimulatorCaptureFocus();
      else setSimulatorCaptureReady(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      const capture = simulatorTextCaptureRef.current;
      if (event.target === capture) {
        setSimulatorCaptureReady(true);
        return;
      }
      setSimulatorCaptureReady(false);
      const target = event.target instanceof HTMLElement ? event.target : null;
      const focusTarget = target?.closest("input, textarea, select, [contenteditable='true']");
      if (
        simulatorCaptureShouldRefocus(
          focusTarget instanceof HTMLElement
            ? {
                tagName: focusTarget.tagName,
                inputType: focusTarget instanceof HTMLInputElement ? focusTarget.type : null,
                isContentEditable: focusTarget.isContentEditable,
              }
            : target
              ? { tagName: target.tagName, isContentEditable: target.isContentEditable }
              : null,
        )
      ) {
        scheduleSimulatorCaptureFocus();
      }
    };

    window.addEventListener("focus", onWindowFocus);
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("focusin", onFocusIn);
    scheduleSimulatorCaptureFocus();
    return () => {
      window.removeEventListener("focus", onWindowFocus);
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("focusin", onFocusIn);
      if (simulatorFocusFrameRef.current !== null) {
        window.cancelAnimationFrame(simulatorFocusFrameRef.current);
        simulatorFocusFrameRef.current = null;
      }
    };
  }, [phase, scheduleSimulatorCaptureFocus, ui.simulatorMode]);

  keyHandlerRef.current = (e: KeyboardEvent) => {
    // Ctrl/⌘+S 保存 —— 放在输入框守卫之前,焦点在输入框时也能存并挡浏览器保存框。
    if ((e.key === "s" || e.key === "S") && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (phaseRef.current === "ready") {
        void persistNow(true);
      }
      return;
    }
    // Ctrl/⌘+R 随机排键 —— 放在输入框守卫之前,防止浏览器误刷新页面,保证快捷键必定生效
    if (isRandomizeKeyEvent(e) && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (phaseRef.current === "ready") {
        randomizeTargetOnset();
      }
      return;
    }
    // Ctrl/⌘+M 镜像选中 clip 内排键 —— 放在输入框守卫之前,防止浏览器默认行为或 macOS 最小化窗口
    if (isMirrorKeyEvent(e) && (e.ctrlKey || e.metaKey) && !e.altKey) {
      e.preventDefault();
      const tgtEl = e.target as HTMLElement | null;
      const isText =
        tgtEl &&
        tgtEl !== simulatorTextCaptureRef.current &&
        (tgtEl.tagName === "TEXTAREA" ||
          tgtEl.isContentEditable ||
          (tgtEl.tagName === "INPUT" &&
            ["text", "search", "password", "email", "url", "number"].includes(
              (tgtEl as HTMLInputElement).type?.toLowerCase() ?? "text",
            )));
      if (!isText && phaseRef.current === "ready") {
        mirrorSelectedClips();
      }
      return;
    }
    // Ctrl/⌘ + Alt + C 复制当前播放头时间点
    if (isKeyCEvent(e) && (e.ctrlKey || e.metaKey) && e.altKey) {
      e.preventDefault();
      const tgtEl = e.target as HTMLElement | null;
      const isText =
        tgtEl &&
        tgtEl !== simulatorTextCaptureRef.current &&
        (tgtEl.tagName === "TEXTAREA" ||
          tgtEl.isContentEditable ||
          (tgtEl.tagName === "INPUT" &&
            ["text", "search", "password", "email", "url", "number"].includes(
              (tgtEl as HTMLInputElement).type?.toLowerCase() ?? "text",
            )));
      if (!isText && phaseRef.current === "ready") {
        void copyCurrentTimePoint();
      }
      return;
    }
    // Alt+C 标记采音点 A
    if (isKeyCEvent(e) && e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const tgtEl = e.target as HTMLElement | null;
      const isText =
        tgtEl &&
        tgtEl !== simulatorTextCaptureRef.current &&
        (tgtEl.tagName === "TEXTAREA" ||
          tgtEl.isContentEditable ||
          (tgtEl.tagName === "INPUT" &&
            ["text", "search", "password", "email", "url", "number"].includes(
              (tgtEl as HTMLInputElement).type?.toLowerCase() ?? "text",
            )));
      if (!isText && phaseRef.current === "ready") {
        markSwapPointA();
      }
      return;
    }
    // Alt+V 标记采音点 B 且与点 A 互换排键
    if (isKeyVEvent(e) && e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const tgtEl = e.target as HTMLElement | null;
      const isText =
        tgtEl &&
        tgtEl !== simulatorTextCaptureRef.current &&
        (tgtEl.tagName === "TEXTAREA" ||
          tgtEl.isContentEditable ||
          (tgtEl.tagName === "INPUT" &&
            ["text", "search", "password", "email", "url", "number"].includes(
              (tgtEl as HTMLInputElement).type?.toLowerCase() ?? "text",
            )));
      if (!isText && phaseRef.current === "ready") {
        swapWithMarkedPointA();
      }
      return;
    }
    const tgt = e.target as HTMLElement | null;
    const ready = phaseRef.current === "ready";
    const k = e.key;
    const code = e.code;
    // 模拟器六键必须先于文本输入焦点守卫：开启模式的 sr-only checkbox 会保留 INPUT 焦点，
    // 若先 return，控制器刚开启时所有按键都会被吞掉。设备键在模式内是全局录入输入。
    const simulatorColumn = ready
      ? simulatorColumnForEvent(
          uiRef.current.simulatorMode,
          e.code,
          e,
          e.key,
          e.keyCode,
          simulatorKeymapRef.current,
        )
      : null;
    if (uiRef.current.simulatorMode) {
      const diagnostic = {
        type: "keydown",
        key: e.key,
        code: e.code,
        keyCode: e.keyCode,
        which: e.which,
        ctrl: e.ctrlKey,
        meta: e.metaKey,
        alt: e.altKey,
        shift: e.shiftKey,
        repeat: e.repeat,
        target: tgt?.tagName ?? null,
        ready,
        mappedColumn: simulatorColumn,
      };
      const diagnosticWindow = window as unknown as { __simulatorKeyEvents?: unknown[] };
      diagnosticWindow.__simulatorKeyEvents = [
        ...(diagnosticWindow.__simulatorKeyEvents ?? []),
        diagnostic,
      ].slice(-100);
      console.info(
        `[simulator-input] ${JSON.stringify(diagnostic)}`,
      );
    }
    if (simulatorColumn !== null) {
      e.preventDefault();
      if (e.repeat) return;
      const nowMs = performance.now();
      const current = simulatorGestureRef.current;
      if (!current) {
        const tm = timingRef.current;
        if (!tm) return;
        const head = nearestOnsetByTime(
          onsetsRef.current,
          tm,
          clock.getNavigationTime(),
        );
        if (!head) {
          toast("当前工程没有可指派的采音点");
          return;
        }
        if (clock.playing) clock.pause();
        publishSimulatorGesture(startSimulatorGesture(head.id, simulatorColumn, nowMs));
        scheduleSimulatorThreshold(simulatorColumn, nowMs);
      } else {
        const pressed = pressSimulatorLane(current, simulatorColumn, nowMs);
        if (!pressed.accepted) {
          if (current.navigated) toast("长条开始移动后不能再加入新的头部键位");
          return;
        }
        publishSimulatorGesture(pressed.gesture);
        scheduleSimulatorThreshold(simulatorColumn, nowMs);
      }
      return;
    }

    if (ready && simulatorGestureRef.current && k === "Escape") {
      e.preventDefault();
      cancelSimulatorGesture(true);
      return;
    }
    if (
      ready &&
      simulatorGestureRef.current &&
      (k === "ArrowLeft" || k === "ArrowRight")
    ) {
      e.preventDefault();
      stepSimulatorTail(k === "ArrowLeft" ? -1 : 1);
      return;
    }
    if (
      ready &&
      simulatorGestureRef.current &&
      (k === "q" || k === "Q" || code === "KeyQ" || k === " " || code === "Space")
    ) {
      e.preventDefault();
      toast("长条手势中请用 ←/→ 选择尾点，Esc 取消");
      return;
    }

    const simulatorDirection = ready
      ? simulatorOnsetDirection(uiRef.current.simulatorMode, k)
      : null;
    if (simulatorDirection !== null) {
      e.preventDefault();
      stepOnset(simulatorDirection, true);
      return;
    }

    // 非模拟器快捷键只在真正输入文本时让路(INPUT/TEXTAREA/contentEditable);SELECT 不 bail ——
    // 我们已在其 onChange 后 blur，且下方 preventDefault 抑制 select type-ahead。
    const isTextInput =
      tgt &&
      tgt !== simulatorTextCaptureRef.current &&
      (tgt.tagName === "TEXTAREA" ||
        tgt.isContentEditable ||
        (tgt.tagName === "INPUT" &&
          ["text", "search", "password", "email", "url", "number"].includes(
            (tgt as HTMLInputElement).type?.toLowerCase() ?? "text",
          )));
    if (isTextInput) {
      return;
    }
    if (!ready) return;

    const isKeyR = isRandomizeKeyEvent(e);
    const isKeyQ = k === "q" || k === "Q" || code === "KeyQ";
    const isKeyE = k === "e" || k === "E" || code === "KeyE";
    const isSpace = k === " " || code === "Space";
    const isKeyZ = k === "z" || k === "Z" || code === "KeyZ";
    const isKeyY = k === "y" || k === "Y" || code === "KeyY";
    const isF1 = k === "F1" || code === "F1";
    const isDelete =
      (k === "Delete" || code === "Delete") &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey;

    if (isF1) {
      e.preventDefault();
      setHelpOpen((v) => !v);
    } else if (isDelete) {
      e.preventDefault();
      deleteCurrentOnset();
    } else if (isSpace) {
      e.preventDefault();
      clock.toggle();
    } else if (isKeyQ) {
      e.preventDefault();
      stepOnset(-1, true);
    } else if (isKeyE) {
      e.preventDefault();
      stepOnset(1, true);
    } else if (
      (k === "i" || k === "I" || code === "KeyI") &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.repeat &&
      tgt?.tagName !== "SELECT"
    ) {
      e.preventDefault();
      setInPointRef.current();
    } else if (
      (k === "o" || k === "O" || code === "KeyO") &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.repeat &&
      tgt?.tagName !== "SELECT"
    ) {
      e.preventDefault();
      completeOutPointRef.current();
    } else if (isKeyR && !e.altKey) {
      e.preventDefault();
      if (simulatorTextCaptureRef.current) {
        simulatorTextCaptureRef.current.value = "";
      }
      if (e.isComposing) {
        (document.activeElement as HTMLElement)?.blur?.();
        if (uiRef.current.simulatorMode) {
          scheduleSimulatorCaptureFocus();
        } else {
          rootRef.current?.focus();
        }
      }
      const selected = [...selectedSegmentIdsRef.current];
      // 裸按 R 且已多选 2 个以上段落时标记重复关系；其余情况(单点/无多选段落/Ctrl+R)均进行随机排键
      if (selected.length >= 2 && !e.ctrlKey && !e.metaKey) {
        const result = ensureRelation(
          structureRef.current,
          "repeat",
          selected,
          `relation-${Date.now()}-${relationCounterRef.current++}`,
        );
        if (!result.ok) {
          toast(result.error);
        } else {
          onStructureChangeRef.current(result.structure);
          selectedSegmentIdsRef.current = new Set();
          setSelectedSegmentIds(new Set());
          toast(result.created ? "已标记为重复关系；可在右侧改为升级或变奏" : "该关系已存在");
        }
      } else {
        randomizeTargetOnset();
      }
    } else if (isKeyZ) {
      e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        cancelSimulatorGesture();
        doRedo();
      } else {
        cancelSimulatorGesture();
        doUndo(); // 模拟器关闭时裸 Z 与 Ctrl+Z 均为回退
      }
    } else if (isKeyY && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      doRedo();
    } else if (k === "ArrowLeft" || k === "ArrowRight") {
      e.preventDefault();
      const step = (e.shiftKey ? 5 : 1) * (k === "ArrowLeft" ? -1 : 1);
      clock.shuttleTo(clock.getNavigationTime() + step);
    } else if (k === "Home") {
      e.preventDefault();
      cancelSimulatorGesture();
      clock.seek(0);
    } else if (k === "Escape") {
      setSelectionSet(new Set()); // 已无选中态可清(编辑对象由播放头派生)
      setSelectedSegmentIds(new Set());
      setPendingInSec(null);
      if (markedSwapOnsetIdRef.current !== null) {
        markedSwapOnsetIdRef.current = null;
        setMarkedSwapOnsetId(null);
        toast("已取消标记采音点 A");
      }
    }
  };
  keyUpHandlerRef.current = (e: KeyboardEvent) => {
    const gesture = simulatorGestureRef.current;
    if (uiRef.current.simulatorMode) {
      const diagnostic = {
        type: "keyup",
        key: e.key,
        code: e.code,
        keyCode: e.keyCode,
        which: e.which,
        ctrl: e.ctrlKey,
        meta: e.metaKey,
        alt: e.altKey,
        shift: e.shiftKey,
        hasGesture: gesture !== null,
      };
      const diagnosticWindow = window as unknown as { __simulatorKeyEvents?: unknown[] };
      diagnosticWindow.__simulatorKeyEvents = [
        ...(diagnosticWindow.__simulatorKeyEvents ?? []),
        diagnostic,
      ].slice(-100);
      console.info(
        `[simulator-input] ${JSON.stringify(diagnostic)}`,
      );
    }
    if (!gesture) return;
    const column = simulatorColumnForKeyboard(
      e.code,
      e.key,
      e.keyCode,
      simulatorKeymapRef.current,
    );
    if (column === null || !gesture.lanes.some((lane) => lane.column === column && lane.down)) return;
    e.preventDefault();
    const order = new Map(onsetsRef.current.map((onset, index) => [onset.id, index]));
    const released = releaseSimulatorLane(gesture, column, performance.now(), order);
    publishSimulatorGesture(released.gesture);
    if (released.commit) commitSimulatorInput(released.commit);
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandlerRef.current(e);
    const up = (e: KeyboardEvent) => keyUpHandlerRef.current(e);
    const blur = () => cancelSimulatorGesture();
    window.addEventListener("keydown", h);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", h);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      clearSimulatorTimers();
    };
  }, [cancelSimulatorGesture, clearSimulatorTimers]);

  useEffect(() => {
    const copy = (event: ClipboardEvent) => copyHandlerRef.current(event);
    const paste = (event: ClipboardEvent) => pasteHandlerRef.current(event);
    window.addEventListener("copy", copy);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("copy", copy);
      window.removeEventListener("paste", paste);
    };
  }, []);

  // 撤销诊断:__undoDiag() —— desync=true 即"快照与实时状态脱节"(旧 bug 的特征)
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__undoDiag = () => {
      const u = undoRef.current;
      const d = {
        past: u?.pastLength ?? 0,
        future: u?.futureLength ?? 0,
        canUndo: u?.canUndo ?? false,
        snapshotAssigned: u ? Object.keys(u.current.assignments).length : 0,
        snapshotAdded: u ? u.current.addedOnsets.length : 0,
        snapshotDeleted: u ? (u.current.deletedOnsetIds?.length ?? 0) : 0,
        liveAssigned: Object.keys(assignmentsRef.current).length,
        liveAdded: addedOnsetsRef.current.length,
        liveDeleted: deletedOnsetIdsRef.current.length,
        desync: u ? u.current.assignments !== assignmentsRef.current : false,
      };
      console.table(d);
      return d;
    };
    return () => {
      delete w.__undoDiag;
    };
  }, []);

  // ── 持久化(按工程 ?src) ──
  const buildStateRef = useRef<() => WorkingStateV1 | null>(() => null);
  buildStateRef.current = () => {
    if (!sourceInfo) return null;
    return {
      schema: 1,
      sourcePath: sourceInfo.path,
      sourceSha1: sourceInfo.sha1,
      sourceMode: sourceModeRef.current,
      assignments: assignmentsToJson(assignmentsRef.current),
      addedOnsets: addedOnsetsRef.current,
      deletedOnsetIds: deletedOnsetIdsRef.current,
      structure: structureRef.current,
      ui: {
        ...uiRef.current,
        playheadSec: clock.getTime(),
        selectedOnsetId: selectedRef.current,
      },
      updatedAt: new Date().toISOString(),
    };
  };

  const persistNow = useCallback(async (syncBacking = false): Promise<boolean> => {
    const state = buildStateRef.current();
    if (!state) return false;
    let succeeded = true;

    // ① 写回源 .mc(用户授权的"自动保存改原文件")。只在**真发生过编辑**且内容确有变化时写:
    //    防抖也会被滚动/音量等纯 UI 变化触发,没有这道闸会造成写放大。
    if (
      (src.startsWith("managed:") || resolveWriteBack(uiRef.current.writeBackEnabled, src)) &&
      editedRef.current &&
      !writeBackOffRef.current
    ) {
      const built = buildMcRef.current();
      if (built && built.text !== lastWrittenRef.current) {
        try {
          const res = await fetch(`/api/writeback${q}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mcText: built.text, expectSha1: sourceInfoRef.current?.sha1 }),
          });
          const j = await res.json();
          if (res.ok && j.ok) {
            lastWrittenRef.current = built.text;
            const info = { path: String(j.path), sha1: String(j.sha1) };
            sourceInfoRef.current = info;
            setSourceInfo(info);
            state.sourceSha1 = info.sha1; // 随后的 state POST 带上新哈希
            setWriteBackAt(new Date().toLocaleTimeString());
            if (j.backup) setWriteBackBackup(String(j.backup));
            setWriteBackError(null);
          } else {
            // 403/409/422 属结构性问题 → 停止重试,横幅提示(网络抖动则下次防抖再来)
            writeBackOffRef.current = true;
            setWriteBackError(String(j.error ?? (j.errors ?? []).join("; ") ?? `HTTP ${res.status}`));
            succeeded = false;
          }
        } catch {
          succeeded = false;
          /* 网络抖动:保留标志,下次防抖重试 */
        }
      }
    }

    // ② 工作状态
    try {
      const res = await fetch(`/api/state${q}`, { method: "POST", body: JSON.stringify(state) });
      if (res.ok) setSaveStamp(new Date().toLocaleTimeString());
      else succeeded = false;
    } catch {
      /* 网络抖动:下次编辑再存 */
      succeeded = false;
    }
    if (syncBacking && src.startsWith("managed:")) {
      const built = buildMcRef.current();
      if (!built) return false;
      try {
        const saveBacking = async (overwriteAssets = false): Promise<boolean> => {
          const res = await fetch(`/api/projects/save${q}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mcText: built.text, overwriteAssets }),
          });
          const data = await res.json();
          if (res.status === 409 && data.conflict && Array.isArray(data.assetConflicts) && !overwriteAssets) {
            if (window.confirm(`以下素材已存在或被外部修改：\n${data.assetConflicts.join("\n")}\n\n是否备份后覆盖？`)) {
              return saveBacking(true);
            }
            return false;
          }
          if (!res.ok || !data.ok) {
            toast(String(data.error ?? (data.errors ?? []).join("；") ?? "同步原文件失败"));
            return false;
          }
          toast(
            data.syncSkippedReason === "source_missing"
              ? "已保存到工程；原文件已移动或删除，可继续编辑和导出。"
              : data.workspaceOnly
              ? "已保存到工程工作区"
              : data.copiedFromProtectedAsset
                ? "已保存；受保护原件已保留，并切换到普通工作副本"
                : "已同步保存到原文件",
          );
          return true;
        };
        if (!(await saveBacking())) return false;
      } catch (error) {
        toast(`同步原文件失败：${(error as Error).message}`);
        return false;
      }
    } else if (syncBacking) {
      toast(succeeded ? "已保存" : "保存未完成，请查看错误提示");
    }
    return succeeded;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    if (phase !== "ready") return;
    const pending = sessionStorage.getItem("arranger:pending-toast");
    if (!pending) return;
    sessionStorage.removeItem("arranger:pending-toast");
    const timer = window.setTimeout(() => toast(pending), 0);
    return () => window.clearTimeout(timer);
  }, [phase, toast]);

  // 防抖 800ms,maxWait 5s
  useEffect(() => {
    if (phase !== "ready") return;
    if (firstDirtyAt.current === null) firstDirtyAt.current = Date.now();
    const elapsed = Date.now() - firstDirtyAt.current;
    const delay = elapsed >= 5000 ? 0 : 800;
    const timer = window.setTimeout(() => {
      firstDirtyAt.current = null;
      void persistNow();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [assignments, addedOnsets, structure, ui, sourceMode, phase, persistNow]);

  // pagehide → sendBeacon 兜底
  useEffect(() => {
    const h = () => {
      if (phaseRef.current !== "ready") return;
      const state = buildStateRef.current();
      if (state) {
        navigator.sendBeacon(
          `/api/state${q}`,
          new Blob([JSON.stringify(state)], { type: "application/json" }),
        );
      }
    };
    window.addEventListener("pagehide", h);
    return () => window.removeEventListener("pagehide", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 每 5 分钟:有改动则自动快照(用已保存状态)
  useEffect(() => {
    if (phase !== "ready") return;
    const iv = window.setInterval(() => {
      if (snapDirtyRef.current) {
        snapDirtyRef.current = false;
        void fetch(`/api/snapshots${q}`, {
          method: "POST",
          body: JSON.stringify({ label: "自动快照" }),
        });
      }
    }, 5 * 60_000);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const restoreSnapshot = useCallback(
    (state: WorkingStateV1) => {
      cancelSimulatorGesture();
      setLastSimulatorColumns([]);
      const added = state.addedOnsets ?? [];
      const deleted = state.deletedOnsetIds ?? [];
      const deletedSet = new Set(deleted);
      const os = mergeOnsets(buildOnsets(chartRef.current!.gameplay), added).filter((o) => !deletedSet.has(o.id));
      setAddedOnsets(added);
      setDeletedOnsetIds(deleted);
      onStructureChangeRef.current(
        restoreSegmentStructure(state.structure, clock.duration(), timedOnsetsRef.current),
      );
      setPendingInSec(null);
      const map = assignmentsFromJson(state.assignments, os);
      undoRef.current?.push({ assignments: map, addedOnsets: added, deletedOnsetIds: deleted }); // 恢复本身可回退
      snapDirtyRef.current = true;
      setSourceMode(state.sourceMode);
      setAssignments(map);
      const restoredUi = normalizeUiPrefs(state.ui);
      setUi(restoredUi);
      setSelectedId(restoredUi.selectedOnsetId);
      clock.seek(restoredUi.playheadSec);
      setUndoTick((n) => n + 1);
      toast("已恢复快照；排键与分割可分别回退");
    },
    [cancelSimulatorGesture, clock, toast],
  );

  /** 写回在 persistNow 里先于 buildMcForExport 定义,故经 ref 调用 */
  const buildMcRef = useRef<() => { text: string } | null>(() => null);

  const buildMcForExport = useCallback(() => {
    const parsed = chartRef.current;
    if (!parsed) return null;
    const build = buildExportNotes(onsetsRef.current, assignmentsRef.current);
    return {
      text: buildArrangedMc(parsed, build.notes, {
        bpm: uiRef.current.bpmOverride,
        offsetMs: uiRef.current.offsetOverride,
      }),
      noteCount: build.notes.length,
      assignedCount: build.assignedCount,
      unassignedCount: build.unassignedCount,
    };
  }, []);

  buildMcRef.current = buildMcForExport;

  const onViewPersist = useCallback((view: TimelineView) => {
    setUi((prev) =>
      prev.pxPerSec === view.pxPerSec && prev.scrollSec === view.scrollSec
        ? prev
        : { ...prev, ...view },
    );
  }, []);

  const restoreStructureState = useCallback(
    (next: SegmentStructureV3) => {
      structureRef.current = next;
      snapDirtyRef.current = true;
      setStructure(next);
      const valid = new Set(deriveSegments(next).map((segment) => segment.id));
      setSelectedSegmentIds((previous) => {
        const selected = new Set([...previous].filter((id) => valid.has(id)));
        return selected.size === previous.size ? previous : selected;
      });
    },
    [],
  );
  const onStructureChange = useCallback(
    (next: SegmentStructureV3) => {
      if (next === structureRef.current) return;
      if (!structureUndoRef.current) {
        structureUndoRef.current = new UndoStack(structureRef.current);
      }
      structureUndoRef.current.push(next);
      restoreStructureState(next);
      setStructureUndoTick((n) => n + 1);
    },
    [restoreStructureState],
  );
  onStructureChangeRef.current = onStructureChange;
  const doStructureUndo = useCallback(() => {
    const previous = structureUndoRef.current?.undo();
    if (!previous) {
      toast("没有可回退的分割操作");
      return;
    }
    restoreStructureState(previous);
    setPendingInSec(null);
    setStructureUndoTick((n) => n + 1);
  }, [restoreStructureState, toast]);
  const doStructureRedo = useCallback(() => {
    const next = structureUndoRef.current?.redo();
    if (!next) {
      toast("没有可重做的分割操作");
      return;
    }
    restoreStructureState(next);
    setPendingInSec(null);
    setStructureUndoTick((n) => n + 1);
  }, [restoreStructureState, toast]);
  const setInPoint = useCallback(() => {
    const sec = Math.min(audioDuration, Math.max(0, clock.getTime()));
    setPendingInSec(sec);
    toast(`I 已设为 ${sec.toFixed(3)}s`);
  }, [audioDuration, clock, toast]);
  setInPointRef.current = setInPoint;
  const completeOutPoint = useCallback(() => {
    const startSec = pendingInSecRef.current;
    if (startSec == null) {
      toast("请先按 I 设置区间起点");
      return;
    }
    const endSec = Math.min(audioDuration, Math.max(0, clock.getTime()));
    const id = `clip-${Date.now()}-${clipCounterRef.current++}`;
    const result = createClipFromRange(
      structureRef.current,
      startSec,
      endSec,
      id,
      timedOnsetsRef.current,
      audioDuration,
    );
    if (!result.ok) {
      toast(result.error);
      return;
    }
    onStructureChangeRef.current(result.structure);
    const selected = new Set([id]);
    selectedSegmentIdsRef.current = selected;
    setSelectedSegmentIds(selected);
    setPendingInSec(null);
    toast(`已创建并选中 I ${startSec.toFixed(3)}s → O ${endSec.toFixed(3)}s`);
  }, [audioDuration, clock, toast]);
  completeOutPointRef.current = completeOutPoint;

  const buildSuggestedStructure = useCallback((): SegmentStructureV3 | null => {
    if (!timing || audioDuration <= 0) return null;
    let sections = suggestedSections;
    if (sections.length === 0) {
      const startBeat = Math.max(0, audioSecToBeat(0, timing));
      const endBeat = audioSecToBeat(audioDuration, timing);
      const first = Math.max(64, Math.ceil(startBeat / 64) * 64);
      const cuts = [0];
      for (let beat = first; beat < endBeat; beat += 64) {
        cuts.push(beatToAudioSec(beat, timing));
      }
      cuts.push(audioDuration);
      sections = cuts.slice(0, -1).map((start, index) => ({
        start,
        end: cuts[index + 1],
        label: "",
      }));
    }
    const snapToBar = (sec: number) => {
      const beat = audioSecToBeat(sec, timing);
      return Math.min(audioDuration, Math.max(0, beatToAudioSec(Math.round(beat / 4) * 4, timing)));
    };
    return {
      ...createSuggestedStructure(sections, audioDuration, snapToBar, timedOnsets),
      source: "manual",
    };
  }, [audioDuration, suggestedSections, timedOnsets, timing]);

  const loadSuggestedStructure = useCallback(() => {
    if (
      structureRef.current.clips.length > 0 &&
      !window.confirm("载入建议会替换全部现有 clip 与关系，继续吗？")
    ) {
      return;
    }
    const suggested = buildSuggestedStructure();
    if (!suggested) {
      toast("音频尚未就绪，无法载入建议");
      return;
    }
    onStructureChangeRef.current(suggested);
    setPendingInSec(null);
    toast(`已载入 ${suggested.clips.length} 个建议 clip`);
  }, [buildSuggestedStructure, toast]);

  const clearStructure = useCallback(() => {
    if (
      structureRef.current.clips.length > 0 &&
      !window.confirm("清空全部 clip 与关系并重新标记？")
    ) {
      return;
    }
    onStructureChangeRef.current({
      schema: 3,
      initialized: true,
      source: "manual",
      clips: [],
      relations: [],
    });
    setPendingInSec(null);
    toast("已清空全部 clip，可用 I/O 重新标记");
  }, [toast]);
  const toggleSegment = useCallback((id: string) => {
    setSelectedSegmentIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 引擎就绪且工程已 hydrate → 恢复保存的播放头(仅一次)。速度/音量由下方 per-value 副作用负责。
  const restoredRef = useRef(false);
  const openedRecordedRef = useRef(false);
  useEffect(() => {
    if (phase !== "ready" || openedRecordedRef.current) return;
    openedRecordedRef.current = true;
    void fetch("/api/projects/entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "chart", target: src, action: "touch" }),
    });
  }, [phase, src]);

  useEffect(() => {
    if (restoredRef.current || !clock.ready || phase !== "ready") return;
    restoredRef.current = true;
    clock.setKickEnabled(true);
    if (pendingSeekRef.current !== null) {
      clock.seek(pendingSeekRef.current);
      pendingSeekRef.current = null;
    }
  }, [clock, phase]);

  // 速度/音量随 UiPrefs 变化即时下发(引擎方法幂等;ready 翻转时 clock 身份变化亦触发)。
  useEffect(() => {
    if (clock.ready) clock.setRate(ui.playbackRate);
  }, [clock, ui.playbackRate]);
  useEffect(() => {
    if (clock.ready) clock.setMusicVol(ui.musicVol);
  }, [clock, ui.musicVol]);
  useEffect(() => {
    if (clock.ready) clock.setKickVol(ui.kickVol);
  }, [clock, ui.kickVol]);
  useEffect(() => {
    if (clock.ready) clock.setKickOffsetMs(ui.kickOffsetMs);
  }, [clock, ui.kickOffsetMs]);
  useEffect(() => {
    if (clock.ready) clock.setKickSound(ui.kickSound as KickSoundId);
  }, [clock, ui.kickSound]);

  // 音频时长就绪后恢复手工结构；旧自动播种结构清空，建议改由用户手动载入。
  useEffect(() => {
    if (!clock.ready || phase !== "ready" || !timing || audioDuration <= 0) return;
    if (pendingStructureRef.current) {
      const migrated = restoreSegmentStructure(
        pendingStructureRef.current,
        audioDuration,
        timedOnsets,
      );
      pendingStructureRef.current = null;
      structureRef.current = migrated;
      setStructure(migrated);
      structureUndoRef.current = new UndoStack(migrated);
      setStructureUndoTick((n) => n + 1);
      snapDirtyRef.current = true;
    }
  }, [audioDuration, clock.ready, phase, timedOnsets, timing]);

  // kick 调度用的采音点音频时刻(nudge/onsets 变化时重算)。
  useEffect(() => {
    if (timing) clock.setKickOnsets(onsets.map((o) => beatToAudioSec(o.beatFloat, timing)));
  }, [clock, onsets, timing]);

  // 活动采音点**由播放头派生**(已废除选中机制)= 播放头**之前最近的一个采音点**
  // (正好落在其上也算)。于是播放头停在任意位置都能排键 —— 指派落到前一个采音点;
  // 右侧栏因共用 selectedId 自动聚焦该点。仅在派生结果变化时 setState。
  useEffect(() => {
    return clock.subscribe((t) => {
      const tm = timingRef.current;
      if (!tm) return;
      const active = onsetAtOrBefore(onsetsRef.current, tm, t);
      const id = active?.id ?? null;
      if (id !== selectedRef.current) setSelectedId(id);
    });
  }, [clock]);

  // ── 渲染 ──
  if (phase === "loading") {
    return <Center>正在加载谱面与几何配置…</Center>;
  }
  if (phase === "error" || !chart || !geometry || !timing) {
    return (
      <Center>
        <span className="text-err">加载失败:{loadError ?? "未知错误"}</span>
      </Center>
    );
  }

  const canUndo = (undoRef.current?.canUndo ?? false) && undoTick >= 0;
  const canRedo = undoRef.current?.canRedo ?? false;
  const canUndoStructure =
    (structureUndoRef.current?.canUndo ?? false) && structureUndoTick >= 0;
  const canRedoStructure = structureUndoRef.current?.canRedo ?? false;
  const simulatorPressedColumns = simulatorGesture
    ? simulatorGesture.lanes.filter((lane) => lane.down).map((lane) => lane.column)
    : [];
  const simulatorHoldReady = simulatorGesture
    ? simulatorGestureHoldReady(simulatorGesture, simulatorNowMs)
    : false;
  let simulatorStatus: string | null = null;
  if (ui.simulatorMode) {
    if (!simulatorGesture) {
      simulatorStatus = "短按写入单点 · 按住键位并用 ←/→ 选择长条尾";
    } else {
      const headIndex = onsetOrder.get(simulatorGesture.headOnsetId) ?? -1;
      const cursorIndex = onsetOrder.get(simulatorGesture.cursorOnsetId) ?? headIndex;
      const released = simulatorGesture.lanes
        .filter((lane) => !lane.down && lane.tailOnsetId)
        .map((lane) => `${lane.column}→#${(onsetOrder.get(lane.tailOnsetId!) ?? -1) + 1}`);
      simulatorStatus = simulatorHoldReady
        ? cursorIndex > headIndex
          ? `长条 #${headIndex + 1} → #${cursorIndex + 1}${released.length > 0 ? ` · 已定 ${released.join(" ")}` : ""}`
          : "长条待定 · 按 → 选择更晚尾点 · Esc 取消"
        : "松开写入单点 · 持续 350ms 或按 → 进入长条";
    }
  }

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onPointerDownCapture={() => {
        if (!uiRef.current.simulatorMode) {
          rootRef.current?.focus();
        }
        cancelSimulatorGesture();
      }}
      onPointerUpCapture={(event) => {
        if (!uiRef.current.simulatorMode) return;
        const target = event.target instanceof HTMLElement ? event.target : null;
        const focusTarget = target?.closest("input, textarea, select, [contenteditable='true']");
        if (
          simulatorCaptureShouldRefocus(
            focusTarget instanceof HTMLElement
              ? {
                  tagName: focusTarget.tagName,
                  inputType: focusTarget instanceof HTMLInputElement ? focusTarget.type : null,
                  isContentEditable: focusTarget.isContentEditable,
                }
              : target
                ? { tagName: target.tagName, isContentEditable: target.isContentEditable }
                : null,
          )
        ) {
          scheduleSimulatorCaptureFocus();
        }
      }}
      className="flex h-screen flex-col overflow-hidden bg-parchment text-ink outline-none"
    >
      <input
        ref={simulatorTextCaptureRef}
        type="text"
        tabIndex={-1}
        aria-hidden="true"
        autoComplete="off"
        data-testid="simulator-text-capture"
        className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
        onFocus={() => setSimulatorCaptureReady(true)}
        onBlur={(event) => {
          setSimulatorCaptureReady(false);
          const next = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
          const focusTarget = next?.closest("input, textarea, select, [contenteditable='true']");
          if (
            simulatorCaptureShouldRefocus(
              focusTarget instanceof HTMLElement
                ? {
                    tagName: focusTarget.tagName,
                    inputType: focusTarget instanceof HTMLInputElement ? focusTarget.type : null,
                    isContentEditable: focusTarget.isContentEditable,
                  }
                : next
                  ? { tagName: next.tagName, isContentEditable: next.isContentEditable }
                  : null,
            )
          ) {
            scheduleSimulatorCaptureFocus();
          }
        }}
        onCompositionUpdate={(event) => {
          console.info(`[simulator-text] compositionupdate ${JSON.stringify(event.data)}`);
          if (uiRef.current.simulatorMode) commitSimulatorText(event.data);
        }}
        onBeforeInput={(event) => {
          const data = (event.nativeEvent as InputEvent).data ?? "";
          console.info(`[simulator-text] beforeinput ${JSON.stringify(data)}`);
          if (uiRef.current.simulatorMode) commitSimulatorText(data);
        }}
        onInput={(event) => {
          const text = event.currentTarget.value;
          console.info(`[simulator-text] input ${JSON.stringify(text)}`);
          event.currentTarget.value = "";
          if (uiRef.current.simulatorMode) commitSimulatorText(text);
        }}
      />
      {clock.error && (
        <div className="border-b border-cream bg-warn-wash px-3 py-1 text-xs text-warn-ink">
          无音频预览({clock.error})—— 仍可排键；统一 .mcz 导出需要工程内恰好一份音频与封面。
        </div>
      )}
      <TransportBar
        clock={clock}
        timing={timing}
        playing={clock.playing}
        projectTitle={projectTitle}
        selectedIndex={selectedIndex >= 0 ? selectedIndex : null}
        totalOnsets={onsets.length}
        assignedCount={assignedCount}
        warningCount={warnings.length}
        tripleWarningCount={tripleWarnings.length}
        onJumpToHoldOverlap={jumpToHoldOverlap}
        onJumpToTriple={jumpToTriple}
        onCopyTimePoint={copyCurrentTimePoint}
        canUndoArrangement={canUndo}
        canRedoArrangement={canRedo}
        canUndoStructure={canUndoStructure}
        canRedoStructure={canRedoStructure}
        saveStamp={saveStamp}
        simulatorMode={ui.simulatorMode}
        simulatorGestureActive={simulatorGesture !== null}
        simulatorCaptureReady={simulatorCaptureReady}
        simulatorKeymap={simulatorKeymap}
        onOpenSimulatorKeymap={() => setShowKeymapModal(true)}
        onUndoArrangement={doUndo}
        onRedoArrangement={doRedo}
        onUndoStructure={doStructureUndo}
        onRedoStructure={doStructureRedo}
        onSnapshotPanel={() => setSnapsOpen((v) => !v)}
        onExportPanel={() => setExportOpen(true)}
        onOpenHelp={() => setHelpOpen((v) => !v)}
        onSimulatorModeChange={(on) => {
          cancelSimulatorGesture();
          if (!on) setLastSimulatorColumns([]);
          setUi((prev) => ({ ...prev, simulatorMode: on }));
          if (on) {
            scheduleSimulatorCaptureFocus();
          }
        }}
        onExit={onExit}
      />

      {chart.warnings.length > 0 && (
        <div className="border-b border-cream bg-warn-wash px-3 py-1 text-xs text-warn-ink">
          {chart.warnings.join(" · ")}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <HexPreview
            geometry={geometry}
            onsets={onsets}
            assignments={simulatorPreviewAssignments}
            selectedOnset={selectedOnset}
            timing={timing}
            leadInSec={ui.leadInSec}
            snapDenom={ui.snapDenom}
            clock={clock}
            coverUrl={`/api/cover${q}&assetRevision=${assetRevision}`}
            simulatorMode={ui.simulatorMode}
            simulatorPressedColumns={simulatorPressedColumns}
            simulatorPreviousColumns={lastSimulatorColumns}
            simulatorStatus={simulatorStatus}
            simulatorKeymap={simulatorKeymap}
            interactionLocked={simulatorGesture !== null}
            onKeyClick={onKeyClick}
            onKeyRightClick={onKeyRightClick}
            onNoteMove={onNoteMove}
            onNoteDelete={onNoteDelete}
          />
        </div>
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-cream bg-ivory">
          <ProjectPanel
            key={`${src}:${manageRevision}`}
            src={src}
            saveStamp={saveStamp}
            writeBackEnabled={resolveWriteBack(ui.writeBackEnabled, src)}
            writeBackAt={writeBackAt}
            writeBackBackup={writeBackBackup}
            writeBackError={writeBackError}
            onToggleWriteBack={(on) => {
              writeBackOffRef.current = false;
              setWriteBackError(null);
              setUi((prev) => ({ ...prev, writeBackEnabled: on }));
            }}
            onSaveNow={() => persistNow(true)}
            onManage={() => setManageOpen(true)}
            onSetup={() => setSetupOpen(true)}
            onAddChart={() => setAddChartOpen(true)}
            buildMcText={buildMcForExport}
            onOpen={async (s) => {
              await persistNow();
              onOpenSrc(s);
            }}
            onExit={onExit}
            onToast={toast}
          />
          <SegmentsPanel
            structure={structure}
            duration={audioDuration}
            timedOnsets={timedOnsets}
            clock={clock}
            selectedSegmentIds={selectedSegmentIds}
            onToggleSegment={toggleSegment}
            onChange={onStructureChange}
            pendingInSec={pendingInSec}
            onSetIn={setInPoint}
            onCompleteOut={completeOutPoint}
            onCancelIn={() => setPendingInSec(null)}
            onLoadSuggestions={loadSuggestedStructure}
            onClearStructure={clearStructure}
            onToast={toast}
            onMirrorSelected={mirrorSelectedClips}
          />
          <InspectorPanel
            geometry={geometry}
            selectedOnset={selectedOnset}
            assignments={assignments}
            timing={timing}
            warnings={warnings}
            tripleWarnings={tripleWarnings}
            unassignedCount={onsets.length - assignedCount}
            simulatorKeymap={simulatorKeymap}
            onOpenSimulatorKeymap={() => setShowKeymapModal(true)}
            onJumpToHoldOverlap={jumpToHoldOverlap}
            onJumpToTriple={jumpToTriple}
            onDeleteOnset={deleteCurrentOnset}
            onAssignAll={(column) => {
              applyEdit((map) => ({
                ok: true,
                map: assignAllToColumn(map, onsetsRef.current, column),
              }));
              toast(`已将全部 ${onsetsRef.current.length} 个采音点排至键 ${column}`);
            }}
            onUnassign={(col) => onKeyRightClick(col)}
            onClearHold={(col) => {
              const o = selectedOnset;
              if (o) applyEdit((m) => setHoldEnd(m, o, col, null));
            }}
            onRandomize={() => randomizeTargetOnset(selectedOnset)}
            markedSwapOnset={
              markedSwapOnsetId
                ? onsets.find((o) => o.id === markedSwapOnsetId) ?? null
                : null
            }
            onClearMarkedSwap={() => {
              markedSwapOnsetIdRef.current = null;
              setMarkedSwapOnsetId(null);
              toast("已取消标记采音点 A");
            }}
          />
          <SnapshotsPanel open={snapsOpen} src={src} onRestore={restoreSnapshot} onToast={toast} />
        </aside>
      </div>

      <TimingBar
        timeMap={timing.timeMap}
        offsetMs={timing.offsetMs}
        sourceBpm={chart.timeMap[0]?.bpm ?? null}
        sourceOffsetMs={chart.audioNote.offsetMs}
        multiBpm={chart.timeMap.length > 1}
        onPreviewKick={() => clock.previewKick()}
        ui={ui}
        onUiChange={(patch) => setUi((prev) => ({ ...prev, ...patch }))}
      />

      <div className="relative h-40 shrink-0 border-t border-cream">
        <Timeline
          onsets={onsets}
          assignments={assignments}
          renderAssignments={simulatorPreviewAssignments}
          simulatorDraftHeadId={simulatorGesture?.headOnsetId ?? null}
          markedSwapOnsetId={markedSwapOnsetId}
          timing={timing}
          clock={clock}
          playing={clock.playing}
          selectedId={selectedId}
          selectionSet={selectionSet}
          snapClickEnabled={ui.snapClickEnabled}
          snapDenom={ui.snapDenom}
          warnings={warnings}
          tripleWarnings={tripleWarnings}
          segments={segmentRanges}
          segmentRelations={structure.relations}
          selectedSegmentIds={selectedSegmentIds}
          pendingInSec={pendingInSec}
          initialView={{ pxPerSec: ui.pxPerSec, scrollSec: ui.scrollSec }}
          onViewPersist={onViewPersist}
          onSeek={timelineSeek}
          onClearOnset={(id) => clearOnsetIds([id])}
          onMarquee={(ids) => setSelectionSet(new Set(ids))}
          onToggleSegment={toggleSegment}
          onMergeClips={(leftId, rightId) => {
            const result = mergeClips(structureRef.current, leftId, rightId);
            if (!result.ok) {
              toast(result.error);
              return;
            }
            onStructureChange(result.structure);
            toast("已合并相邻 clip");
          }}
          onDeleteClip={(id) => {
            onStructureChange(removeClip(structureRef.current, id));
            setPendingInSec(null);
            toast("已删除 clip；可用“回退分割”恢复");
          }}
        />
        {selectionSet.size > 0 && (
          <div className="absolute right-3 top-2 flex items-center gap-2 rounded-xl bg-ivory px-3 py-1.5 shadow-whisper">
            <span className="text-xs text-olive">框选 {selectionSet.size} 点</span>
            <button
              className="rounded-lg bg-clay px-3 py-1 text-xs font-semibold text-white hover:bg-coral"
              onClick={() => {
                clearOnsetIds(selectionSet);
                setSelectionSet(new Set());
                toast(`已清空 ${selectionSet.size} 个采音点的排键`);
              }}
            >
              重排 · 清空所选
            </button>
            <button
              className="rounded-lg px-1.5 text-stone hover:text-ink"
              title="取消框选 (Esc)"
              onClick={() => setSelectionSet(new Set())}
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {phase === "dialog" && (
        <LoadDialog
          sourcePath={sourceInfo?.path ?? ""}
          noteCount={chart.gameplay.length}
          onsetCount={onsets.length}
          bpm={chart.timeMap[0]?.bpm ?? 0}
          offsetMs={chart.audioNote.offsetMs}
          shaMismatch={shaMismatch}
          defaultPlaceholder={looksLikePlaceholder(chart.gameplay)}
          onStart={startFresh}
          onResume={shaMismatch ? resumeSaved : undefined}
        />
      )}

      <ExportPanel
        open={exportOpen}
        src={src}
        onClose={() => setExportOpen(false)}
        onManage={() => setManageOpen(true)}
        buildMcText={buildMcForExport}
        onToast={toast}
      />

      <ProjectManageDialog
        open={manageOpen}
        src={src}
        onClose={() => setManageOpen(false)}
        onChanged={() => setManageRevision((revision) => revision + 1)}
        onSave={() => persistNow(true)}
        onToast={toast}
      />

      {setupOpen && <ProjectSetupDialog
        open={setupOpen}
        src={src}
        metadata={effectiveMetadata!}
        mcText={buildMcForExport()?.text ?? ""}
        expectSha1={sourceInfo?.sha1 ?? ""}
        onClose={() => setSetupOpen(false)}
        onApplied={(result) => {
          const parsed = parseMc(result.text);
          chartRef.current = parsed;
          setChart(parsed);
          const info = { path: sourceInfoRef.current?.path ?? src, sha1: result.sourceSha1 };
          sourceInfoRef.current = info;
          setSourceInfo(info);
          lastWrittenRef.current = result.text;
          editedRef.current = true;
          setUi((current) => ({ ...current, bpmOverride: null, offsetOverride: null }));
          setAssetRevision(result.assetRevision);
          setManageRevision((revision) => revision + 1);
        }}
        onToast={toast}
      />}

      {addChartOpen && <BlankChartDialog
        open={addChartOpen}
        mode="internal"
        src={src}
        defaults={newChartMetadata}
        onClose={() => setAddChartOpen(false)}
        onCreated={async (nextSrc) => {
          await persistNow();
          sessionStorage.setItem("arranger:pending-toast", "已新增包内空白谱面");
          onOpenSrc(nextSrc);
        }}
        onToast={() => undefined}
      />}

      {showKeymapModal && (
        <SimulatorKeymapModal
          isOpen={showKeymapModal}
          onClose={() => setShowKeymapModal(false)}
          keymap={simulatorKeymap}
          onSaveKeymap={(nextKeymap) => {
            setSimulatorKeymap(nextKeymap);
            saveStoredSimulatorKeymap(nextKeymap);
            toast(
              `✓ 已保存模拟器按键映射：${nextKeymap.map((b) => `${b.column}:${b.label}`).join(" ")}`,
            );
          }}
        />
      )}

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />

      {hint && (
        <div className="pointer-events-none fixed bottom-48 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-ink px-4 py-2 text-sm text-ivory shadow-whisper">
          {hint}
        </div>
      )}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen items-center justify-center bg-parchment text-sm text-olive">
      {children}
    </div>
  );
}
