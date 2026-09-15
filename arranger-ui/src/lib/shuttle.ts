const SHUTTLE_RATE = 8;
const SHUTTLE_MIN_MS = 120;
const SHUTTLE_MAX_MS = 350;

export interface ShuttlePlan {
  from: number;
  target: number;
  startedAtMs: number;
  durationMs: number;
}

export function shuttleDurationMs(from: number, target: number): number {
  const raw = (Math.abs(target - from) / SHUTTLE_RATE) * 1000;
  return Math.min(SHUTTLE_MAX_MS, Math.max(SHUTTLE_MIN_MS, raw));
}

export function makeShuttle(from: number, target: number, startedAtMs: number): ShuttlePlan {
  return { from, target, startedAtMs, durationMs: shuttleDurationMs(from, target) };
}

export function sampleShuttle(
  plan: ShuttlePlan,
  nowMs: number,
): { position: number; done: boolean } {
  const progress = Math.max(0, Math.min(1, (nowMs - plan.startedAtMs) / plan.durationMs));
  return {
    position: plan.from + (plan.target - plan.from) * progress,
    done: progress >= 1,
  };
}

export function navigationTime(current: number, plan: ShuttlePlan | null): number {
  return plan?.target ?? current;
}
