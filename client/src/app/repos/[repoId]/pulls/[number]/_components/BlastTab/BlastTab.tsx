"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Card, EmptyState, ErrorState, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { BlastReason } from "@devdigest/shared";
import { useBlast, useExplainBlast } from "@/lib/hooks/blast";
import { useResyncRepoIntel } from "@/lib/hooks/repo-intel";
import { githubBlobUrl } from "@/lib/github-urls";
import { BlastSummaryStats } from "./_components/BlastSummaryStats";
import { BlastTree } from "./_components/BlastTree";
import { BlastGraph } from "./_components/BlastGraph";
import { countBlast, graphSubject, hasDownstream } from "./helpers";
import { s, toggleButtonFor } from "./styles";

interface BlastTabProps {
  /** Null while the PR list is still resolving `number` → id. */
  prId: string | null;
  /** The repository row's id — what a resync is addressed by. */
  repoId: string;
  /** "owner/repo", or null until the repo is loaded. */
  repoFullName: string | null;
  /**
   * False until the PR detail has resolved. `GET /pulls/:id` rewrites
   * `pr_files` inside a transaction, so a map fetched before it lands would
   * describe a file list the page does not have.
   */
  ready: boolean;
}

/** Which reasons the "Re-analyze" action can actually do something about. */
const RESYNCABLE: ReadonlySet<BlastReason> = new Set<BlastReason>([
  "index_missing",
  "index_failed",
  "index_partial",
]);

/**
 * The Blast tab: what this pull request's diff can reach.
 *
 * Built as ONE self-contained card — the design places this block inside the PR
 * Brief's card, beside Intent and Risks, and the assignment asks for a tab. It
 * is a tab here, with the design's card as its content, so the Brief lesson can
 * mount this component unchanged rather than re-implementing it.
 *
 * Every state the server can answer with is rendered as itself. An empty map is
 * never drawn as an empty tree: `status` says whether the index could speak and
 * `reason` says what it found, and the three degraded reasons come with the
 * action that can fix them. That distinction is the whole point of the feature —
 * "nothing calls this" and "we could not look" are different sentences.
 */
export function BlastTab({ prId, repoId, repoFullName, ready }: BlastTabProps) {
  const t = useTranslations("blast");
  const [view, setView] = React.useState<"tree" | "graph">("tree");
  // `isPending`, not `isLoading`: a query held back by `enabled` is pending but
  // NOT loading, and that is the normal first paint of this tab — the gate is
  // open only once `usePullDetail` has resolved. Reading `isLoading` here draws
  // nothing at all for the whole width of that window.
  const { data: map, isPending, isError, refetch } = useBlast(prId, ready);
  const resync = useResyncRepoIntel(repoId);
  const explain = useExplainBlast(prId);

  if (!prId || isPending) {
    return (
      <Card>
        <SectionLabel icon="Workflow">{t("title")}</SectionLabel>
        <Skeleton height={140} />
      </Card>
    );
  }
  // A non-404 failure. Every OTHER way this can go wrong is an answer with a
  // `reason` — this branch is the request itself not arriving, and it says so
  // rather than rendering a card-shaped hole.
  if (isError) {
    return (
      <Card>
        <SectionLabel icon="Workflow">{t("title")}</SectionLabel>
        <ErrorState
          title={t("loadFailedTitle")}
          body={t("loadFailedBody")}
          onRetry={() => void refetch()}
        />
      </Card>
    );
  }
  if (!map) return null;

  const counts = countBlast(map);
  const shortSha = map.indexed_sha ? map.indexed_sha.slice(0, 7) : null;
  // Pinned to `indexed_sha`, NOT to the PR's head: the line number came out of
  // the index built at that commit, and that is the only commit at which it is
  // guaranteed to be right. A caller usually lives outside the diff anyway, so
  // there is nothing on the Files tab to jump to instead.
  const hrefFor =
    repoFullName && map.indexed_sha
      ? (file: string, line: number) =>
          githubBlobUrl(repoFullName, map.indexed_sha!, file, line)
      : null;

  const banner = map.reason && map.status !== "ok" && (
    <div style={s.banner}>
      <Icon.AlertTriangle size={14} style={s.bannerIcon} />
      <span>
        <span style={s.bannerTitle}>{t(`reason.${map.reason}.title`)}</span>
        {t(`reason.${map.reason}.body`)}
      </span>
      {RESYNCABLE.has(map.reason) && (
        <span style={s.bannerAction}>
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            onClick={() => resync.mutate()}
            loading={resync.isPending}
          >
            {t("reanalyze")}
          </Button>
        </span>
      )}
    </div>
  );

  // A degraded map has no nodes to draw, so the banner IS the content.
  if (map.status === "degraded") {
    return (
      <Card>
        <SectionLabel icon="Workflow">{t("title")}</SectionLabel>
        {banner}
        <p style={s.summary}>{map.summary}</p>
      </Card>
    );
  }

  // `ok` with a reason: the index answered, and the answer is that there is
  // nothing below. Which of the three it is decides what the reader does next.
  if (map.reason && map.status === "ok") {
    return (
      <Card>
        <SectionLabel icon="Workflow">{t("title")}</SectionLabel>
        <EmptyState
          icon="Workflow"
          title={t(`reason.${map.reason}.title`)}
          body={
            map.reason === "no_callers"
              ? t("noDownstream", { count: counts.symbols })
              : t(`reason.${map.reason}.body`)
          }
        />
        {shortSha && (
          <div style={s.shaLine}>
            <Icon.GitCommit size={12} />
            {t("indexedAt", { sha: shortSha })}
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card>
      <SectionLabel
        icon="Workflow"
        right={
          // The one model call this feature makes, and the only thing on this
          // card that costs anything — so it is a button a reader presses, never
          // something that happens because they opened a tab.
          <Button
            kind="ghost"
            size="sm"
            icon="Sparkles"
            onClick={() => explain.mutate()}
            loading={explain.isPending}
          >
            {t("explain")}
          </Button>
        }
      >
        {t("title")}
      </SectionLabel>
      {banner}
      {explain.isError && <p style={s.explainError}>{t("explainFailed")}</p>}
      {explain.data && (
        <p style={s.explanation}>
          {explain.data.explanation}
          <span style={s.explanationMeta}>
            {t("explainedBy", { model: explain.data.model })}
          </span>
        </p>
      )}
      <div style={s.header}>
        <BlastSummaryStats counts={counts} />
        <div style={s.toggleGroup}>
          {(["tree", "graph"] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => setView(key)}
              style={toggleButtonFor(view === key)}
            >
              {t(`view.${key}`)}
            </button>
          ))}
        </div>
      </div>

      {view === "tree" ? (
        <BlastTree downstream={map.downstream} hrefFor={hrefFor} />
      ) : (
        <BlastGraph subject={hasDownstream(map) ? graphSubject(map) : null} />
      )}

      <div style={s.shaLine}>
        <Icon.GitCommit size={12} />
        {shortSha ? t("indexedAt", { sha: shortSha }) : t("notIndexed")}
      </div>
    </Card>
  );
}
