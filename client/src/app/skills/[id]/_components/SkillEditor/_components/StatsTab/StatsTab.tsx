"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BarRow, Card, CircularScore, EmptyState, Icon, MonoLink, SectionLabel } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillStats } from "@/lib/hooks/skills";
import { CATEGORY_BAR_COLOR } from "./constants";
import { s } from "./styles";

/**
 * What happened after this skill was attached.
 *
 * The tiles are usage, NOT the skill's performance, and the note under the
 * heading says so on screen rather than only in the contract: `findings` records
 * the agent that produced it, so two skills on one agent report identical
 * numbers. Removing that sentence would turn an honest approximation into a
 * claim the data cannot support.
 */
export function StatsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: stats, isError } = useSkillStats(skill.id);

  if (isError) return <p style={s.error}>{t("stats.loadError")}</p>;
  if (!stats) return null;

  if (stats.used_by.length === 0) {
    return (
      <EmptyState
        icon="BarChart"
        title={t("stats.empty.title")}
        body={t("stats.empty.body")}
      />
    );
  }

  const decided = stats.accepted + stats.dismissed;
  const acceptPct = stats.accept_rate == null ? null : Math.round(stats.accept_rate * 100);
  const maxCategory = Math.max(1, ...stats.by_category.map((c) => c.count));

  return (
    <div style={s.wrap}>
      <h2 style={s.h2}>{t("stats.heading")}</h2>
      <p style={s.lead}>{t("stats.lead", { days: stats.window_days })}</p>
      <p style={s.attribution}>
        <Icon.Info size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span>{t("stats.attribution")}</span>
      </p>

      <div style={s.tiles}>
        <Tile
          label={t("stats.usedBy")}
          value={stats.used_by.length}
          suffix={` ${t("stats.usedByUnit", { count: stats.used_by.length })}`}
        />
        <Tile label={t("stats.runs", { days: stats.window_days })} value={stats.runs} />
        <Tile label={t("stats.findings", { days: stats.window_days })} value={stats.findings} />
        <Tile
          label={t("stats.acceptRate")}
          value={acceptPct == null ? t("stats.acceptRateNone") : acceptPct}
          suffix={acceptPct == null ? undefined : "%"}
          arc={acceptPct}
          note={
            decided === 0
              ? undefined
              : t("stats.acceptRateHint", { accepted: stats.accepted, decided })
          }
        />
      </div>

      <div style={s.cards}>
        <Card>
          <SectionLabel icon="Cpu">{t("stats.agentsCard")}</SectionLabel>
          <div style={s.agentList}>
            {stats.used_by.map((a) => (
              <div key={a.agent_id} style={s.agentRow}>
                <span style={s.agentIcon}>
                  <Icon.Cpu size={12} />
                </span>
                <span style={s.agentName}>{a.agent_name}</span>
                {!a.agent_enabled && <span style={s.disabled}>{t("stats.agentDisabled")}</span>}
                <MonoLink onClick={() => router.push(`/agents/${a.agent_id}?tab=skills`)}>
                  {t("stats.open")}
                </MonoLink>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionLabel icon="Tag">{t("stats.categoriesCard")}</SectionLabel>
          {stats.by_category.length === 0 ? (
            <p style={s.noFindings}>{t("stats.noFindings")}</p>
          ) : (
            <div style={s.bars}>
              {stats.by_category.map((c) => (
                <BarRow
                  key={c.category}
                  label={c.category}
                  value={c.count}
                  max={maxCategory}
                  color={CATEGORY_BAR_COLOR[c.category] ?? "var(--accent)"}
                  suffix={String(c.count)}
                />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  suffix,
  arc,
  note,
}: {
  label: string;
  value: React.ReactNode;
  suffix?: string;
  arc?: number | null;
  note?: string;
}) {
  return (
    <div style={s.tile}>
      <div style={s.tileHead}>
        <span style={s.tileLabel}>{label}</span>
        {arc != null && <CircularScore score={arc} size={32} stroke={3.5} />}
      </div>
      <div style={s.tileValue} className="tnum">
        {value}
        {suffix && <span style={s.tileSuffix}>{suffix}</span>}
      </div>
      {note && <div style={s.tileNote}>{note}</div>}
    </div>
  );
}
