"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Button, Checkbox, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import {
  useAgentSkills,
  useSetAgentSkills,
  useSkills,
} from "../../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../../lib/toast";
import { TYPE_COLOR } from "@/lib/skills";
import { filterRows, orderSkills, reorder, sameOrder } from "./helpers";
import { s } from "./styles";

/**
 * Which skills this agent reviews with, and in what order.
 *
 * Attach, detach and reorder are one operation on the server — the whole ordered
 * set is POSTed at once — so the tab keeps a local draft of the id list and saves
 * it in a single call. Order is prompt order: index 0 is the first block under
 * `## Skills / rules`.
 *
 * A skill that is switched off globally still shows its link here, marked, because
 * the link is intact and only the master switch is stopping it. Silently hiding it
 * would make "why is my rule not applied" unanswerable from this screen.
 */
export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const ts = useTranslations("skills");
  const toast = useToast();

  const { data: skills, isLoading: loadingSkills, isError, refetch } = useSkills();
  const {
    data: links,
    isLoading: loadingLinks,
    isError: linksError,
    refetch: refetchLinks,
  } = useAgentSkills(agent.id);
  const save = useSetAgentSkills(agent.id);

  const [draft, setDraft] = React.useState<string[] | null>(null);
  const [search, setSearch] = React.useState("");
  /** The row being dragged, and the row a drop would land on. Both are ids. */
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);

  const saved = React.useMemo(
    () => [...(links ?? [])].sort((a, b) => a.order - b.order).map((l) => l.skill_id),
    [links],
  );
  const current = draft ?? saved;

  // Discard the draft only when the editor moves to a different agent.
  //
  // NOT on `links` changing: that array gets a new identity on every refetch —
  // including the invalidation this tab's own save triggers — which would throw
  // away an in-progress edit. A successful save clears the draft explicitly.
  React.useEffect(() => setDraft(null), [agent.id]);

  const rows = React.useMemo(
    () =>
      orderSkills(
        skills ?? [],
        current.map((id, order) => ({ agent_id: agent.id, skill_id: id, order })),
      ),
    [skills, current, agent.id],
  );
  const visible = filterRows(rows, search);

  const toggle = (id: string) =>
    setDraft(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);

  const dirty = !sameOrder(current, saved);

  const endDrag = () => {
    setDragId(null);
    setOverId(null);
  };

  /**
   * Drop `dragged` onto `targetId`: it takes that row's position.
   *
   * The dragged id is read from state first and from `dataTransfer` only as a
   * fallback — the payload exists because a drag with no data is a no-op in
   * Firefox, not because we need it. A drop on an unlinked row resolves to no
   * position at all, so `reorder` returns the list unchanged rather than
   * inventing one.
   */
  const drop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const dragged = dragId ?? e.dataTransfer.getData("text/plain");
    if (dragged) setDraft(reorder(current, dragged, targetId));
    endDrag();
  };

  // A failed LINKS fetch must not fall through to the list. `links` would be
  // undefined, `saved` would collapse to [], and the tab would render "0 of N
  // enabled" — indistinguishable from an agent that genuinely has none. Saving
  // from that state POSTs a replacement set and deletes every link the tab never
  // loaded. Refusing to render is the only safe response.
  if (isError || linksError) {
    return (
      <ErrorState
        body={ts("page.loadError")}
        onRetry={() => {
          void refetch();
          void refetchLinks();
        }}
      />
    );
  }
  if (loadingSkills || loadingLinks) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 760 }}>
        <Skeleton height={40} />
        <Skeleton height={40} />
        <Skeleton height={40} />
      </div>
    );
  }

  if ((skills ?? []).length === 0) {
    return (
      <EmptyState
        icon="Sparkles"
        title={ts("page.empty.title")}
        body={ts("page.empty.body")}
      />
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.headRow}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <Badge color="var(--accent-text)" bg="var(--accent-bg)">
          {t("skills.enabledCount", { linked: current.length, total: (skills ?? []).length })}
        </Badge>
        <div style={s.filter}>
          <Icon.Search size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("skills.filterPlaceholder")}
            style={s.filterInput}
          />
        </div>
      </div>

      <p style={s.hint}>{t("skills.orderHint")}</p>

      {/* A real list: each row is one skill, so the order is exposed to assistive
          technology (and to tests) rather than only being visual. */}
      <ul style={s.list}>
        {visible.map(({ skill, linked }) => {
          const index = current.indexOf(skill.id);
          return (
            <li
              key={skill.id}
              style={{
                ...s.row(linked),
                ...(dragId === skill.id ? s.rowDragging : {}),
                ...(overId === skill.id ? s.rowOver : {}),
              }}
              aria-label={skill.name}
              // Only an ATTACHED skill has a position, so only an attached row
              // can be dragged — dragging an unattached one would ask the list
              // to order something that is not in it.
              draggable={linked}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", skill.id);
                setDragId(skill.id);
              }}
              onDragOver={(e) => {
                if (!linked || !dragId || dragId === skill.id) return;
                // Without preventDefault the browser refuses the drop outright —
                // the default for a dragover is "this is not a drop target".
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOverId(skill.id);
              }}
              onDragLeave={() => setOverId((o) => (o === skill.id ? null : o))}
              onDrop={(e) => drop(e, skill.id)}
              // Fires on a cancelled drag too (Esc, or a drop outside the list),
              // which is the only thing that clears the visual state there.
              onDragEnd={endDrag}
            >
              <span style={s.grip(linked)} aria-hidden="true">
                <Icon.Menu size={14} />
              </span>
              <span className="mono tnum" style={s.orderIndex}>
                {linked ? index + 1 : ""}
              </span>
              {/* The label is visually hidden, not omitted: an aria-label on the
                  row does not name a control inside it, so without this every
                  checkbox announces as an unnamed "checkbox, not checked". */}
              <Checkbox
                checked={linked}
                onChange={() => toggle(skill.id)}
                label={<span style={s.srOnly}>{t("skills.attach", { name: skill.name })}</span>}
              />
              {/* An anchor is natively draggable and would start its OWN drag
                  (the URL), pre-empting the row's. */}
              <Link
                href={`/skills/${skill.id}?tab=config`}
                className="mono"
                draggable={false}
                style={{ ...s.name, color: "inherit", textDecoration: "none" }}
              >
                {skill.name}
              </Link>
              {linked && !skill.enabled && (
                <span style={s.offNote} title={t("skills.disabledTitle")}>
                  <Icon.AlertTriangle size={11} />
                  {t("skills.disabledShort")}
                </span>
              )}
              <span style={s.typeChip(TYPE_COLOR[skill.type])}>
                {ts(`listItem.type.${skill.type}`)}
              </span>
            </li>
          );
        })}
      </ul>

      <div style={s.actions}>
        <Button
          kind="primary"
          icon="Check"
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate(current, {
              onSuccess: () => {
                setDraft(null);
                toast.success(t("skills.savedToast", { count: current.length }));
              },
            })
          }
        >
          {save.isPending ? t("skills.saving") : t("skills.save")}
        </Button>
        {dirty && (
          <Button kind="ghost" onClick={() => setDraft(null)}>
            {t("skills.reset")}
          </Button>
        )}
        {!dirty && <span style={s.savedNote}>{t("skills.upToDate")}</span>}
      </div>
    </div>
  );
}
