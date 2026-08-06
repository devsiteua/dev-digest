"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  Drawer,
  FormField,
  Icon,
  SelectInput,
  TextInput,
  Textarea,
} from "@devdigest/ui";
import type { SkillDraft, SkillType } from "@devdigest/shared";
import {
  useCreateSkill,
  useImportPreview,
  useImportSkill,
} from "../../../../lib/hooks/skills";
import { useToast } from "../../../../lib/toast";
import { ApiError } from "../../../../lib/api";
import { TYPE_VALUES } from "../../[id]/_components/SkillEditor/constants";
import { ACCEPT, DRAWER_WIDTH, MAX_ZIP_BYTES } from "./constants";
import { ArchiveTooLargeError, fileToPayload } from "./helpers";
import { s } from "./styles";

type Mode = "pick" | "review";

/**
 * Add a skill: write one from scratch, or import one from a markdown file or a
 * zip bundle.
 *
 * Import is deliberately two steps. The file is parsed by
 * `POST /skills/import/preview`, which has no write path at all, and only the
 * user's confirmation calls the endpoint that persists. Nothing is stored while
 * you are looking at the preview, and the preview names every archive entry that
 * was NOT read — scripts and binaries included — so what the product ignored is
 * visible rather than implied.
 */
export function AddSkillDrawer({
  onClose,
  initialMode = "pick",
}: {
  onClose: () => void;
  /** "blank" opens straight on the empty form; "pick" opens on the file picker. */
  initialMode?: "pick" | "blank";
}) {
  const t = useTranslations("skills");
  const toast = useToast();
  const router = useRouter();

  const preview = useImportPreview();
  const importSkill = useImportSkill();
  const createSkill = useCreateSkill();

  const [mode, setMode] = React.useState<Mode>(initialMode === "blank" ? "review" : "pick");
  /** Set only for an imported draft; a from-scratch skill stays null. */
  const [draft, setDraft] = React.useState<SkillDraft | null>(null);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [body, setBody] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const applyDraft = (d: SkillDraft) => {
    setDraft(d);
    setName(d.name);
    setDescription(d.description);
    setType(d.type);
    setBody(d.body);
    setMode("review");
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const payload = await fileToPayload(file);
      applyDraft(await preview.mutateAsync(payload));
    } catch (err) {
      if (err instanceof ArchiveTooLargeError) {
        setError(t("file.zipTooLarge", { max: Math.round(MAX_ZIP_BYTES / 1024) }));
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(t("drawer.importFailed"));
      }
    } finally {
      // Let the same file be picked again after a failed parse.
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const startBlank = () => {
    setDraft(null);
    setName("");
    setDescription("");
    setType("custom");
    setBody("");
    setError(null);
    setMode("review");
  };

  const confirm = async () => {
    setError(null);
    const payload = { name: name.trim(), description: description.trim(), type, body };
    try {
      const saved = draft
        ? await importSkill.mutateAsync(payload)
        : await createSkill.mutateAsync(payload);
      toast.success(
        draft ? t("file.success", { name: saved.name }) : t("config.createdToast", { name: saved.name }),
      );
      onClose();
      router.push(`/skills/${saved.id}?tab=config`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("drawer.importFailed"));
    }
  };

  const busy = importSkill.isPending || createSkill.isPending;
  const canSave = !!name.trim() && !!body.trim() && !busy;

  return (
    <Drawer
      width={DRAWER_WIDTH}
      title={t("drawer.title")}
      subtitle={t("drawer.subtitle")}
      onClose={onClose}
      footer={
        mode === "review" ? (
          <div style={s.footer}>
            {draft && (
              <span style={s.footerNote}>
                <Icon.Lock size={12} />
                {t("drawer.savedDisabled")}
              </span>
            )}
            <Button kind="ghost" onClick={onClose}>
              {t("drawer.cancel")}
            </Button>
            <Button kind="primary" icon="Check" onClick={confirm} disabled={!canSave}>
              {busy ? t("file.importing") : draft ? t("file.import") : t("drawer.create")}
            </Button>
          </div>
        ) : undefined
      }
    >
      {error && (
        <div style={s.error}>
          <Icon.AlertTriangle size={15} style={{ color: "var(--crit)", flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {mode === "pick" ? (
        <div style={s.section}>
          <p style={s.lead}>{t("drawer.pickLead")}</p>

          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            hidden
            data-testid="skill-file-input"
            onChange={(e) => void pickFile(e.target.files?.[0])}
          />
          <div style={s.pickRow}>
            <Button
              kind="secondary"
              icon="Upload"
              onClick={() => fileRef.current?.click()}
              disabled={preview.isPending}
            >
              {preview.isPending ? t("file.importing") : t("file.chooseFile")}
            </Button>
            <span style={s.pickedName}>{t("file.accepts")}</span>
          </div>

          <div style={s.divider}>
            <span style={s.rule} />
            {t("drawer.or")}
            <span style={s.rule} />
          </div>

          <Button kind="ghost" icon="Edit" onClick={startBlank}>
            {t("page.menu.createFromScratch")}
          </Button>
        </div>
      ) : (
        <div style={s.section}>
          <FormField label={t("config.name")} required>
            <TextInput value={name} onChange={setName} mono placeholder={t("file.namePlaceholder")} />
          </FormField>

          <FormField label={t("config.description")} hint={t("config.descriptionHint")}>
            <TextInput value={description} onChange={setDescription} />
          </FormField>

          <FormField label={t("config.type")}>
            <SelectInput
              value={type}
              onChange={(v) => setType(v as SkillType)}
              options={TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
            />
          </FormField>

          <FormField
            label={t("file.bodyLabel")}
            required
            hint={draft ? t("file.bodyHint") : t("config.bodyHint")}
          >
            <Textarea
              value={body}
              onChange={setBody}
              rows={14}
              mono
              placeholder={t("file.bodyPlaceholder")}
            />
          </FormField>

          {draft && draft.ignored_files.length > 0 && (
            <div style={s.ignoredBox}>
              <div style={s.ignoredTitle}>
                <Icon.Shield size={14} style={{ color: "var(--ok)" }} />
                {t("file.ignoredTitle", { count: draft.ignored_files.length })}
              </div>
              <p style={s.ignoredHint}>{t("file.ignoredHint")}</p>
              <ul style={s.ignoredList}>
                {draft.ignored_files.map((f) => (
                  <li key={f} style={s.ignoredItem}>
                    <Icon.File size={11} />
                    <span className="mono">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {draft && draft.warnings.length > 0 && (
            <div style={s.warnings}>
              {draft.warnings.map((w) => (
                <span key={w} style={s.warning}>
                  <Icon.Info size={12} style={{ flexShrink: 0, marginTop: 2 }} />
                  {w}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
