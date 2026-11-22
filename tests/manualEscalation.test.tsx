import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { TriageResult } from "../src/types/triage";

const mocks = vi.hoisted(() => ({
  runTriagePipeline: vi.fn(),
  escalateApprovedTicket: vi.fn(),
}));

vi.mock("../src/firewall/pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/firewall/pipeline")>();
  return {
    ...actual,
    runTriagePipeline: mocks.runTriagePipeline,
    escalateApprovedTicket: mocks.escalateApprovedTicket,
  };
});

import App from "../src/App";

const ticket: TriageResult = {
  id: "ticket-pre-cloud",
  title: "Ready for review",
  rawText: "Sanitized [REDACTED:API_KEY_1]",
  sanitizedText: "Sanitized [REDACTED:API_KEY_1]",
  severity: "P2",
  category: "Security",
  spans: [],
  resolution: "Stage 1 complete. Review before sending.",
  resolutionMode: "PRE_CLOUD_COUNTDOWN",
  inferenceSource: "ON_DEVICE",
  stage1Source: "ON_DEVICE (Nano 4)",
  stage1LatencyMs: 8,
  stage2Source: "PENDING_PRE_CLOUD",
  stage2LatencyMs: 0,
  nanoStatus: "READY",
  latencyMs: 8,
  estimatedTokensSaved: 10,
  riskProfile: {
    score: 10,
    tier: "LOW",
    action: "LOCAL_RUNBOOK",
    reasons: [],
    breakdown: { credentials: 0, piiPhi: 0, corporate: 0, entropyBonus: 0, nanoBonus: 0 },
  },
  createdAt: 1700000000000,
};

describe("web cloud escalation", () => {
  it("requires an explicit click and never auto-sends on a timer", async () => {
    mocks.runTriagePipeline.mockResolvedValue(ticket);
    mocks.escalateApprovedTicket.mockResolvedValue({
      ...ticket,
      resolutionMode: "CLOUD_ESCALATION",
      resolution: "Cloud answer",
    });

    const { getByRole, queryByRole } = render(<App />);

    // No auto-cloud toggle exists: one explicit confirmation at send time.
    expect(queryByRole("switch", { name: /Toggle Auto-Cloud mode/i })).toBeNull();

    fireEvent.click(getByRole("button", { name: /Scrub & (Analyze|Fix Offline)/i }));
    await waitFor(() => expect(mocks.runTriagePipeline).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.body.textContent).toContain("Ready for Safe AI"));

    // The fallback/approve prose must be allowed to wrap on a 390px viewport.
    fireEvent.click(getByRole("tab", { name: /AI Solution/i }));
    await waitFor(() =>
      expect(document.querySelector('[class*="overflow-wrap:anywhere"]')).toBeTruthy(),
    );

    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(mocks.escalateApprovedTicket).not.toHaveBeenCalled();

    fireEvent.click(
      getByRole("button", { name: /Approve & Send Scrubbed Text to Cloud AI/i }),
    );
    await waitFor(() => expect(mocks.escalateApprovedTicket).toHaveBeenCalledTimes(1));
  });
});
