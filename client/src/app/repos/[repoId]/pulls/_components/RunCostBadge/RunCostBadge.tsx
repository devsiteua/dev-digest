/* RunCostBadge — what one review run cost, in the two shapes the design uses:
   compact ("$0.014") for the PR list column and the review-run header, and
   with-tokens ("9,119 tok · $0.0013") for the Agent runs timeline.

   Deliberately font-agnostic: it inherits size and colour from its container so
   the same component fits a 12px table cell and an 11px muted timeline column.
   Only the unknown-cost dash overrides colour. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { formatCost, formatTokenCount } from "@/lib/format";
import { s } from "./styles";

export function RunCostBadge({
  costUsd,
  tokens,
}: {
  /** Null = unknown (unpriced model / never reviewed). 0 = genuinely free. */
  costUsd: number | null | undefined;
  /** When > 0, renders the token count alongside the cost. */
  tokens?: number | null;
}) {
  const t = useTranslations("prReview");
  const unknown = costUsd == null;
  const cost = formatCost(costUsd);

  if (tokens == null || tokens <= 0) {
    return (
      <span className="tnum" style={s.value(unknown)}>
        {cost}
      </span>
    );
  }
  return (
    <span className="mono" style={s.value(false)}>
      {formatTokenCount(tokens)} {t("cost.tokensUnit")}
      {unknown ? "" : ` · ${cost}`}
    </span>
  );
}
