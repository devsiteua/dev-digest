"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "../IntentCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
}

/**
 * The PR's Overview tab.
 *
 * Intent comes FIRST, above the description. In the design this tab is the PR
 * Brief and nothing else — its PR fixture has no `body` field and `PRHeader`
 * never renders one, so the Description section below is a production addition
 * the design does not have. Putting the brief under it would invert the hierarchy
 * the design is the authority on.
 */
export function OverviewTab({ prId, prBody }: OverviewTabProps) {
  return (
    <>
      <section>
        <IntentCard prId={prId} />
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
