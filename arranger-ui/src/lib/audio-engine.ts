/**
 * WebAudio + soundtouch(WSOLA)播放引擎 + 低延迟 kick 打点。
 *
 * 移植自旧采音器 `src/editor/static/app.js` 的音频栈:整曲解码入内存,经 soundtouch
 * PitchShifter(AudioWorklet 优先,ScriptProcessor 回退)做**变调保持**的 0.1–2× 变速;
 * 位置时钟在 soundtouch 分块上报之间按倍率外推,保证播放头/预览丝滑;kick 用 Web Audio
 * 时钟前瞻调度(不受 rAF 抖动),采样前导静音补偿让军鼓瞬态精确落在采音点。
 *
 * 纯命令式、无 React;由 `useAudioClock` 包装成 hook。DSP 来自 `public/vendor/soundtouch*.js`,
 * 打点采样 `public/punchy-snare.mp3`(均自包含,无 CDN)。
 */

import { makeShuttle, navigationTime, sampleShuttle, type ShuttlePlan } from "./shuttle";

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** soundtouch PitchShifter / WorkletPitchShifter 的公共契约(percentagePlayed setter 收 0..1,getter 返回 0..100)。 */
interface Shifter {
  percentagePlayed: number;
  tempo: number;
  rate: number;
  pitch: number;
  connect(node: AudioNode): void;
  disconnect(): void;
  /** 闸门:false 时 worklet 输出静音且不消耗源(暂停期防泄漏)。ScriptProcessor 回退版无此能力。 */
  setRunning?(on: boolean): void;
}

interface EngineCallbacks {
  onPlayingChange(playing: boolean): void;
  onReady(): void;
}

export const SPEED_MIN = 0.1;
export const SPEED_MAX = 2;

/** 打点音色(kick = punchy-snare 采样;其余为纯 WebAudio 合成,移植自旧采音器音库)。 */
export const KICK_SOUNDS = [
  { id: "kick", label: "军鼓采样(默认)" },
  { id: "snare", label: "小鼓" },
  { id: "rim", label: "边击 Rim" },
  { id: "clap", label: "拍手 Clap" },
  { id: "cowbell", label: "牛铃 Cowbell" },
  { id: "zap", label: "电子 Zap" },
  { id: "guitar", label: "失真吉他" },
  { id: "beep", label: "蜂鸣 Beep" },
  { id: "gong", label: "锣 Gong" },
] as const;
export type KickSoundId = (typeof KICK_SOUNDS)[number]["id"];

// source 秒:提前多少调度 kick。必须显著大于采样前导补偿(punchy-snare ≈46ms),
// 否则 playKick 的 Math.max(currentTime, …) 会把近端 kick 钳到"立刻播"而迟到。
const KICK_LOOKAHEAD = 0.25;

/** AudioWorklet 版时间拉伸:与 vendored PitchShifter 同 API,但 DSP 跑在音频线程,避免主线程抢占导致慢放抽帧。 */
class WorkletPitchShifter implements Shifter {
  private sampleRate: number;
  private duration: number;
  private _sourcePosition = 0;
  private _node: AudioWorkletNode;

