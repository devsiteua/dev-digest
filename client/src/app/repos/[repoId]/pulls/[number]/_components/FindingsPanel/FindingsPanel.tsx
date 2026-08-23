/* FindingsPanel — severity counters/filter + hide-low-confidence + j/k navigation
   + FindingCard list, wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { severityCounts, type SeverityKey } from "@/lib/severity";
import { FindingCard } from "../FindingCard";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { SeverityFilterChips } from "./_components/SeverityFilterChips";
import { KEY_TO_ACTION } from "./constants";
import { confidenceFiltered, nextSelection, visibleFindings } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  focusFindingId,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** The finding `?findingId=` names, when this panel is the one that holds it. */
  focusFindingId?: string | null;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const [hideLow, setHideLow] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(0);
  // Per-panel, deliberately: the accordion renders one FindingsPanel per review
  // run, and a filter lifted any higher would narrow every run at once. A new run
  // gets a new panel instance (FindingsTab keys accordions by review id), so the
  // filter resets by itself without any explicit reset.
  //
  // `null` is the resting state: all three chips read as active, as the design
  // shows them, and nothing is narrowed. See `nextSelection` for the transitions.
  const [selected, setSelected] = React.useState<readonly SeverityKey[] | null>(null);

  // Only this panel's own finding counts as a target — the accordion renders one
  // panel per run, and every one of them is handed the same id.
  const target = React.useMemo(
    () =>
      focusFindingId && findings.some((f) => f.id === focusFindingId) ? focusFindingId : null,
    [focusFindingId, findings],
  );

  /**
   * A navigation target beats the filters that would hide it.
   *
   * `hideLow` or a narrowed severity selection can perfectly well exclude the
   * card a reader just clicked their way to, and a click that lands on "no
   * findings match" is indistinguishable from a broken link. Widening the filter
   * is visible on screen and one click to undo; silently showing nothing is not.
   */
  React.useEffect(() => {
    if (!target) return;
    setHideLow(false);
    setSelected(null);
  }, [target]);

  const counted = React.useMemo(
    () => severityCounts(confidenceFiltered(findings, hideLow)),
    [findings, hideLow],
  );
  const shown = React.useMemo(
    () => visibleFindings(findings, hideLow, selected),
    [findings, hideLow, selected],
  );

  // Keyboard focus follows the reader, so j/k continues from the card they were
  // brought to rather than from the top of a list they never looked at.
  React.useEffect(() => {
    if (!target) return;
    const i = shown.findIndex((f) => f.id === target);
    if (i >= 0) setFocusIdx(i);
  }, [target, shown]);

  const toggleSeverity = React.useCallback((key: SeverityKey) => {
    setSelected((prev) => nextSelection(prev, key));
    setFocusIdx(0);
  }, []);

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        <SeverityFilterChips counts={counted} selected={selected} onToggle={toggleSeverity} />
        <div style={s.divider} />
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              // With a target, the reader asked for one card in particular; the
              // "first one is open" default would leave two cards open and only
              // one of them the one they clicked.
              defaultExpanded={target ? f.id === target : i === 0}
              focusTarget={f.id === target}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
            />
          ))
        )}
      </div>
    </div>
  );
}
