import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import {
  draftFromMarkdown,
  draftFromZip,
  parseFrontmatter,
  toSkillName,
} from '../src/modules/skills/helpers.js';
import {
  MAX_DESCRIPTION_CHARS,
  MAX_NAME_CHARS,
  MAX_ZIP_ENTRIES,
} from '../src/modules/skills/constants.js';

/**
 * Unit coverage for skill import. The invariant these tests defend: importing a
 * third-party bundle reads exactly ONE markdown file out of it and treats every
 * other entry as a name in a list — never as content, never as a command.
 */

const zip = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

describe('parseFrontmatter', () => {
  it('splits a flat key: value block off the top', () => {
    const { attrs, body } = parseFrontmatter(
      '---\nname: no-console\ndescription: Ban console.log\n---\n# Body\ntext',
    );
    expect(attrs).toEqual({ name: 'no-console', description: 'Ban console.log' });
    expect(body).toBe('# Body\ntext');
  });

  it('strips surrounding quotes from a value', () => {
    const { attrs } = parseFrontmatter('---\nname: "quoted-name"\n---\nbody');
    expect(attrs.name).toBe('quoted-name');
  });

  it('returns the document untouched when there is no frontmatter', () => {
    const md = '# Just a heading\n\nSome text.';
    expect(parseFrontmatter(md)).toEqual({ attrs: {}, body: md });
  });

  it('does not swallow the document when the block is never closed', () => {
    const md = '---\nname: broken\nstill going';
    expect(parseFrontmatter(md).body).toBe(md);
    expect(parseFrontmatter(md).attrs).toEqual({});
  });

  it('ignores lines that are not key: value', () => {
    const { attrs } = parseFrontmatter('---\nname: ok\n  - a list item\n---\nbody');
    expect(attrs).toEqual({ name: 'ok' });
  });
});

describe('toSkillName', () => {
  it('slugifies prose into the mono style the UI shows', () => {
    expect(toSkillName('PR Quality Rubric')).toBe('pr-quality-rubric');
  });

  it('leaves an already-slugged name alone', () => {
    expect(toSkillName('no-console-in-prod')).toBe('no-console-in-prod');
  });

  it('falls back rather than producing an empty name', () => {
    expect(toSkillName('!!!')).toBe('imported-skill');
  });
});

describe('draftFromMarkdown', () => {
  it('takes name and description from frontmatter without warnings', () => {
    const draft = draftFromMarkdown('whatever.md', '---\nname: a-b\ndescription: d\n---\n# T\nbody');
    expect(draft.name).toBe('a-b');
    expect(draft.description).toBe('d');
    expect(draft.warnings).toEqual([]);
  });

  it('falls back to the first heading, and says so', () => {
    const draft = draftFromMarkdown('x.md', '# No Then Chains\n\nPrefer async/await.');
    expect(draft.name).toBe('no-then-chains');
    expect(draft.description).toBe('Prefer async/await.');
    expect(draft.warnings).toHaveLength(2);
    expect(draft.warnings[0]).toMatch(/first heading/);
  });

  it('falls back to the file name when there is no heading', () => {
    const draft = draftFromMarkdown('My Rule.md', 'just a paragraph');
    expect(draft.name).toBe('my-rule');
    expect(draft.warnings[0]).toMatch(/file name/);
  });

  it('clamps a name and description the create endpoint would reject, and says so', () => {
    // A draft that previews cleanly and then 422s on confirm is the worst of both
    // worlds: the failure lands after the user has already approved it.
    const draft = draftFromMarkdown(
      'x.md',
      `---\nname: ${'n'.repeat(200)}\ndescription: ${'d'.repeat(900)}\n---\nbody`,
    );
    expect(draft.name).toHaveLength(MAX_NAME_CHARS);
    expect(draft.description).toHaveLength(MAX_DESCRIPTION_CHARS);
    expect(draft.warnings.some((w) => /Name was longer/.test(w))).toBe(true);
    expect(draft.warnings.some((w) => /Description was longer/.test(w))).toBe(true);
  });

  it('rejects an empty body', () => {
    expect(() => draftFromMarkdown('x.md', '---\nname: a\n---\n   \n')).toThrow(/empty/i);
  });
});

