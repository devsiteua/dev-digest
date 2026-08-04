/**
 * `rationale` is markdown, and the popover renders it as a two-line plain-text
 * preview. Rendering it through `Markdown` would drag block elements into a
 * clamped 11.5px line — the design strips the emphasis markers instead and keeps
 * the text flat.
 */
export function stripMd(text: string): string {
  return text.replace(/\*\*|`/g, "");
}
