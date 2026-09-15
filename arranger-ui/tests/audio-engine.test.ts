import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AudioEngine } from "../src/lib/audio-engine";

describe("AudioEngine audition kick suppression", () => {
  let originalWindow: unknown;
  let originalFetch: unknown;
  let originalRaf: unknown;
  let originalCaf: unknown;

  beforeEach(() => {
    originalWindow = (globalThis as unknown as { window?: unknown }).window;
    originalFetch = globalThis.fetch;
    originalRaf = globalThis.requestAnimationFrame;
    originalCaf = globalThis.cancelAnimationFrame;

    class FakeAudioBuffer {
      numberOfChannels = 2;
      length = 44100 * 10;
      sampleRate = 44100;
      duration = 10;
      getChannelData() {
        return new Float32Array(this.length);
      }
      copyToChannel() {}
    }

    class FakeAudioNode {
      connect() {}
      disconnect() {}
    }

    class FakeAudioWorkletNode extends FakeAudioNode {
      port = {
        postMessage: () => {},
        onmessage: null as ((ev: unknown) => void) | null,
      };
    }

    class FakeGainNode extends FakeAudioNode {
      gain = {
        value: 1,
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      };
    }

    class FakeAudioBufferSourceNode extends FakeAudioNode {
      buffer: FakeAudioBuffer | null = null;
      start() {}
      stop() {}
    }

    class FakeAudioContext {
      currentTime = 0;
      destination = new FakeAudioNode();
      sampleRate = 44100;
      state = "running";
      audioWorklet = {
        addModule: async () => {},
      };
      createGain() {
        return new FakeGainNode();
      }
      createBuffer(channels: number, length: number, sampleRate: number) {
        const buf = new FakeAudioBuffer();
        buf.numberOfChannels = channels;
        buf.length = length;
        buf.sampleRate = sampleRate;
        buf.duration = length / sampleRate;
        return buf;
      }
      createBufferSource() {
        return new FakeAudioBufferSourceNode();
      }
      decodeAudioData() {
        return Promise.resolve(new FakeAudioBuffer());
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
    }

    (globalThis as unknown as { window: unknown }).window = {
      AudioContext: FakeAudioContext,
    };
    (globalThis as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = FakeAudioWorkletNode;
    globalThis.fetch = vi.fn().mockResolvedValue({
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
    }) as unknown as typeof fetch;
    globalThis.requestAnimationFrame = vi.fn().mockReturnValue(1);
    globalThis.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = originalWindow;
    globalThis.fetch = originalFetch as typeof fetch;
    globalThis.requestAnimationFrame = originalRaf as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCaf as typeof cancelAnimationFrame;
    delete (globalThis as unknown as { AudioWorkletNode?: unknown }).AudioWorkletNode;
  });

  it("suppresses kick drum during audition when withKick=false (e.g. Q/E navigation)", async () => {
    vi.useFakeTimers();
    try {
      const engine = new AudioEngine({
        onPlayingChange: () => {},
        onReady: () => {},
      });

      await engine.load("/test.mp3", "/kick.mp3");
      engine.setKickOnsets([0.1, 0.5, 1.0]);
      engine.setKickEnabled(true);
      engine.setKickVol(1.0);

      // Audition at 0.5s with withKick = false (default)
      engine.audition(0.5, 0.12, 0.15, false);

      // Advance timer for interval kickScheduler (every 25ms)
      vi.advanceTimersByTime(100);

      // During audition without kick, no kicks should be scheduled
      const diagDuringAudition = engine.diagnostics();
      expect(diagDuringAudition.kickScheduled).toBe(0);

      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("schedules kick drum normally during standard playback", async () => {
    vi.useFakeTimers();
    try {
      const engine = new AudioEngine({
        onPlayingChange: () => {},
        onReady: () => {},
      });

      await engine.load("/test.mp3", "/kick.mp3");
      // Set an onset within lookahead of start position (0.05s)
      engine.setKickOnsets([0.05, 0.5, 1.0]);
      engine.setKickEnabled(true);
      engine.setKickVol(1.0);

      // Standard play()
      engine.play();

      // Advance timer for kickScheduler
      vi.advanceTimersByTime(50);

      // In standard playback, kick should be scheduled
      const diag = engine.diagnostics();
      expect(diag.kickScheduled).toBeGreaterThan(0);

      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shuttleToAndAudition defaults to withKick=false", async () => {
    vi.useFakeTimers();
    try {
      const engine = new AudioEngine({
        onPlayingChange: () => {},
        onReady: () => {},
      });

      await engine.load("/test.mp3", "/kick.mp3");
      engine.setKickOnsets([1.0]);
      engine.setKickEnabled(true);
      engine.setKickVol(1.0);

      // shuttleToAndAudition to 1.0s (default withKick = false)
      // When target is current position or arrival happens, it triggers audition(target, 0.12, 0.15, false)
      engine.seek(1.0);
      engine.shuttleToAndAudition(1.0);

      vi.advanceTimersByTime(100);

      const diag = engine.diagnostics();
      expect(diag.kickScheduled).toBe(0);

      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
