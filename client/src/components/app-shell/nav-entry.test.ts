/**
 * The sidebar's one new destination — AC-33's test half.
 *
 * `nav.ts` is the single file under `client/src/vendor/ui/` this work is allowed
 * to touch, and the criterion is about how much of it changed: exactly ONE new
 * `NAV` item, with an `href` and a `gKey`, and nothing else. The diff half of
 * that (no second path under `vendor/ui/`) is a `git diff` check; what is
 * decidable in a test is the shape of the list itself, which is why the counts
 * below are written as literals rather than derived — a derived count would
 * agree with any list at all.
 *
 * It lives in `components/app-shell/` rather than beside `nav.ts` because the
 * shell is what consumes `NAV`, and `vendor/ui/` is not ours to add files to.
 */
import { describe, it, expect } from "vitest";
import { NAV, SHORTCUTS, resolveHref } from "@devdigest/ui";
import { activeKeyFor } from "./helpers";

const items = NAV.flatMap((group) => group.items);
const multiAgent = items.filter((item) => item.key === "multi-agent");

describe("NAV — the Multi-Agent Review entry (AC-33)", () => {
  it("is exactly one item, in its own GLOBAL section", () => {
    expect(multiAgent).toHaveLength(1);
    expect(NAV.find((g) => g.items.some((i) => i.key === "multi-agent"))?.section).toBe(
      "GLOBAL",
    );
  });

  it("carries an href and a gKey, which is what makes it a destination rather than a label", () => {
    const entry = multiAgent[0]!;
    expect(entry.label).toBe("Multi-Agent Review");
    expect(entry.href).toBe("/repos/:repoId/multi-agent");
    expect(entry.gKey).toBe("m");
  });

  it("grew the flattened list by exactly one: five entries before this work, six now", () => {
    // The literal is the assertion, and the number is measured, not quoted: the
    // committed `nav.ts` flattens to five items (`git show HEAD:.../nav.ts`) and
    // this work adds the sixth. `NAV` is flattened by `useGlobalShortcuts` and
    // `useShellCommands`, so a second entry slipped in here would ship two
    // shortcuts and two palette commands nobody asked for.
    expect(items).toHaveLength(6);
    expect(items.every((item) => item.href.length > 0)).toBe(true);
  });

  it("takes a free shortcut letter — no two nav entries share a gKey", () => {
    const gKeys = items.map((item) => item.gKey).filter((k): k is string => !!k);
    expect(new Set(gKeys).size).toBe(gKeys.length);
    expect(gKeys).toContain("m");
  });

  it("is documented in SHORTCUTS, because a gKey the palette does not list is half shipped", () => {
    const shortcut = SHORTCUTS.filter((s) => s.keys === "g m");
    expect(shortcut).toHaveLength(1);
    expect(shortcut[0]!.label).toBe("Go to Multi-Agent Review");
    expect(shortcut[0]!.group).toBe("Navigation");
  });

  it("resolves to a real repo-scoped path, and to the placeholder without a repo", () => {
    // `resolveHref` can template `:repoId` and nothing else — which is why the
    // route is repo-scoped rather than keyed by pull request.
    expect(resolveHref(multiAgent[0]!.href, "r1")).toBe("/repos/r1/multi-agent");
    expect(resolveHref(multiAgent[0]!.href, null)).toBe("/repos/_/multi-agent");
  });

  it("is the entry the sidebar highlights on its own route", () => {
    // `activeKeyFor` already mapped `/multi-agent` to this key before the entry
    // existed; this pins that the two agree, which is what makes the highlight work.
    expect(activeKeyFor("/repos/r1/multi-agent")).toBe("multi-agent");
    expect(activeKeyFor("/repos/r1/multi-agent?pr=482")).toBe("multi-agent");
    expect(activeKeyFor("/repos/r1/pulls")).toBe("pulls");
  });
});
