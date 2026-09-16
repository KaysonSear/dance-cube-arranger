function extractHostName(raw: string): string {
  const str = raw.trim().toLowerCase();
  if (str.startsWith("[")) {
    const end = str.indexOf("]");
    if (end !== -1) {
      return str.slice(1, end);
    }
  }
  const colonCount = (str.match(/:/g) || []).length;
  if (colonCount > 1) {
    return str;
  }
  if (colonCount === 1) {
    return str.split(":")[0];
  }
  return str;
}

/**
 * 校验请求主机名是否为环回地址、本机或私有局域网地址。
 */
export function isSafeLocalHost(rawHost: string | null | undefined): boolean {
  if (!rawHost) return false;
  const clean = extractHostName(rawHost);
  if (!clean) return false;

  // 基础环回与通用本地主机名
  if (clean === "localhost" || clean === "0.0.0.0" || clean === "::" || clean === "::1") {
    return true;
  }
  if (clean.endsWith(".local") || clean.endsWith(".localhost")) {
    return true;
  }
  // 单段本地计算机名 (Windows/Linux NetBIOS 主机名，不包含点号)
  if (!clean.includes(".")) {
    return true;
  }

  // 127.0.0.0/8 完整环回网段
  if (/^127(?:\.\d{1,3}){3}$/.test(clean)) {
    return true;
  }
  // IPv4-mapped IPv6 环回与私有地址 (Node/Windows 双栈常见)
  if (/^::ffff:127(?:\.\d{1,3}){3}$/.test(clean)) {
    return true;
  }
  if (/^::ffff:(?:10|172|192)\./.test(clean)) {
    return true;
  }

  // RFC 1918 局域网私有网段与本地链路
  if (/^10(?:\.\d{1,3}){3}$/.test(clean)) return true;
  if (/^192\.168(?:\.\d{1,3}){2}$/.test(clean)) return true;
  if (/^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(clean)) return true;
  if (/^169\.254(?:\.\d{1,3}){2}$/.test(clean)) return true;

  // IPv6 本地链路与唯一本地地址
  if (clean.startsWith("fe80:") || clean.startsWith("fc00:") || clean.startsWith("fd00:")) {
    return true;
  }

  return false;
}

/**
 * 校验当前 HTTP 请求是否为合法的本机/本地受信请求。
 * 防范恶意外部公网网站通过 CSRF 发起跨站调用。
 */
export function isLocalRequest(req: Request): boolean {
  const secFetchSite = req.headers.get("sec-fetch-site")?.trim().toLowerCase();
  // 现代浏览器标准防御：同源交互受浏览器内核底层保护，外部恶意网站绝对无法伪造 same-origin
  if (secFetchSite === "same-origin" || secFetchSite === "none") {
    return true;
  }

  // 若明确为跨站请求 (cross-site)，严格校验 Origin 与 Referer 绝不允许公网来源
  if (secFetchSite === "cross-site") {
    return false;
  }

  // 检查请求目标 Host / URL
  let targetHost = "";
  try {
    const url = new URL(req.url);
    targetHost = url.hostname;
  } catch {
    // 忽略
  }
  const headerHost = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  if (!isSafeLocalHost(targetHost) && !isSafeLocalHost(headerHost)) {
    return false;
  }

  // 检查 Origin（如果存在且非 "null"）
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") {
    try {
      const originHost = new URL(origin).hostname;
      if (!isSafeLocalHost(originHost)) return false;
    } catch {
      return false;
    }
  }

  // 检查 Referer（如果存在）
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const refererHost = new URL(referer).hostname;
      if (!isSafeLocalHost(refererHost)) return false;
    } catch {
      return false;
    }
  }

  return true;
}
