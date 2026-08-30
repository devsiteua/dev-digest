"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  FormField,
  Icon,
  MonoLink,
  SectionLabel,
  SelectInput,
  Skeleton,
} from "@devdigest/ui";
import type { Agent, CiFailOn } from "@devdigest/shared";
import { useAgentCi } from "../../../../../../../lib/hooks/ci";
import { useUpdateAgent } from "../../../../../../../lib/hooks/agents";
import { NO_VALUE } from "../../../../../../../lib/format";
import { ExportWizard } from "../ExportWizard";
import { CI_FAIL_ON_VALUES, RUN_STATUS, TAB_RUNS_SHOWN } from "./constants";
import { formatTimestamp } from "./helpers";
import { s } from "./styles";

/**
 * Where this agent runs in CI: its installations, the runner version behind
 * them, its recent CI runs, and the one thing this tab may change — the gate.
 *
 * "Not exported to CI" and "we have not asked yet" are deliberately different
 * screens. The design has only the first, and collapsing them would offer an
 * export to somebody who already has one, for as long as the request is in
 * flight.
 *
 * The gate saves through the ordinary agent update (`PUT /agents/:id`); nothing
 * on this tab has an endpoint of its own, which is why `GET /agents/:id/ci`
 * carries no `ci_fail_on` to keep in step.
 */
export function CiTab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci.ciTab");
  const tr = useTranslations("ci.runs");

  const { data, isLoading, isError, refetch } = useAgentCi(agent.id);
  const update = useUpdateAgent();
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [failOn, setFailOn] = React.useState<CiFailOn>(agent.ci_fail_on);

  React.useEffect(() => setFailOn(agent.ci_fail_on), [agent.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveFailOn = (value: CiFailOn) => {
    setFailOn(value);
    update.mutate({ id: agent.id, patch: { ci_fail_on: value } });
  };

  const wizard = wizardOpen ? (
    <ExportWizard
      agent={agent}
      installations={data?.installations ?? []}
      onClose={() => setWizardOpen(false)}
    />
  ) : null;

  if (isError) {
    return <ErrorState body={t("loadError")} onRetry={() => void refetch()} />;
  }

  if (isLoading || !data) {
    return (
      <div style={s.loading}>
        <Skeleton height={20} width={220} />
        <Skeleton height={54} />
        <Skeleton height={54} />
      </div>
    );
  }

  if (data.installations.length === 0) {
    return (
      <>
        {wizard}
        <EmptyState
          icon="Workflow"
          title={t("emptyTitle")}
          body={t("emptyBody")}
          cta={t("exportToCi")}
          onCta={() => setWizardOpen(true)}
        />
      </>
    );
  }

  const runs = data.runs.slice(0, TAB_RUNS_SHOWN);

  return (
    <div style={s.wrap}>
      {wizard}

      <div style={s.headRow}>
        <h2 style={s.h2}>{t("heading")}</h2>
        <Badge color="var(--ok)" bg="var(--ok-bg)" dot>
          {t("activeIn", { count: data.installations.length })}
        </Badge>
        <Badge color="var(--text-secondary)" mono>
          {t("runnerVersion", { version: data.runner_version })}
        </Badge>
        <div style={s.headActions}>
          <Button kind="secondary" size="sm" icon="Plus" onClick={() => setWizardOpen(true)}>
            {t("addToCi")}
          </Button>
        </div>
      </div>
      <p style={s.subtitle}>{t("subtitle")}</p>

      {data.installations.map((installation) => (
        <div key={installation.id} style={s.installation}>
          <Icon.GitBranch size={16} style={{ color: "var(--text-muted)" }} />
          <span className="mono" style={s.repo}>
            {installation.repo}
          </span>
          <Badge color="var(--text-secondary)" icon="Workflow">
            {installation.target_type}
          </Badge>
          <span style={s.installedAt}>
            {t("installed", { date: formatTimestamp(installation.installed_at) })}
          </span>
        </div>
      ))}

      <div style={s.section}>
        <SectionLabel icon="History">{t("recentRuns")}</SectionLabel>
        {runs.length === 0 ? (
          <p style={s.noRuns}>{t("noRuns")}</p>
        ) : (
          <div style={s.runsBox}>
            {runs.map((run, i) => {
              const status = run.status ? RUN_STATUS[run.status] : undefined;
              return (
                <div key={run.id} style={s.runRow(i === runs.length - 1)}>
                  <span className="mono" style={s.runTime}>
                    {formatTimestamp(run.ran_at)}
                  </span>
                  <span className="mono" style={s.runPr}>
                    {run.pr_number == null ? NO_VALUE : `#${run.pr_number}`}
                  </span>
                  {status ? (
                    <Badge color={status.color} bg={status.bg} dot>
                      {tr(`status.${status.labelKey}`)}
                    </Badge>
                  ) : (
                    <span style={s.runFindings}>{run.status ?? NO_VALUE}</span>
                  )}
                  <span className="tnum" style={s.runFindings}>
                    {run.findings_count ? run.findings_count : NO_VALUE}
                  </span>
                  {run.github_url ? (
                    <MonoLink href={run.github_url}>{tr("view")}</MonoLink>
                  ) : (
                    <span style={s.runFindings}>{NO_VALUE}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={s.gate}>
        <FormField
          label={t("failOnLabel")}
          hint={t("failOnHint")}
          right={update.isSuccess ? <span style={s.savedNote}>{t("failOnSaved")}</span> : null}
        >
          <SelectInput
            value={failOn}
            mono={false}
            onChange={(v) => saveFailOn(v as CiFailOn)}
            options={CI_FAIL_ON_VALUES.map((v) => ({
              value: v,
              label: t(`failOnOptions.${v}`),
            }))}
          />
        </FormField>
      </div>
    </div>
  );
}
