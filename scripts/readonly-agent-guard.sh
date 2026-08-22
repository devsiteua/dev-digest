#!/usr/bin/env bash
#
# PreToolUse guard — makes "read-only agent" a boundary instead of a sentence.
#
# `architecture-reviewer`, `plan-verifier` and `researcher` have no `Write` and
# no `Edit`, and each one's prompt lists the shell commands it may run. That list
# was an INSTRUCTION: `tools` says which tools, never with which arguments, so
# nothing stopped `sed -i` or `echo … > file` from inside one of them.
#
# Why a repo-level hook and not a per-agent one. The subagent frontmatter schema
# in Claude Code 2.1.240 carries `description`, `tools`, `disallowedTools`,
# `prompt`, `model`, `mcpServers`, `skills`, `initialPrompt`, `maxTurns`,
# `background`, `memory`, `effort`, `permissionMode`, `observer` and
# `observerMessage` — there is NO `hooks:` field, so a hook cannot be scoped to
# one agent from its own file. What does work is this: the common hook payload
# carries `agent_type`, on `PreToolUse` as on every other event, so one hook
# registered once can decide per agent. That is the fallback this repository's
# L03 Round 2 spec named, and it is the whole mechanism.
#
# Contract with Claude Code:
#   exit 0  -> allow the command
#   exit 2  -> deny it; stderr is fed back to the model, so write for that reader
#
# Failure policy, deliberately the same as `pr-self-review-gate.sh`: an internal
# error ALLOWS and says why on stderr. A guard that silently blocks every shell
# in the session is worse than no guard; a guard that silently allows is the
# failure nobody notices, so it never stays quiet.

set -uo pipefail

# --------------------------------------------------- 1. is this one of ours --
INPUT="$(cat)"

command -v jq >/dev/null 2>&1 || exit 0

AGENT="$(printf '%s' "$INPUT" | jq -r '.agent_type // ""' 2>/dev/null)" || exit 0
case "$AGENT" in
  architecture-reviewer|plan-verifier|researcher) ;;
  *) exit 0 ;;
esac

CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null)" || exit 0
[[ -n "$CMD" ]] || exit 0

# ------------------------------------------------------ 2. what is refused ---
# One pattern per mutation route, each with the reason it is here. Matching is
# on the command STRING, which is the only thing a `PreToolUse` hook can see and
# the reason this file exists at all.
#
# Redirection is checked before the per-segment loop because `>` is the one
# mutation that needs no command name of its own. Redirects to `/dev/null` and
# `2>&1` are carved out rather than blanket-refused: neither writes to the tree,
# and every read-only agent's own prompt tells it to use them. Refusing those
# would make the guard the thing that gets removed.
deny() {
  {
    echo "BLOCKED: \`$AGENT\` is a read-only agent and this command would mutate the tree."
    echo
    echo "  command: $CMD"
    echo "  refused: $1"
    echo
    echo "Read, search and verify freely — cat, sed -n, grep, rg, find, ls, git log/show/diff/status,"
    echo "pnpm test, pnpm typecheck, pnpm arch:check are all allowed. Report what you found and let"
    echo "the caller decide; writing the fix is \`implementer\`'s job, from a plan."
  } >&2
  exit 2
}

# Strip the redirections that discard rather than write, then look for any that
# remain: `2>&1`, and any fd redirected at /dev/null.
STRIPPED="$(printf '%s' "$CMD" | sed -E 's/2>&1//g; s/[0-9]*>>?[[:space:]]*\/dev\/null//g')"
printf '%s' "$STRIPPED" | grep -qE '(^|[^0-9<>])>' && deny "output redirection writes a file"

# Now per segment, so `git log | grep x` is judged on `git log`, not on the pipe.
while IFS= read -r SEG; do
  # Trim, drop a leading subshell brace and any VAR=value prefix, exactly as the
  # PR gate does — `FOO=1 rm -rf x` must not read as a command called `FOO=1`.
  SEG="$(printf '%s' "$SEG" \
    | sed -E 's/^[[:space:]]*//; s/[[:space:]]*$//; s/^(\(|\{)[[:space:]]*//; s/^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*//')"
  [[ -n "$SEG" ]] || continue

  case "$SEG" in
    # --- direct filesystem mutation ---
    rm\ *|rm) deny "\`rm\` deletes files" ;;
    rmdir\ *|mv\ *|cp\ *) deny "\`${SEG%% *}\` moves or overwrites files" ;;
    mkdir\ *|touch\ *|truncate\ *|ln\ *) deny "\`${SEG%% *}\` creates or truncates files" ;;
    tee\ *|tee) deny "\`tee\` writes its input to a file" ;;
    dd\ *) deny "\`dd\` writes blocks" ;;
    chmod\ *|chown\ *) deny "\`${SEG%% *}\` changes file metadata" ;;

    # --- in-place editors ---
    *sed\ *-i*|*perl\ *-i*) deny "in-place editing rewrites the file it reads" ;;
    patch\ *|patch) deny "\`patch\` applies a diff to the tree" ;;

    # --- git and the remote ---
    git\ add*|git\ commit*|git\ push*|git\ checkout*|git\ switch*|git\ restore*|git\ reset*|git\ rebase*|git\ merge*|git\ stash*|git\ clean*|git\ apply*|git\ rm*|git\ mv*|git\ tag*|git\ branch\ -*)
      deny "\`${SEG:0:24}…\` changes the repository state" ;;
    gh\ pr\ create*|gh\ pr\ ready*|gh\ pr\ merge*|gh\ pr\ edit*|gh\ pr\ close*|gh\ issue\ create*|gh\ release*|gh\ api\ *-X*|gh\ api\ *--method*)
      deny "this \`gh\` call writes to GitHub" ;;

    # --- package managers and the database ---
    npm\ i*|npm\ install*|npm\ ci*|npm\ uninstall*|pnpm\ i*|pnpm\ install*|pnpm\ add*|pnpm\ remove*|yarn\ add*|yarn\ install*|npx\ *)
      deny "installing packages mutates node_modules and the lockfile" ;;
    *db:migrate*|*db:generate*|*db:seed*|*db:push*|*db:drop*)
      deny "a database command changes persisted state" ;;
    docker\ compose\ down*|docker\ compose\ rm*|docker\ *rm\ *|docker\ volume\ *)
      deny "\`docker compose down -v\` destroys every imported repo and review" ;;
  esac
# `printf '%s\n'` and not `'%s'`: without the trailing newline `read` reports EOF
# on the only segment of a single-command call, the loop body never runs, and the
# guard silently allows everything it was written to refuse.
done < <(printf '%s\n' "$CMD" | tr ';|&' '\n\n\n')

exit 0
