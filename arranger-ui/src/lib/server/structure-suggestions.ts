import fs from "node:fs";
import path from "node:path";

import { findRepoRoot } from "./paths";

export interface StructureSuggestion {
  start: number;
  end: number;
  label: string;
}

export function shapeStructureSuggestions(raw: unknown): StructureSuggestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const value = item as Record<string, unknown>;
      return {
        start: Number(value?.start),
        end: Number(value?.end),
        label: String(value?.label ?? "").trim().toLowerCase(),
      };
    })
    .filter(
      (item) =>
        Number.isFinite(item.start) &&
        Number.isFinite(item.end) &&
        item.start >= 0 &&
        item.end > item.start,
    )
    .toSorted((a, b) => a.start - b.start);
}

/** 工程音频同名的转录骨架，例如 WDA/WDA.mp3 → artifacts/skeletons/WDA.json。 */
export function suggestionsForAudio(audioPath: string): StructureSuggestion[] {
  const stem = path.basename(audioPath, path.extname(audioPath));
  const skeletonPath = path.join(findRepoRoot(), "artifacts", "skeletons", `${stem}.json`);
  if (!fs.existsSync(skeletonPath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(skeletonPath, "utf-8")) as Record<string, unknown>;
    return shapeStructureSuggestions(raw.sections);
  } catch {
    return [];
  }
}
