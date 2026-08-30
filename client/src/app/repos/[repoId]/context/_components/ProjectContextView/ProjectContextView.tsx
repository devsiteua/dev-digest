/* /repos/:repoId/context — the Project Context folder (design screen key
   `project-context`, artboards `context` / `e-context`).

   Three deliberate departures from the artboard, each one a spec decision:
     - no `.devdigest/specs/` header. There is no such folder; `path_label` is a
       LABEL and the screen must not present it as somewhere to `cd` (AC-03).
     - no chunk counter and no COVERAGE ring. Nothing in this product defines
       what either would be a number of; the footer counts documents and bytes,
       which are facts.
     - no `New file` / `New folder` / `Preview | Edit`. The preview is read-only
       (AC-23) and authoring is out of scope. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useAgents } from "@/lib/hooks/agents";
import {
  useDeleteProjectContextDoc,
  useProjectContext,
  useProjectContextDoc,
  useReorderProjectContext,
  useUpdateProjectContextDoc,
  useUploadProjectContextDoc,
} from "@/lib/hooks/context";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ContextDocPreview } from "../ContextDocPreview";
import { ContextDocRow } from "../ContextDocRow";
import { ContextUploadButton } from "../ContextUploadButton";
import { MAX_DOCS_PER_REPO, MAX_DOC_BYTES, SKELETON_HEIGHT, SKELETON_ROWS } from "./constants";
import { agentReaderCounts, reorderedIds, toKb, totalBytes } from "./helpers";
import { s } from "./styles";

export function ProjectContextView() {
  const t = useTranslations("context");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data, isLoading, isError, refetch } = useProjectContext(repoId);
  const { data: agents } = useAgents();
  const upload = useUploadProjectContextDoc(repoId);
  const update = useUpdateProjectContextDoc(repoId);
  const remove = useDeleteProjectContextDoc(repoId);
  const reorder = useReorderProjectContext(repoId);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const docs = React.useMemo(() => data ?? [], [data]);

  // The selection follows the list rather than being stored alongside it: a
  // deleted document must not leave the preview showing a row that is gone.
  const selected = docs.find((d) => d.id === selectedId) ?? docs[0];
  const preview = useProjectContextDoc(repoId, selected?.id);

  const { readers, total } = agentReaderCounts(agents);
  const bytes = totalBytes(docs);
  const busy = update.isPending || remove.isPending || reorder.isPending;

  // Every rejection the server can answer an upload with — 400 wrong extension,
  // 413 too large, 409 repository full, 400 blank body — arrives here carrying
  // the server's own sentence. The artboard has nowhere to put them; this is it.
  const uploadError = upload.isError ? upload.error.message : null;

  const rowLabels = {
    enable: t("doc.enable"),
    disable: t("doc.disable"),
    delete: t("doc.delete"),
    moveUp: t("doc.moveUp"),
    moveDown: t("doc.moveDown"),
    disabled: t("doc.disabled"),
  };

  const crumb = [
    { label: activeRepo?.full_name ?? repoId, mono: true },
    { label: t("title") },
  ];

  const uploadButton = (
    <ContextUploadButton
      label={t("upload.action")}
      busyLabel={t("upload.busy")}
      busy={upload.isPending}
      onFile={(file) => upload.mutate(file)}
    />
  );

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
            <h1 style={s.h1}>{t("title")}</h1>
            <p style={s.subtitle}>{t("subtitle")}</p>
            {/* A property of the WORKSPACE's agents, not of a document — agents
                are not repo-scoped, and a per-document number would be a claim
                nothing in the data can support (AC-24). */}
            <span style={s.agentCounter}>
              <Icon.Cpu size={13} aria-hidden="true" />
              {t("agentCounter", { enabled: readers, total })}
            </span>
          </div>
          {docs.length > 0 && uploadButton}
        </div>

        {uploadError && (
          <div role="alert" style={s.alert}>
            <Icon.AlertOctagon size={15} style={s.alertIcon} aria-hidden="true" />
            <div>
              <div style={s.alertTitle}>{t("upload.failed")}</div>
              <div style={s.alertBody}>{uploadError}</div>
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

        {isError && <ErrorState title={t("loadError")} onRetry={() => refetch()} />}

        {/* The empty state explains what the folder is FOR and carries the one
            action that resolves it (AC-22). `EmptyState`'s own `cta` is not used
            — the action is a file picker, not a callback — so the button sits
            under it rather than being faked inside it. */}
        {!isLoading && !isError && docs.length === 0 && (
          <div style={s.emptyBlock}>
            <EmptyState icon="Folder" title={t("empty.title")} body={t("empty.body")} />
            {uploadButton}
          </div>
        )}

        {!isLoading && !isError && docs.length > 0 && (
          <div style={s.body}>
            <div style={s.listPane}>
              <div style={s.list}>
                {docs.map((doc, i) => (
                  <ContextDocRow
                    key={doc.id}
                    doc={doc}
                    selected={doc.id === selected?.id}
                    sizeLabel={t("kb", { kb: toKb(doc.size_bytes) })}
                    labels={rowLabels}
                    canMoveUp={i > 0}
                    canMoveDown={i < docs.length - 1}
                    busy={busy}
                    onSelect={() => setSelectedId(doc.id)}
                    onToggle={(enabled) => update.mutate({ id: doc.id, patch: { enabled } })}
                    onMove={(delta) => {
                      const ids = reorderedIds(docs, doc.id, delta);
                      if (ids) reorder.mutate(ids);
                    }}
                    onDelete={() => remove.mutate(doc.id)}
                  />
                ))}
              </div>

              {/* Documents and bytes — not the artboard's chunk counter, which
                  would be a number of nothing here. */}
              <div style={s.footer}>
                <div>
                  {t("count", { count: docs.length })} · {t("totalSize", { kb: toKb(bytes) })}
                </div>
                <div>
                  {t("upload.hint", {
                    maxKb: toKb(MAX_DOC_BYTES),
                    maxDocs: MAX_DOCS_PER_REPO,
                  })}
                </div>
                <div>{t("pathLabelNote")}</div>
              </div>
            </div>

            <div style={s.previewPane}>
              <ContextDocPreview
                doc={preview.data}
                isLoading={preview.isLoading}
                isError={preview.isError}
                loadErrorLabel={t("doc.loadError")}
                readOnlyNote={t("doc.readOnly")}
                pathLabelNote={t("pathLabelNote")}
                onRetry={() => preview.refetch()}
              />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
