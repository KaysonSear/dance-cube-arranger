import { afterEach, describe, expect, it, vi } from "vitest";
import { requestProjectData } from "../src/lib/project-request";

afterEach(() => vi.unstubAllGlobals());

describe("project request diagnostics", () => {
  it("identifies a failed saved-state read and retains the server log ID", async () => {
    vi.stubGlobal("fetch", async () => Response.json(
      { error: "Saved state unavailable", code: "STATE_READ_FAILED" },
      { status: 500, headers: { "X-Arranger-Diagnostic-Id": "fixture-log-id" } },
    ));
    await expect(requestProjectData("state", "/api/state", new AbortController().signal,
      (response) => response.json())).rejects.toMatchObject({
      issue: { stage: "state", status: 500, detailCode: "STATE_READ_FAILED", diagnosticId: "fixture-log-id" },
    });
  });

  it("reports invalid chart data instead of a network error", async () => {
    vi.stubGlobal("fetch", async () => new Response("{"));
    await expect(requestProjectData("chart", "/api/chart", new AbortController().signal,
      (response) => response.json())).rejects.toMatchObject({
      issue: { stage: "chart", status: 200, code: "INVALID_RESPONSE" },
    });
  });

  it("reports the requested stage when the response body stalls", async () => {
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => Promise.resolve({
      ok: true, status: 200, headers: new Headers(),
      json: () => new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
    }));
    await expect(requestProjectData("geometry", "/api/geometry", new AbortController().signal,
      (response) => response.json(), { timeoutMs: 8 })).rejects.toMatchObject({
      issue: { stage: "geometry", status: 200, code: "REQUEST_TIMEOUT" },
    });
  });

  it("discards a late result after cancellation", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", async () => {
      controller.abort();
      return Response.json({ old: true });
    });
    await expect(requestProjectData("chart", "/api/chart", controller.signal,
      (response) => response.json())).rejects.toMatchObject({ name: "AbortError" });
  });
});