  constructor(context: AudioContext, buffer: AudioBuffer, onEnd: () => void) {
    this.sampleRate = context.sampleRate;
    this.duration = buffer.duration;
    this._node = new AudioWorkletNode(context, "soundtouch-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this._node.port.onmessage = (e: MessageEvent) => {
      const d = e.data;
      if (!d) return;
      if (d.type === "position") this._sourcePosition = d.sourcePosition;
      else if (d.type === "end") onEnd();
    };
    const left = buffer.getChannelData(0).slice();
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : left.slice();
    this._node.port.postMessage({ type: "buffer", left, right }, [left.buffer, right.buffer]);
  }
  get percentagePlayed(): number {
    return (100 * this._sourcePosition) / (this.duration * this.sampleRate);
  }
  set percentagePlayed(fraction: number) {
    this._sourcePosition = Math.round(fraction * this.duration * this.sampleRate);
    this._node.port.postMessage({ type: "seek", sourcePosition: this._sourcePosition });
  }
  set tempo(v: number) {
    this._node.port.postMessage({ type: "tempo", value: v });
  }
  set rate(v: number) {
    this._node.port.postMessage({ type: "rate", value: v });
  }
  set pitch(v: number) {
    this._node.port.postMessage({ type: "pitch", value: v });
  }
  connect(node: AudioNode): void {
    this._node.connect(node);
  }
  disconnect(): void {
    this._node.disconnect();
  }
  setRunning(on: boolean): void {
    this._node.port.postMessage({ type: "running", value: on });
  }
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private shifter: Shifter | null = null;
  private musicGain: GainNode | null = null;
  private kickGain: GainNode | null = null;
  private engineConnected = false;
  private workletReady = false;

  private _duration = 0;
  private _position = 0;
  private _playing = false;
  private _ready = false;
  private speed = 1;
  private musicVol = 1;
  private kickVol = 0.5;
  private kickEnabled = true;

  // 位置时钟锚定在 AudioContext 时钟(可听输出的真实时钟),而非 soundtouch 上报的
  // sourcePosition(那是拉入 WSOLA 输入缓冲的源样本数,领先可听输出 ~371ms,会让 kick/
  // 播放头整体提前跑拍)。播放中 _position = anchorPos + (ctx.currentTime − anchorCtx) × speed。
  private anchorPos = 0;
  private anchorCtx = 0;

  // kick 调度
  private kickBuffer: AudioBuffer | null = null;
  private kickSampleOnset = 0;
  private kickTimerId: ReturnType<typeof setInterval> | null = null;
  private lastSchedPos = 0;
  private kickOnsets: number[] = []; // 采音点音频时刻(秒),升序
  /** 听感微调(秒),正=推迟 kick。由 UiPrefs kickOffsetMs 下发。 */
  private kickOffset = 0;
  private kickSound: KickSoundId = "kick";
  /** 诊断:被 Math.max 钳位(排期不足以容纳采样前导)的次数 */
  private kickClamped = 0;
  private kickScheduledCount = 0;

  // audition(暂停态落点试听)
  private auditioning = false;
  private auditionWithKick = false;
  private auditionRestore = 0;
  private auditionTarget = 0;
  private auditionDeadline = 0;

  // Q/E 与左右键的静音快速穿梭。_position 始终是当前画面时间；音频缓冲只在终点 seek。
  private shuttle: ShuttlePlan | null = null;
  private resumeAfterShuttle = false;
  /** 模拟器方向键抵达后试听落点，并最终停回目标。 */
  private auditionAfterShuttle = false;
  private auditionWithKickAfterShuttle = false;

  private subs = new Set<(t: number) => void>();
  private raf = 0;
  private disposed = false;

  constructor(private cb: EngineCallbacks) {}

  get duration(): number {
    return this._duration;
  }
  get playing(): boolean {
    return this._playing;
  }
  get ready(): boolean {
    return this._ready;
  }
  getTime(): number {
    return this._position;
  }
  getNavigationTime(): number {
    if (this.shuttle) return navigationTime(this._position, this.shuttle);
    if (this.auditioning) return this.auditionRestore;
    return this._position;
  }

  subscribe(cb: (t: number) => void): () => void {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }

  /** vendored ScriptProcessor 版 PitchShifter(仅在 worklet 失败时动态载入)。 */
  private FallbackShifter: (new (
    ctx: AudioContext,
    buf: AudioBuffer,
    bufferSize: number,
    onEnd: () => void,
  ) => Shifter) | null = null;

