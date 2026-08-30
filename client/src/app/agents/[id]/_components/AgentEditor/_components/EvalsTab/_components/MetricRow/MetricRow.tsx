/* MetricRow — one eval metric, rendered honestly.

   The ONE rule this component exists for: a metric whose denominator is 0 shows
   `—`, never a number. The scoring layer returns a vacuous `1` on an empty
   denominator because the contract's `z.number().min(0).max(1)` cannot carry
   null — and `Math.round(1 * 100)` is `100`, which reads as a perfect score for
   a set that asserted nothing. The design's metric cards do exactly that
   rounding with no such branch, so this is a deliberate divergence from the
   artboard rather than an omission from it (AC-20 → AC-21).

   Shared by the Evals tab, the Eval Dashboard and the comparison screen — three
   consumers in three branches of the tree, which is what earns it a folder. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { s } from "./styles";

export function MetricRow({
  label,
  value,
  denominator,
  numerator,
  delta,
  color,
}: {
  label: string;
  /** The ratio as stored: 0–1, or null while a batch is still running. */
  value: number | null;
  /** What the ratio was computed over. `0` is what turns the value into `—`. */
  denominator: number;
  /** Shown beside the value so a percentage is never read without its size. */
  numerator?: number;
  delta?: number | null;
  color?: string;
}) {
  const t = useTranslations("eval");
  const empty = denominator === 0 || value === null;

  return (
    <div style={s.card} data-metric={label}>
      <div style={s.label}>{label}</div>
      {empty ? (
        <div
          style={s.empty}
          title={t("metric.emptyTitle", { metric: label.toLowerCase() })}
          data-empty="true"
        >
          {t("metric.empty")}
        </div>
      ) : (
        <>
          <div style={s.value(color)}>{Math.round(value * 100)}%</div>
          {numerator !== undefined && (
            <div style={s.denominator}>
              {t("metric.denominator", { numerator, denominator })}
            </div>
          )}
          {delta != null && delta !== 0 && (
            <div style={s.delta(delta)}>
              {delta > 0 ? "+" : ""}
              {Math.round(delta * 100)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
