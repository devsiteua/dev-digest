import type { AgentColumn } from "@devdigest/shared";

/**
 * The status chip's colours, one entry per status the database can write.
 *
 * All four are spelled out rather than defaulted, so a fifth status added to the
 * contract is a typecheck failure here instead of an unstyled chip.
 */
export const STATUS_TONE: Record<AgentColumn["status"], { color: string; bg: string }> = {
  running: { color: "var(--accent-text)", bg: "var(--accent-bg)" },
  done: { color: "var(--ok)", bg: "var(--ok-bg)" },
  failed: { color: "var(--crit)", bg: "var(--crit-bg)" },
  cancelled: { color: "var(--text-muted)", bg: "var(--bg-hover)" },
};
