#!/usr/bin/env bash
#
# Proof that the scripted checks fire — and that they stay quiet where the tree
# is legitimately already doing the thing they look for.
#
#   scripts/test-pr-self-review.sh
#
# Why this file exists, in the repo's own words (INSIGHTS.md, 2026-08-05):
# "never trust a green depcruise run you have not seen fail. Prove each new rule
# by planting a violation, confirming exit code 1, then removing it." The same
# applies here with more force, because these checks are the only thing that can
# block a PR. A check nobody has watched fail is a false blocker waiting for its
# moment.
#
# Every case plants into the working tree and restores it afterwards. It never
# runs `git clean`, because the scripts under test are themselves untracked while
# this feature is in development.
#
# Requires a clean-ish worktree: planted files must be the only thing the checks
# see, so run it before you start editing, or stash first.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CHECKS="$ROOT/scripts/pr-self-review-checks.sh"
PASS=0
FAIL=0
PLANTED_FILES=()
TOUCHED_FILES=()

cleanup() {
  local f d
  for f in "${PLANTED_FILES[@]:-}"; do
    [[ -n "$f" ]] || continue
    rm -rf "$f"
    # `plant` may have created the parent. Git does not track empty directories,
    # so one left behind is invisible to `git status` but still litters the tree —
    # and a stray server/src/modules/__probe/ is exactly the kind of thing the
    # onion guard would later cruise. rmdir only succeeds while it is empty.
    d="$(dirname "$f")"
    while [[ "$d" != "." && "$d" != "/" ]]; do
      rmdir "$d" 2>/dev/null || break
      d="$(dirname "$d")"
    done
  done
  for f in "${TOUCHED_FILES[@]:-}"; do [[ -n "$f" ]] && git checkout -- "$f" 2>/dev/null; done
  PLANTED_FILES=()
  TOUCHED_FILES=()
}
trap cleanup EXIT

# plant <path> <content...>   — a new file, removed on cleanup
plant() {
  local p="$1"; shift
  mkdir -p "$(dirname "$p")"
  printf '%s\n' "$@" > "$p"
  PLANTED_FILES+=("$p")
}

# append <path> <line>        — modifies a tracked file, git-restored on cleanup
append() {
  local p="$1"; shift
  TOUCHED_FILES+=("$p")
  printf '%s\n' "$@" >> "$p"
}

# A file created on this branch reads as `A` against the merge-base, not `M`,
# so a check that only fires on a modification cannot be exercised against the
# default base. BASE_OVERRIDE re-bases a single case onto the commit that
# introduced the file, which is the state every later PR will actually see.
BASE_OVERRIDE=""
sources() { "$CHECKS" $BASE_OVERRIDE 2>/dev/null | jq -r '.[].source' | sort -u; }

# expect <fires|silent> <source> <description>
expect() {
  local mode="$1" src="$2" desc="$3" out
  out="$(sources)"
  if [[ "$mode" == fires ]]; then
    if echo "$out" | grep -qx "$src"; then
      echo "  ok    $desc"; PASS=$((PASS + 1))
    else
      echo "  FAIL  $desc — expected $src, got: ${out//$'\n'/, }"; FAIL=$((FAIL + 1))
    fi
  else
    if echo "$out" | grep -qx "$src"; then
      echo "  FAIL  $desc — $src fired but should not have"; FAIL=$((FAIL + 1))
    else
      echo "  ok    $desc"; PASS=$((PASS + 1))
    fi
  fi
  cleanup
  BASE_OVERRIDE=""
}

echo "PR self-review — scripted checks"
echo

echo "baseline"
out="$(sources)"
if [[ -z "$out" ]]; then
  echo "  ok    clean worktree produces no findings"; PASS=$((PASS + 1))
else
  echo "  FAIL  clean worktree already fires: ${out//$'\n'/, }"; FAIL=$((FAIL + 1))
fi
echo

echo "positives — each check must be seen failing"

plant client/src/vendor/ui/__probe.ts "export const probe = 1;"
expect fires check:vendor-ui "1  vendored design system touched"

