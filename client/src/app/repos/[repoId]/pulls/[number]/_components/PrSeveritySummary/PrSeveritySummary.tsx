/* PrSeveritySummary — "CRITICAL 2 · WARNING 1 · SUGGESTION 1" in the PR header.

   The severity chips live inside each run's panel, which is right for filtering
   but leaves a PR with several runs without a single answer to "how bad is this
   PR?". This is that answer, in the sticky header where it stays visible while
   the reader scrolls the findings.

   It tallies EVERY finding on the PR, not just the latest review's — that is the
   set the tab count and the accordions below show, so the numbers here and the
   list underneath always agree. The PR *list* column deliberately differs: it
   reports the latest review only, because summing runs there would triple-count
   one defect three agents each found. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SeverityBadge } from "@devdigest/ui";
import type { SeverityCounts } from "@devdigest/shared";
import { SEVERITY_KEYS, countFor, totalCount } from "@/lib/severity";
import { s } from "./styles";

export function PrSeveritySummary({ counts }: { counts: SeverityCounts }) {
  const t = useTranslations("prReview");

  if (totalCount(counts) === 0) {
    return <span style={s.none}>{t("severity.none")}</span>;
  }

  return (
    <span
      style={s.row}
      title={t("severity.summary", {
        critical: counts.critical,
        warning: counts.warning,
        suggestion: counts.suggestion,
      })}
    >
      {SEVERITY_KEYS.map((key) => {
        const count = countFor(counts, key);
        return (
          <span key={key} style={count === 0 ? s.zero : undefined}>
            <SeverityBadge severity={key} count={count} />
          </span>
        );
      })}
    </span>
  );
}

export default PrSeveritySummary;
