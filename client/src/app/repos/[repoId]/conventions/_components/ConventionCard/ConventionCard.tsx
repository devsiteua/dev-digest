/* ConventionCard — one extracted house rule (design N7 `ConventionCard`): the
   rule in italics, the evidence that grounds it, a confidence bar, and the
   accept/reject pair. The card's left edge carries the status.

   The evidence path is a link to the real file on GitHub. It is built here from
   the repo's full_name + default branch, exactly as FindingCard builds its own
   (`FindingCard.tsx:48`) — the component never fetches the repo itself, so this
   stays testable without the repo provider.

   Editing is not in the design, which only accepts or rejects what the model
   wrote. It is here because a rule that is 90% right should be fixable without
   another extraction pass — and `ConventionUpdate` already accepts `rule` and
   `category` (evidence is deliberately not editable: it was read off disk). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, MonoLink, ProgressBar, TextInput, Textarea } from "@devdigest/ui";
import type { ConventionCandidate, ConventionStatus } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { evidenceLabel } from "../../helpers";
import { RULE_EDITOR_ROWS } from "./constants";
import { confidenceColor, confidencePercent, statusColor } from "./helpers";
import { s } from "./styles";

export interface ConventionEdit {
  rule: string;
  category: string;
}

export function ConventionCard({
  candidate,
  repoFullName,
  gitRef,
  onSetStatus,
  onSave,
  pending,
}: {
  candidate: ConventionCandidate;
  /** owner/repo — omitted while the repo list is still loading. */
  repoFullName?: string | null;
  /** The repo's default branch; what the evidence lines were read at. */
  gitRef?: string | null;
  onSetStatus: (status: ConventionStatus) => void;
  /** Persist a reworded rule / re-filed category. Rejects on a failed write. */
  onSave?: (edit: ConventionEdit) => Promise<unknown>;
  /** The status currently being written for THIS card, if any. */
  pending?: ConventionStatus;
}) {
  const t = useTranslations("conventions");

  /* The draft is seeded by the click that opens the editor, never by an effect
     over the candidate. A candidate arriving fresh from a refetch — which
     happens after every accept on any other card — must not overwrite what the
     user is typing (client/INSIGHTS.md, 2026-08-06). */
  const [draft, setDraft] = React.useState<ConventionEdit | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const accepted = candidate.status === "accepted";
  const rejected = candidate.status === "rejected";
  const editing = draft !== null;
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

  const startEdit = () => {
    setFailed(false);
    setDraft({ rule: candidate.rule, category: candidate.category });
  };

  const save = async () => {
    if (!draft || !onSave) return;
    setSaving(true);
    setFailed(false);
    try {
      await onSave({ rule: draft.rule.trim(), category: draft.category.trim() });
      setDraft(null);
    } catch {
      // The draft stays open with the user's text in it — a failed PATCH must
      // not silently discard the wording they just typed.
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const saveDisabled = saving || !draft?.rule.trim() || !draft?.category.trim();

  return (
    <div data-convention-id={candidate.id} style={s.card(statusColor(candidate.status), rejected)}>
      <div style={s.row}>
        <div style={s.main}>
          {editing ? (
            <div style={s.editor}>
              {/* The control sits INSIDE its <label>: `Textarea` does not forward
                  an id or an aria-label, and `vendor/ui` is not ours to widen —
                  implicit association is what gives both fields a name. */}
              <label style={s.editLabel}>
                {t("card.ruleLabel")}
                <Textarea
                  value={draft.rule}
                  onChange={(rule) => setDraft({ ...draft, rule })}
                  rows={RULE_EDITOR_ROWS}
                />
              </label>
              <label style={s.editLabel}>
                {t("card.categoryLabel")}
                <TextInput
                  value={draft.category}
                  onChange={(category) => setDraft({ ...draft, category })}
                  mono
                />
              </label>
              <div style={s.editHint}>{t("card.editHint")}</div>
              {failed && (
                <div role="alert" style={s.editError}>
                  {t("card.saveFailed")}
                </div>
              )}
            </div>
          ) : (
            <div style={s.rule}>{candidate.rule}</div>
          )}

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
            {!editing && (
              <span className="mono" style={s.category}>
                {candidate.category}
              </span>
            )}
          </div>
        </div>

        <div style={s.actions}>
          {editing ? (
            <>
              <Button
                kind="primary"
                size="sm"
                icon="Check"
                full
                loading={saving}
                disabled={saveDisabled}
                onClick={save}
              >
                {saving ? t("card.saving") : t("card.save")}
              </Button>
              <Button
                kind="ghost"
                size="sm"
                icon="X"
                full
                disabled={saving}
                onClick={() => {
                  setDraft(null);
                  setFailed(false);
                }}
              >
                {t("card.cancel")}
              </Button>
            </>
          ) : (
            <>
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
              {onSave && (
                <Button
                  kind="ghost"
                  size="sm"
                  icon="Edit"
                  full
                  disabled={!!pending}
                  onClick={startEdit}
                >
                  {t("card.edit")}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