append server/src/db/migrations/0000_init.sql "-- probe"
expect fires check:migration-edit "2  generated migration edited by hand"

append server/src/vendor/shared/contracts/findings.ts "export const Probe = z.string();"
expect fires check:contract-mirror "3  contract changed on one side only"

append server/src/db/schema/agents.ts "// probe"
expect fires check:schema-migration "4  schema changed with no new migration"

append docs/agent-prompts/general-reviewer.md "Probe line."
expect fires check:prompt-mirror "5  agent prompt changed without its seed mirror"

plant server/test/probe-db.test.ts \
  "import { PostgreSqlContainer } from 'testcontainers';" \
  "export const probe = PostgreSqlContainer;"
expect fires check:it-test-lane "6  DB-backed test outside the integration lane"

plant client/src/app/__probe/Probe.tsx \
  "export async function probe() { return fetch('/api/x'); }"
expect fires check:component-fetch "7  fetch() called from a component"

plant server/src/probe-secret.ts "export const k = 'sk_live_0123456789abcdef';"
expect fires check:secret-literal "8  credential literal added"

append server/src/platform/config.ts "// apiKey: string;"
expect silent check:config-secret "8b commented-out key field is not a violation"

plant server/src/modules/__probe/service.ts "import { eq } from 'drizzle-orm';" "export const probe = eq;"
expect fires check:arch "9  onion guard rejects drizzle in a service"

append server/.dependency-cruiser-known-violations.json ""
expect silent check:arch-baseline "10a a blank line is not new debt"

BASE_OVERRIDE=88d483c
append server/.dependency-cruiser-known-violations.json \
  '  { "from": "src/probe.ts", "to": "node_modules/drizzle-orm/index.cjs" },' \
  '  { "from": "src/probe2.ts", "to": "node_modules/postgres/index.js" },'
expect fires check:arch-baseline "10b appending to the frozen debt list"

append server/src/platform/config.ts "  apiKey: string;"
expect fires check:config-secret "8c credential field added to AppConfig"

append skills-lock.json '    "onion-architecture": { "source": "x/y" },'
expect fires check:skill-lock "12c hand-authored skill added to the vendor lock"

plant server/src/modules/probe/handler.ts "const u = process.env.PROBE_URL;" "export const probe = u;"
expect fires check:env-read "11  process.env read outside its chokepoint"

plant e2e/specs/99-probe.flow.json '{"steps":[{"label":"x","cmd":"chat"}]}'
expect fires check:e2e-contract "12a e2e flow using the forbidden chat command"

plant e2e/specs/98-probe.flow.json '{"steps":[{"label":"x","url":"http://localhost:3000/"}]}'
expect fires check:e2e-contract "12b e2e flow hardcoding a host"

echo
echo "negatives — the tree's own legitimate patterns must stay quiet"

append client/src/app/agents/[id]/page.tsx "// onRetry={() => refetch()}"
expect silent check:component-fetch "refetch() is not fetch()"

append client/src/lib/api.ts "// await fetch(url)"
expect silent check:component-fetch "client/src/lib is where fetch belongs"

append server/src/adapters/secrets/local.ts "// const x = process.env.FOO;"
expect silent check:env-read "the secrets adapter may read process.env"

append server/src/db/seed.ts "// const x = process.env.FOO;"
expect silent check:env-read "the seed entrypoint may read process.env"

append docs/agent-prompts/README.md "Probe line."
expect silent check:prompt-mirror "the prompt-authoring README is not a prompt"

# Both mirrors edited identically: the historical drift between the two copies
# must not make this look like a one-sided change.
append server/src/vendor/shared/contracts/findings.ts "// probe mirror"
append client/src/vendor/shared/contracts/findings.ts "// probe mirror"
expect silent check:contract-mirror "identical edits on both mirrors are fine"

echo
echo "the gate — exit 0 allows, exit 2 denies"

