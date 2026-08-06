import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SkillDraft } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../lib/toast";

const DRAFT: SkillDraft = {
  name: "no-console-in-prod",
  description: "Flag console.* in application code.",
  type: "convention",
  body: "# No console.*\nUse the logger.",
  ignored_files: ["no-console-in-prod/install.sh", "no-console-in-prod/README.md"],
  warnings: ["2 other archive entries were not read or executed."],
};

type Payload = Record<string, unknown>;
const previewMutate = vi.fn(async (_payload: Payload) => DRAFT);
const importMutate = vi.fn(async (_input: Payload) => ({ id: "s9", name: DRAFT.name }));
const createMutate = vi.fn(async (_input: Payload) => ({ id: "s8", name: "hand-written" }));

vi.mock("../../../../lib/hooks/skills", () => ({
  useImportPreview: () => ({ mutateAsync: previewMutate, isPending: false }),
  useImportSkill: () => ({ mutateAsync: importMutate, isPending: false }),
  useCreateSkill: () => ({ mutateAsync: createMutate, isPending: false }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { AddSkillDrawer } from "./AddSkillDrawer";

beforeEach(() => {
  previewMutate.mockClear();
  importMutate.mockClear();
  createMutate.mockClear();
});
afterEach(cleanup);

const renderDrawer = (onClose = vi.fn()) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <AddSkillDrawer onClose={onClose} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );

/** Drop a file on the hidden input the "Choose a file…" button drives. */
function pick(name: string, content = "# Rule\ntext") {
  const input = screen.getByTestId("skill-file-input") as HTMLInputElement;
  const file = new File([content], name, { type: "text/markdown" });
  // jsdom's File has no arrayBuffer/text in every version — provide them.
  Object.defineProperty(file, "text", { value: async () => content });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new TextEncoder().encode(content).buffer,
  });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("AddSkillDrawer", () => {
  it("starts on the picker, offering a file or a blank skill", () => {
    renderDrawer();
    expect(screen.getByText("Choose a file…")).toBeInTheDocument();
    expect(screen.getByText("Create from scratch")).toBeInTheDocument();
  });

  it("parses a picked file through the preview endpoint and shows the draft", async () => {
    renderDrawer();
    pick("skill.md");

    await waitFor(() => expect(previewMutate).toHaveBeenCalledTimes(1));
    expect(previewMutate).toHaveBeenCalledWith({
      kind: "markdown",
      filename: "skill.md",
      content: "# Rule\ntext",
    });
    expect(await screen.findByDisplayValue("no-console-in-prod")).toBeInTheDocument();
    expect(screen.getByDisplayValue(DRAFT.description)).toBeInTheDocument();
    // getByDisplayValue normalises whitespace, so check the multi-line body directly.
    const body = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(body.value).toBe(DRAFT.body);
  });

  it("SAVES NOTHING until the user confirms", async () => {
    renderDrawer();
    pick("skill.md");
    await screen.findByDisplayValue("no-console-in-prod");

    // The whole point of the two-step flow: previewing is not importing.
    expect(importMutate).not.toHaveBeenCalled();
    expect(createMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Import skill"));
    await waitFor(() => expect(importMutate).toHaveBeenCalledTimes(1));
    expect(importMutate).toHaveBeenCalledWith({
      name: DRAFT.name,
      description: DRAFT.description,
      type: DRAFT.type,
      body: DRAFT.body,
    });
  });

  it("never sends source or enabled — the server decides provenance", async () => {
    renderDrawer();
    pick("skill.md");
    await screen.findByDisplayValue("no-console-in-prod");
    fireEvent.click(screen.getByText("Import skill"));

    await waitFor(() => expect(importMutate).toHaveBeenCalled());
    const payload = importMutate.mock.calls[0]![0];
    expect(payload).not.toHaveProperty("source");
    expect(payload).not.toHaveProperty("enabled");
  });

  it("names every archive entry it refused to read", async () => {
    renderDrawer();
    pick("bundle.zip", "PK-fake-archive-bytes");
    await screen.findByDisplayValue("no-console-in-prod");

    // A .zip must go up base64-encoded, not as text — that is the only branch of
    // fileToPayload with real logic in it.
    const payload = previewMutate.mock.calls[0]![0];
    expect(payload).toMatchObject({ kind: "zip", filename: "bundle.zip" });
    expect(payload).not.toHaveProperty("content");
    expect(atob(payload.content_base64 as string)).toBe("PK-fake-archive-bytes");

    expect(screen.getByText("2 files ignored")).toBeInTheDocument();
    expect(screen.getByText("no-console-in-prod/install.sh")).toBeInTheDocument();
    expect(screen.getByText("no-console-in-prod/README.md")).toBeInTheDocument();
    expect(
      screen.getByText(/never opened, written to disk, or executed/),
    ).toBeInTheDocument();
  });

  it("says the import will land disabled", async () => {
    renderDrawer();
    pick("skill.md");
    await screen.findByDisplayValue("no-console-in-prod");
    expect(screen.getByText("Saved disabled, for you to vet first")).toBeInTheDocument();
  });

  it("creating from scratch uses the create endpoint, not the import one", async () => {
    renderDrawer();
    fireEvent.click(screen.getByText("Create from scratch"));

    fireEvent.change(screen.getByPlaceholderText("pr-quality-rubric"), {
      target: { value: "hand-written" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Describe the rule/), {
      target: { value: "# Body" },
    });
    fireEvent.click(screen.getByText("Create skill"));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(importMutate).not.toHaveBeenCalled();
    // No draft, so no "ignored files" panel to show.
    expect(screen.queryByText(/files ignored/)).not.toBeInTheDocument();
  });

  it("rejects an oversized archive before making a request", async () => {
    renderDrawer();
    const input = screen.getByTestId("skill-file-input") as HTMLInputElement;
    const big = new File(["x"], "huge.zip");
    Object.defineProperty(big, "size", { value: 900 * 1024 });
    Object.defineProperty(big, "arrayBuffer", { value: async () => new ArrayBuffer(0) });
    fireEvent.change(input, { target: { files: [big] } });

    expect(await screen.findByText(/larger than 512 KB/)).toBeInTheDocument();
    expect(previewMutate).not.toHaveBeenCalled();
  });
});
