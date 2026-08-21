---
name: deprecation-policy
description: Apply when a diff removes or renames something callers can reach — require a deprecation note, a stated support window and an overlap period instead of a silent deletion.
---

# Deprecation policy

House convention. Nothing that callers can reach is deleted in the commit that
decides it should go. Removal is the *second* step; this skill is about the first.

Apply it to any field, endpoint, status code, export, enum member or config key
that leaves the diff. The question is never "should this go away?" — it is
"does this diff give the people using it a way to notice and move?"

## What a compliant removal looks like

1. **Mark it, do not drop it.** The old name stays and gains a deprecation note
   that says what to use instead. A `@deprecated` tag, a `.describe()` on the Zod
   field, or a comment on the route — whichever the surrounding code already uses.
2. **State the window.** A deprecation with no end date is never actioned. Name a
   date or a version: "removed in 2.0", "after 2026-12-01".
3. **Overlap the shapes.** For a rename, emit BOTH keys for the whole window: the
   old one populated exactly as before, the new one beside it. For a request
   field, accept both and prefer the new one. The duplication is temporary and it
   is the entire point — it is what lets callers migrate one at a time.
4. **Say it somewhere a caller reads.** A changelog entry, a response header, a
   release note. A comment in the handler is not a notice.

## What to flag

- A response field removed in the same commit that adds its replacement.
- A rename shipped as one edit — the old key gone, the new key present.
- An endpoint deleted, or a route path changed, with no alias left behind.
- An exported symbol removed with no re-export under the old name.
- A deprecation note with no removal date, or a removal date already in the past
  with no evidence the callers moved.
- A removal justified by "it was a security issue". That justification is often
  right and it changes the urgency, not the mechanics: the field can be blanked
  or rotated in place, and *then* removed on a window.

## Not a finding

- Something added and removed within the same unreleased change.
- Internal, unexported code with no reachable caller.
- A value the service only ever produced for itself.

### Good

```ts
// Both shapes ship for one window; the old one is marked, not deleted.
return {
  id: sub.id,
  /** @deprecated removed 2026-12-01 — read `delivery_attempts` instead. */
  attempts: sub.deliveryAttempts,
  delivery_attempts: sub.deliveryAttempts,
};
```

### Avoid

```ts
// The old key is gone the moment the new one arrives. Every caller reading
// `attempts` now gets undefined, with no error and no notice anywhere.
return {
  id: sub.id,
  delivery_attempts: sub.deliveryAttempts,
};
```

## For every finding, state

what was removed, who could reach it, and the smallest compliant version of the
same change — usually "keep the old key for one release and add the note".
