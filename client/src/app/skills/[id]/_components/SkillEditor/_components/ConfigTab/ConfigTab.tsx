"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, FormField, SelectInput, TextInput, Textarea, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useDeleteSkill, useUpdateSkill } from "../../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../../lib/toast";
import { approxTokens } from "@/lib/tokens";
import { MAX_BODY_CHARS, TYPE_VALUES } from "../../constants";
import { s } from "../../styles";

/**
 * The skill itself. Everything above the body is metadata; the body is the only
 * text that ever reaches a model, which is what the field hints say out loud.
 */
export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const router = useRouter();
  const update = useUpdateSkill();
  const del = useDeleteSkill();

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);

  // Reset the form when the route switches to another skill.
  React.useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
  }, [skill.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const overBudget = body.length > MAX_BODY_CHARS;
  const bodyChanged = body !== skill.body;

  const save = () =>
    update.mutate(
      { id: skill.id, patch: { name, description, type, body } },
      {
        onSuccess: (data) =>
          toast.success(
            bodyChanged
              ? t("config.savedNewVersion", { version: data.version })
              : t("config.saved"),
          ),
      },
    );

  const remove = () => {
    if (!window.confirm(t("card.deleteConfirm", { name: skill.name }))) return;
    del.mutate(skill.id, { onSuccess: () => router.push("/skills") });
  };

  return (
    <div style={s.form}>
      <div style={s.headRow}>
        <h2 style={s.h2}>{t("config.heading")}</h2>
        {/* Applied immediately, not collected into the draft: the same field is
            toggled from the skill card, and a stale copy in this form would be
            written back over that on the next unrelated save. */}
        <label style={s.enabledLabel}>
          {t("preview.enabled")}
          <Toggle
            on={skill.enabled}
            onChange={(next) => update.mutate({ id: skill.id, patch: { enabled: next } })}
            size={16}
          />
        </label>
      </div>

      <FormField label={t("config.name")} required>
        <TextInput value={name} onChange={setName} mono />
      </FormField>

      <FormField label={t("config.description")} hint={t("config.descriptionHint")}>
        <TextInput value={description} onChange={setDescription} />
      </FormField>

      <FormField label={t("config.type")} hint={t("config.typeHint")}>
        <SelectInput
          value={type}
          onChange={(v) => setType(v as SkillType)}
          options={TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
        />
      </FormField>

      <FormField
        label={t("config.body")}
        required
        hint={t("config.bodyHint")}
        right={
          <span className="mono" style={overBudget ? s.overBudget : s.bodyMeta}>
            {t("config.bodyTokens", {
              tokens: approxTokens(body),
              chars: body.length,
              max: MAX_BODY_CHARS,
            })}
          </span>
        }
      >
        <Textarea value={body} onChange={setBody} rows={20} mono />
      </FormField>

      <div style={s.actions}>
        <Button
          kind="primary"
          icon="Check"
          onClick={save}
          disabled={update.isPending || overBudget || !name.trim() || !body.trim()}
        >
          {update.isPending ? t("config.saving") : t("config.save")}
        </Button>
        {overBudget && <span style={s.overBudget}>{t("config.tooLong")}</span>}
        {bodyChanged && !overBudget && (
          <span style={s.savedNote}>{t("config.willVersion", { version: skill.version + 1 })}</span>
        )}
      </div>

      <div style={s.danger}>
        <div style={{ flex: 1 }}>
          <div style={s.dangerTitle}>{t("config.deleteTitle")}</div>
          <div style={s.dangerBody}>{t("config.deleteBody")}</div>
        </div>
        <Button kind="danger" size="sm" icon="Trash" onClick={remove} disabled={del.isPending}>
          {t("card.delete")}
        </Button>
      </div>
    </div>
  );
}
