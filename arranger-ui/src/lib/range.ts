/** HTTP Range 头解析(音频秒级 seek 所需)。畸形/不可满足 → null(上层回 200 全量)。 */

export interface ByteRange {
  start: number;
  end: number;
}

export function parseRangeHeader(header: string | null, size: number): ByteRange | null {
  if (!header || size <= 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === "" && b === "") return null;
  if (a === "") {
    // 后缀形式 bytes=-N:最后 N 字节
    const n = Number(b);
    if (!Number.isFinite(n) || n <= 0) return null;
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  if (!Number.isFinite(start) || start >= size) return null;
  const end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  if (!Number.isFinite(end) || end < start) return null;
  return { start, end };
}
