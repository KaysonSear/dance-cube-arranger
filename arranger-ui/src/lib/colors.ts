/**
 * 键型配色规则(需求 5):单押=蓝,同刻 ≥2 键(双押/多押,含长条)=黄；长条头尾同色,
 * 未指派=灰。颜色按"该时刻键数"统一决定 —— 单押+长条同刻即 2 键 → 黄。
 *
 * 色值为羊皮纸浅底调校(语义不变):金黄 #ca8a04(hue≈45°)与陶土强调色 #c96442
 * (hue≈17°)保持色相距离;浅底对比不足由 Canvas 侧 1px 墨色描边(THEME.stage.noteOutline)
 * 补偿。备选更深金:#d97706。
 */

export const NOTE_COLORS = {
  unassigned: "#78716c",
  single: "#2563eb",
  chord: "#ca8a04",
} as const;

export function noteColor(chordSize: number): string {
  if (chordSize <= 0) return NOTE_COLORS.unassigned;
  return chordSize === 1 ? NOTE_COLORS.single : NOTE_COLORS.chord;
}

/** 长条头与尾带按起点时刻的总押数统一取色。 */
export function holdColor(chordSize: number): string {
  return noteColor(chordSize);
}
