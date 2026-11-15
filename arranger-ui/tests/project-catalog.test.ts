import { afterEach, describe, expect, it, vi } from "vitest";

import { loadProjectCatalog, PROJECT_LOAD_TIMEOUT_MS } from "../src/lib/project-catalog";

function pendingFetch(_url: string, { signal }: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("loadProjectCatalog", () => {
  it("aborts a pending startup request after ten seconds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(pendingFetch);
    vi.stubGlobal("fetch", fetchMock);
    const result = loadProjectCatalog("resume", new AbortController().signal);

    await vi.advanceTimersByTimeAsync(PROJECT_LOAD_TIMEOUT_MS);

    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(await result).toMatchObject({
      status: "failed",
      issue: { stage: "resume", code: "REQUEST_TIMEOUT", status: null },
    });
  });

  it("also cancels a stalled response body after headers arrived", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", async (_url: string, options: RequestInit) => ({
      ok: true,
      status: 200,
      json: () => pendingFetch(_url, options),
    }));
    const result = loadProjectCatalog("catalog", new AbortController().signal);

    await vi.advanceTimersByTimeAsync(PROJECT_LOAD_TIMEOUT_MS);

    expect(await result).toMatchObject({
      status: "failed",
      issue: { stage: "catalog", code: "REQUEST_TIMEOUT", status: 200 },
    });
  });

  it("ignores a response that arrives after the user skips recovery", async () => {
    let respond!: (response: Response) => void;
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => { respond = resolve; }));
    const controller = new AbortController();
    const result = loadProjectCatalog("resume", controller.signal);
    controller.abort();
    respond(Response.json({ packages: [], lastOpenedSrc: "managed:old:chart" }));

    expect(await result).toEqual({ status: "cancelled" });
  });

  it.each([
    { response: () => new Response("server error", { status: 500 }), code: "HTTP_ERROR", status: 500 },
    { response: () => new Response("<html>"), code: "INVALID_RESPONSE", status: 200 },
    { response: () => Response.json({ packages: [], lastOpenedSrc: 123 }), code: "INVALID_RESPONSE", status: 200 },
    { response: () => Response.json({ packages: [null], lastOpenedSrc: null }), code: "INVALID_RESPONSE", status: 200 },
  ])("reports $code for invalid or unsuccessful replies", async ({ response, code, status }) => {
    vi.stubGlobal("fetch", async () => response());

    expect(await loadProjectCatalog("catalog", new AbortController().signal)).toMatchObject({
      status: "failed",
      issue: { stage: "catalog", code, status },
    });
  });

  it("preserves the catalog and reports a failed WDA import", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      packages: [{ dir: "existing", title: "Existing", charts: [] }],
      lastOpenedSrc: null,
      startupWarning: "WDA_IMPORT_FAILED",
    }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await loadProjectCatalog("catalog", new AbortController().signal)).toMatchObject({
      status: "loaded",
      data: { packages: [{ dir: "existing", title: "Existing", charts: [] }], lastOpenedSrc: null },
      warning: { stage: "catalog", code: "WDA_IMPORT_FAILED", status: 200 },
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/projects?includeHidden=1", expect.any(Object));
  });
});
