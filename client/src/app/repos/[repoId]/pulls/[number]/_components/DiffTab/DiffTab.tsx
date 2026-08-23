"use client";

import React from "react";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { useSmartDiff } from "@/lib/hooks/smart-diff";
import { notify } from "@/lib/toast";
import { SmartDiffViewer } from "../SmartDiffViewer";
import type { FindingRecord, PrFile } from "@devdigest/shared";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /**
   * The latest review's findings, or `null` while the reviews are loading.
   *
   * Passed down rather than fetched here so the badges update the moment a run
   * settles: the page already refreshes `usePrReviews` in `onRunDone`, and the
   * smart-diff response — computed before that run existed — would otherwise
   * keep saying there is nothing to flag.
   */
  findings?: FindingRecord[] | null;
}

export function DiffTab({ prId, filesCount, files, canComment, findings }: DiffTabProps) {
  const { data: comments } = usePrComments(prId);
  // Asked for only once the detail has resolved — `GET /pulls/:id` rewrites
  // `pr_files` as it loads, and a smart diff read mid-write would describe the
  // previous snapshot. `files` is that detail, so its presence is the gate.
  const { data: smartDiff } = useSmartDiff(prId, files.length > 0);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          commentCount > 0 ? (
            <Button
              kind="ghost"
              size="sm"
              icon={showComments ? "EyeOff" : "Eye"}
              onClick={() => setShowComments((v) => !v)}
            >
              {showComments ? "Hide comments" : "Show comments"} ({commentCount})
            </Button>
          ) : undefined
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>
      {smartDiff && smartDiff.groups.length > 0 ? (
        <SmartDiffViewer
          groups={smartDiff.groups}
          splitSuggestion={smartDiff.split_suggestion}
          files={files}
          findings={findings}
          commenting={commenting}
        />
      ) : (
        // Nothing classified yet (a PR imported but never opened, or the request
        // still in flight): the flat viewer is the honest fallback, not an empty
        // screen with three group headers.
        <DiffViewer files={files} commenting={commenting} />
      )}
    </section>
  );
}
