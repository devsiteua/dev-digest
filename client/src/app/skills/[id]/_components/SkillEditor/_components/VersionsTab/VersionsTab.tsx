"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useRestoreSkillVersion, useSkillVersions } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { formatSnapshotDate } from "./helpers";
import { s } from "./styles";

/**
 * Every body this skill has had, newest first.
 *
 * Restoring moves the skill FORWARD — the server appends the old text as a new
 * version — so nothing here is ever overwritten and an eval that scored v4 can
 * still be replayed against v4. The hint under the heading says that out loud,
 * because "Restore" reads like "go back" everywhere else.
 */
export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isError } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();
  const [open, setOpen] = React.useState<number | null>(null);

  if (isError) return <p style={s.error}>{t("versions.loadError")}</p>;
  if (!versions) return null;

  const onRestore = (version: number) =>
    restore.mutate(
      { id: skill.id, version },
      {
        onSuccess: (data) =>
          toast.success(t("versions.restored", { version, newVersion: data.version })),
        onError: () => toast.error(t("versions.restoreFailed")),
      },
    );

  // The in-flight row comes from the mutation's own variables, so one shared
  // hook can drive per-row pending state without a map in component state.
  const pending = restore.isPending ? restore.variables?.version : undefined;

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <h2 style={s.h2}>{t("versions.heading")}</h2>
        <Badge color="var(--text-secondary)">
          {t("versions.count", { count: versions.length })}
        </Badge>
      </div>
      <p style={s.lead}>{t("versions.lead")}</p>
      <p style={s.hint}>{t("versions.restoreHint")}</p>

      <div style={s.list}>
        {versions.map((v) => {
          const isCurrent = v.version === skill.version;
          const isOpen = open === v.version;
          return (
            <div key={v.version} style={isCurrent ? s.rowCurrent : s.row}>
              <div style={s.rowHead}>
                <span className="mono" style={isCurrent ? s.tagCurrent : s.tag}>
                  v{v.version}
                </span>
                <div style={s.meta}>
                  <div style={s.date}>{formatSnapshotDate(v.created_at)}</div>
                </div>
                {isCurrent ? (
                  <Badge color="var(--ok)" bg="var(--ok-bg)" dot>
                    {t("versions.current")}
                  </Badge>
                ) : (
                  <div style={s.actions}>
                    <Button
                      kind="ghost"
                      size="sm"
                      icon="Eye"
                      onClick={() => setOpen(isOpen ? null : v.version)}
                    >
                      {isOpen ? t("versions.hide") : t("versions.view")}
                    </Button>
                    <Button
                      kind="secondary"
                      size="sm"
                      icon="History"
                      disabled={restore.isPending}
                      onClick={() => onRestore(v.version)}
                    >
                      {pending === v.version ? t("versions.restoring") : t("versions.restore")}
                    </Button>
                  </div>
                )}
              </div>
              {isOpen && !isCurrent && <pre style={s.body}>{v.body}</pre>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
