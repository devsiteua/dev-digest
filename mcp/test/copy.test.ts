import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SERVER_INSTRUCTIONS, TOOL_DESCRIPTIONS } from '../src/copy.js';
import { TOOL_NAMES } from '../src/schemas.js';

/**
 * The Appendix of `specs/L04-mcp-server.md` is BINDING: the server's
 * `instructions` and the five tool descriptions must be byte-identical to it.
 *
 * This test therefore re-reads the spec **at test time** and parses the Appendix
 * itself. That is the whole point of the file: a test that compared `copy.ts`
 * against a second hand-typed copy would only prove the two copies agree, and
 * would go green while both had drifted away from the document they are supposed
 * to implement. Here there is exactly one source, and it is the spec.
 *
 * If a string genuinely needs to change, the Appendix changes first and
 * `src/copy.ts` follows — never the other way round.
 */

const SPEC_PATH = new URL('../../specs/L04-mcp-server.md', import.meta.url);

interface AppendixBlock {
  readonly key: string;
  readonly text: string;
  /** The character count the Appendix heading claims for this string, if any. */
  readonly declaredChars: number | null;
}

/**
 * Parse the Appendix into its labelled fenced blocks.
 *
 * Written independently of `scripts`-time generation on purpose: the key comes
 * from the first backticked token of the `###` heading, so reordering or
 * relabelling a block fails here rather than silently matching by position.
 */
function readAppendix(): AppendixBlock[] {
  const lines = readFileSync(SPEC_PATH, 'utf8').split('\n');
  const start = lines.findIndex((line) => line.startsWith('## Appendix'));
  expect(start, 'the spec has a "## Appendix" heading').toBeGreaterThan(-1);

  const blocks: AppendixBlock[] = [];
  let heading: { key: string; declaredChars: number | null } | null = null;
  let fenceStart: number | null = null;

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.startsWith('## ')) break; // the next top-level section ends the Appendix
    if (line.startsWith('### ')) {
      const key = /`([A-Za-z_]+)`/.exec(line)?.[1];
      expect(key, `Appendix heading names a key: ${line}`).toBeTruthy();
      const chars = /—\s*(\d+)\s*chars/.exec(line)?.[1];
      heading = { key: key!, declaredChars: chars === undefined ? null : Number(chars) };
      continue;
    }
    if (line.startsWith('```text')) {
      fenceStart = i + 1;
      continue;
    }
    if (line.startsWith('```') && fenceStart !== null) {
      expect(heading, 'every Appendix fence sits under a "###" heading').not.toBeNull();
      blocks.push({
        key: heading!.key,
        declaredChars: heading!.declaredChars,
        text: lines.slice(fenceStart, i).join('\n'),
      });
      fenceStart = null;
    }
  }
  return blocks;
}

const appendix = readAppendix();
const blockFor = (key: string): AppendixBlock => {
  const found = appendix.find((block) => block.key === key);
  if (!found) throw new Error(`the spec's Appendix has no block for ${key}`);
  return found;
};

describe('the Appendix is the source of the tool copy', () => {
  it('holds exactly six strings: the instructions and one per tool', () => {
    expect(appendix.map((block) => block.key)).toEqual(['instructions', ...TOOL_NAMES]);
  });

  it('registers the instructions paragraph byte for byte', () => {
    expect(SERVER_INSTRUCTIONS).toBe(blockFor('instructions').text);
  });

  it.each(TOOL_NAMES)('registers the %s description byte for byte', (name) => {
    expect(TOOL_DESCRIPTIONS[name]).toBe(blockFor(name).text);
  });

  it('describes every tool and nothing but the tools', () => {
    expect(Object.keys(TOOL_DESCRIPTIONS).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it('matches the character count each Appendix heading declares', () => {
    for (const block of appendix) {
      if (block.declaredChars === null) continue;
      expect(block.text.length, `${block.key} in the spec`).toBe(block.declaredChars);
    }
    // The one heading with no declared count is the instructions paragraph; the
    // plan measures it in prose instead (505 chars).
    expect(blockFor('instructions').text.length).toBe(505);
  });
});

describe('the copy stays inside the limits the plan measured it against', () => {
  it('keeps the instructions to one paragraph of at most 600 characters', () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(600);
    expect(SERVER_INSTRUCTIONS).not.toContain('\n');
  });

  it.each(TOOL_NAMES)('gives %s a non-empty description of at most 1200 characters', (name) => {
    const description = TOOL_DESCRIPTIONS[name];
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(1200);
  });

  it.each(TOOL_NAMES)('gives %s at least one worked example call', (name) => {
    expect(TOOL_DESCRIPTIONS[name]).toContain('Example:');
    expect(TOOL_DESCRIPTIONS[name]).toContain(`${name}(`);
  });

  it('keeps run_agent_on_pr pointing the timeout path at get_findings, not at itself', () => {
    // D5/D6: "still running" is an ordinary outcome, and the wording is what
    // stops a model starting a second paid run.
    const description = TOOL_DESCRIPTIONS.run_agent_on_pr;
    expect(description).toContain('still_running');
    expect(description).toContain('Collect it with get_findings');
    expect(description).toContain('Do NOT call this tool again');
  });

  it('keeps get_blast_radius telling a model how to read an empty answer', () => {
    // D13's warning outlived the stub it was written for. The tool answers now,
    // so the description no longer claims otherwise — but a model that reads
    // only the tool list still has to be told that a degraded map is "we could
    // not look" rather than "there is nothing downstream", because that is the
    // one misreading this feature exists to prevent.
    const description = TOOL_DESCRIPTIONS.get_blast_radius;
    expect(description).not.toContain('NOT IMPLEMENTED');
    expect(description).not.toContain('not_implemented');
    expect(description).toContain('never as \"this pull request affects nothing\"');
    expect(description).toContain('status');
    expect(description).toContain('reason');
  });
});
