"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, MonoLink } from "@devdigest/ui";
import type { DownstreamImpact } from "@devdigest/shared";
import { s, symbolRowStyle, chevronStyle } from "./styles";

interface BlastTreeProps {
  downstream: DownstreamImpact[];
  /**
   * Builds the github.com link for a caller. Null when the repository's
   * `full_name` or the indexed sha is not known yet, in which case the
   * `file:line` renders as plain text rather than as a link to nowhere.
   */
  hrefFor: ((file: string, line: number) => string) | null;
}

/**
 * The collapsible symbol → callers → endpoints tree — the design's
 * `BlastRadiusTree` verbatim, with two things its fixture cannot have.
 *
 * The first is a caller's `file:line` as a real link. The second is a symbol
 * that reaches nothing: the server emits an entry for every changed symbol,
 * including the ones nothing calls, because absence would be indistinguishable
 * from "the traversal never got here". Those rows render, collapsed, saying
 * `0 callers` — which is the answer, not a gap.
 */
export function BlastTree({ downstream, hrefFor }: BlastTreeProps) {
  const t = useTranslations("blast");
  // Uncontrolled, and the tab is unmounted while another tab is active, so
  // nothing here survives a tab switch — which is why it may only hold what a
  // reader would not mind losing.
  const [open, setOpen] = React.useState<Record<string, boolean>>({});

  return (
    <div style={s.root}>
      {downstream.map((impact, i) => {
        // Keyed by POSITION, not by name. The server emits one row per changed
        // symbol and two changed files may each declare a `format` — same string,
        // two rows. Keying either the list or this open-state record on the name
        // alone gives React duplicate siblings and makes one chevron expand both.
        const rowKey = `${i}:${impact.symbol}`;
        const isOpen = open[rowKey] ?? false;
        const empty = impact.callers.length === 0;
        return (
          <div key={rowKey}>
            <button
              type="button"
              aria-expanded={isOpen}
              disabled={empty}
              onClick={() => setOpen((o) => ({ ...o, [rowKey]: !o[rowKey] }))}
              style={symbolRowStyle(isOpen, empty)}
            >
              <Icon.ChevronRight size={13} style={chevronStyle(isOpen)} />
              <Icon.Code size={13} style={s.symbolIcon} />
              <span className="mono" style={s.symbolName}>
                {impact.symbol}()
              </span>
              <span style={s.callerCount}>
                {t("callerCount", { count: impact.callers.length })}
              </span>
            </button>

            {isOpen && (
              <div style={s.body}>
                {impact.callers.map((caller, i) => (
                  <div key={`${caller.file}:${caller.line}:${i}`} style={s.callerRow}>
                    <Icon.CornerDownRight size={13} style={s.callerIcon} />
                    {hrefFor ? (
                      <MonoLink href={hrefFor(caller.file, caller.line)}>
                        {caller.file}:{caller.line}
                      </MonoLink>
                    ) : (
                      <span className="mono" style={s.callerPlain}>
                        {caller.file}:{caller.line}
                      </span>
                    )}
                    <span style={s.callerName}>{caller.name}</span>
                  </div>
                ))}

                {impact.endpoints_affected.length > 0 && (
                  <div style={s.badgeRow}>
                    {impact.endpoints_affected.map((endpoint) => (
                      <Badge
                        key={endpoint}
                        mono
                        icon="Globe"
                        color="var(--accent-text)"
                        bg="var(--accent-bg)"
                      >
                        {endpoint}
                      </Badge>
                    ))}
                  </div>
                )}

                {impact.crons_affected.length > 0 && (
                  <div style={s.badgeRow}>
                    {impact.crons_affected.map((cron) => (
                      <Badge key={cron} mono icon="Clock" color="var(--warn)" bg="var(--warn-bg)">
                        {cron}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