  private async loadFallbackShifter(): Promise<void> {
    if (this.FallbackShifter) return;
    try {
      // 用 Function 包一层,避免打包器静态分析这个运行时 URL
      const dynImport = new Function("u", "return import(u)") as (
        u: string,
      ) => Promise<{ PitchShifter: new (...a: never[]) => Shifter }>;
      const mod = await dynImport("/vendor/soundtouch.js");
      this.FallbackShifter = mod.PitchShifter as unknown as typeof this.FallbackShifter;
    } catch (err) {
      console.warn("ScriptProcessor 回退实现载入失败:", err);
    }
  }

  async load(audioUrl: string, kickUrl: string): Promise<void> {
    if (this.disposed) throw new Error("引擎已释放,不能重复 load(应新建实例)");
    this.ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    this.musicGain = this.ctx.createGain();
    this.musicGain.connect(this.ctx.destination);
    this.musicGain.gain.value = this.musicVol;
    this.kickGain = this.ctx.createGain();
    this.kickGain.connect(this.ctx.destination);
    this.kickGain.gain.value = this.kickVol;

    await this.ensureWorklet();
    if (!this.workletReady) await this.loadFallbackShifter(); // worklet 失败 → 备好真回退
    const arr = await (await fetch(audioUrl)).arrayBuffer();
    this.buffer = this.ensureStereo(await this.ctx.decodeAudioData(arr));
    this._duration = this.buffer.duration;
    this.buildShifter();
    void this.loadKick(kickUrl);

    this._ready = true;
    this.cb.onReady();
    this.startFrameLoop();
  }

  private ensureStereo(buf: AudioBuffer): AudioBuffer {
    if (buf.numberOfChannels >= 2) return buf;
    const stereo = this.ctx!.createBuffer(2, buf.length, buf.sampleRate);
    const data = buf.getChannelData(0);
    stereo.copyToChannel(data, 0);
    stereo.copyToChannel(data, 1);
    return stereo;
  }

  private async ensureWorklet(): Promise<void> {
    if (this.workletReady || !this.ctx?.audioWorklet) return;
    try {
      await this.ctx.audioWorklet.addModule("/vendor/soundtouch-worklet.js");
      this.workletReady = true;
    } catch (err) {
      // 常见成因:引擎被 dispose 导致 ctx.close() 打断在途 addModule(AbortError)。
      // 真·回退在 buildShifter 里(动态载入 vendored ScriptProcessor 版 PitchShifter)。
      console.warn("AudioWorklet 加载失败,将回退 ScriptProcessor(慢放可能抽帧):", err);
    }
  }

  private buildShifter(): void {
    if (this.shifter) {
      try {
        this.shifter.disconnect();
      } catch {
        /* not connected */
      }
    }
    this.engineConnected = false;
    // 首选 AudioWorklet(DSP 在音频线程,慢放不抽帧);失败时**真的**回退到 vendored
    // ScriptProcessor 版 PitchShifter —— 有声音(可能抽帧)远胜完全没声音。
    if (this.workletReady) {
      this.shifter = new WorkletPitchShifter(this.ctx!, this.buffer!, () => this.onAudioEnd());
    } else if (this.FallbackShifter) {
      this.shifter = new this.FallbackShifter(this.ctx!, this.buffer!, 4096, () =>
        this.onAudioEnd(),
      );
    } else {
      throw new Error("音频引擎初始化失败:AudioWorklet 与 ScriptProcessor 均不可用");
    }
    this.shifter.pitch = 1;
    this.applySpeed();
    this.applySeek(this._position);
  }

  private applySpeed(): void {
    if (!this.shifter) return;
    // 变调保持:tempo = WSOLA 时间拉伸;rate 恒 1
    this.shifter.tempo = this.speed;
    this.shifter.rate = 1;
  }

  private applySeek(sec: number): void {
    if (!this.shifter || !this._duration) return;
    // 仅令 worklet 跳转到该源位置(percentagePlayed setter);位置读数用 ctx 锚定,不读它。
    this.shifter.percentagePlayed = clamp(sec, 0, this._duration) / this._duration;
  }

