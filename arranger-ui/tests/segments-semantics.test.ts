import { describe, expect, it } from "vitest";

import {
  applyClipRoles,
  clearClipSemanticsAndRelations,
  ensureRelation,
  formatAllRelationsText,
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
});
