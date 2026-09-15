/** 显示格式化小工具(纯展示,无业务语义)。 */

export function fmtTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, "0")}:${rest.toFixed(3).padStart(6, "0")}`;
}

export function fmtBeatFloat(beatFloat: number): string {
  const bar = Math.floor(beatFloat / 4) + 1;
  const inBar = beatFloat - (bar - 1) * 4;
  return `${bar}小节 ${(inBar + 1).toFixed(2)}拍`;
}
