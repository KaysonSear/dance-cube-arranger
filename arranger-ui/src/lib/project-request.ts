import { PROJECT_LOAD_TIMEOUT_MS, type ProjectLoadIssue, type ProjectLoadStage } from "./project-catalog";

export class ProjectRequestError extends Error {
  constructor(readonly issue: ProjectLoadIssue, readonly reason?: string) {
    super(reason ?? issue.code);
  }
}

export async function requestProjectData<T>(
  stage: ProjectLoadStage,
  url: string,
  signal: AbortSignal,
  parse: (response: Response) => Promise<T>,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = PROJECT_LOAD_TIMEOUT_MS, ...init } = options;
  const deadline = AbortSignal.timeout(timeoutMs);
  const started = performance.now();
  let status: number | null = null;
  let diagnosticId: string | undefined;
  function failure(code: ProjectLoadIssue["code"], reason?: string) {
    return new ProjectRequestError({
      stage, code, status, diagnosticId, elapsedMs: Math.round(performance.now() - started),
    }, reason);
  }
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.any([signal, deadline]) });
    status = response.status;
    diagnosticId = response.headers.get("X-Arranger-Diagnostic-Id") ?? undefined;
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { error?: unknown; code?: unknown } | null;
      deadline.throwIfAborted();
      const issue = failure("HTTP_ERROR", typeof error?.error === "string" ? error.error : undefined);
      if (typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{0,60}$/.test(error.code)) {
        issue.issue.detailCode = error.code;
      }
      throw issue;
    }
    try {
      const value = await parse(response);
      signal.throwIfAborted();
      deadline.throwIfAborted();
      return value;
    } catch {
      if (signal.aborted || deadline.aborted) throw failure("REQUEST_TIMEOUT");
      throw failure("INVALID_RESPONSE");
    }
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof ProjectRequestError) throw error;
    throw failure(deadline.aborted ? "REQUEST_TIMEOUT" : "NETWORK_ERROR");
  }
}