  /** 以当前 _position 为锚,绑定到 AudioContext 时钟(播放中位置从此点按倍率外推)。 */
  private reanchor(): void {
    this.anchorPos = this._position;
    this.anchorCtx = this.ctx ? this.ctx.currentTime : 0;
  }

  play(): void {
    if (!this.shifter || !this.ctx) return;
    this.cancelShuttle(true);
    if (this._position >= this._duration - 0.01) {
      this._position = 0;
      this.applySeek(0);
    }
    void this.ctx.resume();
    this.shifter.tempo = this.speed;
    // 起播前强制把 worklet 对齐到引擎位置(setter 自带 clear)——消除暂停期间可能的源位置泄漏
    // (AudioWorkletNode.process() 返回 true,断连期间是否仍被调用取决于实现)。幂等,无副作用。
    this.applySeek(this._position);
    this.shifter.setRunning?.(true); // 开闸
    if (!this.engineConnected) {
      this.shifter.connect(this.musicGain!);
      this.engineConnected = true;
    }
    this.reanchor(); // 从当前 _position + 当前 ctx.currentTime 起算
    this.setPlaying(true);
    this.startKickScheduler();
  }

  pause(): void {
    // 先关闸再断连:仅 disconnect 不会阻止 process() 继续消耗源(实测暂停 3s 前进 3.07s)
    this.shifter?.setRunning?.(false);
    if (this.shifter && this.engineConnected) {
      try {
        this.shifter.disconnect();
      } catch {
        /* already off */
      }
    }
    this.engineConnected = false;
    this.setPlaying(false);
    this.stopKickScheduler();
  }

  toggle(): void {
    if (!this.shifter) return;
    this.auditioning = false;
    this.auditionWithKick = false;
    if (this.shuttle) {
      this.cancelShuttle(true);
      this.play();
      return;
    }
    if (this._playing) this.pause();
    else this.play();
  }

  /**
   * 静音、线性地经过中间谱面时间。连续调用从当前画面位置改向，但逻辑导航基准由
   * getNavigationTime() 保持为上次请求的终点。
   */
  shuttleTo(sec: number): void {
    this.startShuttle(sec, false, false);
  }

  /** 穿梭导航(Q/E、模拟器方向键等)：平滑穿梭，抵达后播放一小段落点音频并保持暂停。若调用时正在播放则立即暂停。默认只播音乐不播kick。 */
  shuttleToAndAudition(sec: number, withKick = false): void {
    this.startShuttle(sec, true, withKick);
  }

  private startShuttle(sec: number, auditionAtEnd: boolean, withKick = false): void {
    const target = clamp(sec, 0, this._duration || 0);
    if (!this.shifter || !this.ctx || !this._duration) {
      if (auditionAtEnd) {
        if (this._playing) this.pause();
        this.audition(target, 0.12, 0.15, withKick);
      } else {
        this.seek(target);
      }
      return;
    }
    if (Math.abs(target - this._position) <= 1e-6) {
      this.cancelShuttle(true);
      if (this._playing) this.pause();
      this._position = target;
      this.applySeek(target);
      this.broadcast();
      if (auditionAtEnd) this.audition(target, 0.12, 0.15, withKick);
      return;
    }

    const shouldResume =
      !auditionAtEnd && ((this._playing && !this.auditioning) || this.resumeAfterShuttle);
    if (this.auditioning) {
      this.auditioning = false;
      this.auditionWithKick = false;
    }
    if (this._playing) this.pause();
    this.resumeAfterShuttle = shouldResume;
    this.auditionAfterShuttle = auditionAtEnd;
    this.auditionWithKickAfterShuttle = withKick;
    this.shuttle = makeShuttle(this._position, target, performance.now());
    this.broadcast();
  }

