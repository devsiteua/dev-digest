/* SeverityFilterChips — the severity counters above a run's findings, doubling as
   a filter. The row rests with every chip active, as the design shows it, so it
   reads as a summary of the run until the user decides to narrow it.

   `selected === null` is that resting state. The first click isolates one level
   ("show me only the critical ones"); from there the row is a plain multi-select,
   and clearing it returns to all-active. Transitions live in `nextSelection`.

   All three chips always render, including a zero. Hiding a zero would reflow the
   row under the cursor the moment a toggle emptied a level — and the count itself
   is information: "no suggestions" is an answer. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Chip, SEV } from "@devdigest/ui";
import type { SeverityCounts } from "@devdigest/shared";
import { SEVERITY_KEYS, countFor, type SeverityKey } from "@/lib/severity";
import { s } from "./styles";

export function SeverityFilterChips({
  counts,
  selected,
  onToggle,
}: {
  /** Tallied over the same set the list shows, so a chip never advertises a
   *  finding the confidence toggle has hidden. */
  counts: SeverityCounts;
  /** `null` = nothing narrowed, every chip active. */
  selected: readonly SeverityKey[] | null;
  onToggle: (key: SeverityKey) => void;
}) {
  const t = useTranslations("prReview");
  const all = selected === null;

  return (
    <div style={s.row} role="group" aria-label={t("panel.severityFilterLabel")}>
      {SEVERITY_KEYS.map((key) => {
        const count = countFor(counts, key);
        const label = t(`severity.${key.toLowerCase()}`);
        const active = all || selected.includes(key);
        // What the next click will do, so the tooltip never lies about it.
        const hint = all
          ? "panel.severityIsolate"
          : selected.length === 1 && active
            ? "panel.severityShowAll"
            : "panel.severityToggle";
        const chip = (
          <Chip
            icon={SEV[key].icon}
            color={SEV[key].c}
            count={count}
            active={active}
            onClick={count > 0 ? () => onToggle(key) : undefined}
          >
            {label}
          </Chip>
        );

        // `Chip` has no `disabled` prop and `vendor/ui` is off-limits, so the empty
        // state is the same chip made inert by its wrapper — identical geometry,
        // so toggling never shifts the row.
        return count > 0 ? (
          <span key={key} title={t(hint, { severity: label, count })}>
            {chip}
          </span>
        ) : (
          <span
            key={key}
            style={s.empty}
            aria-disabled="true"
            title={t("panel.severityEmpty", { severity: label })}
          >
            {chip}
          </span>
        );
      })}
    </div>
  );
}

export default SeverityFilterChips;
