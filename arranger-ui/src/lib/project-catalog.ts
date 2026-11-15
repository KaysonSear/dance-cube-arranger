import type { ProjectPackage } from "./projects";

export const PROJECT_LOAD_TIMEOUT_MS = 10_000;

export type ProjectLoadStage = "resume" | "catalog" | "geometry" | "chart" | "state" | "suggestions" | "save-dialog" | "update";
export type ProjectLoadCode =
  | "REQUEST_TIMEOUT"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE"
  | "WDA_IMPORT_FAILED";

export type ProjectLoadIssue = {
  stage: ProjectLoadStage;
  code: ProjectLoadCode;
  status: number | null;
  elapsedMs: number;
  diagnosticId?: string;
  detailCode?: string;
};

type CatalogData = {
  packages: ProjectPackage[];
  lastOpenedSrc: string | null;
};

type CatalogResult =
  | { status: "cancelled" }
  | { status: "failed"; issue: ProjectLoadIssue }
  | { status: "loaded"; data: CatalogData; warning?: ProjectLoadIssue };

function hasProjectRows(value: unknown): value is ProjectPackage[] {
  return Array.isArray(value) && value.every((project: ProjectPackage | null) =>
    project && typeof project.dir === "string" && typeof project.title === "string" &&
    Array.isArray(project.charts) && project.charts.every((chart) =>
      chart && typeof chart.src === "string" && typeof chart.title === "string"
    )
  );
}

export async function loadProjectCatalog(
  stage: "resume" | "catalog",
  signal: AbortSignal,
): Promise<CatalogResult> {
  const started = performance.now();
  const request = new AbortController();
  const cancel = () => request.abort();
  signal.addEventListener("abort", cancel, { once: true });
  let timedOut = false;
  let status: number | null = null;
  let diagnosticId: string | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    request.abort();
  }, PROJECT_LOAD_TIMEOUT_MS);
  const issue = (code: ProjectLoadCode): ProjectLoadIssue => ({
    stage,
    code,
    status,
    diagnosticId,
    elapsedMs: Math.round(performance.now() - started),
  });
  const failed = (code: ProjectLoadCode): CatalogResult => ({ status: "failed", issue: issue(code) });

  try {
    if (signal.aborted) return { status: "cancelled" };
    const url = stage === "catalog" ? "/api/projects?includeHidden=1" : "/api/projects";
    const response = await fetch(url, { signal: request.signal });
    if (signal.aborted) return { status: "cancelled" };
    status = response.status;
    diagnosticId = response.headers?.get("X-Arranger-Diagnostic-Id") ?? undefined;
    if (!response.ok) return failed("HTTP_ERROR");

    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      if (request.signal.aborted) throw error;
      return failed("INVALID_RESPONSE");
    }
    if (signal.aborted) return { status: "cancelled" };
    if (!data || typeof data !== "object") return failed("INVALID_RESPONSE");

    const { packages, lastOpenedSrc, startupWarning } = data as Partial<CatalogData> & {
      startupWarning?: unknown;
    };
    if (
      !hasProjectRows(packages) ||
      (lastOpenedSrc !== null && (typeof lastOpenedSrc !== "string" || !lastOpenedSrc.trim()))
    ) {
      return failed("INVALID_RESPONSE");
    }
    return {
      status: "loaded",
      data: { packages, lastOpenedSrc },
      warning: startupWarning === "WDA_IMPORT_FAILED" ? issue(startupWarning) : undefined,
    };
  } catch {
    if (signal.aborted) return { status: "cancelled" };
    return failed(timedOut ? "REQUEST_TIMEOUT" : "NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
