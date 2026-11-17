import type { HoldOverlapWarning, Onset, TripleChordWarning } from "./arrangement";
import { beatToAudioSec, type TimingContext } from "./timemap";

const HEADER = ["类型", "拍位", "音频时间（秒）", "通道", "说明"];

export function holdOverlapTarget(
  warning: HoldOverlapWarning,
  lookup: (id: string) => Onset | undefined,
): Onset | undefined {
  return lookup(warning.overlappedOnsetId) ?? lookup(warning.onsetId);
}

export function encodeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
}

export function buildDiagnosticsCsv(
  onsets: readonly Onset[],
  overlaps: readonly HoldOverlapWarning[],
  triples: readonly TripleChordWarning[],
  timing: TimingContext,
): string {
  const onsetById = new Map(onsets.map((onset) => [onset.id, onset]));
  const rows: { type: string; order: number; beat: number; columns: string; detail: string }[] = [];

  for (const warning of overlaps) {
    const onset = holdOverlapTarget(warning, (id) => onsetById.get(id));
    if (!onset) continue;
    rows.push({
      type: "长条重叠",
      order: 0,
      beat: onset.beatFloat,
      columns: String(warning.column),
      detail: "同通道后续采音点与长条重叠",
    });
  }

  for (const warning of triples) {
    const details = [
      ["起始", warning.startingColumns],
      ["释放", warning.endingColumns],
      ["持续", warning.holdingColumns],
    ] as const;
    rows.push({
      type: "三押及以上",
      order: 1,
      beat: warning.beatFloat,
      columns: warning.columns.join(","),
      detail: details.map(([label, columns]) => label + "：" + (columns.join(",") || "无")).join(" / "),
    });
  }

  rows.sort((a, b) => a.beat - b.beat || a.order - b.order);
  const fields = rows.map(({ type, beat, columns, detail }) => [
    type,
    String(beat),
    beatToAudioSec(beat, timing).toFixed(3),
    columns,
    detail,
  ]);
  return "\uFEFF" + [HEADER, ...fields].map((row) => row.map(encodeCsvField).join(",")).join("\r\n") + "\r\n";
}
