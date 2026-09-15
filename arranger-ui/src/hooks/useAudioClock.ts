"use client";

/**
 * 主时钟 = WebAudio + soundtouch 引擎(`AudioEngine`)。引擎每帧广播位置(暂停时恒定,
 * 供两块 Canvas 重绘;播放时按倍率外推丝滑),渲染因此是播放头 t 的纯函数 —— 倒拖自动反向。
 * 变速为变调保持的 0.1–2× WSOLA;kick 前瞻调度低延迟。接口与旧 `<audio>` 版兼容,新增
 * audition / 音量 / kick 方法与 `ready` 标志。
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { AudioEngine, type KickSoundId } from "@/lib/audio-engine";

export interface AudioClock {
  getTime(): number;
  /** 穿梭中返回最后请求的逻辑终点，否则返回当前画面时间。 */
  getNavigationTime(): number;
  duration(): number;
  playing: boolean;
  ready: boolean;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(sec: number): void;
  /** 左右键使用的静音快速穿梭。 */
  shuttleTo(sec: number): void;
  /** Q/E、模拟器方向键：穿梭后试听落点并最终停回目标(若正在播放则默认暂停)。默认只播音乐不播kick。 */
  shuttleToAndAudition(sec: number, withKick?: boolean): void;
  /** 暂停态落点试听(播放态请直接 seek 续播)。默认只播音乐不播kick。 */
  audition(center: number, withKick?: boolean): void;
  setRate(rate: number): void;
  setMusicVol(v: number): void;
  setKickVol(v: number): void;
  setKickEnabled(on: boolean): void;
  /** kick 听感微调(毫秒,正=推迟)。 */
  setKickOffsetMs(ms: number): void;
  /** 打点音色。 */
  setKickSound(id: KickSoundId): void;
  /** 试听一声当前音色。 */
  previewKick(): void;
  /** 采音点音频时刻(秒,升序)——kick 调度用。 */
  setKickOnsets(times: number[]): void;
  subscribe(cb: (t: number) => void): () => void;
  error: string | null;
}

const KICK_URL = "/punchy-snare.mp3";

export function useAudioClock(audioUrl: string): AudioClock {
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const engineRef = useRef<AudioEngine | null>(null);

  useEffect(() => {
    // 每次 effect 运行都新建引擎:引擎是**一次性**的(dispose 后不可复用)。
    // 旧写法用 ref 复用同一个引擎,在 React StrictMode 双调用下:
    // 卸载 → dispose() → ctx.close() 打断在途的 addModule → "AbortError: Unable to load a
    // worklet's module",且 disposed 永久为 true 让帧循环直接 return → 整个引擎变砖。
    const engine = new AudioEngine({
      onPlayingChange: setPlaying,
      onReady: () => setReady(true),
    });
    engineRef.current = engine;
    // This effect owns an external audio engine; a new URL resets its observable status.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(false);
    setError(null);
    engine.load(audioUrl, KICK_URL).catch((e: unknown) => {
      setError((e as Error)?.message ?? "音频引擎初始化失败");
    });
    // 诊断入口(控制台):__kickDiag() 快照 / __kickLeakTest() 暂停态泄漏测试
    const w = window as unknown as Record<string, unknown>;
    w.__kickDiag = () => {
      const d = engine.diagnostics();
      console.table(d);
      return d;
    };
    w.__kickLeakTest = async (ms?: number) => {
      const r = await engine.leakTest(ms);
      console.table(r);
      return r;
    };
    return () => {
      delete w.__kickDiag;
      delete w.__kickLeakTest;
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [audioUrl]);

  return useMemo<AudioClock>(() => {
    const e = () => engineRef.current;
    return {
      getTime: () => e()?.getTime() ?? 0,
      getNavigationTime: () => e()?.getNavigationTime() ?? 0,
      duration: () => e()?.duration ?? 0,
      playing,
      ready,
      error,
      play: () => e()?.play(),
      pause: () => e()?.pause(),
      toggle: () => e()?.toggle(),
      seek: (sec) => e()?.seek(sec),
      shuttleTo: (sec) => e()?.shuttleTo(sec),
      shuttleToAndAudition: (sec, withKick) => e()?.shuttleToAndAudition(sec, withKick),
      audition: (center, withKick) => e()?.audition(center, 0.12, 0.15, withKick),
      setRate: (rate) => e()?.setRate(rate),
      setMusicVol: (v) => e()?.setMusicVol(v),
      setKickVol: (v) => e()?.setKickVol(v),
      setKickEnabled: (on) => e()?.setKickEnabled(on),
      setKickOffsetMs: (ms) => e()?.setKickOffsetMs(ms),
      setKickSound: (id) => e()?.setKickSound(id),
      previewKick: () => e()?.previewKick(),
      setKickOnsets: (times) => e()?.setKickOnsets(times),
      subscribe: (cb) => e()?.subscribe(cb) ?? (() => {}),
    };
  }, [playing, ready, error]);
}
