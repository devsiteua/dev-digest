import type { CSSProperties } from "react";

/** Co-located styles for the Smart Diff surface. */
export const s = {
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  } satisfies CSSProperties,
  headerStat: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  addText: { color: "var(--code-add-text)" } satisfies CSSProperties,
  delText: { color: "var(--code-del-text)" } satisfies CSSProperties,
  toggleGroup: {
    marginLeft: "auto",
    display: "flex",
    gap: 2,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: 2,
  } satisfies CSSProperties,
  group: { marginBottom: 18 } satisfies CSSProperties,
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: "6px 0",
    marginBottom: 8,
    // Sticky, as the design draws it: scrolling through a long group must never
    // leave the reader wondering which group they are in.
    position: "sticky",
    top: 0,
    // `--bg-primary` is the page ground the diff is drawn on. A token that does
    // not exist resolves to nothing, which leaves a STICKY header transparent —
    // the one thing it must not be.
    background: "var(--bg-primary)",
    zIndex: 1,
  } satisfies CSSProperties,
  groupLabel: { fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  groupDesc: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  groupCount: { marginLeft: "auto", fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  cards: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  banner: {
    border: "1px solid var(--warn)",
    borderRadius: 8,
    background: "var(--warn-bg)",
    padding: 14,
    marginBottom: 14,
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
  } satisfies CSSProperties,
  bannerIcon: { color: "var(--warn)", flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
  bannerTitle: { fontSize: 13.5, fontWeight: 650 } satisfies CSSProperties,
  bannerBody: { fontSize: 12.5, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  splitList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginTop: 10,
  } satisfies CSSProperties,
  splitRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  splitName: { color: "var(--text-primary)", fontWeight: 600 } satisfies CSSProperties,
  splitFiles: { fontSize: 11.5 } satisfies CSSProperties,
} as const;

/** The role dot beside a group header. */
export function roleDotFor(colour: string): CSSProperties {
  return { width: 8, height: 8, borderRadius: 2, background: colour, flexShrink: 0 };
}

/** One segment of the Smart / Original order toggle. */
export function toggleButtonFor(active: boolean): CSSProperties {
  return {
    padding: "3px 11px",
    fontSize: 11.5,
    fontWeight: 600,
    borderRadius: 5,
    border: "none",
    cursor: "pointer",
    background: active ? "var(--bg-elevated)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
  };
}
