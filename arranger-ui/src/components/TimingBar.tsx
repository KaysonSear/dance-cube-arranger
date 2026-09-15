"use client";

/**
 * 时间/同步栏(象牙面):常显 BPM · offset · beat0(元信息);仅预览的 AV 微调(绝不写回
 * .mc)、吸附细分、飞行时长、点击吸附开关、慢放滑杆(0.1–2× 变调保持)、音乐/kick 音量。
 */

import { SNAP_DENOMS, type UiPrefs } from "@/lib/persist-types";
import { KICK_SOUNDS, SPEED_MAX, SPEED_MIN } from "@/lib/audio-engine";
import { beat0AudioSec, type TimePoint } from "@/lib/timemap";

export interface TimingBarProps {
  timeMap: TimePoint[];
  offsetMs: number | null;
  /** 源谱面的原始值(用于对照与复位) */
  sourceBpm: number | null;
  sourceOffsetMs: number | null;
  /** 源谱面是否多段 BPM(覆盖只作用于首段) */
  multiBpm: boolean;
  onPreviewKick(): void;
  ui: UiPrefs;
  onUiChange(patch: Partial<UiPrefs>): void;
}

const inputCls =
  "rounded-lg bg-white px-1.5 py-0.5 text-ink shadow-ring focus:shadow-ring-focus focus:outline-none";

