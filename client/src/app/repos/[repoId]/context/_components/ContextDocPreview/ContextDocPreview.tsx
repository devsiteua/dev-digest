/* The read-only pane: what one project-context document actually says.

   READ-ONLY, deliberately and structurally (AC-23). No editable field, no
   `Preview | Edit` switch and no save path — the design's artboard shows all
   three, and the spec puts an in-browser editor with dirty state and conflict
   handling out of scope. A document is something the user wrote elsewhere and
   gave to DevDigest; DevDigest does not edit it back. */
"use client";

import React from "react";
import { ErrorState, Icon, Markdown, Skeleton } from "@devdigest/ui";
import type { ProjectContextDoc } from "@devdigest/shared";
import { s } from "./styles";

export interface ContextDocPreviewProps {
  doc: ProjectContextDoc | undefined;
  isLoading: boolean;
  isError: boolean;
  loadErrorLabel: string;
  readOnlyNote: string;
  /** "A label, not a path" — the sentence AC-03 turns into a UI obligation. */
  pathLabelNote: string;
  onRetry: () => void;
}

export function ContextDocPreview({
  doc,
  isLoading,
  isError,
  loadErrorLabel,
  readOnlyNote,
  pathLabelNote,
  onRetry,
}: ContextDocPreviewProps) {
  if (isError) return <ErrorState title={loadErrorLabel} onRetry={onRetry} />;

  if (isLoading || !doc) {
    return (
      <div style={s.pane}>
        <Skeleton height={18} width="40%" />
        <Skeleton height={12} />
        <Skeleton height={12} />
        <Skeleton height={12} width="70%" />
      </div>
    );
  }

  return (
    <div style={s.pane}>
      <div style={s.head}>
        <span className="mono" style={s.pathLabel} title={pathLabelNote}>
          {doc.path_label}
        </span>
        <span style={s.readOnly}>
          <Icon.Lock size={12} aria-hidden="true" />
          {readOnlyNote}
        </span>
      </div>
      <div style={s.body}>
        <Markdown>{doc.body}</Markdown>
      </div>
    </div>
  );
}
