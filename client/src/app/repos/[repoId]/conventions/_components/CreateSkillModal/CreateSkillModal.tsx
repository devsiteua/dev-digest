/* CreateSkillModal — design N7, artboard `conv-create`: the accepted candidates
   merged into ONE editable skill, reviewed before anything is written.

   Two deliberate deviations from the design:
     · the body is a mono `Textarea` + a token counter, not the design's
       `CodeEditor` — `@devdigest/ui` has no such primitive and porting one for a
       markdown body would be a design-system change smuggled in as a feature.
       The skill editor's ConfigTab already answers "what does this cost in a
       prompt?" this way, and both screens edit the same field.
     · the name defaults to `repo-conventions` rather than the first rule's slug,
       so a repo's merged skill has one predictable name (see constants). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  FormField,
  Icon,
  Modal,
  SelectInput,
  TextInput,
  Textarea,
  Toggle,
} from "@devdigest/ui";
import type { ConventionCandidate, Skill, SkillType } from "@devdigest/shared";
import { useCreateSkillFromConventions } from "@/lib/hooks/conventions";
import { approxTokens } from "@/lib/tokens";
import { BODY_ROWS, MAX_BODY_CHARS, MODAL_WIDTH, TYPE_VALUES } from "./constants";
import { conventionsToDraft } from "./helpers";
import { s } from "./styles";

export function CreateSkillModal({
  repoId,
  repoName,
  accepted,
  onClose,
}: {
  repoId: string;
  /** owner/repo — what the heading above the modal already shows. */
  repoName: string;
  /** ONLY the accepted candidates. Whatever is here ends up in the body. */
  accepted: ConventionCandidate[];
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const router = useRouter();
  const create = useCreateSkillFromConventions(repoId);

  /* Seeded ONCE, by the click that opened the modal. `accepted` is query data:
     a background refetch hands back a new array on every accept elsewhere, and
     re-deriving the draft from it would wipe the body the user is editing
     (client/INSIGHTS.md, 2026-08-06). The ids are frozen with it, so the request
     merges exactly the cards the draft was written from. */
  const [seed] = React.useState(() =>
    conventionsToDraft(accepted, {
      description: t("create.draft.description", { count: accepted.length, repo: repoName }),
      intro: t("create.draft.intro", { repo: repoName }),
      detected: (evidence) => t("create.draft.detected", { evidence }),
    }),
  );
  const [conventionIds] = React.useState(() => accepted.map((c) => c.id));
  const [mergedCount] = React.useState(accepted.length);

  const [name, setName] = React.useState(seed.name);
  const [description, setDescription] = React.useState(seed.description);
  const [type, setType] = React.useState<SkillType>(seed.type);
  const [enabled, setEnabled] = React.useState(seed.enabled);
  const [body, setBody] = React.useState(seed.body);
  const [created, setCreated] = React.useState<Skill | null>(null);

  const overBudget = body.length > MAX_BODY_CHARS;
  const canSubmit = !!name.trim() && !!body.trim() && !overBudget && !create.isPending;

  const submit = () =>
    create.mutate(
      {
        // No `source` and no `id`: the server stamps `'extracted'` itself, which
        // is what keeps a model-written body inside `wrapUntrusted()`.
        name: name.trim(),
        description,
        type,
        enabled,
        body,
        convention_ids: conventionIds,
      },
      { onSuccess: setCreated },
    );

  if (created) {
    return (
      <Modal
        width={MODAL_WIDTH}
        title={t("create.success.title")}
        subtitle={created.name}
        onClose={onClose}
        footer={
          <div style={s.footer}>
            <Button kind="ghost" onClick={onClose}>
              {t("create.success.close")}
            </Button>
            <Button
              kind="primary"
              icon="ArrowRight"
              onClick={() => router.push(`/skills/${created.id}`)}
            >
              {t("create.success.open")}
            </Button>
          </div>
        }
      >
        {/* The heading is the modal's own title — repeating it here would say
            the same thing twice on a four-line panel. */}
        <div style={s.success}>
          <Icon.Check size={20} style={s.successIcon} />
          <div style={s.successBody}>{t("create.success.body", { name: created.name })}</div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("create.title")}
      subtitle={name}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <span style={s.footerNote}>
            <Icon.GitCommit size={13} />
            {t.rich("create.savedNote", {
              mono: (chunks) => (
                <span className="mono" style={s.footerNoteValue}>
                  {chunks}
                </span>
              ),
            })}
          </span>
          <Button kind="ghost" onClick={onClose}>
            {t("create.cancel")}
          </Button>
          <Button kind="primary" icon="Sparkles" onClick={submit} disabled={!canSubmit}>
            {create.isPending ? t("create.creating") : t("create.submit")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.info}>
          <Icon.Wrench size={15} style={s.infoIcon} />
          <span style={s.infoText}>
            {t.rich("create.mergedFrom", {
              count: mergedCount,
              repo: repoName,
              b: (chunks) => <b style={s.strong}>{chunks}</b>,
              mono: (chunks) => (
                <span className="mono" style={s.mono}>
                  {chunks}
                </span>
              ),
            })}
          </span>
        </div>

        {create.isError && (
          <div role="alert" style={s.alert}>
            <Icon.AlertOctagon size={15} style={s.alertIcon} />
            <div>
              <div style={s.alertTitle}>{t("create.failed")}</div>
              <div style={s.alertBody}>{create.error.message}</div>
            </div>
          </div>
        )}

        <FormField label={t("create.name")} required>
          <TextInput value={name} onChange={setName} mono />
        </FormField>

        <FormField label={t("create.description")}>
          <TextInput value={description} onChange={setDescription} />
        </FormField>

        <div style={s.twoCol}>
          <div style={s.col}>
            <FormField label={t("create.type")}>
              <SelectInput
                value={type}
                onChange={(v) => setType(v as SkillType)}
                options={TYPE_VALUES.map((v) => ({ value: v, label: t(`create.types.${v}`) }))}
              />
            </FormField>
          </div>
          <div style={s.col}>
            <FormField label={t("create.enabled")} hint={t("create.enabledHint")}>
              <div style={s.toggleRow}>
                <Toggle on={enabled} onChange={setEnabled} size={17} />
              </div>
            </FormField>
          </div>
        </div>

        <FormField
          label={t("create.body")}
          required
          hint={overBudget ? t("create.tooLong") : t("create.bodyHint")}
          right={
            <span className="mono" style={overBudget ? s.overBudget : s.bodyMeta}>
              {t("create.bodyTokens", {
                tokens: approxTokens(body),
                chars: body.length,
                max: MAX_BODY_CHARS,
              })}
            </span>
          }
        >
          <Textarea value={body} onChange={setBody} rows={BODY_ROWS} mono />
        </FormField>
      </div>
    </Modal>
  );
}
