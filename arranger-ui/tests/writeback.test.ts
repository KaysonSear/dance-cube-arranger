import { describe, expect, it } from "vitest";

import { normalizeSrcRel } from "../src/lib/server/paths";
import {
  backupRelFor,
  defaultWriteBackFor,
  isWritableRel,
  resolveStoredSha1,
  resolveWriteBack,
} from "../src/lib/writeback";

describe("isWritableRel(写回白名单)", () => {
  it("允许 WDA/ 与 artifacts/", () => {
    expect(isWritableRel("WDA/WDA_Recorded.mc")).toBe(true);
    expect(isWritableRel("artifacts/arranger/imports/x/y.mc")).toBe(true);
    expect(isWritableRel("wda/x.mc")).toBe(true); // 根名大小写不敏感
  });

  it("data/corpus 与其它一律只读", () => {
    expect(isWritableRel("data/corpus/charts/10083_135114.mc")).toBe(false);
    expect(isWritableRel("src/x.mc")).toBe(false);
    expect(isWritableRel("scripts/x.mc")).toBe(false);
  });

  it("拒绝越界/绝对/盘符/反斜杠/非 .mc/空", () => {
    expect(isWritableRel("WDA/../data/corpus/x.mc")).toBe(false);
    expect(isWritableRel("../x.mc")).toBe(false);
    expect(isWritableRel("/etc/passwd.mc")).toBe(false);
    expect(isWritableRel("C:/x.mc")).toBe(false);
    expect(isWritableRel("WDA\\x.mc")).toBe(false);
    expect(isWritableRel("WDA/x.mp3")).toBe(false);
    expect(isWritableRel("")).toBe(false);
  });
});

describe("backupRelFor(首次覆写前的原件备份)", () => {
  it("追加 .orig,且**不以 .mc 结尾**(否则会变成包里的影子谱)", () => {
    const backup = backupRelFor("WDA/WDA_Recorded.mc");
    expect(backup).toBe("WDA/WDA_Recorded.mc.orig");
    expect(normalizeSrcRel(backup).ok).toBe(false); // 不会被当成合法谱面
    expect(isWritableRel(backup)).toBe(false);
  });
});

describe("resolveWriteBack / defaultWriteBackFor", () => {
  it("可写路径默认开启,不可写路径恒关", () => {
    expect(defaultWriteBackFor("WDA/WDA_Recorded.mc")).toBe(true);
    expect(defaultWriteBackFor("artifacts/arranger/imports/x/y.mc")).toBe(true);
    expect(defaultWriteBackFor("data/corpus/x.mc")).toBe(false);
  });

  it("显式偏好优先,但不可写路径永远 false", () => {
    expect(resolveWriteBack(null, "WDA/x.mc")).toBe(true);
    expect(resolveWriteBack(false, "WDA/x.mc")).toBe(false);
    expect(resolveWriteBack(true, "data/corpus/x.mc")).toBe(false);
  });
});

describe("resolveStoredSha1(写回后不得误报「源已变更」)", () => {
  const src = "WDA/WDA_Recorded.mc";

  it("写回开启 → 采用磁盘哈希", () => {
    const st = { sourcePath: src, sourceSha1: "old", ui: { writeBackEnabled: true } };
    expect(resolveStoredSha1(st, "fresh", src)).toBe("fresh");
  });

  it("写回关闭 → 保留客户端哈希", () => {
    const st = { sourcePath: src, sourceSha1: "old", ui: { writeBackEnabled: false } };
    expect(resolveStoredSha1(st, "fresh", src)).toBe("old");
  });

  it("路径不匹配 → 保留客户端哈希", () => {
    const st = { sourcePath: "other/x.mc", sourceSha1: "old", ui: { writeBackEnabled: true } };
    expect(resolveStoredSha1(st, "fresh", src)).toBe("old");
  });
});
