/**
 * The six BINDING strings of `specs/L04-mcp-server.md` § Appendix: the server's
 * `instructions` paragraph and one description per tool.
 *
 * GENERATED FROM THE SPEC — do not hand-edit, and do not "improve" the wording
 * here. The Appendix is the source: if a string genuinely needs to change, the
 * spec changes first and this file follows. `test/copy.test.ts` re-reads the
 * Appendix at test time and fails on any drift, whitespace included.
 *
 * Why it is worth this much ceremony: a tool description is what MCP tool search
 * matches on, so a paraphrase is a silent regression in discoverability — and the
 * error-path wording in `run_agent_on_pr` is the sentence that stops a model
 * starting a second paid run.
 *
 * Each string is written as its lines joined with a newline so a diff on this file
 * is readable line by line, and so no editor's wrapping can alter a byte.
 */

/** Server `instructions` — 505 chars. */
export const SERVER_INSTRUCTIONS = [
  "DevDigest is a local AI pull-request review studio. These tools drive it over its API on localhost:3001, which must already be running (./scripts/dev.sh). Address repositories as owner/name, pull requests by their number, and reviewer agents by the name or slug that list_agents returns — never by an internal UUID. If you do not already have an agent name, call list_agents first. Responses are concise by default; pass response_format \"detailed\" when you need each finding's rationale and suggested fix.",
].join('\n');

/** Tool descriptions, keyed by the tool name they are registered under. */
export const TOOL_DESCRIPTIONS = {
  /** `list_agents` — 632 chars. */
  list_agents: [
    "List the reviewer agents configured in DevDigest — the AI code reviewers that can be run over a pull request. Returns each agent's name, slug, model, enabled flag and a one-line description of what it looks for. This is the only source of a valid `agent` value for run_agent_on_pr and get_findings, so call it first instead of guessing a name. `enabled` is the membership test for a review-all triggered in the DevDigest UI; it does not stop you running that agent by name here. Costs nothing.",
    "Example: list_agents() -> [{ name: \"Security Reviewer\", slug: \"security-reviewer\", model: \"claude-opus-5\", enabled: true }, ...]",
  ].join('\n'),

  /** `run_agent_on_pr` — 802 chars. */
  run_agent_on_pr: [
    "Run one reviewer agent over one pull request and return the finished review: verdict, score and grounded findings with severity, file and line. One blocking call does all three steps — it starts the run, waits for it, and collects the result — so there is no separate start or poll tool.",
    "This spends a real model call. Run it once per pull request per agent, and use get_findings to re-read the result instead of running it again.",
    "It waits up to 120 seconds. If the run is still going when that expires it returns status \"still_running\" with the run id — the run is healthy and continuing. Collect it with get_findings using the same repo, pr and agent. Do NOT call this tool again: that starts a second paid run.",
    "Example: run_agent_on_pr(repo: \"acme/payments-api\", pr: 482, agent: \"security-reviewer\")",
  ].join('\n'),

  /** `get_findings` — 714 chars. */
  get_findings: [
    "Read the findings of a review that has already run on a pull request, without starting a new one and without spending anything. Returns the same shape as run_agent_on_pr: a verdict plus findings carrying severity (CRITICAL, WARNING, SUGGESTION), file, line and title.",
    "Pass `agent` to read one reviewer's pass; omit it to get the most recent review, whose agent is named in the response. Use this after a run_agent_on_pr that returned \"still_running\", or to re-read a review you already paid for. If no agent has reviewed the pull request yet, the response says so — it is not an empty findings list.",
    "Example: get_findings(repo: \"acme/payments-api\", pr: 482, agent: \"security-reviewer\", response_format: \"detailed\")",
  ].join('\n'),

  /** `get_conventions` — 632 chars. */
  get_conventions: [
    "Read the coding conventions DevDigest extracted from a repository — the accepted house rules for naming, error handling, testing and structure, each with the file:line evidence it was derived from. Use it before writing or reviewing code in that repository so the code matches the house style.",
    "Read-only: it returns what the conventions extractor already stored and never runs the extractor, which spends a model call. If nothing has been accepted yet, the response says so and reports the pending and rejected counts — that is different from \"this repository has no conventions\".",
    "Example: get_conventions(repo: \"acme/payments-api\")",
  ].join('\n'),

  /** `get_blast_radius` — 1056 chars. */
  get_blast_radius: [
    "Read the blast radius of a pull request: what its diff can reach. Returns the symbols the changed files declare, the call sites that reach them, and the HTTP endpoints and scheduled jobs downstream of those call sites. It is computed from DevDigest's static index of the repository rather than by a model, so it costs nothing, starts no review and reflects the last index rather than this minute.",
    "An empty map is never served as a bare empty list. `status` says how far the answer can be trusted (ok, partial, degraded) and `reason` says why it looks the way it does — read a degraded answer as \"DevDigest could not look\", never as \"this pull request affects nothing\". Every file:line was recorded at `indexed_sha`, the commit the index was built at, not the pull request's head.",
    "Example: get_blast_radius(repo: \"acme/payments-api\", pr: 482) -> { changed_symbols: [{ name: \"rateLimit\", file: \"src/middleware/ratelimit.ts\" }], downstream: [{ symbol: \"rateLimit\", callers: [...], endpoints_affected: [\"GET /api/public/items\"] }], status: \"ok\", reason: null }",
  ].join('\n'),
};
