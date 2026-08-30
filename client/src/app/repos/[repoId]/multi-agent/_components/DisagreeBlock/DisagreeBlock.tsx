/* DisagreeBlock — "Where agents disagree", the section under both view modes.

   The switch is the reason this block takes GROUPS as well as conflicts: with it
   off, every place the agents flagged is listed; with it on, only the contended
   ones survive. A block that could only ever show conflicts would give the switch
   nothing to do.

   `did not flag` is the label for a take whose verdict is `ignored`, and the
   server deliberately leaves that string empty (an absent stance is not English
   the server owns). The heading, the switch label and `did not flag` all come
   from the `runs` namespace, which already carries them. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SectionLabel, SEV, Toggle, type Severity } from "@devdigest/ui";
import type { Conflict, FindingGroup } from "@devdigest/shared";
import { agreedGroups } from "./helpers";
import { s } from "./styles";

export interface DisagreeBlockProps {
  groups: FindingGroup[];
  conflicts: Conflict[];
  /** How many of the run's agents finished — the only ones whose silence counts. */
  agentsConsidered: number;
  agentCount: number;
}

export function DisagreeBlock({
  groups,
  conflicts,
  agentsConsidered,
  agentCount,
}: DisagreeBlockProps) {
  const t = useTranslations("multiAgent");
  const tRuns = useTranslations("runs");
  const [onlyConflicts, setOnlyConflicts] = React.useState(false);

  const agreed = onlyConflicts ? [] : agreedGroups(groups, conflicts);
  const nothingToShow = conflicts.length === 0 && agreed.length === 0;

  return (
    <div style={s.wrap}>
      <SectionLabel
        icon="Activity"
        right={
          <label style={s.switchLabel}>
            {tRuns("conflicts.onlyConflicts")}
            <Toggle on={onlyConflicts} onChange={setOnlyConflicts} size={15} />
          </label>
        }
      >
        {tRuns("conflicts.title")}
      </SectionLabel>

      {/* Only when the two numbers differ: "3 of 3" is noise, "2 of 3" is the
          reason a disagreement may be missing an opinion. */}
      {agentsConsidered !== agentCount && (
        <div style={s.considered}>
          {t("conflicts.considered", { considered: agentsConsidered, total: agentCount })}
        </div>
      )}

      {nothingToShow ? (
        <div style={s.empty}>{tRuns("conflicts.empty")}</div>
      ) : (
        <div style={s.list}>
          {conflicts.map((c) => (
            <div key={`${c.file}:${c.line}:${c.title}`} style={s.place}>
              <div style={s.placeHead}>
                <Icon.Code size={13} style={{ color: "var(--text-muted)" }} />
                <span className="mono" style={s.where}>
                  {c.file}:{c.line}
                </span>
                <span style={s.placeTitle}>{c.title}</span>
              </div>
              <div style={s.takes(c.takes.length)}>
                {c.takes.map((take) => {
                  const flagged = take.verdict !== "ignored";
                  const color = flagged
                    ? (SEV[take.verdict as Severity]?.c ?? "var(--warn)")
                    : "var(--text-muted)";
                  return (
                    <div key={`${take.agent_id}:${take.verdict}`} style={s.take}>
                      <div style={s.persona}>{take.persona}</div>
                      <div style={s.verdictRow}>
                        <span style={s.dot(color)} />
                        <span style={s.verdict(flagged)}>
                          {flagged ? take.verdict : tRuns("conflicts.didNotFlag")}
                        </span>
                      </div>
                      {take.note && <div style={s.note}>{take.note}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {agreed.map((g) => (
            <div key={g.key} style={s.place}>
              <div style={s.placeHead}>
                <Icon.Code size={13} style={{ color: "var(--text-muted)" }} />
                <span className="mono" style={s.where}>
                  {g.file}:{g.start_line}
                </span>
                <span style={s.placeTitle}>{g.title}</span>
              </div>
              <div style={s.agreed}>
                {t("group.badge", { count: g.members.length })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
