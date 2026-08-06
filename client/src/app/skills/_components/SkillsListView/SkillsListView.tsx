/* /skills — the Skills index: every skill as a tile, the way /agents lists
   agents. Opening a tile navigates to /skills/:id, which is where the list
   becomes a rail next to the editor. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useSkills, useUpdateSkill } from "../../../../lib/hooks/skills";
import { filterSkills } from "../../helpers";
import { SkillCard } from "../SkillCard";
import { AddSkillDrawer } from "../AddSkillDrawer";
import { s } from "./styles";

export function SkillsListView() {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  const [search, setSearch] = React.useState("");
  const [adding, setAdding] = React.useState<"pick" | "blank" | null>(null);

  const list = filterSkills(skills ?? [], search);

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      {adding && <AddSkillDrawer initialMode={adding} onClose={() => setAdding(null)} />}
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("page.heading")}</h1>
            <p style={s.subtitle}>{t("page.subtitle")}</p>
          </div>
          <div style={s.search}>
            <Icon.Search size={13} style={s.searchIcon} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("page.searchPlaceholder")}
              aria-label={t("page.searchPlaceholder")}
              style={s.searchInput}
            />
          </div>
          <Dropdown
            width={220}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                {t("page.addSkill")}
              </Button>
            }
            items={[
              {
                label: t("page.menu.createFromScratch"),
                icon: "Edit",
                onClick: () => setAdding("blank"),
              },
              {
                label: t("page.menu.fromFile"),
                icon: "Upload",
                onClick: () => setAdding("pick"),
              },
            ]}
          />
        </div>

        {isLoading && (
          <div style={s.grid}>
            <Skeleton height={120} />
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        )}
        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
        {!isLoading && !isError && list.length === 0 && (
          <EmptyState
            icon="Sparkles"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => setAdding("pick")}
          />
        )}
        {list.length > 0 && (
          <div style={s.grid}>
            {list.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onClick={() => router.push(`/skills/${skill.id}?tab=config`)}
                onToggle={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
