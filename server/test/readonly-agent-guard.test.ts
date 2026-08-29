/**
 * `scripts/readonly-agent-guard.sh` — the boundary that makes "read-only agent"
 * true rather than merely written down.
 *
 * The guard runs on EVERY Bash call in the session, so two failure modes cost
 * more than the thing it prevents: refusing a command the read-only agents are
 * told to run (they would stop working, and the guard would be switched off),
 * and firing at all for an agent it does not own. Both get a table here.
 *
 * The tests shell out to the script with a real hook payload, because that is
 * the only interface it has. Exit 2 = denied, exit 0 = allowed; the contract is
 * Claude Code's, not ours.
 *
 * The subject lives at the repo root, outside this package. That makes the
 * `paths:` filter of `.github/workflows/server-unit.yml` part of this suite's
 * contract: `scripts/readonly-agent-guard.sh` is listed there so a pull request
 * that only edits the guard still runs the tests written to protect it.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const GUARD = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/readonly-agent-guard.sh');

function run(command: string, agentType: string | null = 'architecture-reviewer') {
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    ...(agentType === null ? {} : { agent_type: agentType }),
  });
  const res = spawnSync(GUARD, { input: payload, encoding: 'utf8' });
  return { code: res.status, stderr: res.stderr ?? '' };
}

const READ_ONLY_AGENTS = [
  'architecture-reviewer',
  'plan-verifier',
  'researcher',
  'security-reviewer',
];

describe('readonly-agent-guard — what a read-only agent may run', () => {
  it.each([
    'cat server/src/app.ts',
    'sed -n "40,80p" server/src/db/schema/reviews.ts',
    'grep -rn "scope" reviewer-core/src',
    'rg --files-with-matches intent server/src',
    'find . -name "*.it.test.ts" -not -path "*/node_modules/*"',
    'ls -la .claude/agents',
    'git log --oneline -20',
    'git show HEAD --stat',
    'git diff main...HEAD',
    'git status --short',
    'cd server && pnpm arch:check',
    'cd server && pnpm typecheck',
    'cd server && pnpm exec vitest run --exclude "**/*.it.test.ts"',
    'cd reviewer-core && npm test',
    // stderr redirection is not a write, and every one of these agents is told
    // to use it. Refusing it would make the guard the thing that gets removed.
    'pnpm arch:check 2>&1 | tail -3',
    'docker info >/dev/null 2>&1 || echo no',
    // A pipe whose first segment is harmless must be judged segment by segment.
    'git log --oneline | grep intent',
  ])('allows %s', (command) => {
    expect(run(command).code).toBe(0);
  });
});

describe('readonly-agent-guard — what it refuses', () => {
  it.each([
    ['output redirection', 'echo "x" > server/src/notes.md'],
    ['appending redirection', 'cat a.md >> b.md'],
    ['rm', 'rm -rf server/dist'],
    ['mv', 'mv a.ts b.ts'],
    ['cp', 'cp a.ts b.ts'],
    ['mkdir', 'mkdir scratch'],
    ['touch', 'touch server/src/new.ts'],
    ['tee', 'cat plan.md | tee copy.md'],
    ['sed -i', 'sed -i "" "s/a/b/" server/src/app.ts'],
    ['patch', 'patch -p1 < fix.diff'],
    ['git add', 'git add -A'],
    ['git commit', 'git commit -m "fix"'],
    ['git push', 'git push origin lesson-03'],
    ['git checkout', 'git checkout main'],
    ['git restore', 'git restore server/src/app.ts'],
    ['gh pr create', 'gh pr create --fill'],
    ['pnpm install', 'pnpm install'],
    ['npm i', 'npm i zod'],
    ['db:migrate', 'cd server && pnpm db:migrate'],
    ['db:seed', 'cd server && pnpm db:seed'],
    ['docker compose down', 'docker compose down -v'],
    // The prefix strip the PR gate already does: a VAR=value prefix must not
    // read as the command name.
    ['an env-prefixed mutation', 'FORCE=1 rm -rf server/dist'],
    // A pipeline is only as read-only as its worst segment.
    ['a mutation later in a pipeline', 'git log --oneline && git commit -m "x"'],
  ])('denies %s', (_label, command) => {
    const { code, stderr } = run(command);
    expect(code).toBe(2);
    // Denials are never silent: the model has to be told what was refused and
    // what it may do instead, or it will simply try the next spelling.
    expect(stderr).toContain('read-only agent');
    expect(stderr).toContain('refused:');
  });

  it.each(READ_ONLY_AGENTS)('guards %s', (agent) => {
    expect(run('rm -rf server/dist', agent).code).toBe(2);
  });
});

describe('readonly-agent-guard — whose commands it does not touch', () => {
  it.each([
    ['implementer', 'implementer'],
    ['test-writer', 'test-writer'],
    ['doc-writer', 'doc-writer'],
    ['implementation-planner', 'implementation-planner'],
    // The main session: no `agent_type` at all, or an empty one.
    ['the main session', null],
    ['an empty agent_type', ''],
  ])('lets %s write', (_label, agent) => {
    expect(run('git commit -m "feat: a thing"', agent).code).toBe(0);
    expect(run('echo x > notes.md', agent).code).toBe(0);
  });
});
