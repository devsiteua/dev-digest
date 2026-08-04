#!/usr/bin/env bash
#
# The one definition of "which diff was reviewed".
#
#   scripts/pr-self-review-hash.sh [base-ref]                 # 16-char hex digest
#   scripts/pr-self-review-hash.sh --print-base [base-ref]    # the merge-base sha
#
# `--print-base` exists so the checks script and the gate resolve the review base
# through this file too. Base resolution is part of "which diff was reviewed";
# a second copy of it would drift exactly like the digest recipe would.
#
# Two callers depend on this file agreeing with itself: the pr-self-review skill
# stamps the digest into .claude/pr-self-review/last-verdict.json, and
# pr-self-review-gate.sh recomputes it to decide whether that verdict still
# describes the working tree.
#
# Never inline this recipe anywhere. If the two sides ever compute it
# differently the gate either blocks every PR or blocks none — and "blocks none"
# is silent, which is the failure you would not notice.
#
# What goes into the digest:
#   - the merge-base sha, so rebasing onto a moved main invalidates the verdict
#   - the full base..worktree diff, which covers committed + staged + unstaged
#   - the content of every untracked file, because `git diff` cannot see them
#     and a brand-new file is exactly where an unreviewed CRITICAL hides
#
# Exits non-zero only when it cannot resolve the base ref.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PRINT_BASE=0
if [[ "${1:-}" == "--print-base" ]]; then
  PRINT_BASE=1
  shift
fi

BASE_REF="${1:-}"

if [[ -z "$BASE_REF" ]]; then
  # The PR's own base when one already exists, otherwise the branch point.
  BASE_REF="$(gh pr view --json baseRefName -q .baseRefName 2>/dev/null || true)"
  [[ -n "$BASE_REF" ]] || BASE_REF="origin/main"
  git rev-parse --verify --quiet "$BASE_REF" >/dev/null 2>&1 || BASE_REF="main"
fi

BASE_SHA="$(git merge-base HEAD "$BASE_REF" 2>/dev/null)" || {
  echo "pr-self-review-hash: cannot resolve base ref '$BASE_REF'" >&2
  exit 1
}

if [[ "$PRINT_BASE" == "1" ]]; then
  echo "$BASE_SHA"
  exit 0
fi

{
  echo "$BASE_SHA"
  git diff "$BASE_SHA" || true
  # -z + xargs -0 so paths with spaces survive; -r so an empty list is a no-op.
  #
  # The `|| true` is load-bearing. A worktree is live: a build artefact, an
  # editor swap file, or a concurrent test run can delete an untracked path
  # between the listing and the hashing. Under `pipefail` that aborts the whole
  # script, it prints nothing, and the gate reads the empty digest as "staleness
  # could not be checked" — which is the silent-allow this tool must never have.
  # Losing one vanished file from the digest is the lesser error by far.
  git ls-files --others --exclude-standard -z \
    | xargs -0 -r shasum -a 256 2>/dev/null || true
} | shasum -a 256 | cut -c1-16
