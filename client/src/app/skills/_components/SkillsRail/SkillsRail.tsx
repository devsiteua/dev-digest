/* The skill list as it appears next to the editor on /skills/:id — the same role
   the agent list plays on /agents/:id. The tile grid lives on /skills. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { useSkills, useUpdateSkill } from "../../../../lib/hooks/skills";
import { filterSkills } from "../../helpers";
import { SkillCard } from "../SkillCard";
import { AddSkillDrawer } from "../AddSkillDrawer";
import { s } from "./styles";

export function SkillsRail({ selectedId, tab }: { selectedId: string; tab: string }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  const [search, setSearch] = React.useState("");
  const [adding, setAdding] = React.useState<"pick" | "blank" | null>(null);

  const list = filterSkills(skills ?? [], search);

  return (
    <div style={s.rail}>
      {adding && <AddSkillDrawer initialMode={adding} onClose={() => setAdding(null)} />}
      <div style={s.header}>
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

      <div style={s.body}>
        {isLoading && (
          <>
            <Skeleton height={104} />
            <Skeleton height={104} />
            <Skeleton height={104} />
          </>
        )}
        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
        {list.map((skill) => (
          <SkillCard
            key={skill.id}
            skill={skill}
            active={skill.id === selectedId}
            // Carry the open tab across skills: comparing two skills' Preview
            // should not drop you back onto Config on every click.
            onClick={() => router.push(`/skills/${skill.id}?tab=${tab}`)}
            onToggle={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })}
          />
        ))}
      </div>
    </div>
  );
}
