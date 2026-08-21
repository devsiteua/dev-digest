import type { CSSProperties } from "react";

/** Co-located styles for the two-column skill detail screen. */
export const s = {
  shell: { display: "flex", height: "calc(100vh - 52px)" } satisfies CSSProperties,
  detailPane: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  } satisfies CSSProperties,
  detailHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "16px 24px 0",
    flexShrink: 0,
  } satisfies CSSProperties,
  detailTitle: { fontSize: 17, fontWeight: 700 } satisfies CSSProperties,
  /* Scrolls the whole editor, tab bar included — the same behaviour as /agents/:id. */
  editorScroll: { flex: 1, minHeight: 0, overflow: "auto" } satisfies CSSProperties,
  skeletonWrap: {
    padding: 28,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,
} as const;
