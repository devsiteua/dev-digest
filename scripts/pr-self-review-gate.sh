#!/usr/bin/env bash
#
# PreToolUse gate — the thing that actually stops a pull request being opened.
#
# Wired from .claude/settings.json with matcher "Bash", so this runs before
# EVERY shell command in the session. The command filter is therefore the first
# statement in the file and everything expensive lives behind it.
#
# Contract with Claude Code:
#   exit 0  -> allow the command
#   exit 2  -> deny it; stderr is fed back to the model, so the text below is
#              what Claude reads and acts on. Write it for that reader.
#
# It gates `gh pr create` / `gh pr ready` and deliberately NOT `git push`:
# the ask was "before opening a PR", and blocking pushes would break WIP
# branches and backups while closing nothing — a pushed branch can still be
# opened as a PR from the GitHub web UI, which no local hook can see.
#
# Failure policy: any internal error allows the command, but always says why on
# stderr. A gate that silently blocks everyone's shell is worse than no gate;
# a gate that silently allows is the failure you would never notice, so it never
# stays quiet.

set -uo pipefail

# ------------------------------------------------------- 1. cheap filter -----
INPUT="$(cat)"

command -v jq >/dev/null 2>&1 || exit 0
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null)" || exit 0

case "$CMD" in
  *gh*pr*create*|*gh*pr*ready*) ;;
  *) exit 0 ;;
esac
# The glob above only says "these words appear somewhere". Now require that a
# command actually *starts* with the invocation, so `echo ... gh pr create ...`
# in a doc example or a commit message does not trip the gate. Split on shell
# operators, trim, drop any VAR=value prefix, then anchor.
printf '%s' "$CMD" \
  | tr ';|&\n' '\n\n\n\n' \
  | sed -E 's/^[[:space:]]*//; s/^(\(|\{)[[:space:]]*//; s/^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*//' \
  | grep -qE '^gh[[:space:]]+pr[[:space:]]+(create|ready)([[:space:]]|$)' || exit 0

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" 2>/dev/null || exit 0

VERDICT=".claude/pr-self-review/last-verdict.json"
CHECKS="$ROOT/scripts/pr-self-review-checks.sh"
HASHER="$ROOT/scripts/pr-self-review-hash.sh"

# --------------------------------------------------- 2. the emergency door ---
if [[ "${DEVDIGEST_SKIP_PR_REVIEW:-}" == "1" ]]; then
  echo "pr-self-review: SKIPPED via DEVDIGEST_SKIP_PR_REVIEW=1 — no review was consulted." >&2
  exit 0
fi

# ------------------------------------- 3. the deterministic checks, live -----
# Run even when the skill was never invoked. This is the half that cannot be
# forgotten, and it costs about a second.
if [[ -x "$CHECKS" ]]; then
  SCRIPTED="$("$CHECKS" 2>/dev/null)" || SCRIPTED=""
  if [[ -n "$SCRIPTED" ]]; then
    BLOCKERS="$(printf '%s' "$SCRIPTED" | jq -r '[.[] | select(.severity == "CRITICAL")] | length' 2>/dev/null || echo 0)"
    if [[ "${BLOCKERS:-0}" -gt 0 ]]; then
      {
        echo "BLOCKED: pr-self-review found $BLOCKERS critical issue(s) in the changes you are about to open a PR for."
        echo
        printf '%s' "$SCRIPTED" | jq -r '.[] | select(.severity == "CRITICAL")
          | "  • \(.title)\n    \(.file):\(.start_line)\n    \(.rationale)\n    Fix: \(.suggestion // "—")\n"' 2>/dev/null
        echo "These come from deterministic repo checks, not from a model — each one is a rule this repo states somewhere."
        echo "Fix them and try again, or run: /pr-self-review --override \"<reason>\""
      } >&2
      exit 2
    fi
  fi
else
  echo "pr-self-review: checks script missing or not executable — mechanical checks did NOT run." >&2
fi

# ------------------------------------------------------- 4. the artifact -----
if [[ ! -f "$VERDICT" ]]; then
  {
    echo "BLOCKED: no PR self-review has been run for this diff."
    echo
    echo "The mechanical checks are clean, but the skill-routed review has not run,"
    echo "so nothing has looked at this diff through the react / fastify / security / architecture skills."
    echo
    echo "Run /pr-self-review first."
  } >&2
  exit 2
fi

GATE="$(jq -r '.gate // ""' "$VERDICT" 2>/dev/null || echo "")"
SAVED_SHA="$(jq -r '.diff_sha // ""' "$VERDICT" 2>/dev/null || echo "")"
OVERRIDE="$(jq -r '.override // empty | .reason // empty' "$VERDICT" 2>/dev/null || echo "")"

# An artifact that does not parse, or carries no gate, is not evidence of
# anything. Treating it as "not fail" would let a truncated write silently open
# the door — the one failure mode this script must not have.
if [[ -z "$GATE" || -z "$SAVED_SHA" ]]; then
  {
    echo "BLOCKED: the PR self-review verdict at $VERDICT is unreadable or incomplete."
    echo "It has no usable 'gate'/'diff_sha', so it proves nothing about this diff."
    echo
    echo "Re-run /pr-self-review."
  } >&2
  exit 2
fi

# --------------------------------------------------- 5. staleness, softly ----
NOW_SHA="$("$HASHER" 2>/dev/null || echo "")"
if [[ -z "$NOW_SHA" ]]; then
  # Skipping the staleness branch on an empty digest would let a verdict recorded
  # for a completely different diff through without a word. Say it out loud.
  echo "pr-self-review: could not compute the diff digest, so the verdict could NOT be" >&2
  echo "checked for staleness. It may describe a different diff. Mechanical checks did run." >&2
fi
if [[ -n "$NOW_SHA" && -n "$SAVED_SHA" && "$NOW_SHA" != "$SAVED_SHA" ]]; then
  if [[ "$GATE" == "pass" ]]; then
    # The mechanical half already re-ran clean above, so the only thing that has
    # aged is the model's judgement. Blocking here would mean paying for a full
    # re-review after a comment typo, which is how gates get switched off.
    echo "pr-self-review: the diff changed since the last review ($SAVED_SHA -> $NOW_SHA)." >&2
    echo "Mechanical checks re-ran clean, so this is allowed. Re-run /pr-self-review for a fresh skill review." >&2
    exit 0
  fi
  {
    echo "BLOCKED: the last PR self-review failed and the diff has changed since."
    echo "Saved verdict: gate=$GATE for diff $SAVED_SHA; the tree is now $NOW_SHA."
    echo
    echo "Re-run /pr-self-review — the previous blockers may or may not still apply."
  } >&2
  exit 2
fi

# ------------------------------------------------------------- 6. the gate ---
if [[ "$GATE" == "fail" && -z "$OVERRIDE" ]]; then
  {
    echo "BLOCKED: pr-self-review verdict is request_changes for this diff."
    echo
    jq -r '.findings // [] | .[] | select(.severity == "CRITICAL")
      | "  • \(.title)\n    \(.file):\(.start_line)\n    \(.rationale)\n    Fix: \(.suggestion // "—")\n"' "$VERDICT" 2>/dev/null
    echo "Fix them and re-run /pr-self-review, or override deliberately:"
    echo "  /pr-self-review --override \"<reason>\""
  } >&2
  exit 2
fi

# ---------------------------------------------------------- 7. let it through -
if [[ -n "$OVERRIDE" ]]; then
  echo "pr-self-review: proceeding with a recorded override — \"$OVERRIDE\"" >&2
  echo "Consider putting that reason in the PR description." >&2
fi
exit 0
