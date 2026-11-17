import { describe, expect, it } from "vitest";

import {
  applyClipRoles,
  canReassignTo,
  canUpdateRelationKind,
  clearClipSemanticsAndRelations,
  ensureRelation,
  formatAllRelationsText,
  getUpgradeLevel,
  mergeClips,
  reassignRelationGroup,
  removeClip,
  relationBadge,
  relationIndexesForSegment,
  swapUpgradeLevel,
  unlinkSegmentFromRelation,
  updateRelationKind,
  type SegmentClipV2,
  type SegmentStructureV3,
} from "../src/lib/segments";
import { relationGroupCardBg, relationGroupColor } from "../src/lib/theme";

function makeStructure(clips: SegmentClipV2[], relations: SegmentStructureV3["relations"] = []): SegmentStructureV3 {
  return {
    schema: 3,
    initialized: true,
    source: "manual",
    clips,
    relations,
  };
}

const c = (id: string, startSec: number, endSec: number, role?: SegmentClipV2["role"]): SegmentClipV2 => ({
  id,
  startSec,
  endSec,
  label: "",
  role,
});

describe("Segment Semantics & Relations", () => {
  describe("Intro constraint (strictly 1 per chart)", () => {
    it("marks single clip as intro", () => {
      const s = makeStructure([c("c1", 0, 10), c("c2", 10, 20)]);
      const res = applyClipRoles(s, ["c1"], "intro");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.structure.clips[0].role).toBe("intro");
        expect(res.structure.clips[1].role).toBeUndefined();
      }
    });

    it("rejects multi-selection for intro", () => {
      const s = makeStructure([c("c1", 0, 10), c("c2", 10, 20)]);
      const res = applyClipRoles(s, ["c1", "c2"], "intro");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("单张谱面仅限一个 Intro");
      }
    });

    it("transfers intro to new clip and clears previous intro", () => {
      const s = makeStructure([c("c1", 0, 10, "intro"), c("c2", 10, 20)]);
      const res = applyClipRoles(s, ["c2"], "intro");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.structure.clips[0].role).toBeUndefined();
        expect(res.structure.clips[1].role).toBe("intro");
      }
    });

    it("toggles off intro when marked again on the same clip", () => {
      const s = makeStructure([c("c1", 0, 10, "intro"), c("c2", 10, 20)]);
      const res = applyClipRoles(s, ["c1"], "intro");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.structure.clips[0].role).toBeUndefined();
      }
    });
  });

  describe("Outro constraint (strictly 1 per chart)", () => {
    it("marks single clip as outro", () => {
      const s = makeStructure([c("c1", 0, 10), c("c2", 10, 20)]);
      const res = applyClipRoles(s, ["c2"], "outro");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.structure.clips[0].role).toBeUndefined();
        expect(res.structure.clips[1].role).toBe("outro");
      }
    });

    it("rejects multi-selection for outro", () => {
      const s = makeStructure([c("c1", 0, 10), c("c2", 10, 20)]);
      const res = applyClipRoles(s, ["c1", "c2"], "outro");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("单张谱面仅限一个 Outro");
      }
    });

    it("transfers outro to new clip and clears previous outro", () => {
      const s = makeStructure([c("c1", 0, 10), c("c2", 10, 20, "outro")]);
      const res = applyClipRoles(s, ["c1"], "outro");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.structure.clips[0].role).toBe("outro");
        expect(res.structure.clips[1].role).toBeUndefined();
      }
    });
  });

  describe("Drop, Build-Up & Break (multiple allowed across chart)", () => {
    it("allows multiple clips to be marked as drop", () => {
      const s = makeStructure([c("c1", 0, 10), c("c2", 10, 20), c("c3", 20, 30)]);
      const res = applyClipRoles(s, ["c1", "c3"], "drop");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.structure.clips[0].role).toBe("drop");
        expect(res.structure.clips[1].role).toBeUndefined();
        expect(res.structure.clips[2].role).toBe("drop");
      }
    });

    it("allows multiple clips to be marked as buildup", () => {
      const s = makeStructure([c("c1", 0, 10), c("c2", 10, 20)]);
      const res = applyClipRoles(s, ["c1", "c2"], "buildup");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.structure.clips[0].role).toBe("buildup");
        expect(res.structure.clips[1].role).toBe("buildup");
      }
    });

    it("allows multiple clips to be marked as break", () => {
      const s = makeStructure([c("c1", 0, 10), c("c2", 10, 20)]);
      const res = applyClipRoles(s, ["c2"], "break");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.structure.clips[0].role).toBeUndefined();
        expect(res.structure.clips[1].role).toBe("break");
      }
    });
  });

  describe("Variation relation (strictly 1-to-1)", () => {
    it("allows exactly 2 clips for variation", () => {
      const s = makeStructure([c("c1", 0, 10), c("c2", 10, 20), c("c3", 20, 30)]);
      const res = ensureRelation(s, "variation", ["c1", "c2"], "rel-v1");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.structure.relations).toHaveLength(1);
        expect(res.structure.relations[0].kind).toBe("variation");
        expect(res.structure.relations[0].segmentIds).toEqual(["c1", "c2"]);
      }
    });

    it("rejects 1 clip for variation", () => {
      const s = makeStructure([c("c1", 0, 10), c("c2", 10, 20)]);
      const res = ensureRelation(s, "variation", ["c1"], "rel-v1");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("变奏关系只能一对一");
      }
    });

    it("rejects 3 or more clips for variation", () => {
      const s = makeStructure([c("c1", 0, 10), c("c2", 10, 20), c("c3", 20, 30)]);
      const res = ensureRelation(s, "variation", ["c1", "c2", "c3"], "rel-v1");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("变奏关系只能一对一");
      }
    });

    it("replaces old 1-to-1 variation for participating clips", () => {
      const s = makeStructure(
        [c("c1", 0, 10), c("c2", 10, 20), c("c3", 20, 30)],
        [{ id: "old-v", kind: "variation", segmentIds: ["c1", "c2"] }],
      );
      // Now pair c1 with c3 as variation
      const res = ensureRelation(s, "variation", ["c1", "c3"], "new-v");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.structure.relations).toHaveLength(1);
        expect(res.structure.relations[0].id).toBe("new-v");
        expect(res.structure.relations[0].segmentIds).toEqual(["c1", "c3"]);
      }
    });
  });

  describe("Upgrade relation (1-to-many)", () => {
    it("allows 2 or more clips for upgrade", () => {
      const s = makeStructure([c("c1", 0, 10), c("c2", 10, 20), c("c3", 20, 30)]);
      const res = ensureRelation(s, "upgrade", ["c1", "c2", "c3"], "rel-u1");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.structure.relations).toHaveLength(1);
        expect(res.structure.relations[0].segmentIds).toEqual(["c1", "c2", "c3"]);
      }
    });

    it("rejects fewer than 2 clips for upgrade", () => {
      const s = makeStructure([c("c1", 0, 10), c("c2", 10, 20)]);
      const res = ensureRelation(s, "upgrade", ["c1"], "rel-u1");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("升级");
      }
    });
  });

  describe("Repeat relation (many repeats allowed)", () => {
    it("allows multiple repeat relations with >= 2 clips", () => {
      const s = makeStructure([c("c1", 0, 10), c("c2", 10, 20), c("c3", 20, 30), c("c4", 30, 40)]);
      const res1 = ensureRelation(s, "repeat", ["c1", "c2"], "r1");
      expect(res1.ok).toBe(true);
      if (res1.ok) {
        const res2 = ensureRelation(res1.structure, "repeat", ["c3", "c4"], "r2");
        expect(res2.ok).toBe(true);
        if (res2.ok) {
          expect(res2.structure.relations).toHaveLength(2);
        }
      }
    });
  });

  describe("Clearing semantics and relations (plain clip)", () => {
    it("clears role and relations from selected clips", () => {
      const s = makeStructure(
        [c("c1", 0, 10, "drop"), c("c2", 10, 20), c("c3", 20, 30)],
        [{ id: "rel1", kind: "repeat", segmentIds: ["c1", "c2", "c3"] }],
      );
      const next = clearClipSemanticsAndRelations(s, ["c1"]);
      expect(next.clips[0].role).toBeUndefined();
      // c2 and c3 still have 2 clips, so relation remains with c2, c3
      expect(next.relations).toHaveLength(1);
      expect(next.relations[0].segmentIds).toEqual(["c2", "c3"]);

      // If we clear c2 as well, remaining is only c3 (<2), so relation is removed
      const next2 = clearClipSemanticsAndRelations(next, ["c2"]);
      expect(next2.relations).toHaveLength(0);
    });
  });

  describe("Theme color pairing helper", () => {
    it("provides stable background card tints for relation groups", () => {
      for (let i = 0; i < 8; i++) {
        const bg = relationGroupCardBg(i);
        const col = relationGroupColor(i);
        expect(bg).toMatch(/^#[0-9a-f]{6}$/i);
        expect(col).toMatch(/^#[0-9a-f]{6}$/i);
      }
      expect(relationGroupCardBg(0)).toBe(relationGroupCardBg(8));
    });
  });

  describe("formatAllRelationsText", () => {
    it("formats relations and roles to plain text matching user specification", () => {
      const s = makeStructure(
        [
          c("c1", 9.32, 71.13, "intro"),
          c("c2", 105.3, 109.5),
          c("c3", 249.4, 281.23, "drop"),
        ],
        [
          { id: "r1", kind: "repeat", segmentIds: ["c1", "c2", "c3"] },
          { id: "r2", kind: "upgrade", segmentIds: ["c1", "c2"] },
        ],
      );
      const text = formatAllRelationsText(s);
      const lines = text.split("\n");
      expect(lines).toContain("S01(00 : 09 : 32 ~ 01 : 11 : 13) & S02(01 : 45 : 30 ~ 01 : 49 : 50) & S03(04 : 09 : 40 ~ 04 : 41 : 23) Repeat");
      expect(lines).toContain("S01(00 : 09 : 32 ~ 01 : 11 : 13) & S02(01 : 45 : 30 ~ 01 : 49 : 50) Upgrade");
      expect(lines).toContain("S01(00 : 09 : 32 ~ 01 : 11 : 13) Intro");
      expect(lines).toContain("S03(04 : 09 : 40 ~ 04 : 41 : 23) Drop");
    });
  });

  describe("Segment deselection behavior (right click card deselect)", () => {
    it("removes clip from selection after I/O range creation", () => {
      // 模拟 I/O 创建 clip 后自动选中的状态
      const newlyCreatedId = "clip-io-1";
      let selection = new Set<string>([newlyCreatedId]);
      expect(selection.has(newlyCreatedId)).toBe(true);

      // 右键卡片触发 deselect
      const deselect = (id: string) => {
        if (!selection.has(id)) return selection;
        const next = new Set(selection);
        next.delete(id);
        return next;
      };

      selection = deselect(newlyCreatedId);
      expect(selection.has(newlyCreatedId)).toBe(false);
      expect(selection.size).toBe(0);
    });

    it("only deselects the targeted clip in a multi-selection", () => {
      let selection = new Set<string>(["c1", "c2", "c3"]);
      const deselect = (id: string) => {
        if (!selection.has(id)) return selection;
        const next = new Set(selection);
        next.delete(id);
        return next;
      };

      selection = deselect("c2");
      expect(selection.has("c2")).toBe(false);
      expect(selection.has("c1")).toBe(true);
      expect(selection.has("c3")).toBe(true);
      expect(selection.size).toBe(2);
    });

    it("is idempotent when deselecting an unselected clip", () => {
      const selection = new Set<string>(["c1"]);
      const deselect = (id: string) => {
        if (!selection.has(id)) return selection;
        const next = new Set(selection);
        next.delete(id);
        return next;
      };

      const result = deselect("c99");
      expect(result).toBe(selection);
    });
  });

  describe("Upgrade relation levels (Easy / Hard) & dropdown semantics", () => {
    it("assigns Easy to the earlier clip and Hard to the later clip by default", () => {
      const s = makeStructure([
        c("s01", 10, 20),
        c("s02", 30, 40),
      ]);
      const res = ensureRelation(s, "upgrade", ["s02", "s01"], "rel-u1");
      expect(res.ok).toBe(true);
      if (res.ok) {
        const rel = res.relation;
        expect(rel.kind).toBe("upgrade");
        expect(rel.upgradeLevels?.["s01"]).toBe("Easy");
        expect(rel.upgradeLevels?.["s02"]).toBe("Hard");
        expect(getUpgradeLevel(rel, "s01", res.structure.clips)).toBe("Easy");
        expect(getUpgradeLevel(rel, "s02", res.structure.clips)).toBe("Hard");
      }
    });

    it("generates correct relation badges for upgrade levels and other relations", () => {
      expect(relationBadge("upgrade", 1, "Easy")).toBe("U1-Easy");
      expect(relationBadge("upgrade", 1, "Hard")).toBe("U1-Hard");
      expect(relationBadge("repeat", 2)).toBe("R2");
      expect(relationBadge("repeat", 3)).toBe("R3");
      expect(relationBadge("variation", 1)).toBe("V1");
    });

    it("swaps Easy and Hard levels when user triggers swapUpgradeLevel", () => {
      const s = makeStructure([
        c("s01", 10, 20),
        c("s02", 30, 40),
      ]);
      const created = ensureRelation(s, "upgrade", ["s01", "s02"], "rel-u1");
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const relId = created.relation.id;
      // 初始：s01: Easy, s02: Hard
      expect(getUpgradeLevel(created.structure.relations[0], "s01", created.structure.clips)).toBe("Easy");
      expect(getUpgradeLevel(created.structure.relations[0], "s02", created.structure.clips)).toBe("Hard");

      // 点击 s01 切换为 Hard -> s01 变为 Hard，原配对 s02 自动互换为 Easy
      const swapped = swapUpgradeLevel(created.structure, relId, "s01");
      const swappedRel = swapped.relations.find((r) => r.id === relId)!;
      expect(getUpgradeLevel(swappedRel, "s01", swapped.clips)).toBe("Hard");
      expect(getUpgradeLevel(swappedRel, "s02", swapped.clips)).toBe("Easy");

      // 再次切换 s02 -> s02 变为 Hard，s01 自动互换为 Easy
      const swappedBack = swapUpgradeLevel(swapped, relId, "s02");
      const swappedBackRel = swappedBack.relations.find((r) => r.id === relId)!;
      expect(getUpgradeLevel(swappedBackRel, "s01", swappedBack.clips)).toBe("Easy");
      expect(getUpgradeLevel(swappedBackRel, "s02", swappedBack.clips)).toBe("Hard");
    });

    it("merges entire Repeat group when migrating R3 to R2 (all members become R2, R3 is removed)", () => {
      // 场景：S02与S03成重复关系(R2)，S04和S05成重复关系(R3)
      const s = makeStructure(
        [
          c("s01", 0, 10),
          c("s02", 10, 20),
          c("s03", 20, 30),
          c("s04", 30, 40),
          c("s05", 40, 50),
        ],
        [
          { id: "rel-r2", kind: "repeat", segmentIds: ["s02", "s03"] },
          { id: "rel-r3", kind: "repeat", segmentIds: ["s04", "s05"] },
        ],
      );

      // 点击 S04 的 R3 下拉菜单选择 R2
      const updated = reassignRelationGroup(s, "s04", "rel-r3", "rel-r2");
      // 期望：R3 组被清除，S04 与 S05 同步并入 R2 组
      expect(updated.relations.length).toBe(1);
      const r2 = updated.relations[0];
      expect(r2.id).toBe("rel-r2");
      expect(r2.kind).toBe("repeat");
      expect(r2.segmentIds).toEqual(expect.arrayContaining(["s02", "s03", "s04", "s05"]));
      expect(r2.segmentIds.length).toBe(4);
    });

    it("allows U1 and R2/R3 to coexist on the same clip (U and R do not mutually exclude)", () => {
      // 场景：S01 与 S02 成升级关系 (U1)，S02 随后与 S03 组成重复关系 (R2)
      const s = makeStructure(
        [
          c("s01", 0, 10),
          c("s02", 10, 20),
          c("s03", 20, 30),
        ],
        [
          {
            id: "rel-u1",
            kind: "upgrade",
            segmentIds: ["s01", "s02"],
            upgradeLevels: { s01: "Easy", s02: "Hard" },
          },
          { id: "rel-r2", kind: "repeat", segmentIds: ["s02", "s03"] },
        ],
      );

      // S02 应当同时出现在 U1 和 R2 中
      const s02Indexes = relationIndexesForSegment(s.relations, "s02");
      expect(s02Indexes).toEqual([0, 1]);

      // 从 U1 的下拉菜单中选择加入已有的 R2 组（或在跨关系操作时保留原有 U 关系）
      const updated = reassignRelationGroup(s, "s01", "rel-u1", "rel-r2");
      // U1 关系依然保留完整，S01 同时也加入到 R2 组
      const u1 = updated.relations.find((r) => r.id === "rel-u1");
      const r2 = updated.relations.find((r) => r.id === "rel-r2");
      expect(u1).toBeDefined();
      expect(u1?.segmentIds).toEqual(["s01", "s02"]);
      expect(r2).toBeDefined();
      expect(r2?.segmentIds).toEqual(expect.arrayContaining(["s01", "s02", "s03"]));
    });

    it("strictly enforces mutual exclusion among Drop, Build-up, and Break", () => {
      let s = makeStructure([c("s01", 10, 20)]);

      // 赋予 drop
      let res = applyClipRoles(s, ["s01"], "drop");
      expect(res.ok).toBe(true);
      if (res.ok) s = res.structure;
      expect(s.clips[0].role).toBe("drop");

      // 切换为 buildup -> drop 必须被替换，不能并存
      res = applyClipRoles(s, ["s01"], "buildup");
      expect(res.ok).toBe(true);
      if (res.ok) s = res.structure;
      expect(s.clips[0].role).toBe("buildup");

      // 切换为 break -> buildup 必须被替换，不能并存
      res = applyClipRoles(s, ["s01"], "break");
      expect(res.ok).toBe(true);
      if (res.ok) s = res.structure;
      expect(s.clips[0].role).toBe("break");

      // 切换回 drop -> break 必须被替换
      res = applyClipRoles(s, ["s01"], "drop");
      expect(res.ok).toBe(true);
      if (res.ok) s = res.structure;
      expect(s.clips[0].role).toBe("drop");
    });

    it("unlinks a segment from relation and dissolves relation if fewer than 2 clips remain", () => {
      const s = makeStructure(
        [c("s01", 10, 20), c("s02", 30, 40)],
        [{ id: "rel-u1", kind: "upgrade", segmentIds: ["s01", "s02"] }],
      );

      // 只有2个成员时移除1个 -> 关系解散
      const unlinked = unlinkSegmentFromRelation(s, "s01", "rel-u1");
      expect(unlinked.relations.length).toBe(0);

      // 3个成员时移除1个 -> 剩余2个保留
      const s3 = makeStructure(
        [c("s01", 10, 20), c("s02", 30, 40), c("s03", 50, 60)],
        [{ id: "rel-r1", kind: "repeat", segmentIds: ["s01", "s02", "s03"] }],
      );
      const unlinked3 = unlinkSegmentFromRelation(s3, "s02", "rel-r1");
      expect(unlinked3.relations.length).toBe(1);
      expect(unlinked3.relations[0].segmentIds).toEqual(["s01", "s03"]);
    });
  });

  describe("Upgrade level invariant (exactly one Easy) across edits", () => {
    const three = () =>
      makeStructure(
        [c("a", 0, 10), c("b", 10, 20), c("c", 20, 30), c("d", 30, 40)],
        [
          {
            id: "rel-u1",
            kind: "upgrade",
            segmentIds: ["a", "b", "c"],
            upgradeLevels: { a: "Easy", b: "Hard", c: "Hard" },
          },
        ],
      );
    const levels = (s: SegmentStructureV3, id = "rel-u1") =>
      s.relations.find((r) => r.id === id)?.upgradeLevels;

    it("keeps the surviving clip's own level when merging clips", () => {
      const merged = mergeClips(three(), "a", "b");
      expect(merged.ok).toBe(true);
      if (!merged.ok) return;
      expect(levels(merged.structure)).toEqual({ a: "Easy", c: "Hard" });
    });

    it("keeps the survivor Hard when it absorbs the original Easy", () => {
      const s = three();
      s.relations[0].upgradeLevels = { b: "Easy", c: "Hard" };
      const merged = mergeClips(s, "a", "b");
      expect(merged.ok && levels(merged.structure)).toEqual({ a: "Hard", c: "Easy" });
    });

    it("promotes the earliest remaining clip when the Easy clip is removed", () => {
      expect(levels(removeClip(three(), "a"))).toEqual({ b: "Easy", c: "Hard" });
    });

    it("promotes the earliest remaining clip when the Easy clip is unlinked", () => {
      expect(levels(unlinkSegmentFromRelation(three(), "a", "rel-u1"))).toEqual({
        b: "Easy",
        c: "Hard",
      });
    });

    it("demotes the previous Easy when a clip joins a group as Easy", () => {
      const s = makeStructure(three().clips, [
        ...three().relations,
        { id: "rel-r1", kind: "repeat", segmentIds: ["c", "d"] },
      ]);
      const joined = reassignRelationGroup(s, "d", "rel-r1", "rel-u1", "Easy");
      expect(levels(joined)).toEqual({ a: "Hard", b: "Hard", c: "Hard", d: "Easy" });
    });

    it("fills derived levels when joining a legacy group without stored levels", () => {
      const s = makeStructure(
        [c("a", 0, 10), c("b", 10, 20), c("c", 20, 30)],
        [
          { id: "rel-u1", kind: "upgrade", segmentIds: ["b", "c"] },
          { id: "rel-r1", kind: "repeat", segmentIds: ["a", "c"] },
        ],
      );
      const joined = reassignRelationGroup(s, "a", "rel-r1", "rel-u1", "Hard");
      // b was the derived Easy before a joined; a joining as Hard must not create a second Easy.
      expect(levels(joined)).toEqual({ a: "Hard", b: "Easy", c: "Hard" });
    });

    it("promotes another member when an existing Easy is reassigned as Hard", () => {
      const s = makeStructure(three().clips, [
        ...three().relations,
        { id: "rel-r1", kind: "repeat", segmentIds: ["a", "d"] },
      ]);
      const joined = reassignRelationGroup(s, "a", "rel-r1", "rel-u1", "Hard");
      expect(levels(joined)).toEqual({ a: "Hard", b: "Easy", c: "Hard" });
    });

    it("derives one Easy from legacy duplicate Easy or all Hard levels", () => {
      const s = three();
      const relation = s.relations[0];
      for (const level of ["Easy", "Hard"] as const) {
        relation.upgradeLevels = { a: level, b: level, c: level };
        expect(relation.segmentIds.map((id) => getUpgradeLevel(relation, id, s.clips))).toEqual(["Easy", "Hard", "Hard"]);
      }
    });

    it("derives at most one Easy when stored levels are partial", () => {
      const rel = {
        id: "rel-u1",
        kind: "upgrade" as const,
        segmentIds: ["a", "b", "c"],
        upgradeLevels: { c: "Easy" as const },
      };
      const clips = [c("a", 0, 10), c("b", 10, 20), c("c", 20, 30)];
      expect(["a", "b", "c"].map((id) => getUpgradeLevel(rel, id, clips))).toEqual([
        "Hard",
        "Hard",
        "Easy",
      ]);
    });
  });

  describe("Variation groups stay one-to-one under reassignment", () => {
    const s = makeStructure(
      [c("a", 0, 10), c("b", 10, 20), c("c", 20, 30), c("d", 30, 40)],
      [
        { id: "rel-v1", kind: "variation", segmentIds: ["a", "b"] },
        { id: "rel-r1", kind: "repeat", segmentIds: ["c", "d"] },
      ],
    );

    it("does not offer a full variation group as a target", () => {
      expect(canReassignTo(s, "c", "rel-r1", "rel-v1")).toBe(false);
      expect(canReassignTo(s, "a", "rel-v1", "rel-r1")).toBe(true);
      expect(canReassignTo(s, "c", "rel-r1", "rel-r1")).toBe(false);
    });

    it("rejects converting a three-member group and permits converting a pair", () => {
      const extra = { id: "three", kind: "repeat" as const, segmentIds: ["a", "b", "c"] };
      const structure = makeStructure(s.clips, [...s.relations, extra]);
      expect(canUpdateRelationKind(extra, "variation")).toBe(false);
      expect(updateRelationKind(structure, extra.id, "variation")).toBe(structure);
      expect(updateRelationKind(structure, "rel-r1", "variation").relations[1].kind).toBe("variation");
    });

    it("leaves the structure untouched when asked to overfill a variation", () => {
      expect(reassignRelationGroup(s, "c", "rel-r1", "rel-v1")).toBe(s);
    });
  });
});
