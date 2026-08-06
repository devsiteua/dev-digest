import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate, Skill } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const createMutate = vi.fn();
const createState = { isPending: false, isError: false, error: null as Error | null };
vi.mock("@/lib/hooks/conventions", () => ({
  useCreateSkillFromConventions: () => ({ ...createState, mutate: createMutate }),
}));

import { CreateSkillModal } from "./CreateSkillModal";

const candidate = (over: Partial<ConventionCandidate> = {}): ConventionCandidate => ({
  id: "c1",
  repo_id: "r1",
  rule: "Read every environment variable in src/config.ts",
  category: "structure",
  evidence_path: "src/config.ts",
  evidence_snippet: "export const config = {\n  port: Number(process.env.PORT ?? 3000),\n};",
  evidence_start_line: 8,
  evidence_end_line: 11,
  confidence: 0.74,
  status: "accepted",
  skill_id: null,
  created_at: "2026-08-06T10:00:00.000Z",
  ...over,
});

const SKILL: Skill = {
  id: "s9",
  name: "repo-conventions",
  description: "2 house conventions extracted from acme/payments-api",
  type: "convention",
  source: "extracted",
  body: "# repo-conventions",
  enabled: true,
  version: 1,
  evidence_files: ["src/config.ts"],
};

const ACCEPTED = [
  candidate(),
  candidate({
    id: "c2",
    rule: "Return early with a typed error",
    evidence_path: "src/api/users.ts",
    evidence_snippet: "if (!user) return err('not_found');",
    evidence_start_line: 23,
    evidence_end_line: 23,
  }),
];

const renderModal = (accepted: ConventionCandidate[] = ACCEPTED) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <CreateSkillModal
        repoId="r1"
        repoName="acme/payments-api"
        accepted={accepted}
        onClose={() => {}}
      />
    </NextIntlClientProvider>,
  );

const bodyField = () => document.querySelector("textarea") as HTMLTextAreaElement;

beforeEach(() => {
  push.mockClear();
  createMutate.mockClear();
  Object.assign(createState, { isPending: false, isError: false, error: null });
});
afterEach(cleanup);

describe("CreateSkillModal", () => {
  it("merges every candidate it was given into one body, each with its evidence", () => {
    renderModal();
    const body = bodyField().value;

    expect(body).toContain("# repo-conventions");
    expect(body).toContain("## read-every-environment-variable");
    expect(body).toContain("Read every environment variable in src/config.ts");
    expect(body).toContain("Detected in `src/config.ts:8-11`:");
    expect(body).toContain("export const config");
    // A single-line range collapses, and the second rule is a section of its own.
    expect(body).toContain("## return-early-typed-error");
    expect(body).toContain("Detected in `src/api/users.ts:23`:");
  });

  it("says how many conventions it merged, and out of which repo", () => {
    renderModal();
    expect(screen.getByText(/2 accepted conventions/)).toBeInTheDocument();
    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
  });

  it("keeps the edited body when the conventions list refetches underneath it", () => {
    const { rerender } = renderModal();
    fireEvent.change(bodyField(), { target: { value: "# hand-written" } });

    // A background refetch hands back a NEW array with new object identities —
    // it must not re-derive the draft (client/INSIGHTS.md, 2026-08-06).
    rerender(
      <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
        <CreateSkillModal
          repoId="r1"
          repoName="acme/payments-api"
          accepted={[candidate({ rule: "Something the model just re-worded" })]}
          onClose={() => {}}
        />
      </NextIntlClientProvider>,
    );

    expect(bodyField().value).toBe("# hand-written");
  });

  it("posts the draft without a `source` — the server stamps provenance", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    const payload = createMutate.mock.calls[0]![0];
    expect(payload).not.toHaveProperty("source");
    expect(payload).toMatchObject({
      name: "repo-conventions",
      type: "convention",
      enabled: true,
      convention_ids: ["c1", "c2"],
    });
    expect(payload.body).toContain("## read-every-environment-variable");
  });

  it("will not create a skill without a name", () => {
    renderModal();
    fireEvent.change(screen.getByDisplayValue("repo-conventions"), { target: { value: "  " } });
    expect(screen.getByRole("button", { name: "Create skill" })).toBeDisabled();
  });

  it("surfaces the server's reason when the merge fails", () => {
    Object.assign(createState, {
      isError: true,
      error: new Error("None of the selected conventions are accepted."),
    });
    renderModal();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not create the skill.");
    expect(screen.getByRole("alert")).toHaveTextContent("None of the selected conventions");
  });

  it("offers the created skill once the merge succeeds", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));
    // The hook's onSuccess is what flips the modal into its success state.
    act(() => createMutate.mock.calls[0]![1].onSuccess(SKILL));

    expect(screen.getByText("Skill created")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open skill" }));
    expect(push).toHaveBeenCalledWith("/skills/s9");
  });
});
