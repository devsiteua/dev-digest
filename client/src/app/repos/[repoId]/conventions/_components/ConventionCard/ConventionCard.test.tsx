import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";
import { ConventionCard } from "./ConventionCard";

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
  status: "pending",
  skill_id: null,
  created_at: "2026-08-06T10:00:00.000Z",
  ...over,
});

const renderCard = (props: Partial<React.ComponentProps<typeof ConventionCard>> = {}) => {
  const onSetStatus = props.onSetStatus ?? vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ConventionCard
        candidate={candidate()}
        repoFullName="acme/payments-api"
        gitRef="main"
        {...props}
        onSetStatus={onSetStatus}
      />
    </NextIntlClientProvider>,
  );
  return onSetStatus;
};

afterEach(cleanup);

describe("ConventionCard", () => {
  it("shows the rule, the evidence snippet and the confidence", () => {
    renderCard();
    expect(screen.getByText(/Read every environment variable/)).toBeInTheDocument();
    expect(screen.getByText(/export const config/)).toBeInTheDocument();
    expect(screen.getByText("74%")).toBeInTheDocument();
  });

  it("links the evidence path to the real lines on GitHub", () => {
    renderCard();
    const link = screen.getByRole("link", { name: "src/config.ts:8-11" });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/main/src/config.ts#L8-L11",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("falls back to a non-link path while the repo is unknown", () => {
    renderCard({ repoFullName: null, gitRef: null });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("src/config.ts:8-11")).toBeInTheDocument();
  });

  it("accepts a pending candidate", () => {
    const onSetStatus = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onSetStatus).toHaveBeenCalledWith("accepted");
  });

  it("rejects a pending candidate", () => {
    const onSetStatus = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onSetStatus).toHaveBeenCalledWith("rejected");
  });

  it("takes an accepted candidate back to pending — the per-card half of Deselect all", () => {
    const onSetStatus = renderCard({ candidate: candidate({ status: "accepted" }) });
    fireEvent.click(screen.getByRole("button", { name: "Accepted" }));
    expect(onSetStatus).toHaveBeenCalledWith("pending");
  });

  it("labels a rejected candidate and disables both buttons while a write is in flight", () => {
    renderCard({ candidate: candidate({ status: "rejected" }), pending: "rejected" });
    expect(screen.getByRole("button", { name: "Rejecting…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
  });
});
