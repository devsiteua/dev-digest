"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { isUntrusted } from "@/lib/skills";
import { MARKDOWN_CSS, s } from "../../styles";

/** The skill body as the reviewing agent receives it. */
export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");

  return (
    <div style={s.previewWrap}>
      <style>{MARKDOWN_CSS}</style>
      <h2 style={s.h2}>{t("editor.tabs.preview")}</h2>
      <p style={s.previewLead}>{t("preview.lead")}</p>

      {isUntrusted(skill.source) && (
        <div style={s.untrustedNotice}>
          <Icon.AlertTriangle size={16} style={{ color: "var(--warn)", flexShrink: 0 }} />
          <span>{t("preview.untrustedNotice")}</span>
        </div>
      )}

      <div style={s.card}>
        <Markdown>{skill.body}</Markdown>
      </div>
    </div>
  );
}
