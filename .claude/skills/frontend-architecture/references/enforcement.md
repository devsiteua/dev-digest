# Enforcement — making the rules fail the build, not the review

## Contents

- Why this file exists
- Layer direction with `import/no-restricted-paths`
- Layers with `eslint-plugin-boundaries`
- Path aliases
- File and folder naming
- Environment separation
- What cannot be linted

## Why this file exists

Every rule in this skill is a convention until something checks it. Conventions documented in a
README hold until the first contributor who has not read it — and then they degrade silently,
because nothing fails. The audit that produced this skill found exactly that pattern: correct rules
written down in three places, and a tree that had drifted from all three.

Prefer, in this order:

1. **A build failure** — the rule cannot be broken.
2. **A lint error** — the rule is broken loudly and locally.
3. **A documented convention** — the rule is broken quietly and found at review, sometimes.

## Layer direction with `import/no-restricted-paths`

The core rule (SKILL.md 9): `shared → features → app`. Three zones express it — features cannot
import each other, features cannot import app code, and shared code cannot import either.

```js
'import/no-restricted-paths': ['error', {
  zones: [
    // one feature may not reach into another
    {
      target: './src/features/auth',
      from: './src/features',
      except: ['./auth'],
    },
    // features may not import from the app layer
    {
      target: './src/features',
      from: './src/app',
    },
    // shared code may not import features or app code
    {
      target: ['./src/components', './src/hooks', './src/lib', './src/types', './src/utils'],
      from: ['./src/features', './src/app'],
    },
  ],
}]
```

The first zone is repeated per feature. That repetition is the plugin's main weakness; it is also
why the rule is worth generating from the folder listing rather than hand-maintaining.

Source: [bulletproof-react — project standards](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md).

## Layers with `eslint-plugin-boundaries`

For layered architectures (FSD, hexagonal, or any explicit layering), a dedicated plugin expresses
the rule once instead of per pair. It classifies each file as an architectural element and then
allows or denies dependencies between element types — so "a layer may only import layers strictly
below it" is a single declaration, and new slices are covered automatically.

Use it when the number of features makes the zone list unmanageable, or when the layering is real
enough that people argue about it.

Source: [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries).

## Path aliases

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

Two things to get right:

- **Mirror the aliases everywhere that resolves modules** — the test runner and the bundler each
  have their own resolver. An alias that works in the editor and fails in tests is worse than no
  alias.
- **The alias existing does not make anyone use it.** TypeScript accepts both `@/lib/api` and
  `../../../../lib/api`. If both styles matter, add a lint rule that bans deep relative imports
  (`no-restricted-imports` with a `../../../*` pattern) — otherwise the two styles coexist forever
  and every file is a coin flip.

## File and folder naming

Naming conventions are checkable:

```js
'check-file/filename-naming-convention': [
  'error',
  { '**/*.{ts,tsx}': 'KEBAB_CASE' },
  { ignoreMiddleExtensions: true },
],
'check-file/folder-naming-convention': [
  'error',
  { 'src/**/!(__tests__)': 'KEBAB_CASE' },
],
```

Pick the convention that matches what the codebase already mostly does — the goal is a single
answer, not the objectively best case style. If two branches of the tree use different conventions
deliberately, encode both patterns rather than pretending one exists.

## Environment separation

The strongest available check, because it is a build failure rather than a lint error:

- `import 'server-only'` in any module that must never reach the browser — data access, secrets,
  internal business logic. A client component importing it fails the build.
- `import 'client-only'` in modules that touch `window` or other browser APIs.

This is the one place where an architectural boundary is enforced by the compiler. Use it on every
data-access module, not just the obviously sensitive ones — the leak you find at build time is free.

## What cannot be linted

Some rules in this skill have no mechanical check today. Know which, and compensate with review
attention rather than assuming coverage:

| Rule | Checkable? |
|---|---|
| Layer direction, cross-feature imports | yes — zones or boundaries plugin |
| Naming, deep relative imports | yes — `check-file`, `no-restricted-imports` |
| Server/client separation | yes — `server-only` / `client-only`, build-time |
| No folder-wide barrels | partially — ban `index` re-export files by path pattern |
| The rule of two (premature promotion) | no — requires judgement about consumers |
| Business logic in the right layer | no — requires reading what the code means |
| Cache-key registries and invalidation pairs | no — but a typed key factory makes drift a type error |
| One styling mechanism | partially — ban the imports of the mechanisms you rejected |

The pattern worth copying: where a rule cannot be linted, change the shape of the code so violating
it becomes a type error. A key factory turns "remember to use the same array" into "the compiler
knows the shape". That is enforcement without a linter.
