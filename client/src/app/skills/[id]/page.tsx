/* Route: /skills/:id — the skill rail on the left, that skill's editor on the
   right, the same shape as /agents/:id. Tab state lives in ?tab= so a Preview
   link is shareable. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../components/app-shell";
import { SkillsRail } from "../_components/SkillsRail";
import { SkillEditor } from "./_components/SkillEditor";
import { TAB_KEYS } from "./_components/SkillEditor/constants";
import { TYPE_COLOR, isUntrusted } from "@/lib/skills";
import { useSkill } from "../../../lib/hooks/skills";
import { ApiError } from "../../../lib/api";
import { s } from "./styles";

export default function SkillEditorPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const t = useTranslations("skills");

  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);

  const tab = TAB_KEYS.includes(search.get("tab") ?? "") ? search.get("tab")! : TAB_KEYS[0]!;
  const setTab = (next: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", next);
    router.replace(`/skills/${id}?${sp.toString()}`);
  };

  const notFound = isError && error instanceof ApiError && error.status === 404;
  const crumb = [
    { label: t("page.crumbLab") },
    { label: t("page.crumbSkills"), href: "/skills" },
    { label: skill?.name ?? t("detail.crumbSkill") },
  ];

  return (
    <AppShell crumb={crumb}>
      <div style={s.shell}>
        <SkillsRail selectedId={id} tab={tab} />

        <div style={s.detailPane}>
          {isError && (
            <ErrorState
              title={notFound ? t("detail.notFound.title") : t("detail.loadError")}
              body={
                notFound
                  ? t("detail.notFound.body")
                  : error instanceof ApiError
                    ? error.message
                    : t("detail.loadError")
              }
              onRetry={notFound ? undefined : () => refetch()}
            />
          )}

          {!isError && (isLoading || !skill) && (
            <div style={s.skeletonWrap}>
              <Skeleton height={24} width={240} />
              <Skeleton height={280} />
            </div>
          )}

          {!isError && !isLoading && skill && (
            <>
              <div style={s.detailHeader}>
                <Icon.Sparkles size={18} style={{ color: TYPE_COLOR[skill.type] }} />
                <h1 className="mono" style={s.detailTitle}>
                  {skill.name}
                </h1>
                <Badge color="var(--text-secondary)" icon="GitCommit">
                  {t("preview.version", { version: skill.version })}
                </Badge>
                {!skill.enabled && <Badge color="var(--text-muted)">{t("preview.disabled")}</Badge>}
                {isUntrusted(skill.source) && (
                  <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
                    {t("preview.untrustedBadge")}
                  </Badge>
                )}
              </div>
              <div style={s.editorScroll}>
                <SkillEditor skill={skill} tab={tab} onTab={setTab} />
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
