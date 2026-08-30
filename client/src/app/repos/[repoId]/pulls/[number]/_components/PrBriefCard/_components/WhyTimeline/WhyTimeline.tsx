"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { PrBriefDelta, PrBriefTimelineEntry } from "@devdigest/shared";
import { s, headerFor, rowFor } from "./styles";

interface WhyTimelineProps {
  entries: PrBriefTimelineEntry[];
}

/**
 * Every past brief of this pull request, newest first, with what changed.
 *
 * The order is the server's `seq` and this component does not re-sort: two rows
 * written in one transaction tie on `generated_at` to the microsecond, so any
 * sort here would be planner order wearing a timestamp (root `CLAUDE.md`
 * § Gotchas, and AC-27 is that rule stated as a criterion).
 *
 * `delta` is `null` on the oldest entry — there is nothing behind it to differ
 * from — and that is a different statement from "nothing changed", which is why
 * they read differently.
 */
export function WhyTimeline({ entries }: WhyTimelineProps) {
  const t = useTranslations("brief");
  const [open, setOpen] = React.useState(false);

  if (entries.length === 0) return null;

  return (
    <div style={s.frame}>
      <button type="button" style={headerFor(open)} onClick={() => setOpen((o) => !o)}>
        <Icon.History size={14} style={{ color: "var(--text-muted)" }} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("timeline.title")}</span>
        <Badge>{t("timeline.count", { count: entries.length })}</Badge>
        <Icon.ChevronDown
          size={15}
          style={{
            marginLeft: "auto",
            color: "var(--text-muted)",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform .15s",
          }}
        />
      </button>
      {open && (
        <div style={s.body}>
          {entries.map((entry, i) => (
            <div key={entry.state_key} style={rowFor(i === entries.length - 1)}>
              <div style={s.rail}>
                <span style={s.dot} />
                {i !== entries.length - 1 && <span style={s.rope} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={s.rowHead}>
                  <Badge mono>{entry.risk_level}</Badge>
                  <span className="mono">{t("timeline.at", { sha: entry.head_sha.slice(0, 7) })}</span>
                  <span>·</span>
                  <span>{entry.generated_at}</span>
                </div>
                <div style={s.what}>{entry.what}</div>
                <DeltaLine delta={entry.delta} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * What moved between this brief and the one before it.
 *
 * Every line is computed server-side by code, never asked of a model: "the risk
 * level went medium → high" is a fact about two rows, and paying for a sentence
 * that restates it would be paying to be told what we already know (AC-28).
 */
function DeltaLine({ delta }: { delta: PrBriefDelta | null }) {
  const t = useTranslations("brief");
  if (!delta) return <div style={s.delta}>{t("timeline.first")}</div>;

  const parts: string[] = [];
  if (delta.risk_level_from && delta.risk_level_to && delta.risk_level_from !== delta.risk_level_to)
    parts.push(t("timeline.riskMoved", { from: delta.risk_level_from, to: delta.risk_level_to }));
  if (delta.risks_added.length > 0)
    parts.push(t("timeline.risksAdded", { titles: delta.risks_added.join(", ") }));
  if (delta.risks_removed.length > 0)
    parts.push(t("timeline.risksRemoved", { titles: delta.risks_removed.join(", ") }));
  if (delta.focus_added.length > 0)
    parts.push(t("timeline.focusAdded", { refs: delta.focus_added.join(", ") }));
  if (delta.focus_removed.length > 0)
    parts.push(t("timeline.focusRemoved", { refs: delta.focus_removed.join(", ") }));

  // An empty delta is informative rather than embarrassing: it is what a
  // regenerate at an unchanged head looks like, and the spec says so.
  if (parts.length === 0) return <div style={s.delta}>{t("timeline.noChange")}</div>;

  return (
    <div style={s.delta}>
      {parts.map((part) => (
        <span key={part}>· {part}</span>
      ))}
    </div>
  );
}