  private cancelShuttle(applyCurrent: boolean): void {
    if (!this.shuttle) return;
    this.shuttle = null;
    this.resumeAfterShuttle = false;
    this.auditionAfterShuttle = false;
    this.auditionWithKickAfterShuttle = false;
    if (applyCurrent) this.applySeek(this._position);
  }

  seek(sec: number): void {
    // 打断试听必须连同停止"试听引发的播放":否则 auditioning 被清后帧循环里的
    // finishAudition() 永不触发,引擎会一直播下去,播放头持续前漂 —— 表现为按 Q 只退一步
    // 就被前漂拽回原地("空气墙"),而 E 因前漂同向而看似正常。
    // 用户主动播放时 auditioning 为 false,此处不会误暂停(播放中跳转仍续播)。
    if (this.shuttle) this.cancelShuttle(false);
    if (this.auditioning) {
      this.auditioning = false;
      this.auditionWithKick = false;
      this.pause();
    }
    const t = clamp(sec, 0, this._duration || 0);
    this._position = t;
    this.applySeek(t);
    if (this._playing) this.reanchor(); // 播放中跳转 → 从新位置重锚
    this.broadcast();
  }

  setRate(rate: number): void {
    if (this._playing) this.reanchor(); // 变速前先落定当前位置,避免回溯改写已播段
    this.speed = clamp(rate, SPEED_MIN, SPEED_MAX);
    this.applySpeed();
  }

  setMusicVol(v: number): void {
    this.musicVol = clamp(v, 0, 1);
    if (this.musicGain) this.musicGain.gain.value = this.musicVol;
  }

  setKickVol(v: number): void {
    this.kickVol = clamp(v, 0, 1);
    if (this.kickGain) this.kickGain.gain.value = this.kickVol;
  }

  setKickEnabled(on: boolean): void {
    this.kickEnabled = on;
  }

  /** kick 听感微调(毫秒,正=推迟)。 */
  setKickOffsetMs(ms: number): void {
    this.kickOffset = clamp(ms, -200, 200) / 1000;
  }

  /** worklet 自报的源位置(秒)——领先可听输出,仅用于诊断,不用于时钟。 */
  private reportedSourceSec(): number {
    if (!this.shifter || !this._duration) return 0;
    return (this.shifter.percentagePlayed / 100) * this._duration;
  }

  /** 诊断快照:定位 kick 恒定偏差的来源。 */
  diagnostics(): Record<string, unknown> {
    const ctx = this.ctx;
    return {
      playing: this._playing,
      speed: this.speed,
      enginePosition: +this._position.toFixed(4),
      workletReportedPosition: +this.reportedSourceSec().toFixed(4),
      // 正数 = worklet 上报领先引擎(WSOLA 输入缓冲深度,预期 ~0.37s 且稳定)
      reportedMinusEngine: +(this.reportedSourceSec() - this._position).toFixed(4),
      anchorPos: +this.anchorPos.toFixed(4),
      anchorCtx: +this.anchorCtx.toFixed(4),
      kickOffsetMs: Math.round(this.kickOffset * 1000),
      kickSampleOnsetMs: Math.round(this.kickSampleOnset * 1000),
      kickScheduled: this.kickScheduledCount,
      kickClamped: this.kickClamped, // >0 说明有 kick 因排期不足被迫迟到
      baseLatency: ctx?.baseLatency ?? null,
      outputLatency: (ctx as AudioContext & { outputLatency?: number })?.outputLatency ?? null,
      sampleRate: ctx?.sampleRate ?? null,
      ctxState: ctx?.state ?? null,
    };
  }

