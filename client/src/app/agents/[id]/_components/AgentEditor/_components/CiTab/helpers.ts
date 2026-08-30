/** Pure helpers for the CI tab. */

/** An ISO timestamp as local text; unparsable input is shown as it arrived. */
export function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
