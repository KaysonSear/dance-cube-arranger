export function isLocalRequest(req: Request): boolean {
  const url = new URL(req.url);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) return false;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const originHost = new URL(origin).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return ["localhost", "127.0.0.1", "::1"].includes(originHost);
  } catch {
    return false;
  }
}