GATE_SH="$ROOT/scripts/pr-self-review-gate.sh"
VERDICT_DIR="$ROOT/.claude/pr-self-review"
VERDICT="$VERDICT_DIR/last-verdict.json"
HAD_VERDICT=0
[[ -f "$VERDICT" ]] && { HAD_VERDICT=1; cp "$VERDICT" "$VERDICT.testbak"; }
mkdir -p "$VERDICT_DIR"

restore_verdict() {
  if [[ "$HAD_VERDICT" == 1 ]]; then mv "$VERDICT.testbak" "$VERDICT"
  else rm -f "$VERDICT"; rmdir "$VERDICT_DIR" 2>/dev/null; fi
}

# gate <expected-exit> <command> <description>
gate() {
  local want="$1" cmd="$2" desc="$3" got
  echo "{\"tool_input\":{\"command\":$(jq -Rn --arg c "$cmd" '$c')}}" \
    | "$GATE_SH" >/dev/null 2>&1
  got=$?
  if [[ "$got" == "$want" ]]; then
    echo "  ok    $desc"; PASS=$((PASS + 1))
  else
    echo "  FAIL  $desc — expected exit $want, got $got"; FAIL=$((FAIL + 1))
  fi
}

# Commands that must never be touched, whatever the verdict says.
rm -f "$VERDICT"

# Computed only after the tree is in the state the gate cases will see, so a
# verdict left behind by an earlier manual run cannot skew it.
FRESH="$("$ROOT/scripts/pr-self-review-hash.sh")"
gate 0 'ls -la'                                   "ls is not gated"
gate 0 'git push origin HEAD'                     "git push is deliberately not gated"
gate 0 'gh pr list'                               "gh pr list is not gated"
gate 0 'echo see the docs for gh pr create usage' "a prose mention does not trip the gate"
gate 0 'git commit -m "gh pr create notes"'       "a commit message does not trip the gate"

# The invocation itself, in the shapes it really appears in.
gate 2 'gh pr create --fill'      "gh pr create with no verdict is denied"
gate 2 'cd /repo && gh pr create' "the invocation after && is caught"
gate 2 'PAGER=cat gh pr create'   "an env-prefixed invocation is caught"
gate 2 'gh pr ready'              "gh pr ready is caught"

# An artifact that proves nothing must not be read as permission. This is the
# one failure mode the gate must never have, and it shipped broken once.
printf 'not json {{{' > "$VERDICT"
gate 2 'gh pr create' "an unparseable verdict is denied, not ignored"
: > "$VERDICT"
gate 2 'gh pr create' "an empty verdict is denied"
echo '{"gate":"pass"}' > "$VERDICT"
gate 2 'gh pr create' "a verdict with no diff_sha is denied"

jq -n --arg s "$FRESH" '{diff_sha:$s,gate:"pass",override:null,findings:[]}' > "$VERDICT"
gate 0 'gh pr create' "a fresh passing verdict allows"
jq -n --arg s "$FRESH" '{diff_sha:$s,gate:"fail",override:null,findings:[]}' > "$VERDICT"
gate 2 'gh pr create' "a fresh failing verdict denies"
jq -n --arg s "$FRESH" '{diff_sha:$s,gate:"fail",override:{reason:"deliberate"},findings:[]}' > "$VERDICT"
gate 0 'gh pr create' "a recorded override releases a failing verdict"
jq -n '{diff_sha:"deadbeefdeadbeef",gate:"pass",override:null,findings:[]}' > "$VERDICT"
gate 0 'gh pr create' "a stale passing verdict allows once the checks re-run clean"
jq -n '{diff_sha:"deadbeefdeadbeef",gate:"fail",override:null,findings:[]}' > "$VERDICT"
gate 2 'gh pr create' "a stale failing verdict still denies"

# A live mechanical blocker outranks a green verdict.
jq -n --arg s "$FRESH" '{diff_sha:$s,gate:"pass",override:null,findings:[]}' > "$VERDICT"
plant client/src/vendor/ui/__probe.ts "export const probe = 1;"
gate 2 'gh pr create' "a live scripted CRITICAL beats a green verdict"
cleanup

restore_verdict

echo
echo "$PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
