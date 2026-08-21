/** Accepted uploads. Anything else is rejected before a request is made. */
export const ACCEPT = ".md,.markdown,.zip";

/**
 * Client-side archive cap.
 *
 * `app.ts` limits a request body to 1 MB, and base64 inflates by ~33%, so an
 * archive over this size would be rejected as a bare 413 with no explanation.
 * Checking here means the user gets a sentence instead. The server enforces its
 * own MAX_ZIP_BYTES regardless — this is UX, not the security boundary.
 */
export const MAX_ZIP_BYTES = 512 * 1024;

export const DRAWER_WIDTH = 520;