  /**
   * 断连泄漏测试(**暂停态**运行):worklet 断连期间是否仍在消耗源?
   * deltaSec 明显 > 0 → 泄漏成立(音乐会领先引擎,kick 恒定偏晚)。
   */
  async leakTest(ms = 3000): Promise<Record<string, unknown>> {
    const wasPlaying = this._playing;
    const before = this.reportedSourceSec();
    await new Promise((r) => setTimeout(r, ms));
    const after = this.reportedSourceSec();
    return {
      ranWhilePlaying: wasPlaying,
      waitedMs: ms,
      before: +before.toFixed(4),
      after: +after.toFixed(4),
      deltaSec: +(after - before).toFixed(4),
      verdict: wasPlaying
        ? "请在【暂停】状态下再跑一次"
        : Math.abs(after - before) > 0.01
          ? "泄漏成立:断连期间 worklet 仍在消耗源"
          : "无泄漏:断连期间 worklet 已停止",
    };
  }

  setKickOnsets(times: number[]): void {
    this.kickOnsets = times;
  }

  // ── audition:仅暂停态调用;播放态由上层直接 seek 续播 ──
  audition(center: number, pre = 0.12, post = 0.15, withKick = false): void {
    if (!this.shifter) {
      this.seek(center);
      return;
    }
    center = clamp(center, 0, this._duration || 0);
    this.auditionRestore = center;
    this.auditionTarget = Math.min(this._duration, center + post);
    this.auditioning = true;
    this.auditionWithKick = withKick;
    const realMs = ((pre + post) / Math.max(0.01, this.speed)) * 1000;
    this.auditionDeadline = performance.now() + realMs + 1500;
    const start = Math.max(0, center - pre);
    this._position = start;
    this.applySeek(start);
    this.play();
  }

  private finishAudition(): void {
    const r = this.auditionRestore;
    this.auditioning = false;
    this.auditionWithKick = false;
    this.pause();
    this._position = r;
    this.applySeek(r);
    this.broadcast();
  }

  private onAudioEnd(): void {
    // 仅在播放中才认曲终:暂停期间 worklet 若跑到源尾会误发 end,不能让播放头跳到曲尾
    if (!this._playing) return;
    this._position = this._duration;
    this.pause();
    this.broadcast();
  }

  // ── kick ──
  private async loadKick(url: string): Promise<void> {
    if (!this.ctx) return;
    try {
      const arr = await (await fetch(url)).arrayBuffer();
      this.kickBuffer = await this.ctx.decodeAudioData(arr);
      this.kickSampleOnset = this.computeSampleOnset(this.kickBuffer);
    } catch (err) {
      console.warn("kick 采样加载失败:", err);
    }
  }

