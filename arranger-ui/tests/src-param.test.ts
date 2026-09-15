import { describe, expect, it } from "vitest";

import { normalizeSrcRel } from "../src/lib/server/paths";

describe("normalizeSrcRel(?src 参数校验)", () => {
  it("accepts repo-relative .mc paths and normalizes ./", () => {
    expect(normalizeSrcRel("WDA/WDA_Recorded.mc")).toEqual({
      ok: true,
      rel: "WDA/WDA_Recorded.mc",
    });
    expect(normalizeSrcRel("artifacts/arranger/imports/foo-0723/song.mc")).toEqual({
      ok: true,
      rel: "artifacts/arranger/imports/foo-0723/song.mc",
    });
    expect(normalizeSrcRel("./WDA/WDA_Recorded.mc")).toEqual({
      ok: true,
      rel: "WDA/WDA_Recorded.mc",
    });
    expect(normalizeSrcRel("WDA/x.MC")).toEqual({ ok: true, rel: "WDA/x.MC" }); // 大小写扩展名放行
  });

  it("rejects traversal, absolute, drive letters, backslashes", () => {
    expect(normalizeSrcRel("../secrets.mc").ok).toBe(false);
    expect(normalizeSrcRel("a/../../x.mc").ok).toBe(false);
    expect(normalizeSrcRel("/etc/passwd.mc").ok).toBe(false);
    expect(normalizeSrcRel("C:/x.mc").ok).toBe(false);
    expect(normalizeSrcRel("WDA\\WDA_Recorded.mc").ok).toBe(false);
  });

  it("rejects non-.mc and empty", () => {
    expect(normalizeSrcRel("WDA/WDA.mp3").ok).toBe(false);
    expect(normalizeSrcRel("").ok).toBe(false);
  });
});
