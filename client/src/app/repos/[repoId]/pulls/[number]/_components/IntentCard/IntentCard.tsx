"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Card,
  ConfidenceNum,
  EmptyState,
  Icon,
  SectionLabel,
} from "@devdigest/ui";
import type { IntentSource, PrIntentRecord } from "@devdigest/shared";
import { usePrIntent, useDeriveIntent } from "../../../../../../../lib/hooks/intent";
import { formatCost, formatTokenCount } from "../../../../../../../lib/format";
import { s } from "./styles";

interface IntentCardProps {
  /**
   * Null while the PR list is still resolving `number` → id. The page renders
   * this tab before that lands, so the card tolerates it rather than the page
   * guarding — the same shape `usePullDetail(prId)` already accepts.
   */
  prId: string | null;
}

function ScopeList({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: "ok" | "muted";
}) {
  return (
    <div>
      <div style={s.scopeLabel(tone)}>
        {tone === "ok" ? <Icon.Check size={13} /> : <Icon.X size={13} />}
        {label}
      </div>
      <ul style={s.list}>
        {items.map((item, i) => (
          <li key={i} style={s.item(tone)}>
            <span style={s.bullet(tone)}>·</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What the PR claims to be for, and how much that claim is worth.
 *
 * The quoted line and the two-column scope grid are the design's `IntentBlock`
 * verbatim. Four things are added, which the design's fixture has no concept of:
 * a confidence reading, the sources it was computed from, a Re-derive action, and
 * an empty state for a PR nobody has derived one for yet.
 *
 * Confidence renders through `ConfidenceNum` — the primitive findings and memory
 * items already use — rather than a second confidence visual invented for the
 * same screen. `confidence` is set server-side so each tier lands inside that
 * primitive's own colour bands, which is why there is no colour logic here.
 *
 * Deliberately owns no `<section>` and no outer heading: in the design this block
 * is the top half of a Card that continues into "Risk areas", so the PR Brief
 * lesson has to be able to drop this component into that grid unchanged.
 */
export function IntentCard({ prId }: IntentCardProps) {
  const t = useTranslations("prReview");
  const { data: intent, isLoading } = usePrIntent(prId);
  const derive = useDeriveIntent(prId);

  if (!prId || isLoading) return null;

  if (!intent) {
    return (
      <Card>
        <SectionLabel icon="Target">{t("intent.title")}</SectionLabel>
        <EmptyState
          icon="Target"
          title={t("intent.emptyTitle")}
          body={t("intent.emptyBody")}
          cta={t("intent.derive")}
          onCta={() => derive.mutate()}
          ctaLoading={derive.isPending}
        />
      </Card>
    );
  }

  return (
    <Card>
      <SectionLabel
        icon="Target"
        right={
          <span style={s.right}>
            <ConfidenceNum value={intent.confidence} />
            <Button
              kind="ghost"
              size="sm"
              icon="RefreshCw"
              onClick={() => derive.mutate()}
              loading={derive.isPending}
            >
              {t("intent.rederive")}
            </Button>
          </span>
        }
      >
        {t("intent.title")}
      </SectionLabel>

      <p style={s.quote}>&ldquo;{intent.intent}&rdquo;</p>

      <div style={s.grid}>
        <ScopeList label={t("intent.inScope")} items={intent.in_scope} tone="ok" />
        <ScopeList label={t("intent.outOfScope")} items={intent.out_of_scope} tone="muted" />
      </div>

      {intent.missing_context.length > 0 && (
        // The brief's "an unreachable link must not be silently replaced with
        // invention": what the PR named and we could not read is stated on the
        // card, next to the claim it weakens, rather than left in a log line.
        <div style={s.missing}>
          <Icon.AlertTriangle size={13} style={s.missingIcon} />
          <ul style={s.missingList}>
            <li>{t("intent.missingContext")}</li>
            {intent.missing_context.map((note: string, i: number) => (
              <li key={i}>· {note}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={s.sources}>
        <Badge>{t(`intent.kind.${intent.kind}`)}</Badge>
        {intent.sources.map((source: IntentSource) => (
          <Badge key={source} mono>
            {t(`intent.source.${source}`)}
          </Badge>
        ))}
        <span style={s.meta}>
          {t("intent.derivedBy", { model: intent.model })}
          {" · "}
          {t("intent.usage", {
            tokensIn: formatTokenCount(intent.tokens_in),
            tokensOut: formatTokenCount(intent.tokens_out),
            // Never "$0.0000" for a model we have no price for: null and free are
            // different facts, and only one of them is worth a number.
            cost: intent.cost_usd == null ? t("intent.unpriced") : formatCost(intent.cost_usd),
          })}
        </span>
      </div>
    </Card>
  );
}

export type { PrIntentRecord };
