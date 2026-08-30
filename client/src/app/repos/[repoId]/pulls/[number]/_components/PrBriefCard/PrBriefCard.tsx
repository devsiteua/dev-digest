"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, EmptyState, Icon, SectionLabel } from "@devdigest/ui";
import { usePrBrief, useGenerateBrief } from "@/lib/hooks/brief";
import { formatCost, formatTokenCount } from "@/lib/format";
import { RISK_SEV } from "./constants";
import { RiskPillRow } from "./_components/RiskPillRow";
import { ReviewFocusList } from "./_components/ReviewFocusList";
import { WhyTimeline } from "./_components/WhyTimeline";
import { s } from "./styles";

interface PrBriefCardProps {
  /**
   * Null while the PR list is still resolving `number` → id, the same way
   * `IntentCard` tolerates it rather than making the page guard.
   */
  prId: string | null;
  /**
   * Opens a file in the Files tab — one navigation, defined by the page, which
   * is what owns the URL. REQUIRED at every hop on purpose: `DiffTab` declares
   * `onOpenFinding?` optional, and an unpassed optional callback compiles into
   * a button that quietly does nothing. Without the `?`, `pnpm typecheck` is
   * the gate that the chain is threaded.
   */
  onOpenFile: (path: string, line: number | null) => void;
}

/**
 * Why this pull request exists, what it risks, and where to start reading.
 *
 * The first block of the Overview tab, full width. The design (screen
 * `pull-request-detail`, artboard `pr-overview`) gives this card exactly one
 * thing — `RiskPillRow` — and gives `what`, `why`, `risk_level` and
 * `review_focus` no artboard at all, which is to say it has no drawing for the
 * four fields this feature exists to produce. Every decision about those is
 * derived, and the spec's Design analysis is what each derivation follows.
 *
 * Block order is AC-32 and is asserted by a test rather than left to reading:
 * header → what/why → divider → Risk areas → divider → Review focus → Why
 * Timeline. `data-block` exists for that test, because dividers carry no text
 * and there is no accessible query for "the fifth thing in this card".
 *
 * Three states the design has no concept of, each named by a criterion:
 * nothing generated yet is an `EmptyState` with a CTA and no mutation before
 * the click (AC-30); a stale brief keeps the brief on screen behind a banner
 * rather than hiding it (AC-31); a degraded input is said out loud beside the
 * claim it weakens rather than left in a log line.
 */
export function PrBriefCard({ prId, onOpenFile }: PrBriefCardProps) {
  const t = useTranslations("brief");
  const { data: brief, isLoading } = usePrBrief(prId);
  const generate = useGenerateBrief(prId);

  if (!prId || isLoading) return null;

  if (!brief) {
    return (
      <Card>
        <SectionLabel icon="Sparkles">{t("card.title")}</SectionLabel>
        {/* No mutation fires before this button is clicked — the card asks, it
            does not spend (AC-30). */}
        <EmptyState
          icon="Sparkles"
          title={t("unavailable")}
          body={t("unavailableHint")}
          cta={t("card.generate")}
          onCta={() => generate.mutate()}
          ctaLoading={generate.isPending}
        />
      </Card>
    );
  }

  const regenerate = (
    <Button
      kind="ghost"
      size="sm"
      icon="RefreshCw"
      onClick={() => generate.mutate()}
      loading={generate.isPending}
    >
      {t("card.regenerate")}
    </Button>
  );

  return (
    <Card>
      <div data-block="header">
        <SectionLabel
          icon="Sparkles"
          right={
            <span style={s.right}>
              <Badge color={RISK_SEV[brief.risk_level]}>{t(`severity.${brief.risk_level}`)}</Badge>
              <span style={s.meta}>
                {t("card.generatedBy", { model: brief.model })}
                {" · "}
                {t("card.usage", {
                  tokensIn: formatTokenCount(brief.tokens_in),
                  tokensOut: formatTokenCount(brief.tokens_out),
                  // null and free are different facts, and only one is a number.
                  cost: brief.cost_usd == null ? t("card.unpriced") : formatCost(brief.cost_usd),
                })}
                {/* `trimmed` belongs beside tokens and cost: a reader comparing
                    two briefs needs to know one of them was asked less. */}
                {brief.trimmed.length > 0 && ` · ${t("card.trimmedShort")}`}
              </span>
              {regenerate}
            </span>
          }
        >
          {t("card.title")}
        </SectionLabel>

        {brief.stale && (
          <div style={s.stale} role="status">
            <Icon.AlertTriangle size={16} style={s.staleIcon} />
            <div>
              <span style={s.staleTitle}>{t("card.stale.title")}</span>
              {t("card.stale.body")}
            </div>
            <span style={s.staleAction}>{regenerate}</span>
          </div>
        )}
      </div>

      <div data-block="prose">
        <div style={s.proseLabel}>{t("card.what")}</div>
        <p style={s.prose}>{brief.what}</p>
        <div style={s.proseLabel}>{t("card.why")}</div>
        <p style={s.prose}>{brief.why}</p>

        {brief.missing_inputs.length > 0 && (
          // Under the prose, next to the claim it weakens — the placement
          // `IntentCard` already uses for `missing_context`.
          <div style={s.note}>
            <Icon.AlertTriangle size={13} style={s.noteIcon} />
            <ul style={s.noteList}>
              <li>{t("card.missingInputs")}</li>
              {brief.missing_inputs.map((note) => (
                <li key={note}>· {note}</li>
              ))}
            </ul>
          </div>
        )}

        {brief.trimmed.length > 0 && (
          <div style={s.note}>
            <Icon.Filter size={13} style={s.noteIcon} />
            <ul style={s.noteList}>
              <li>{t("card.trimmed")}</li>
              {brief.trimmed.map((note) => (
                <li key={note}>· {note}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div data-block="divider-risks" style={s.divider} />

      <div data-block="risks">
        <div style={s.blockLabel}>
          <Icon.AlertTriangle size={13} />
          {t("card.risks")}
        </div>
        {brief.risks.length > 0 ? (
          <RiskPillRow risks={brief.risks} onOpenFile={onOpenFile} />
        ) : (
          <div style={s.emptyBlock}>{t("noRisks")}</div>
        )}
      </div>

      <div data-block="divider-focus" style={s.divider} />

      <div data-block="focus">
        <div style={s.blockLabel}>
          <Icon.ListChecks size={13} />
          {t("card.focus")}
        </div>
        <ReviewFocusList items={brief.review_focus} onOpenFile={onOpenFile} />

        {brief.dropped_refs.length > 0 && (
          // A card that quietly says less than the model did is the thing this
          // one line exists to prevent.
          <div style={s.note}>
            <Icon.Slash size={13} style={s.noteIcon} />
            <ul style={s.noteList}>
              <li>{t("card.droppedRefs")}</li>
              {brief.dropped_refs.map((ref) => (
                <li key={ref} className="mono">
                  · {ref}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div data-block="timeline" style={{ marginTop: 16 }}>
        <WhyTimeline entries={brief.history} />
      </div>
    </Card>
  );
}
