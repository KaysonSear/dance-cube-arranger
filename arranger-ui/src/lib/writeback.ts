/**
 * 自动写回源 `.mc` 的纯规则(无 node 依赖,客户端/服务端共用)。
 *
 * 用户明确授权把排键结果实时写回**原文件**(含 `WDA/`),首次覆写前自动备份。
 * 但 `normalizeSrcRel` 允许任意仓库相对 `.mc` 路径,所以写入必须再过一道白名单:
 * **只有 `WDA/` 与 `artifacts/` 可写;`data/corpus/` 永远只读。**
 */

/** 可写根(路径首段,大小写不敏感)。 */
export const WRITABLE_ROOTS = ["wda", "artifacts"] as const;

function normalizeRel(rel: string): string | null {
  if (!rel || typeof rel !== "string") return null;
  if (rel.includes("\\")) return null;
  if (/^[A-Za-z]:/.test(rel)) return null;
  if (rel.startsWith("/")) return null;
  const parts: string[] = [];
  for (const seg of rel.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null; // 越出仓库根
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.length > 0 ? parts.join("/") : null;
}

/** 该仓库相对路径是否允许被写回。 */
export function isWritableRel(rel: string): boolean {
  if (/^managed:[a-f0-9]{16}:[a-f0-9]{12}$/i.test(rel)) return true;
  const norm = normalizeRel(rel);
  if (!norm) return false;
  if (!norm.toLowerCase().endsWith(".mc")) return false;
  const root = norm.split("/")[0].toLowerCase();
  return (WRITABLE_ROOTS as readonly string[]).includes(root);
}

/**
 * 首次覆写前的原件备份路径:`WDA/X.mc` → `WDA/X.mc.orig`。
 * 刻意**不以 `.mc` 结尾** —— 否则备份会被 `normalizeSrcRel`/`MC_EXTS` 当成合法谱面,
 * 让每个工程包里凭空多出一张"影子谱"。
 */
export function backupRelFor(rel: string): string {
  return `${rel}.orig`;
}

/** 写回默认值:按用户决定,`WDA/` 与 `artifacts/` 均默认开启(不可写路径恒为 false)。 */
export function defaultWriteBackFor(rel: string): boolean {
  return isWritableRel(rel);
}

/** `null`/`undefined` = 未决定 → 用路径默认值;显式布尔优先(但不可写路径永远 false)。 */
export function resolveWriteBack(pref: boolean | null | undefined, rel: string): boolean {
  if (!isWritableRel(rel)) return false;
  return pref == null ? defaultWriteBackFor(rel) : pref;
}

/**
 * 写回开启时,`state.json` 的 `sourceSha1` 以**磁盘真值**为准 ——
 * 否则每次写回都会改变文件哈希,重载时误报"源文件已被外部修改"。
 */
export function resolveStoredSha1(
  state: { sourcePath: string; sourceSha1: string; ui?: { writeBackEnabled?: boolean | null } },
  diskSha1: string,
  srcRel: string,
): string {
  if (state.sourcePath !== srcRel) return state.sourceSha1;
  return resolveWriteBack(state.ui?.writeBackEnabled, srcRel) ? diskSha1 : state.sourceSha1;
}
