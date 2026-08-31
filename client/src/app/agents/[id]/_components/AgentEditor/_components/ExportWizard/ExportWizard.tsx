"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Checkbox,
  ExportWizardSteps,
  FormField,
  Icon,
  Modal,
  SelectInput,
  Skeleton,
  TextInput,
} from "@devdigest/ui";
import type { Agent, CiFile, CiInstallation } from "@devdigest/shared";
import { useCiPreview, useExportToCi } from "../../../../../../../lib/hooks/ci";
import {
  CI_TARGETS,
  DEFAULT_TRIGGERS,
  EXPECTED_SECRETS,
  POST_AS_LABEL_KEYS,
  POST_AS_VALUES,
  STEP_KEYS,
  TRIGGER_EVENTS,
  type PostAs,
} from "./constants";
import {
  defaultPreviewPath,
  errorReason,
  isBundleError,
  isRunnerFile,
  isValidRepo,
} from "./helpers";
import { s } from "./styles";

/**
 * Export to CI — Target → Preview → Configure → Install, in one modal.
 *
 * Four states the design never had to answer for, decided here on purpose:
 *
 *  - **loading** — Preview and Install are both slow (a disk read and three
 *    GitHub round trips). Preview shows skeletons, Install a pending button;
 *    neither is allowed to look like an empty result.
 *  - **already installed** — re-exporting to the same repository is the normal
 *    second action, so it is a note on the Target step, not a refusal: the
 *    engine reuses the branch, the pull request and the installation row.
 *  - **GitHub refused** — the sentence names the fix a first-time user actually
 *    needs (`gh auth refresh …`), with the engine's own message underneath.
 *  - **the runner bundle is missing** — told apart from a GitHub failure by the
 *    engine's error code, and surfaced at Preview as well as at Install, which
 *    is the whole reason the preview route exists.
 */
