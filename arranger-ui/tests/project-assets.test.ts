import { describe, expect, it } from "vitest";

import { hasAssetSignature } from "../src/lib/server/project-assets";

describe("project asset signatures", () => {
  it("recognizes supported image signatures", () => {
    expect(hasAssetSignature("cover", ".jpg", Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe(true);
    expect(hasAssetSignature("cover", ".png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
    expect(hasAssetSignature("cover", ".png", Buffer.from("not png"))).toBe(false);
  });

  it("recognizes supported audio signatures", () => {
    expect(hasAssetSignature("audio", ".mp3", Buffer.from("ID3data"))).toBe(true);
    expect(hasAssetSignature("audio", ".ogg", Buffer.from("OggSdata"))).toBe(true);
    expect(hasAssetSignature("audio", ".wav", Buffer.from("RIFF0000WAVEdata"))).toBe(true);
    expect(hasAssetSignature("audio", ".mp3", Buffer.from("nope"))).toBe(false);
  });
});
