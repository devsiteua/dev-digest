/**
 * A snapshot's timestamp, in the reader's locale.
 *
 * Falls back to the raw string when the API sends something `Date` cannot parse
 * — a version row is still worth showing when only its date is unreadable. Same
 * shape as `formatWhen` in the review accordion; kept local rather than shared
 * until a third caller exists.
 */
export function formatSnapshotDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
