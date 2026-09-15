/** Validation and canonical naming for user-selected project assets. */

import path from "node:path";

export type AssetKind = "audio" | "cover";

export const ASSET_LIMITS = { audio: 40 * 1024 * 1024, cover: 10 * 1024 * 1024 } as const;
const EXTENSIONS: Record<AssetKind, Set<string>> = {
  audio: new Set([".mp3", ".ogg", ".wav"]),
  cover: new Set([".jpg", ".jpeg", ".png"]),
};

export function hasAssetSignature(kind: AssetKind, ext: string, data: Buffer): boolean {
  if (kind === "cover" && (ext === ".jpg" || ext === ".jpeg")) {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (kind === "cover" && ext === ".png") {
    return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (ext === ".ogg") return data.length >= 4 && data.subarray(0, 4).toString("ascii") === "OggS";
  if (ext === ".wav") {
    return data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" &&
      data.subarray(8, 12).toString("ascii") === "WAVE";
  }
  if (ext === ".mp3") {
    return (data.length >= 3 && data.subarray(0, 3).toString("ascii") === "ID3") ||
      (data.length >= 2 && data[0] === 0xff && (data[1] & 0xe0) === 0xe0);
  }
  return false;
}

export async function validateAssetUpload(
  kind: AssetKind,
  file: File,
): Promise<{ name: string; data: Buffer }> {
  const ext = path.extname(file.name).toLowerCase();
  if (!EXTENSIONS[kind].has(ext)) {
    throw new Error(kind === "audio" ? "音频仅支持 mp3/ogg/wav" : "封面仅支持 jpg/jpeg/png");
  }
  if (file.size <= 0) throw new Error(`${kind === "audio" ? "音频" : "封面"}文件为空`);
  if (file.size > ASSET_LIMITS[kind]) {
    throw new Error(`${kind === "audio" ? "音频" : "封面"}文件超过 ${kind === "audio" ? "40MB" : "10MB"}`);
  }
  const data = Buffer.from(await file.arrayBuffer());
  if (!hasAssetSignature(kind, ext, data)) throw new Error(`${kind === "audio" ? "音频" : "封面"}内容与扩展名不符`);
  return { name: `${kind}${ext}`, data };
}
