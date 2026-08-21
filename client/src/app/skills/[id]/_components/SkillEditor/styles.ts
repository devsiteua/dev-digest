import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", minHeight: 0 } satisfies CSSProperties,
  tabsBar: { borderBottom: "1px solid var(--border)", flexShrink: 0 } satisfies CSSProperties,
  body: { padding: 24, overflow: "auto" } satisfies CSSProperties,
  form: { maxWidth: 760 } satisfies CSSProperties,
  headRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 18,
  } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  enabledLabel: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  bodyMeta: {
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  overBudget: { color: "var(--crit)", fontWeight: 600 } satisfies CSSProperties,
  actions: {
    display: "flex",
    gap: 8,
    marginTop: 12,
    alignItems: "center",
  } satisfies CSSProperties,
  savedNote: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  danger: {
    marginTop: 28,
    paddingTop: 18,
    borderTop: "1px solid var(--border)",
    display: "flex",
    alignItems: "center",
    gap: 12,
  } satisfies CSSProperties,
  dangerTitle: { fontSize: 13, fontWeight: 600, color: "var(--crit)" } satisfies CSSProperties,
  dangerBody: { fontSize: 12, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,

  // ---- Preview ----
  previewWrap: { maxWidth: 760 } satisfies CSSProperties,
  previewLead: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    margin: "4px 0 14px",
  } satisfies CSSProperties,
  untrustedNotice: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    padding: "11px 14px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    marginBottom: 16,
    fontSize: 12.5,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  card: {
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
    padding: 20,
  } satisfies CSSProperties,
} as const;

/**
 * Typography for rendered skill markdown.
 *
 * `@devdigest/ui`'s `<Markdown>` tags its output `.dd-md` but ships no rule for
 * it, so headings and lists would fall back to browser defaults and look nothing
 * like the rest of the app. The design system is vendored and off-limits, so the
 * rules live here, scoped to this preview.
 */
export const MARKDOWN_CSS = `
.dd-md h1, .dd-md h2, .dd-md h3 { font-weight: 700; letter-spacing: -0.01em; color: var(--text-primary); }
.dd-md h1 { font-size: 19px; margin: 2px 0 12px; }
.dd-md h2 { font-size: 15.5px; margin: 20px 0 8px; }
.dd-md h3 { font-size: 13.5px; margin: 16px 0 6px; }
.dd-md p, .dd-md li { font-size: 13px; line-height: 1.6; color: var(--text-secondary); }
.dd-md ul, .dd-md ol { margin: 6px 0 10px; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }
.dd-md pre { margin: 10px 0; padding: 12px 14px; font-size: 12px; line-height: 1.6;
  background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px; overflow-x: auto; }
.dd-md pre code { background: none; padding: 0; color: var(--text-primary); }
.dd-md blockquote { margin: 10px 0; padding-left: 12px; border-left: 3px solid var(--border-strong); color: var(--text-muted); }
.dd-md hr { border: none; border-top: 1px solid var(--border); margin: 18px 0; }
.dd-md table { border-collapse: collapse; font-size: 12.5px; margin: 10px 0; }
.dd-md th, .dd-md td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
.dd-md th { background: var(--bg-surface); font-weight: 600; }
`;
