/* /repos/:repoId/conventions — the conventions extractor (design N7): the
   candidates one pass found, each with the lines that prove it, the
   accept/reject/reword loop over them, and the modal that merges the survivors
   into a single skill. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { ConventionStatus } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { ApiError } from "@/lib/api";
import {
  useConventions,
  useExtractConventions,
  useUpdateConvention,
} from "@/lib/hooks/conventions";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ConventionCard, type ConventionEdit } from "../ConventionCard";
import { CreateSkillModal } from "../CreateSkillModal";
import { SKELETON_HEIGHT, SKELETON_ROWS } from "./constants";
import { acceptedCount, acceptedOnly, allAccepted, bulkTargets } from "./helpers";
import { s } from "./styles";

export function ConventionsView() {
  const t = useTranslations("conventions");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data, isLoading, isError, error, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const update = useUpdateConvention(repoId);

  const [merging, setMerging] = React.useState(false);

  const list = data ?? [];
  const acceptedList = acceptedOnly(list);
  const accepted = acceptedCount(list);
  const everyAccepted = allAccepted(list);
  const repoName = activeRepo?.full_name ?? t("page.repoFallback");

  // Which card is mid-write, and towards which status — so exactly one card
  // shows "Accepting…" and the rest stay clickable.
  const pendingId = update.isPending ? update.variables?.id : undefined;
  const pendingStatus = update.isPending ? update.variables?.patch.status : undefined;

  const setStatus = (id: string, status: ConventionStatus) =>
    update.mutate({ id, patch: { status } });

  const setAll = (target: "accepted" | "pending") => {
    for (const c of bulkTargets(list, target)) setStatus(c.id, target);
  };

  // `mutateAsync`, not `mutate`: the card keeps its editor open — with the text
  // still in it — when the PATCH fails, and only it knows that.
  const saveEdit = (id: string, edit: ConventionEdit) => update.mutateAsync({ id, patch: edit });

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>
              {t("page.headingPrefix")}
              <span className="mono" style={s.repoName}>
                {repoName}
              </span>
            </h1>
            <p style={s.subtitle}>
              {list.length > 0
                ? t("page.candidateCount", { count: list.length })
                : t("page.subtitle")}
            </p>
          </div>
          {/* With no candidates the empty state owns the scan action — two
              "Run extraction" buttons on one screen is one too many. */}
          {list.length > 0 && (
            <Button
              kind="secondary"
              size="sm"
              icon="RefreshCw"
              loading={extract.isPending}
              onClick={() => extract.mutate()}
            >
              {extract.isPending ? t("page.scanning") : t("page.rescan")}
            </Button>
          )}
        </div>

        {/* The extraction 422 is the screen's most useful message — an unindexed
            repo is told to index itself — so the server's text is shown, not
            swallowed into a generic failure. */}
        {extract.isError && (
          <div role="alert" style={s.alert}>
            <Icon.AlertOctagon size={15} style={s.alertIcon} />
            <div>
              <div style={s.alertTitle}>{t("page.extractionFailed")}</div>
              <div style={s.alertBody}>{extract.error.message}</div>
            </div>
          </div>
        )}

        {isLoading && (
          <div style={s.skeletons}>
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <Skeleton key={i} height={SKELETON_HEIGHT} />
            ))}
          </div>
        )}

        {isError && (
          <ErrorState
            body={error instanceof ApiError ? error.message : t("page.loadError")}
            onRetry={() => refetch()}
          />
        )}

        {!isLoading && !isError && list.length === 0 && (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={extract.isPending ? t("page.scanning") : t("page.empty.cta")}
            onCta={() => extract.mutate()}
            ctaLoading={extract.isPending}
          />
        )}

        {!isLoading && !isError && list.length > 0 && (
          <>
            <div style={s.actionBar}>
              <Button
                kind="ghost"
                size="sm"
                icon={everyAccepted ? "X" : "Check"}
                onClick={() => setAll(everyAccepted ? "pending" : "accepted")}
              >
                {everyAccepted ? t("page.deselectAll") : t("page.acceptAll")}
              </Button>
              <span style={s.count}>
                {t("page.acceptedCount", { accepted, total: list.length })}
              </span>
              {/* Disabled rather than hidden at zero accepted: the button is how
                  the screen says what accepting is FOR. */}
              <div style={s.spacer}>
                <Button
                  kind="primary"
                  size="sm"
                  icon="Sparkles"
                  disabled={accepted === 0}
                  onClick={() => setMerging(true)}
                >
                  {t("create.open")}
                </Button>
              </div>
            </div>

            {list.map((c) => (
              <ConventionCard
                key={c.id}
                candidate={c}
                repoFullName={activeRepo?.full_name}
                gitRef={activeRepo?.default_branch}
                pending={pendingId === c.id ? pendingStatus : undefined}
                onSetStatus={(status) => setStatus(c.id, status)}
                onSave={(edit) => saveEdit(c.id, edit)}
              />
            ))}
          </>
        )}

        {merging && acceptedList.length > 0 && (
          <CreateSkillModal
            repoId={repoId}
            repoName={repoName}
            accepted={acceptedList}
            onClose={() => setMerging(false)}
          />
        )}
      </div>
    </AppShell>
  );
}
