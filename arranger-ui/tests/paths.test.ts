import { describe, expect, it } from "vitest";

import { AUDIO_EXTS, COVER_EXTS, pickAsset, projectKey, sha1Hex } from "../src/lib/server/paths";

describe("pickAsset(恰好一个语义)", () => {
  it("one match → name; zero → null; two → throw", () => {
    const names = ["WDA.mp3", "WDA.jpg", "WDA_Recorded.mc"];
    expect(pickAsset(names, AUDIO_EXTS)).toBe("WDA.mp3");
    expect(pickAsset(names, COVER_EXTS)).toBe("WDA.jpg");
    expect(pickAsset(["a.mc", "b.txt"], AUDIO_EXTS)).toBeNull();
    expect(() => pickAsset(["a.mp3", "b.ogg"], AUDIO_EXTS)).toThrow(/ambiguous/);
  });

  it("matches extensions case-insensitively", () => {
    expect(pickAsset(["SONG.MP3"], AUDIO_EXTS)).toBe("SONG.MP3");
    expect(pickAsset(["c.JPEG"], COVER_EXTS)).toBe("c.JPEG");
  });
});

describe("projectKey / sha1Hex", () => {
  it("deterministic 16-hex key", () => {
    const k = projectKey("WDA/WDA_Recorded.mc");
    expect(k).toMatch(/^[0-9a-f]{16}$/);
    expect(projectKey("WDA/WDA_Recorded.mc")).toBe(k);
    expect(projectKey("other")).not.toBe(k);
  });

  it("sha1Hex of known string", () => {
    expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });
});
