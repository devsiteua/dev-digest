/* FindingDetailCard — one finding in Tabs + detail mode.

   Four actions, and only two of them exist. Accept and Dismiss go through the
   shipped `useFindingAction` hook. `Learn` and `Turn into eval case` call
   NOTHING: their endpoints belong to other lessons, and a button that posts to a
   route nobody has written would render a 404 as an outage. The honest-stub form
   is L04's — the failure says which lesson owns the endpoint and states that
   nothing was saved, and it does not go away.

   A finding whose group has more than one member carries a badge naming the
   agents that flagged the same place; expanding it shows each agent's ORIGINAL
   text, verbatim. A badge rather than a third block, because the per-agent
   columns stay the primary record and that is what makes the badge's claim
   checkable. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  ConfidenceNum,
  Icon,
  Markdown,
  MonoLink,
  SeverityBadge,
  type Severity,
} from "@devdigest/ui";
import type { AgentColumnFinding, FindingGroup } from "@devdigest/shared";
import { useFindingAction } from "@/lib/hooks/reviews";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { s } from "./styles";

export interface FindingDetailCardProps {
  finding: AgentColumnFinding;
  /** The group this finding belongs to, only when more than one agent is in it. */
  group?: FindingGroup;
  prId: string | null;
  defaultExpanded?: boolean;
}

type Acted = "accepted" | "dismissed" | null;

export function FindingDetailCard({
  finding,
  group,
  prId,
  defaultExpanded,
}: FindingDetailCardProps) {
  const t = useTranslations("multiAgent");
  const tRuns = useTranslations("runs");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const [membersOpen, setMembersOpen] = React.useState(false);
  const [acted, setActed] = React.useState<Acted>(null);
  /** The unbuilt-endpoint message, once one of the two stubs has been pressed. */
  const [stub, setStub] = React.useState<string | null>(null);
  const action = useFindingAction();

  const sevColor = SEV_COLOR[finding.severity] ?? SEV_COLOR_FALLBACK;
  const act = (kind: "accept" | "dismiss") => {
    action.mutate(
      { findingId: finding.id, action: kind, ...(prId ? { prId } : {}) },
      { onSuccess: () => setActed(kind === "accept" ? "accepted" : "dismissed") },
    );
  };

  return (
    <div style={s.card(sevColor, acted !== null)}>
      <div onClick={() => setExpanded((e) => !e)} style={s.head}>
        <SeverityBadge severity={finding.severity as Severity} compact />
        <div style={s.headMain}>
          <div style={s.titleRow}>
            <span style={s.title}>{finding.title}</span>
            {group && (
              <Badge icon="Users" color="var(--accent-text)" bg="var(--accent-bg)">
                {t("group.badge", { count: group.members.length })}
              </Badge>
            )}
          </div>
          <div style={s.metaRow}>
            <span className="mono" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              {finding.file}:
              {finding.start_line === finding.end_line
                ? finding.start_line
                : `${finding.start_line}-${finding.end_line}`}
            </span>
            <ConfidenceNum value={finding.confidence} />
          </div>
        </div>
        <Icon.ChevronDown
          size={16}
          style={{
            color: "var(--text-muted)",
            transform: expanded ? "rotate(180deg)" : "none",
            marginTop: 2,
            flexShrink: 0,
          }}
        />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{finding.rationale}</Markdown>
          </div>

          {finding.suggestion && (
            <>
              <div style={s.label}>{tRuns("trace.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{finding.suggestion}</Markdown>
              </div>
            </>
          )}

          {group && (
            <>
              <div style={s.members}>
                <MonoLink onClick={() => setMembersOpen((o) => !o)}>
                  {membersOpen ? t("group.collapse") : t("group.expand")}
                </MonoLink>
              </div>
              {membersOpen && (
                <div style={s.members}>
                  {group.members.map((m) => (
                    <div key={m.finding_id} style={s.member}>
                      <div style={s.memberAgent}>
                        {m.agent_name} · {m.severity}
                      </div>
                      {/* Verbatim: the member's own title, rationale and fix, as
                          that agent wrote them. Nothing is rewritten or merged. */}
                      <div style={s.title}>{m.title}</div>
                      <div style={s.prose}>
                        <Markdown>{m.rationale}</Markdown>
                      </div>
                      {m.suggestion && (
                        <div style={s.prose}>
                          <Markdown>{m.suggestion}</Markdown>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              active={acted === "accepted"}
              disabled={action.isPending}
              onClick={() => act("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              active={acted === "dismissed"}
              disabled={action.isPending}
              onClick={() => act("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
            <Button kind="ghost" size="sm" icon="Brain" onClick={() => setStub(t("stub.learn"))}>
              {t("finding.learn")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="FlaskConical"
              onClick={() => setStub(t("stub.evalCase"))}
            >
              {t("finding.evalCase")}
            </Button>
          </div>

          {/* Not dismissable: the reader asked for something the product cannot
              do yet, and hiding that after a second would be the "pretend it
              worked" this stub exists to avoid. */}
          {stub && (
            <div role="alert" style={s.stub}>
              {stub}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
