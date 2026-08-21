"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useDeleteSkill } from "../../../../lib/hooks/skills";
import { SOURCE_ICON, TYPE_COLOR, isUntrusted } from "./constants";
import { s } from "./styles";

/**
 * One skill in the list. Mirrors AgentCard, plus two things a skill has and an
 * agent does not: a provenance chip, and a "needs vetting" badge whenever the
 * body was not written in this workspace.
 *
 * The toggle is the GLOBAL switch (`skills.enabled`): turning it off removes the
 * skill from every agent's prompt at once, without touching anyone's link list.
 */
export function SkillCard({
  skill,
  active,
  onClick,
  onToggle,
}: {
  skill: Skill;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const del = useDeleteSkill();
  const color = TYPE_COLOR[skill.type];
  const untrusted = isUntrusted(skill.source);
  const SourceIcon = Icon[SOURCE_ICON[skill.source]];

  return (
    // The whole card is the click target, so it must also be a keyboard target:
    // a bare <div onClick> is not focusable and cannot be activated with a key.
    // role="button" rather than an <a> because the card contains its own
    // controls, and interactive elements may not nest inside a link.
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? skill.name : undefined}
      onKeyDown={(e) => {
        if (!onClick || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        onClick();
      }}
      style={s.card(!!active, skill.enabled)}
    >
      <div style={s.headerRow}>
        <div style={s.iconBox(color)}>
          <Icon.Sparkles size={14} />
        </div>
        <span className="mono" style={s.name}>
          {skill.name}
        </span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={skill.enabled} onChange={onToggle} size={14} />
          </div>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(t("card.deleteConfirm", { name: skill.name }))) del.mutate(skill.id);
          }}
          disabled={del.isPending}
          title={t("card.delete")}
          aria-label={t("card.delete")}
          style={s.iconBtn(del.isPending)}
        >
          <Icon.Trash
            size={14}
            style={del.isPending ? { animation: "ddspin 1s linear infinite" } : undefined}
          />
        </button>
      </div>

      <div style={s.description}>{skill.description || t("card.noDescription")}</div>

      <div style={s.metaRow}>
        <span style={s.typeChip(color)}>{t(`listItem.type.${skill.type}`)}</span>
        <span style={s.sourceChip}>
          <SourceIcon size={11} />
          {t(`listItem.source.${skill.source}`)}
        </span>
        {untrusted && (
          <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
            {t("listItem.needsVetting")}
          </Badge>
        )}
      </div>
    </div>
  );
}
