import { CHARS_PER_PX, NODE_HEIGHT } from "./constants";

/** A positioned node of the graph. */
export interface GraphNode {
  x: number;
  y: number;
  label: string;
}

/**
 * Lay `labels` out as a vertical column, centred in `height`.
 *
 * Centred rather than spread edge-to-edge because the design's own formula
 * divides by `labels.length - 1`, which is a division by zero for the very
 * common case of one caller.
 */
export function column(labels: readonly string[], x: number, height: number): GraphNode[] {
  const pitch = (height - NODE_HEIGHT) / Math.max(labels.length, 1);
  const top = (height - pitch * labels.length) / 2;
  return labels.map((label, i) => ({ x, y: top + pitch * (i + 0.5), label }));
}

/** A horizontal cubic bezier between two nodes, as the design draws it. */
export function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const mid = (from.x + to.x) / 2;
  return `M${from.x + 4},${from.y} C${mid},${from.y} ${mid},${to.y} ${to.x - 4},${to.y}`;
}

/** Trim a label to what fits inside a node of `width` pixels. */
export function truncate(label: string, width: number): string {
  const max = Math.floor(width * CHARS_PER_PX) - 2;
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}