export function ExportWizard({
  agent,
  installations,
  onClose,
}: {
  agent: Agent;
  installations: readonly CiInstallation[];
  onClose: () => void;
}) {
  const t = useTranslations("ci.exportWizard");

  const [step, setStep] = React.useState(0);
  const [repo, setRepo] = React.useState("");
  /** The repository Preview and Install actually use — set on leaving Target,
      so a half-typed `owner/n` never becomes a request. */
  const [confirmedRepo, setConfirmedRepo] = React.useState("");
  const [triggers, setTriggers] = React.useState<string[]>([...DEFAULT_TRIGGERS]);
  const [postAs, setPostAs] = React.useState<PostAs>("github_review");
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);

  const preview = useCiPreview(agent.id, confirmedRepo);
  const install = useExportToCi();

  const files: CiFile[] = preview.data ?? [];
  const shownPath = selectedPath ?? defaultPreviewPath(files);
  const shown = files.find((f) => f.path === shownPath) ?? null;

  const alreadyInstalled = installations.some((i) => i.repo === repo.trim());
  const canContinue =
    step === 0 ? isValidRepo(repo) : step === 1 ? preview.isSuccess : true;

  const goForward = () => {
    if (step === 0) {
      setConfirmedRepo(repo.trim());
      setSelectedPath(null);
    }
    setStep((n) => n + 1);
  };

  const runInstall = () =>
    install.mutate({
      agentId: agent.id,
      body: {
        repo: confirmedRepo,
        target: "gha",
        action: "open_pr",
        post_as: postAs,
        triggers,
      },
    });

  const toggleTrigger = (event: string) =>
    setTriggers((current) => {
      const next = new Set(current);
      if (next.has(event)) next.delete(event);
      else next.add(event);
      return TRIGGER_EVENTS.filter((e) => next.has(e));
    });

  const failure = (err: unknown) => (
    <div style={s.note("bad")}>
      <Icon.AlertTriangle size={16} style={{ color: "var(--crit)", flexShrink: 0 }} />
      <div>
        {isBundleError(err) ? t("bundleMissing") : t("githubFailed")}
        <div style={s.noteReason}>{errorReason(err)}</div>
      </div>
    </div>
  );

  return (
    <Modal
      width={720}
      title={t("title")}
      subtitle={t("subtitle", { agentName: agent.name })}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {step > 0 && !install.isSuccess && (
            <Button
              kind="ghost"
              icon="ChevronLeft"
              disabled={install.isPending}
              onClick={() => setStep((n) => n - 1)}
            >
              {t("back")}
            </Button>
          )}
          <div style={s.footerRight}>
            {install.isSuccess ? (
              <Button kind="primary" icon="Check" onClick={onClose}>
                {t("close")}
              </Button>
            ) : step < STEP_KEYS.length - 1 ? (
              <Button
                kind="primary"
                iconRight="ArrowRight"
                disabled={!canContinue}
                onClick={goForward}
              >
                {t("continue")}
              </Button>
            ) : (
              <Button
                kind="primary"
                icon="Check"
                loading={install.isPending}
                disabled={install.isPending}
                onClick={runInstall}
              >
                {install.isPending
                  ? t("installing")
                  : install.isError
                    ? t("retry")
                    : t("install")}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div style={s.stepsBar}>
        <ExportWizardSteps step={step} labels={STEP_KEYS.map((k) => t(`steps.${k}`))} />
      </div>

      <div style={s.body}>
        {step === 0 && (
          <>
            {/* One target, so the card states which one rather than offering a
                choice: a button that can only re-select what is already
                selected promises an interaction it does not have. */}
            <div style={s.targetGrid}>
              {CI_TARGETS.map((target) => {
                const TargetIcon = Icon[target.icon];
                return (
                  <div key={target.key} style={s.targetCard}>
                    <div style={s.targetHead}>
                      <span style={s.targetIcon}>
                        <TargetIcon size={18} />
                      </span>
                      <span style={s.targetName}>{t(target.labelKey)}</span>
                      {target.recommended && (
                        <Badge
                          color="var(--accent-text)"
                          bg="var(--accent-bg)"
                          style={{ marginLeft: "auto" }}
                        >
                          {t("recommended")}
                        </Badge>
                      )}
                    </div>
                    <p style={s.targetDesc}>{t(target.descKey)}</p>
                  </div>
                );
              })}
            </div>
            <FormField label={t("repoLabel")} hint={t("repoHint")}>
              <TextInput
                value={repo}
                onChange={setRepo}
                placeholder={t("repoPlaceholder")}
                aria-label={t("repoLabel")}
                mono
              />
            </FormField>
            {alreadyInstalled && (
              <div style={s.note("info")}>
                <Icon.Info size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                <div>{t("alreadyInstalled", { repo: repo.trim() })}</div>
              </div>
            )}
          </>
        )}

        {step === 1 && (
          <div style={s.previewPane}>
            <div style={s.fileList}>
              <div style={s.fileListLabel}>{t("filesToCreate")}</div>
              {preview.isLoading && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <Skeleton height={22} />
                  <Skeleton height={22} />
                  <Skeleton height={22} />
                </div>
              )}
              {files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  style={s.fileRow(file.path === shownPath)}
                  onClick={() => setSelectedPath(file.path)}
                >
                  <Icon.FileText size={13} style={{ flexShrink: 0 }} />
                  <span className="mono" style={s.fileRowPath}>
                    {file.path}
                  </span>
                </button>
              ))}
            </div>
            <div style={s.previewBody}>
              {preview.isLoading && <div style={s.paneMessage}>{t("generating")}</div>}
              {preview.isError && <div style={s.paneMessage}>{failure(preview.error)}</div>}
              {shown && (
                <>
                  <div style={s.previewHead}>
                    <span className="mono" style={s.previewPath}>
                      {shown.path}
                    </span>
                    {isRunnerFile(shown) && (
                      <Badge color="var(--text-muted)" mono>
                        {t("fileBytes", { bytes: String(shown.bytes ?? 0) })}
                      </Badge>
                    )}
                  </div>
                  {isRunnerFile(shown) ? (
                    <p style={s.runnerNote}>{t("runnerNote")}</p>
                  ) : (
                    <pre className="mono" style={s.code}>
                      {shown.contents}
                    </pre>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={s.form}>
            <FormField label={t("triggerLabel")}>
              <div style={s.triggerList}>
                {TRIGGER_EVENTS.map((event) => (
                  <Checkbox
                    key={event}
                    checked={triggers.includes(event)}
                    onChange={() => toggleTrigger(event)}
                    label={<span className="mono">{t(`triggers.${event}`)}</span>}
                  />
                ))}
              </div>
            </FormField>
            <FormField label={t("postResultsLabel")}>
              <SelectInput
                value={postAs}
                onChange={(v) => setPostAs(v as PostAs)}
                mono={false}
                options={POST_AS_VALUES.map((v) => ({
                  value: v,
                  label: t(POST_AS_LABEL_KEYS[v]),
                }))}
              />
            </FormField>
            <FormField label={t("secretsLabel")} hint={t("secretsHint")}>
              <div style={s.secretsBox}>
                {EXPECTED_SECRETS.map((secret, i) => (
                  <div key={secret.name} style={s.secretRow(i === EXPECTED_SECRETS.length - 1)}>
                    <span className="mono" style={s.secretName}>
                      {secret.name}
                    </span>
                    <span style={s.secretNote}>{t(secret.noteKey)}</span>
                  </div>
                ))}
              </div>
            </FormField>
          </div>
        )}

        {step === 3 && (
          <div style={s.form}>
            {install.isError && failure(install.error)}
            {install.isSuccess ? (
              <>
                <div style={s.installCard}>
                  <div style={s.installHead}>
                    <Icon.Check size={18} style={{ color: "var(--ok)" }} />
                    <span style={s.installTitle}>{t("doneTitle")}</span>
                  </div>
                  <p style={s.installBody}>{t("doneBody", { repo: confirmedRepo })}</p>
                </div>
                <div style={s.doneRow}>
                  {install.data.pr_url ? (
                    <a
                      className="mono"
                      href={install.data.pr_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 13, color: "var(--accent-text)" }}
                    >
                      {t("viewPr")}
                    </a>
                  ) : (
                    <span style={s.installBody}>{t("noPrUrl")}</span>
                  )}
                </div>
              </>
            ) : (
              <div style={s.installCard}>
                <div style={s.installHead}>
                  <Icon.GitPullRequest size={18} style={{ color: "var(--accent)" }} />
                  <span style={s.installTitle}>{t("installCardTitle")}</span>
                </div>
                <p style={s.installBody}>
                  {t("installCardBody", { repo: confirmedRepo, count: files.length })}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
