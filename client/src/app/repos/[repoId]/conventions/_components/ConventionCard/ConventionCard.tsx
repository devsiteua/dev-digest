/* ConventionCard — one extracted house rule (design N7 `ConventionCard`): the
   rule in italics, the evidence that grounds it, a confidence bar, and the
   accept/reject pair. The card's left edge carries the status.

   The evidence path is a link to the real file on GitHub. It is built here from
   the repo's full_name + default branch, exactly as FindingCard builds its own
   (`FindingCard.tsx:48`) — the component never fetches the repo itself, so this
   stays testable without the repo provider. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, MonoLink, ProgressBar } from "@devdigest/ui";
import type { ConventionCandidate, ConventionStatus } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { confidenceColor, confidencePercent, evidenceLabel, statusColor } from "./helpers";
import { s } from "./styles";

export function ConventionCard({
  candidate,
  repoFullName,
  gitRef,
  onSetStatus,
  pending,
}: {
  candidate: ConventionCandidate;
  /** owner/repo — omitted while the repo list is still loading. */
  repoFullName?: string | null;
  /** The repo's default branch; what the evidence lines were read at. */
  gitRef?: string | null;
  onSetStatus: (status: ConventionStatus) => void;
  /** The status currently being written for THIS card, if any. */
  pending?: ConventionStatus;
}) {
  const t = useTranslations("conventions");
  const accepted = candidate.status === "accepted";
  const rejected = candidate.status === "rejected";
  const href =
    repoFullName && gitRef
      ? githubBlobUrl(
          repoFullName,
          gitRef,
          candidate.evidence_path,
          candidate.evidence_start_line,
          candidate.evidence_end_line,
        )
      : undefined;

  return (
    <div data-convention-id={candidate.id} style={s.card(statusColor(candidate.status), rejected)}>
      <div style={s.row}>
        <div style={s.main}>
          <div style={s.rule}>{candidate.rule}</div>

          <div style={s.evidence}>
            <div style={s.evidenceHeader}>
              <MonoLink href={href}>{evidenceLabel(candidate)}</MonoLink>
              {href && <span style={s.evidenceHint}>{t("card.evidenceHint")}</span>}
            </div>
            <pre className="mono" style={s.snippet}>
              {candidate.evidence_snippet}
            </pre>
          </div>

          <div style={s.confidenceRow}>
            <span style={s.confidenceLabel}>{t("card.confidence")}</span>
            <div style={s.confidenceTrack}>
              <ProgressBar
                value={confidencePercent(candidate.confidence)}
                height={5}
                color={confidenceColor(candidate.confidence)}
              />
            </div>
            <span className="mono tnum" style={s.confidenceValue}>
              {confidencePercent(candidate.confidence)}%
            </span>
          </div>
        </div>

        <div style={s.actions}>
          {/* Both buttons toggle back to `pending`, which is what makes
              "Deselect all" reachable one card at a time. */}
          <Button
            kind={accepted ? "primary" : "secondary"}
            size="sm"
            icon={accepted ? "Check" : "Plus"}
            full
            loading={pending === "accepted"}
            disabled={!!pending}
            onClick={() => onSetStatus(accepted ? "pending" : "accepted")}
          >
            {pending === "accepted"
              ? t("card.accepting")
              : accepted
                ? t("card.accepted")
                : t("card.accept")}
          </Button>
          <Button
            kind="ghost"
            size="sm"
            icon="X"
            full
            active={rejected}
            loading={pending === "rejected"}
            disabled={!!pending}
            onClick={() => onSetStatus(rejected ? "pending" : "rejected")}
          >
            {pending === "rejected"
              ? t("card.rejecting")
              : rejected
                ? t("card.rejected")
                : t("card.reject")}
          </Button>
        </div>
      </div>
    </div>
  );
}
