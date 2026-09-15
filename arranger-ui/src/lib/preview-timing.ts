/** Pure time-domain helpers shared by forward playback, seeking and reverse shuttling. */

export const PREVIEW_TIME_EPS = 1e-6;
export const HOLD_BREATH_PERIOD_SEC = 0.8;

/**
 * Deterministic hold-ribbon breathing driven only by chart time.
 * A hold lands at full intensity, contracts halfway through the cycle,
 * then returns to full intensity at the 0.8s boundary.
 */
export function holdBreathStrength(
  visualSec: number,
  hitSec: number,
  periodSec = HOLD_BREATH_PERIOD_SEC,
): number {
  if (!Number.isFinite(visualSec) || !Number.isFinite(hitSec) || periodSec <= 0) return 1;
  const elapsedSec = Math.max(0, visualSec - hitSec);
  const phase = (elapsedSec % periodSec) / periodSec;
  const strength = (1 + Math.cos(phase * Math.PI * 2)) / 2;
  return Math.max(0, Math.min(1, strength));
}

export function flightProgress(
  hitSec: number,
  visualSec: number,
  leadInSec: number,
): number | null {
  if (!Number.isFinite(hitSec) || !Number.isFinite(visualSec) || leadInSec <= 0) return null;
  const dt = hitSec - visualSec;
  if (dt < -PREVIEW_TIME_EPS || dt > leadInSec + PREVIEW_TIME_EPS) return null;
  if (dt <= PREVIEW_TIME_EPS) return 1;
  if (dt >= leadInSec - PREVIEW_TIME_EPS) return 0;
  return Math.max(0, Math.min(1, 1 - dt / leadInSec));
}

export function visibleFlightFrame<T extends { id: string; hitSec: number }>(
  notes: readonly T[],
  visualSec: number,
  leadInSec: number,
): Array<{ id: string; progress: number }> {
  const frame: Array<{ id: string; progress: number }> = [];
  for (const note of notes) {
    const progress = flightProgress(note.hitSec, visualSec, leadInSec);
    if (progress !== null) frame.push({ id: note.id, progress });
  }
  return frame;
}
