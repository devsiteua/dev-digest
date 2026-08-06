/* Route: /skills/:id — the Skills list with one skill open in the editor. Tab
   state lives in ?tab= so a Preview link is shareable. Renders the same
   SkillsListView as /skills, passing the editor as its detail pane. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { SkillsListView } from "../_components/SkillsListView";
import { SkillEditor } from "./_components/SkillEditor";
import { TYPE_COLOR, isUntrusted } from "@/lib/skills";
import { useSkill } from "../../../lib/hooks/skills";
import { ApiError } from "../../../lib/api";

const VALID_TABS = ["config", "preview"];

export default function SkillEditorPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const t = useTranslations("skills");

  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);

  const tab = VALID_TABS.includes(search.get("tab") ?? "") ? search.get("tab")! : "config";
  const setTab = (next: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", next);
    router.replace(`/skills/${id}?${sp.toString()}`);
  };

  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <SkillsListView selectedId={id}>
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
      </SkillsListView>
    );
  }

  if (isLoading || !skill) {
    return (
      <SkillsListView selectedId={id}>
        <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
          <Skeleton height={24} width={240} />
          <Skeleton height={280} />
        </div>
      </SkillsListView>
    );
  }

  return (
    <SkillsListView selectedId={id}>
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "16px 24px 0",
            flexShrink: 0,
          }}
        >
          <Icon.Sparkles size={18} style={{ color: TYPE_COLOR[skill.type] }} />
          <h1 className="mono" style={{ fontSize: 17, fontWeight: 700 }}>
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
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <SkillEditor skill={skill} tab={tab} onTab={setTab} />
        </div>
      </div>
    </SkillsListView>
  );
}
