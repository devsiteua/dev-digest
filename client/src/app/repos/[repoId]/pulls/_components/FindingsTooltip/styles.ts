import type { CSSProperties } from "react";

/** Co-located styles for FindingsTooltip — a port of the design's popover
 *  (`12-prdetail_runs.jsx:38-54`), which both counter surfaces open on hover. */
export const s = {
  /** `placement` is up for rows in the lower half of a list, so the popover never
   *  opens past the viewport bottom. Anchored to the counter row, which is the
   *  positioned ancestor. */
  wrap: (placement: "up" | "down", width: number): CSSProperties => ({
    position: "absolute",
    left: 0,
    ...(placement === "up" ? { bottom: "100%", marginBottom: 8 } : { top: "100%", marginTop: 8 }),
    zIndex: 30,
    width,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 10,
    boxShadow: "var(--shadow-modal)",
    padding: 12,
    animation: "ddpop .12s ease",
    cursor: "default",
    textAlign: "left",
  }),
  header: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    marginBottom: 9,
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 9,
    maxHeight: 300,
    overflow: "auto",
  } satisfies CSSProperties,
  item: (last: boolean): CSSProperties => ({
    paddingBottom: last ? 0 : 9,
    borderBottom: last ? "none" : "1px solid var(--border)",
  }),
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  title: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    margin: "5px 0 0",
  } satisfies CSSProperties,
  anchor: { fontSize: 11, color: "var(--accent-text)" } satisfies CSSProperties,
  /** Two lines, then an ellipsis — the popover is a scan aid, not the finding. */
  rationale: {
    fontSize: 11.5,
    color: "var(--text-secondary)",
    lineHeight: 1.45,
    marginTop: 5,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } as CSSProperties,
} as const;
