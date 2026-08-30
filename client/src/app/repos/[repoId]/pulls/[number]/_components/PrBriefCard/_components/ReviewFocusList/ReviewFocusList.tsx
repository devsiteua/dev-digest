"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { ReviewFocusItem } from "@devdigest/shared";
import { middleTruncate, splitRef } from "../../helpers";
import { s, rowFor } from "./styles";

interface ReviewFocusListProps {
  items: ReviewFocusItem[];
  /**
   * Opens a file in the Files tab. REQUIRED, deliberately — `DiffTab` declares
   * its own `onOpenFinding?` optional, and copying that `?` is exactly what
   * lets an unthreaded callback compile into a button that quietly does
   * nothing. With no `?`, a missing hop is a `pnpm typecheck` failure.
   */
  onOpenFile: (path: string, line: number | null) => void;
}

/**
 * Which files to read first, in order.
 *
 * Fully derived — the design has no artboard for `review_focus`. Two rules come
 * from the criteria rather than from taste:
 *
 * - a `kind: 'file'` row is a button that navigates in ONE call (AC-33), and its
 *   accessible name carries ITS OWN file and line. Three rows sharing one label
 *   would make a flow's `find role button --name` mean "whichever comes first"
 *   (`e2e/INSIGHTS.md`, 2026-08-23) — the fix belongs in the component, which is
 *   here;
 * - a `kind: 'endpoint'` row is monospace text and does not navigate (AC-37).
 *   There is nothing in the diff viewer to open: an endpoint has no line.
 */
export function ReviewFocusList({ items, onOpenFile }: ReviewFocusListProps) {
  const t = useTranslations("brief");

  if (items.length === 0) {
    return <div style={s.empty}>{t("card.noFocus")}</div>;
  }

  return (
    <ol style={s.list}>
      {items.map((item, i) => {
        const label = middleTruncate(
          item.line != null && item.kind === "file" ? `${item.ref}:${item.line}` : item.ref,
        );
        const ordinal = (
          <span style={s.ordinal} aria-hidden>
            {i + 1}
          </span>
        );
        const body = (
          <span style={s.body}>
            <span className="mono" style={s.ref}>
              {label}
            </span>
            <span style={s.why}>{item.why}</span>
          </span>
        );

        if (item.kind === "endpoint") {
          return (
            <li key={`${item.kind}:${item.ref}`}>
              <div style={rowFor(false)} title={item.ref}>
                {ordinal}
                {body}
              </div>
            </li>
          );
        }

        // `ref` is the path the allow-list approved; `line` is optional even on
        // a file row, and the two message keys keep the accessible name honest
        // rather than reading "at line null".
        const { path } = splitRef(item.ref);
        const line = item.line ?? null;
        return (
          <li key={`${item.kind}:${item.ref}:${line ?? ""}`}>
            <button
              type="button"
              style={rowFor(true)}
              title={item.ref}
              aria-label={
                line == null
                  ? t("card.focusFileNoLine", { path })
                  : t("card.focusFile", { path, line })
              }
              onClick={() => onOpenFile(path, line)}
            >
              {ordinal}
              {body}
              <Icon.ArrowRight size={13} style={{ marginLeft: "auto", flexShrink: 0 }} />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
