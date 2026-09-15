import { describe, expect, it } from "vitest";

import {
  DEFAULT_UI,
  PREVIEW_VISUAL_VERSION,
  normalizeUiPrefs,
} from "../src/lib/persist-types";

describe("preview preference migration", () => {
  it("uses the requested 0.75 second default", () => {
    expect(DEFAULT_UI.leadInSec).toBe(0.75);
    expect(DEFAULT_UI.previewVisualVersion).toBe(PREVIEW_VISUAL_VERSION);
    expect(DEFAULT_UI.simulatorMode).toBe(false);
  });

  it("defaults legacy projects off and preserves the per-project simulator switch", () => {
    expect(normalizeUiPrefs({}).simulatorMode).toBe(false);
    expect(normalizeUiPrefs({ simulatorMode: true }).simulatorMode).toBe(true);
  });

  it("migrates every legacy preview exactly once", () => {
    expect(normalizeUiPrefs({ leadInSec: 0.35 }).leadInSec).toBe(0.75);
    expect(normalizeUiPrefs({ leadInSec: 0.6, previewVisualVersion: 6 }).leadInSec).toBe(0.75);
  });

  it("preserves a user-adjusted value after the visual migration", () => {
    const normalized = normalizeUiPrefs({
      leadInSec: 2.15,
      previewVisualVersion: PREVIEW_VISUAL_VERSION,
    });
    expect(normalized.leadInSec).toBe(2.15);
    expect(normalized.previewVisualVersion).toBe(PREVIEW_VISUAL_VERSION);
  });
});
