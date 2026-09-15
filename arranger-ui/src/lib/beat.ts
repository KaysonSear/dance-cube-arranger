/**
 * Malody beat 三元组 [A, B, C] = A + B/C(C 为细分分母,恒 4/4 拍号)。
 * 移植自仓库 src/common/beat.py:beat_to_float / float_to_beat(含进位规则)。
 */

export type Beat = [number, number, number];

export class BeatError extends Error {}

function isNonNegInt(x: unknown): x is number {
  return Number.isInteger(x) && (x as number) >= 0;
}

/** 校验并返回 beat 三元组;非法结构抛 BeatError。 */
export function validateBeat(b: unknown): Beat {
  if (!Array.isArray(b) || b.length !== 3) {
    throw new BeatError(`invalid beat tuple: ${JSON.stringify(b)}`);
  }
  const [a, n, d] = b as [unknown, unknown, unknown];
  if (!isNonNegInt(a) || !isNonNegInt(n) || !Number.isInteger(d)) {
    throw new BeatError(`beat parts must be non-negative integers: ${JSON.stringify(b)}`);
  }
  if ((d as number) <= 0) {
    throw new BeatError(`beat denominator must be > 0: ${JSON.stringify(b)}`);
  }
  return [a, n, d as number];
}

export function beatToFloat(b: Beat): number {
  const [a, n, d] = validateBeat(b);
  return a + n / d;
}

/** 浮点拍 → [A,B,C](四舍五入到 1/denom 网格;分子进位,如 0.99999@4 → [1,0,4])。 */
export function floatToBeat(x: number, denom: number): Beat {
  if (!Number.isInteger(denom) || denom <= 0) {
    throw new BeatError(`denominator must be a positive integer: ${denom}`);
  }
  if (!Number.isFinite(x) || x < 0) {
    throw new BeatError(`beat float must be finite and >= 0: ${x}`);
  }
  const numer = Math.round(x * denom);
  const whole = Math.floor(numer / denom);
  return [whole, numer - whole * denom, denom];
}

export function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x || 1;
}

/**
 * 同一时刻的规范 id:gcd 约分 + 假分数进位,故 [1,2,4]、[1,1,2]、[0,6,4] 同 id "1+1/2"。
 * 用作 Onset 分组键(精确有理数,避免浮点分组误差)。
 */
export function tickId(b: Beat): string {
  const [a, n, d] = validateBeat(b);
  if (n === 0) return String(a);
  const g = gcd(n, d);
  const nn = n / g;
  const dd = d / g;
  const carry = Math.floor(nn / dd);
  const rn = nn - carry * dd;
  const wa = a + carry;
  return rn === 0 ? String(wa) : `${wa}+${rn}/${dd}`;
}

export function beatCompare(a: Beat, b: Beat): number {
  return beatToFloat(a) - beatToFloat(b);
}
