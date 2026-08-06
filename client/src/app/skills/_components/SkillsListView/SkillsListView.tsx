"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useSkills, useUpdateSkill } from "../../../../lib/hooks/skills";
import { SkillCard } from "../SkillCard";
import { AddSkillDrawer } from "../AddSkillDrawer";
import { filterSkills } from "./helpers";
import { s } from "./styles";

/**
 * The Skills screen: a filterable list on the left, and whatever the route says
 * belongs on the right — the editor for `/skills/:id`, or a prompt to pick one at
 * `/skills`. Both routes render THIS component so the list does not remount (and
 * lose its scroll and filter) when you move between skills.
 */
export function SkillsListView({
  selectedId,
  children,
}: {
  selectedId?: string;
  children?: React.ReactNode;
}) {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  const [search, setSearch] = React.useState("");
  const [adding, setAdding] = React.useState<"pick" | "blank" | null>(null);

  const list = filterSkills(skills ?? [], search);
  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }];

  return (
    <AppShell crumb={crumb}>
      {adding && <AddSkillDrawer initialMode={adding} onClose={() => setAdding(null)} />}
      <div style={s.shell}>
        <div style={s.listPane}>
          <div style={s.listHeader}>
            <div style={s.titleRow}>
              <h1 style={s.h1}>{t("page.heading")}</h1>
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
          </div>

          <div style={s.listBody}>
            {isLoading && (
              <>
                <Skeleton height={104} />
                <Skeleton height={104} />
                <Skeleton height={104} />
              </>
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
            {list.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                active={skill.id === selectedId}
                onClick={() => router.push(`/skills/${skill.id}?tab=config`)}
                onToggle={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })}
              />
            ))}
          </div>
        </div>

        <div style={s.detailPane}>
          {children ?? (
            <div style={s.placeholder}>
              <div>
                <Icon.Sparkles size={28} style={{ color: "var(--text-muted)" }} />
                <h2 style={s.placeholderTitle}>{t("page.selectPrompt.title")}</h2>
                <p style={s.placeholderBody}>{t("page.selectPrompt.body")}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