export default function TimingBar({
  timeMap,
  offsetMs,
  sourceBpm,
  sourceOffsetMs,
  multiBpm,
  onPreviewKick,
  ui,
  onUiChange,
}: TimingBarProps) {
  const bpm = timeMap[0]?.bpm ?? 0;
  const beat0 = beat0AudioSec(offsetMs);
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-cream bg-ivory px-3 py-1.5 text-xs text-olive">
      <label
        className="flex items-center gap-1.5"
        title={`谱面 BPM(会写入保存/导出包内谱面)。源值 ${sourceBpm ?? "—"}${multiBpm ? ";多段 BPM 只覆盖首段" : ""}`}
      >
        BPM
        <input
          type="number"
          step={0.001}
          value={bpm}
          onChange={(e) => {
            const v = Number(e.target.value);
            onUiChange({ bpmOverride: Number.isFinite(v) && v > 0 ? v : null });
          }}
          className={`${inputCls} w-20 text-right font-mono`}
        />
        {multiBpm && <span className="text-warn-ink">+{timeMap.length - 1}段</span>}
        {ui.bpmOverride !== null && (
          <button
            onClick={() => onUiChange({ bpmOverride: null })}
            className="rounded px-1 text-stone hover:text-ink"
            title={`复位到源值 ${sourceBpm ?? "—"}`}
          >
            ↺
          </button>
        )}
      </label>

      <label
        className="flex items-center gap-1.5"
        title={`谱面 offset:beat 0 在音频中的毫秒位置(会写入保存/导出包内谱面)。源值 ${sourceOffsetMs ?? "缺失"}`}
      >
        offset
        <input
          type="number"
          step={1}
          value={offsetMs ?? 0}
          onChange={(e) => {
            const v = Number(e.target.value);
            onUiChange({ offsetOverride: Number.isFinite(v) ? v : null });
          }}
          className={`${inputCls} w-20 text-right font-mono`}
        />
        ms
        {ui.offsetOverride !== null && (
          <button
            onClick={() => onUiChange({ offsetOverride: null })}
            className="rounded px-1 text-stone hover:text-ink"
            title={`复位到源值 ${sourceOffsetMs ?? "缺失"}`}
          >
            ↺
          </button>
        )}
      </label>
      <span className="font-mono">
        beat0 @ <span className="text-ink">{(beat0 + ui.nudgeMs / 1000).toFixed(3)}s</span>
      </span>

      <label
        className="flex items-center gap-1.5"
        title="补偿耳机/蓝牙/显示器延迟:只平移预览(飞行/网格/打点)的观感,永不写入 .mc。与上面的谱面 offset 职责不同。"
      >
        设备延迟补偿
        <input
          type="number"
          step={5}
          value={ui.nudgeMs}
          onChange={(e) => onUiChange({ nudgeMs: Number(e.target.value) || 0 })}
          className={`${inputCls} w-16 text-right font-mono`}
        />
        ms
        {ui.nudgeMs !== 0 && (
          <button
            onClick={() => onUiChange({ nudgeMs: 0 })}
            className="rounded px-1 text-stone hover:text-ink"
            title="复位(仅影响预览,不写回 .mc)"
          >
            ↺
          </button>
        )}
      </label>

      <label className="flex items-center gap-1.5">
        吸附
        <select
          value={ui.snapDenom}
          onChange={(e) => {
            onUiChange({ snapDenom: Number(e.target.value) });
            e.currentTarget.blur();
          }}
          className={`${inputCls} font-mono`}
        >
          {SNAP_DENOMS.map((d) => (
            <option key={d} value={d}>
              1/{d}拍
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5" title="点击时间轴吸附到最近节拍并试听落点">
        <input
          type="checkbox"
          checked={ui.snapClickEnabled}
          onChange={(e) => onUiChange({ snapClickEnabled: e.target.checked })}
          className="accent-clay"
        />
        点击吸附
      </label>

      <label className="flex items-center gap-1.5">
        飞行
        <input
          type="range"
          min={0.3}
          max={2.5}
          step={0.05}
          value={ui.leadInSec}
          onChange={(e) => onUiChange({ leadInSec: Number(e.target.value) })}
          className="w-20 accent-clay"
        />
        <span className="w-10 font-mono text-ink">{ui.leadInSec.toFixed(2)}s</span>
      </label>

      <label className="flex items-center gap-1.5" title="慢放变调保持、不卡顿(0.1–2×)">
        速度
        <input
          type="range"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={0.05}
          value={ui.playbackRate}
          onChange={(e) => onUiChange({ playbackRate: Number(e.target.value) })}
          className="w-28 accent-clay"
        />
        <span className="w-10 font-mono text-ink">{ui.playbackRate.toFixed(2)}×</span>
      </label>

      <label className="flex items-center gap-1.5" title="音乐音量">
        🎵
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={ui.musicVol}
          onChange={(e) => onUiChange({ musicVol: Number(e.target.value) })}
          className="w-16 accent-clay"
        />
      </label>

      <label className="flex items-center gap-1.5" title="kick 军鼓打点音量(0 = 静音)">
        🥁
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={ui.kickVol}
          onChange={(e) => onUiChange({ kickVol: Number(e.target.value) })}
          className="w-16 accent-clay"
        />
      </label>

      <label className="flex items-center gap-1.5" title="打点音色">
        音色
        <select
          value={ui.kickSound}
          onChange={(e) => {
            onUiChange({ kickSound: e.target.value });
            e.currentTarget.blur();
            setTimeout(onPreviewKick, 0); // 切换即试听一声
          }}
          className={inputCls}
        >
          {KICK_SOUNDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </label>

      <label
        className="flex items-center gap-1.5"
        title="kick 听感微调:正=推迟军鼓,负=提前。用耳朵把军鼓对到音乐鼓点上(不写回 .mc)"
      >
        🥁微调
        <input
          type="range"
          min={-200}
          max={200}
          step={5}
          value={ui.kickOffsetMs}
          onChange={(e) => onUiChange({ kickOffsetMs: Number(e.target.value) })}
          className="w-24 accent-clay"
        />
        <span className="w-12 font-mono text-ink">{ui.kickOffsetMs}ms</span>
        {ui.kickOffsetMs !== 0 && (
          <button
            onClick={() => onUiChange({ kickOffsetMs: 0 })}
            className="rounded px-1 text-stone hover:text-ink"
            title="复位"
          >
            ↺
          </button>
        )}
      </label>
    </div>
  );
}
