/** Where the "you have no agents" empty state sends the reader. */
export const AGENTS_HREF = "/agents";

/**
 * Where a started run is read back. The picker is mounted on two routes and both
 * land here, which is why the path is written once rather than at each call site.
 */
export const resultsHref = (repoId: string, prNumber: number) =>
  `/repos/${repoId}/multi-agent?pr=${prNumber}`;
