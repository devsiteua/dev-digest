/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "@/lib/findings";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";
import { s } from "./styles";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  focusTarget,
  onAction,
  pending,
  onCreateEvalCase,
  evalCasePending,
  repoFullName,
  headSha,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  /**
   * True while this card is the one `?findingId=` names — a reader who clicked a
   * severity badge in the Smart Diff and was brought here.
   *
   * It is a prop rather than something the card reads off the URL because the
   * card is rendered in three places (per-run panel, and one day elsewhere) and
   * only its parent knows whether this list is the one being navigated into.
   */
  focusTarget?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
  /**
   * Freeze this finding into an eval case.
   *
   * A callback, never a `fetch`: the mutation and the query invalidation live in
   * `FindingsPanel` and `lib/hooks/evals.ts`, which is where the card's siblings
   * put accept and dismiss too.
   */
  onCreateEvalCase?: () => void;
  /** True while THIS card's eval-case mutation is in flight. */
  evalCasePending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  /**
   * Open and reveal the card the URL asked for.
   *
   * The scroll waits a frame: `setExpanded(true)` has not been painted yet when
   * this effect runs, so scrolling now would centre the collapsed header and
   * leave the body below the fold. Expanding is part of the navigation, not a
   * nicety — landing on a closed card means the reader has to find and click the
   * thing they already clicked.
   */
  React.useEffect(() => {
    if (!focusTarget) return;
    setExpanded(true);
    const raf = requestAnimationFrame(() => {
      rootRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(raf);
  }, [focusTarget, f.id]);
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;

  /**
   * An eval case records a decision that has already been made, so a finding
   * with neither an accept nor a dismiss has nothing to assert (AC-03).
   *
   * Derived HERE, from the two fields the card already reads, rather than passed
   * down: the disabled state and the reason for it are the same fact, and
   * splitting them across a prop boundary is how a control ends up disabled with
   * no explanation. The reason is the button's `title`, so it is available to a
   * pointer and to a screen reader without a tooltip component.
   */
  const decided = accepted || dismissed;
  const evalCaseReason = decided ? undefined : t("finding.makeEvalCaseUndecided");

  return (
    <div ref={rootRef} data-finding-id={f.id} style={s.card(!!focused, sevColor, muted)}>
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              active={accepted}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              active={dismissed}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="Gauge"
              disabled={!decided || evalCasePending}
              title={evalCaseReason}
              /* The accessible name carries the FINDING, not just the verb. A
                 pull request renders one of these per finding — ten on the
                 seeded demo — and a browser flow locating a button by name can
                 only ever mean "whichever the runner picks first" when ten of
                 them share a label (`e2e/INSIGHTS.md`, 2026-08-23). The fix
                 belongs here rather than in the flow: it is also the better
                 label for a screen reader, which otherwise hears the same three
                 words ten times with no idea which finding is which. */
              aria-label={t("finding.makeEvalCaseNamed", { title: f.title })}
              onClick={() => onCreateEvalCase?.()}
            >
              {evalCasePending ? t("finding.makeEvalCasePending") : t("finding.makeEvalCase")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
