/* One document in the Project Context list: its title, its path LABEL, its
   size, and the three things the user can do to it — enable/disable, reorder,
   delete. Nothing here edits the text (AC-23). */
"use client";

import React from "react";
import { Icon, IconBtn, Toggle } from "@devdigest/ui";
import type { ProjectContextDoc } from "@devdigest/shared";
import { s } from "./styles";

export interface ContextDocRowProps {
  doc: ProjectContextDoc;
  selected: boolean;
  /** Sizes rendered by the parent, which owns the copy. */
  sizeLabel: string;
  labels: {
    enable: string;
    disable: string;
    delete: string;
    moveUp: string;
    moveDown: string;
    disabled: string;
  };
  canMoveUp: boolean;
  canMoveDown: boolean;
  busy: boolean;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
  onMove: (delta: 1 | -1) => void;
  onDelete: () => void;
}

export function ContextDocRow({
  doc,
  selected,
  sizeLabel,
  labels,
  canMoveUp,
  canMoveDown,
  busy,
  onSelect,
  onToggle,
  onMove,
  onDelete,
}: ContextDocRowProps) {
  // A disabled document stays visible and stays readable — it is the user's
  // document, not a mistake — but it must not look like one the reviewer reads.
  const rowStyle = {
    ...s.row,
    ...(selected ? s.rowSelected : null),
    ...(doc.enabled ? null : s.rowDisabled),
  };

  return (
    <div style={rowStyle} data-testid="context-doc-row">
      <button type="button" style={s.main} onClick={onSelect} aria-pressed={selected}>
        <Icon.FileText
          size={13}
          style={doc.enabled ? s.iconOn : s.iconOff}
          aria-hidden="true"
        />
        <span style={s.text}>
          <span style={s.title}>{doc.title}</span>
          <span className="mono" style={s.pathLabel}>
            {doc.path_label}
          </span>
        </span>
        <span style={s.size}>{sizeLabel}</span>
      </button>

      <span style={s.controls}>
        {!doc.enabled && <span style={s.disabledTag}>{labels.disabled}</span>}
        {/* `Toggle` exposes `role="switch"` + `aria-checked` and takes no label
            of its own, so the affordance is named on the wrapper. */}
        <span title={doc.enabled ? labels.disable : labels.enable}>
          <Toggle on={doc.enabled} onChange={onToggle} />
        </span>
        <IconBtn
          icon="ArrowUp"
          label={labels.moveUp}
          onClick={canMoveUp && !busy ? () => onMove(-1) : undefined}
        />
        <IconBtn
          icon="ArrowDown"
          label={labels.moveDown}
          onClick={canMoveDown && !busy ? () => onMove(1) : undefined}
        />
        <IconBtn
          icon="Trash"
          label={labels.delete}
          danger
          onClick={busy ? undefined : onDelete}
        />
      </span>
    </div>
  );
}