  private computeSampleOnset(buffer: AudioBuffer): number {
    const data = buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const a = data[i] < 0 ? -data[i] : data[i];
      if (a > peak) peak = a;
    }
    if (peak <= 0) return 0;
    const thresh = peak * 0.2;
    for (let i = 0; i < data.length; i++) {
      if ((data[i] < 0 ? -data[i] : data[i]) >= thresh) return i / buffer.sampleRate;
    }
    return 0;
  }

  // ── 合成音库 helpers(移植自旧采音器 app.js:226-277,全部经 kickGain 输出) ──
  private noiseBuffer: AudioBuffer | null = null;
  private noiseBuf(): AudioBuffer {
    if (!this.noiseBuffer) {
      const sr = this.ctx!.sampleRate || 44100;
      const len = Math.floor(sr * 0.8);
      this.noiseBuffer = this.ctx!.createBuffer(1, len, sr);
      const d = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuffer;
  }

  private noiseHit(t: number, dur: number, peak: number, ftype?: BiquadFilterType, freq?: number, q?: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (ftype) {
      const f = ctx.createBiquadFilter();
      f.type = ftype;
      f.frequency.value = freq ?? 1000;
      if (q) f.Q.value = q;
      src.connect(f);
      f.connect(g);
    } else src.connect(g);
    g.connect(this.kickGain!);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  private toneHit(t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur * 0.9);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.kickGain!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private distortion(amount: number): WaveShaperNode {
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) curve[i] = Math.tanh((i / 128 - 1) * amount);
    const ws = this.ctx!.createWaveShaper();
    ws.curve = curve;
    return ws;
  }

  /** 采样打点(kick):提前 kickSampleOnset 起播,让瞬态正好落在调度时刻 when。 */
  private playSample(when: number): void {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.kickBuffer!;
    src.connect(this.kickGain!);
    const startAt = when - this.kickSampleOnset;
    if (startAt < this.ctx!.currentTime) this.kickClamped += 1; // 排期不足以容纳前导 → 会迟到
    src.start(Math.max(this.ctx!.currentTime, startAt));
  }

  private playSynth(id: KickSoundId, t: number): void {
    const ctx = this.ctx!;
    switch (id) {
      case "snare":
        this.toneHit(t, "triangle", 330, 180, 0.12, 0.55);
        this.noiseHit(t, 0.14, 1.0, "highpass", 1200);
        break;
      case "rim":
        this.toneHit(t, "square", 1700, 1200, 0.03, 0.95);
        this.noiseHit(t, 0.02, 0.7, "highpass", 3000);
        break;
      case "clap":
        for (const d of [0, 0.011, 0.022]) this.noiseHit(t + d, 0.05, 0.95, "bandpass", 1400, 1.2);
        this.noiseHit(t + 0.028, 0.13, 0.75, "bandpass", 1100, 0.7);
        break;
      case "cowbell":
        this.toneHit(t, "square", 540, 540, 0.28, 0.65);
        this.toneHit(t, "square", 800, 800, 0.28, 0.6);
        break;
      case "zap":
        this.toneHit(t, "sawtooth", 2400, 160, 0.16, 1.0);
        break;
      case "guitar": {
        const dist = this.distortion(12);
        dist.connect(this.kickGain!);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.8, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
        g.connect(dist);
        for (const [f, det] of [[330, -7], [330, 7], [494, 0], [659, 0]]) {
          const o = ctx.createOscillator();
          o.type = "sawtooth";
          o.frequency.value = f;
          o.detune.value = det;
          o.connect(g);
          o.start(t);
          o.stop(t + 0.26);
        }
        break;
      }
      case "beep":
        this.toneHit(t, "square", 2600, 2600, 0.08, 1.0);
        break;
      case "gong": {
        const master = ctx.createGain();
        master.gain.setValueAtTime(0.0001, t);
        master.gain.exponentialRampToValueAtTime(0.95, t + 0.005);
        master.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
        master.connect(this.kickGain!);
        for (const rr of [1, 1.47, 1.83, 2.4, 2.83, 3.46]) {
          const o = ctx.createOscillator();
          o.type = "square";
          o.frequency.value = 210 * rr; // 非谐波分音 → 金属"锣"感
          const g = ctx.createGain();
          g.gain.value = 0.5;
          o.connect(g);
          g.connect(master);
          o.start(t);
          o.stop(t + 0.78);
        }
        this.noiseHit(t, 0.5, 0.6, "highpass", 3000);
        break;
      }
      default:
        this.playSample(t);
    }
  }

  private playKick(when: number): void {
    if (!this.ctx || !this.kickGain || this.kickVol <= 0) return;
    this.kickScheduledCount += 1;
    if (this.kickSound === "kick") {
      if (!this.kickBuffer) return; // 采样未就绪
      this.playSample(when);
    } else {
      this.playSynth(this.kickSound, Math.max(this.ctx.currentTime, when));
    }
  }

  setKickSound(id: KickSoundId): void {
    this.kickSound = id;
  }

  /** 试听一声(切换音色时用)。 */
  previewKick(): void {
    if (!this.ctx || !this.kickGain) return;
    void this.ctx.resume();
    this.playKick(this.ctx.currentTime + 0.03);
  }

  private kickScheduler = (): void => {
    if (!this._playing || !this.ctx) return;
    if (this.auditioning && !this.auditionWithKick) return;
    const pos = this._position;
    if (pos < this.lastSchedPos || pos > this.lastSchedPos + 0.3) this.lastSchedPos = pos;
    const windowEnd = pos + KICK_LOOKAHEAD;
    if (this.kickEnabled && this.kickVol > 0) {
      for (const ts of this.kickOnsets) {
        if (ts > this.lastSchedPos && ts <= windowEnd) {
          // 直接由锚点换算到 ctx 时刻(源位置 → 渲染时刻的精确映射)。
          // 不可用 "ctx.currentTime + (ts − _position)/speed":_position 只在 rAF 里更新,
          // 与当场读的 currentTime 不同刻,会给每个 kick 注入 0–16ms 随机迟到。
          this.playKick(this.anchorCtx + (ts - this.anchorPos) / this.speed + this.kickOffset);
        }
      }
    }
    this.lastSchedPos = Math.max(this.lastSchedPos, windowEnd);
  };

  private startKickScheduler(): void {
    // 从 pos + 采样前导 起算:排期不足以容纳前导的 onset 直接**跳过而不迟放**
    // (宁可少响一下,也不给出错误的节奏参照)。消除起播/试听后首拍被钳位迟到。
    this.lastSchedPos = this._position + this.kickSampleOnset;
    if (this.kickTimerId) clearInterval(this.kickTimerId);
    this.kickTimerId = setInterval(this.kickScheduler, 25);
  }

  private stopKickScheduler(): void {
    if (this.kickTimerId) clearInterval(this.kickTimerId);
    this.kickTimerId = null;
  }

  // ── 帧循环:引擎存活期间持续广播位置(暂停时位置恒定,供画布重绘)──
  private startFrameLoop(): void {
    const frame = () => {
      if (this.disposed) return;
      if (this.shuttle) {
        const sample = sampleShuttle(this.shuttle, performance.now());
        this._position = sample.position;
        if (sample.done) {
          const resume = this.resumeAfterShuttle;
          const auditionAtEnd = this.auditionAfterShuttle;
          const withKick = this.auditionWithKickAfterShuttle;
          this.shuttle = null;
          this.resumeAfterShuttle = false;
          this.auditionAfterShuttle = false;
          this.auditionWithKickAfterShuttle = false;
          this.applySeek(this._position);
          this.broadcast();
          if (auditionAtEnd) this.audition(this._position, 0.12, 0.15, withKick);
          else if (resume) this.play();
        } else {
          this.broadcast();
        }
        this.raf = requestAnimationFrame(frame);
        return;
      }
      if (this._playing && this.ctx) {
        // ctx.currentTime = 可听输出的真实时钟 → 位置不再领先音乐,kick/播放头对齐
        this._position = Math.min(
          this._duration,
          this.anchorPos + (this.ctx.currentTime - this.anchorCtx) * this.speed,
        );
        if (
          this.auditioning &&
          (this._position >= this.auditionTarget || performance.now() > this.auditionDeadline)
        ) {
          this.finishAudition();
          this.raf = requestAnimationFrame(frame);
          return;
        }
        if (this._position >= this._duration - 0.002) {
          this.onAudioEnd();
          this.raf = requestAnimationFrame(frame);
          return;
        }
      }
      this.broadcast();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private broadcast(): void {
    const t = this._position;
    this.subs.forEach((cb) => cb(t));
  }

  private setPlaying(p: boolean): void {
    if (this._playing === p) return;
    this._playing = p;
    this.cb.onPlayingChange(p);
  }

  dispose(): void {
    if (this.disposed) return; // 幂等
    this.disposed = true;
    this.shuttle = null;
    this.resumeAfterShuttle = false;
    this.auditionAfterShuttle = false;
    this.auditionWithKickAfterShuttle = false;
    this.auditioning = false;
    this.auditionWithKick = false;
    cancelAnimationFrame(this.raf);
    this.stopKickScheduler();
    try {
      this.shifter?.disconnect();
    } catch {
      /* ignore */
    }
    void this.ctx?.close();
    this.subs.clear();
  }
}
