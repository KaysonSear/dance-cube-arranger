import fs from "node:fs";
import crypto from "node:crypto";

import type { WorkingStateV1 } from "../persist-types";
import { projectKey, sha1Hex } from "./paths";
import { readState, saveState } from "./store";

export class WorkspaceConflict extends Error {}

export function atomicWrite(file: string, data: string | Buffer): void {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, data);
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

interface WorkspaceChart {
  file: string;
  key: string;
  original: Buffer;
  state: WorkingStateV1 | null;
}

export function readWorkspaceChart(file: string, src: string, expectSha1?: string): WorkspaceChart {
  const key = projectKey(src);
  const original = fs.readFileSync(file);
  const state = readState(key);
  const expected = expectSha1 ?? state?.sourceSha1;
  if (expected && expected !== sha1Hex(original)) {
    throw new WorkspaceConflict(`谱面已被修改，请重新载入：${src}`);
  }
  return { file, key, original, state };
}

export type WorkspaceChange = WorkspaceChart & { text: string };

/** Call synchronously after preflighting every chart so a stale sibling cannot partially apply a save. */
export function commitWorkspaceCharts(changes: WorkspaceChange[], commit?: () => void): void {
  const writtenFiles: WorkspaceChart[] = [];
  const writtenStates: WorkspaceChart[] = [];
  try {
    for (const change of changes) {
      const { file, key, original, state, text } = change;
      if (!original.equals(Buffer.from(text))) {
        atomicWrite(file, text);
        writtenFiles.push(change);
      }
      const sourceSha1 = sha1Hex(text);
      if (state && state.sourceSha1 !== sourceSha1) {
        saveState(key, { ...state, sourceSha1 });
        writtenStates.push(change);
      }
    }
    commit?.();
  } catch (error) {
    for (const change of writtenFiles) atomicWrite(change.file, change.original);
    for (const change of writtenStates) saveState(change.key, change.state!);
    throw error;
  }
}
