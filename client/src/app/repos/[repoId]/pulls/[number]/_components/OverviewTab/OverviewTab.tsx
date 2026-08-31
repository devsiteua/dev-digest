"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { PrBriefCard } from "../PrBriefCard";
import { IntentCard } from "../IntentCard";
import { MultiAgentPicker } from "../MultiAgentPicker";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
  /**
   * Opens a file in the Files tab. Forwarded straight to `PrBriefCard`; this tab
   * does not know a router exists, and neither does the card.
   *
   * REQUIRED, not `onOpenFile?:`. `DiffTab` declares its own `onOpenFinding?`
   * optional, and copying that `?` is what would let the thread be silently
   * dropped — an unpassed optional callback compiles, and the button then does
   * nothing. With no `?`, a missing hop is a `pnpm typecheck` failure here.
   */
  onOpenFile: (path: string, line: number | null) => void;
}

/**
 * The PR's Overview tab.
 *
 * The brief comes FIRST and full width — that is AC-32, and it is also the
 * hierarchy the design's `pr-overview` artboard draws: the card that says what
 * this PR is and what it risks sits above everything else. Intent follows, then
 * the description.
 *
 * The description section is a production addition the design does not have: its
 * PR fixture has no `body` field and `PRHeader` never renders one. It stays last
 * for the same reason it was added below intent — the raw text the author wrote
 * is the least processed thing on the tab.
 */
export function OverviewTab({ prId, prBody, onOpenFile }: OverviewTabProps) {
  return (
    <>
      <section>
        <PrBriefCard prId={prId} onOpenFile={onOpenFile} />
      </section>
      <section>
        <IntentCard prId={prId} />
      </section>
      {/* The multi-agent picker's first mount point: this PR is already fixed, so
          no PR control is handed in. The second is the Multi-Agent Review route's
          landing state, which passes one. */}
      <section>
        <MultiAgentPicker prId={prId} />
      </section>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