describe('draftFromZip', () => {
  const SKILL = '---\nname: no-console-in-prod\ndescription: Ban console.* outside tests.\n---\n# Rule\nFlag it.';

  it('reads SKILL.md from the archive root', () => {
    const draft = draftFromZip(zip({ 'SKILL.md': SKILL }), 'bundle.zip');
    expect(draft.name).toBe('no-console-in-prod');
    expect(draft.body).toContain('Flag it.');
    expect(draft.ignored_files).toEqual([]);
  });

  it('reads SKILL.md from a single root folder', () => {
    const draft = draftFromZip(zip({ 'no-console-in-prod/SKILL.md': SKILL }), 'bundle.zip');
    expect(draft.name).toBe('no-console-in-prod');
  });

  it('matches the entry name case-insensitively', () => {
    const draft = draftFromZip(zip({ 'skill.md': SKILL }), 'bundle.zip');
    expect(draft.name).toBe('no-console-in-prod');
  });

  it('prefers the root copy over one in a subfolder', () => {
    const draft = draftFromZip(
      zip({
        'SKILL.md': '---\nname: root-one\ndescription: d\n---\nbody',
        'nested/SKILL.md': '---\nname: nested-one\ndescription: d\n---\nbody',
      }),
      'bundle.zip',
    );
    expect(draft.name).toBe('root-one');
  });

  it('lists executables and other files as ignored, and never reads them', () => {
    const draft = draftFromZip(
      zip({
        'SKILL.md': SKILL,
        'install.sh': 'rm -rf / # this must never be read or run',
        'README.md': '# Readme',
        'assets/logo.png': 'PNGDATA',
      }),
      'bundle.zip',
    );
    expect(draft.ignored_files.sort()).toEqual(['README.md', 'assets/logo.png', 'install.sh']);
    // The decisive assertion: no byte of any ignored entry reaches the draft.
    const serialized = JSON.stringify(draft);
    expect(serialized).not.toContain('rm -rf');
    expect(serialized).not.toContain('PNGDATA');
    expect(draft.warnings.some((w) => /not read or executed/.test(w))).toBe(true);
  });

  it('rejects an archive with no SKILL.md', () => {
    expect(() => draftFromZip(zip({ 'README.md': '# hi' }), 'b.zip')).toThrow(/SKILL\.md/);
  });

  it('rejects a SKILL.md buried deeper than one folder', () => {
    expect(() => draftFromZip(zip({ 'a/b/SKILL.md': SKILL }), 'b.zip')).toThrow(/SKILL\.md/);
  });

  it('rejects an archive with too many entries', () => {
    const many: Record<string, string> = { 'SKILL.md': SKILL };
    for (let i = 0; i < MAX_ZIP_ENTRIES + 1; i++) many[`f${i}.txt`] = 'x';
    expect(() => draftFromZip(zip(many), 'b.zip')).toThrow(/entries/);
  });

  it('rejects bytes that are not a zip', () => {
    expect(() => draftFromZip(strToU8('not a zip at all'), 'b.zip')).toThrow(/valid \.zip/);
  });
});

/**
 * The demo bundle in `test/fixtures/skills/` is what the import flow is shown
 * with. It is a real archive built by a real zip tool — not a fflate round-trip —
 * and it carries an executable on purpose. Pinning its behaviour here means the
 * demo cannot quietly stop demonstrating the thing it exists to demonstrate.
 */
describe('the no-console-in-prod demo bundle', () => {
  const bytes = new Uint8Array(
    readFileSync(fileURLToPath(new URL('./fixtures/skills/no-console-in-prod.zip', import.meta.url))),
  );

  it('yields the skill core, and lists the executable as ignored without running it', () => {
    const draft = draftFromZip(bytes, 'no-console-in-prod.zip');

    expect(draft.name).toBe('no-console-in-prod');
    expect(draft.description).toMatch(/console\./);
    expect(draft.body).toContain('# No console.* in production code');
    expect(draft.warnings).toEqual(['2 other archive entries were not read or executed.']);

    expect(draft.ignored_files.sort()).toEqual([
      'no-console-in-prod/README.md',
      'no-console-in-prod/install.sh',
    ]);
    // install.sh echoes this sentinel. If it ever reaches the draft, the import
    // path read a file it promised not to read.
    expect(JSON.stringify(draft)).not.toContain('skill-import-must-never-execute-this');
  });
});

/**
 * `deprecation-policy` is the fourth API-contract skill, and the only one that is
 * NOT seeded: it ships as a markdown file so the demo can walk the import path.
 * A warning in its preview would be the product telling the user it guessed the
 * metadata — on the one file whose import is meant to look clean.
 */
describe('the deprecation-policy import fixture', () => {
  const md = readFileSync(
    fileURLToPath(new URL('./fixtures/skills/deprecation-policy.md', import.meta.url)),
    'utf8',
  );

  it('parses with no warnings and keeps the good/avoid pair in the body', () => {
    const draft = draftFromMarkdown('deprecation-policy.md', md);

    expect(draft.name).toBe('deprecation-policy');
    expect(draft.description).toMatch(/^Apply when/);
    expect(draft.warnings).toEqual([]);
    expect(draft.ignored_files).toEqual([]);
    // The homework's own requirement: every contract skill shows both sides.
    expect(draft.body).toContain('### Good');
    expect(draft.body).toContain('### Avoid');
    // The frontmatter is consumed, not left at the top of the prompt block.
    expect(draft.body.startsWith('# Deprecation policy')).toBe(true);
  });
});
