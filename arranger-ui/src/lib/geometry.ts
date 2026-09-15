/**
 * 键位几何:configs/column_geometry.json 是唯一权威(经 /api/geometry 运行时获取),
 * 本模块只解析/换算,绝不硬编码坐标。坐标为单位六角、屏幕约定 y 向下。
 * habit 编号仅供参考,UI 永不显示(仓库不变量)。
 */

export interface GeometryColumn {
  x: number;
  y: number;
  label: string;
}

export interface Geometry {
  columnCount: number;
  columns: Record<string, GeometryColumn>;
  leftGroup: number[];
  rightGroup: number[];
  ringOrder: number[];
}

export class GeometryError extends Error {}

export function parseGeometry(json: Record<string, unknown>): Geometry {
  const columns = json.columns as Record<string, GeometryColumn> | undefined;
  const count = Number(json.column_count ?? 6);
  if (!columns || Object.keys(columns).length !== count) {
    throw new GeometryError("invalid geometry: columns/column_count mismatch");
  }
  return {
    columnCount: count,
    columns,
    leftGroup: (json.left_group as number[]) ?? [0, 1, 2],
    rightGroup: (json.right_group as number[]) ?? [3, 4, 5],
    ringOrder: (json.ring_order as number[]) ?? [0, 1, 2, 3, 4, 5],
  };
}

export function keyPos(
  geom: Geometry,
  col: number,
  cx: number,
  cy: number,
  r: number,
): { x: number; y: number } {
  const c = geom.columns[String(col)];
  if (!c) throw new GeometryError(`unknown column ${col}`);
  return { x: cx + c.x * r, y: cy + c.y * r };
}

/** 几何文件英文 label → 中文方位(由权威 label 推导,非硬编码位置)。 */
const ZH_LABELS: Record<string, string> = {
  "upper-left": "左上",
  "left-middle": "左中",
  "lower-left": "左下",
  "lower-right": "右下",
  "right-middle": "右中",
  "upper-right": "右上",
};

export function zhLabel(label: string): string {
  return ZH_LABELS[label] ?? label;
}
