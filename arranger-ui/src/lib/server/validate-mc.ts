/** 导出前服务端校验:结构合法才落盘(422 拒绝)。复用客户端 parseMc 的全部校验。 */

import { type Beat, beatToFloat } from "../beat";
import { parseMc } from "../mc";

export interface McValidation {
  ok: boolean;
  errors: string[];
  noteCount: number;
  warnings: string[];
}

export function validateArrangedMcText(text: string): McValidation {
  const errors: string[] = [];
  let noteCount = 0;
  let warnings: string[] = [];
  try {
    const chart = parseMc(text); // 列 0..5 / 恰一音频 note / endbeat ≥ beat / beat 合法
    noteCount = chart.gameplay.length;
    warnings = chart.warnings;

    const rawNotes = chart.raw.note as Record<string, unknown>[];
    if (rawNotes[rawNotes.length - 1]?.type !== 1) {
      errors.push("音频 note 必须是 note[] 的最后一项");
    }
    for (const n of rawNotes) {
      if (n.type !== 1 && "dir" in n) {
        errors.push("存在 dir 属性 —— 禁止 slide 音符");
        break;
      }
    }
    const meta = chart.raw.meta as Record<string, unknown> | undefined;
    if (!meta || meta.mode !== 9) errors.push("meta.mode 必须为 9(Cube)");

    let prev = -Infinity;
    for (const n of rawNotes) {
      if (n.type === 1) continue;
      const f = beatToFloat(n.beat as Beat);
      if (f < prev - 1e-9) {
        errors.push("gameplay 音符未按 beat 排序");
        break;
      }
      prev = f;
    }
  } catch (e) {
    errors.push((e as Error).message);
  }
  return { ok: errors.length === 0, errors, noteCount, warnings };
}
