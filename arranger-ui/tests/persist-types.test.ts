import { describe, expect, it } from "vitest";

import {
  DEFAULT_UI,
  PREVIEW_VISUAL_VERSION,
  normalizeUiPrefs,
} from "../src/lib/persist-types";

describe("preview preference migration", () => {
  it("defaults to a 0.5 second lead-in, 50% music volume, and 100% kick volume", () => {
    const defaults = { leadInSec: 0.5, musicVol: 0.5, kickVol: 1 };
    expect(DEFAULT_UI).toMatchObject(defaults);
    expect(normalizeUiPrefs()).toMatchObject(defaults);
    expect(normalizeUiPrefs({ previewVisualVersion: PREVIEW_VISUAL_VERSION })).toMatchObject(defaults);
    expect(DEFAULT_UI.previewVisualVersion).toBe(PREVIEW_VISUAL_VERSION);
    expect(DEFAULT_UI.simulatorMode).toBe(false);
  });

  it("defaults legacy projects off and preserves the per-project simulator switch", () => {
    expect(normalizeUiPrefs({}).simulatorMode).toBe(false);
    expect(normalizeUiPrefs({ simulatorMode: true }).simulatorMode).toBe(true);
  });

  it("migrates every legacy preview exactly once", () => {
    expect(normalizeUiPrefs({ leadInSec: 0.35, musicVol: 0, kickVol: 0.2 })).toMatchObject({
      leadInSec: 0.5,
      musicVol: 0,
      kickVol: 0.2,
      previewVisualVersion: PREVIEW_VISUAL_VERSION,
    });
    expect(normalizeUiPrefs({ leadInSec: 0.6, previewVisualVersion: 6 }).leadInSec).toBe(0.5);
  });

  it("preserves user-adjusted lead-in and volumes after the visual migration", () => {
    const saved = {
      leadInSec: 2.15,
      musicVol: 0.8,
      kickVol: 0,
      previewVisualVersion: PREVIEW_VISUAL_VERSION,
    };
    expect(normalizeUiPrefs(saved)).toMatchObject(saved);
  });
});
