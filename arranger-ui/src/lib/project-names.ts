/** Portable Windows/Malody file-name validation shared by UI and server routes. */

const RESERVED = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

export type FileNameResult = { ok: true; name: string } | { ok: false; error: string };

export function normalizeFileName(raw: unknown, extension: ".mc" | ".mcz"): FileNameResult {
  if (typeof raw !== "string") return { ok: false, error: "文件名必须是字符串" };
  const value = raw.normalize("NFC");
  if (!value.trim()) return { ok: false, error: "文件名不能为空" };
  if (value !== value.trimEnd()) return { ok: false, error: "文件名不能以空格结尾" };
  if (value.endsWith(".")) return { ok: false, error: "文件名不能以点结尾" };
  if (/[\\/]/.test(value)) return { ok: false, error: "文件名不能包含路径分隔符" };
  if (/[<>:"|?*\u0000-\u001f]/u.test(value)) {
    return { ok: false, error: "文件名包含 Windows 不允许的字符" };
  }
  const withExt = value.toLowerCase().endsWith(extension) ? value : `${value}${extension}`;
  const stem = withExt.slice(0, -extension.length);
  if (!stem || RESERVED.has(stem.split(".")[0].toUpperCase())) {
    return { ok: false, error: "文件名是 Windows 保留名" };
  }
  if (withExt.length > 240) return { ok: false, error: "文件名过长" };
  return { ok: true, name: withExt };
}

export function validateUniqueChartNames(values: unknown[]):
  | { ok: true; names: string[] }
  | { ok: false; error: string } {
  const names: string[] = [];
  const folded = new Set<string>();
  for (const value of values) {
    const result = normalizeFileName(value, ".mc");
    if (!result.ok) return result;
    const key = result.name.toLocaleLowerCase("en-US");
    if (folded.has(key)) return { ok: false, error: `包内谱面名称重复: ${result.name}` };
    folded.add(key);
    names.push(result.name);
  }
  return { ok: true, names };
}
