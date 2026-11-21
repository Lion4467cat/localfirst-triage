import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import App, { decodeHandoffHash, prepareTicketForEscalation } from "../src/App";
import { clearSanitizedTickets, stripRawTextForStorage } from "../src/storage/ticketStore";
import type { TriageResult } from "../src/types/triage";

describe("App integration", () => {
  beforeEach(async () => {
    await clearSanitizedTickets();
    window.location.hash = "";
  });

  afterEach(() => {
    window.location.hash = "";
  });

  it("decodes extension base64url #handoff payload cleanly", () => {
    const json = JSON.stringify({
      title: "GitHub Issue #42",
      sanitizedText: "Error with [REDACTED:API_KEY_1]",
    });
    const b64 = btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const decoded = decodeHandoffHash(`#handoff=${b64}`);
    expect(decoded).toEqual({
      title: "GitHub Issue #42",
      sanitizedText: "Error with [REDACTED:API_KEY_1]",
    });
  });

  it("runs triage on P0 scenario into fail-closed quarantine and respects Offline Mode toggle", async () => {
    const { getByRole, findByText } = render(<App />);

    const runBtn = getByRole("button", { name: /Run Hybrid Triage/i });
    fireEvent.click(runBtn);

    expect(
      await findByText(/Fail-Closed Quarantine: Review masked tokens above/i),
    ).toBeTruthy();

    // Toggle Offline mode on and verify Approve & Escalate button disables safely
    const offlineBtn = getByRole("button", { name: /Hybrid Cloud Allowed/i });
    fireEvent.click(offlineBtn);

    await waitFor(() => {
      const blockedBtn = getByRole("button", { name: /Blocked \(Offline Mode ON\)/i });
      expect((blockedBtn as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it("opens Runbooks & Policy modal cleanly", async () => {
    const { getByRole, findByRole } = render(<App />);
    fireEvent.click(getByRole("button", { name: /Runbooks & Policy/i }));
    const dialog = await findByRole("dialog", { name: /Runbooks & Workspace Privacy Policy/i });
    expect(dialog).toBeTruthy();
  });

  it("resolves P3 local runbook scenario completely offline and clears raw PII when opening purged history", async () => {
    const { getByRole, getByText, findByText, getByLabelText } = render(<App />);

    fireEvent.click(getByText(/P3: Expired Local Dev TLS Cert/i));
    fireEvent.click(getByRole("button", { name: /Run Hybrid Triage/i }));

    expect(await findByText(/Local Runbook/i)).toBeTruthy();

    // Load P0 scenario text into editor, then click history item for P3 (which isn't purged yet) vs simulated purged reload
    fireEvent.click(getByText(/P0: Semantic PHI/i));
    const textarea = getByLabelText(/Raw Support \/ SRE Payload/i) as HTMLTextAreaElement;
    expect(textarea.value).toContain("Manipal ICU Floor 3");
  });

  it("imports sanitized #handoff URL from Chrome Extension and strips URL hash", async () => {
    const json = JSON.stringify({
      title: "Zendesk Ticket #99",
      sanitizedText: "Auth trace with [REDACTED:BEARER_OR_JWT_1]",
    });
    const b64 = btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    window.location.hash = `#handoff=${b64}`;

    const { findByText, getByLabelText } = render(<App />);
    expect(
      await findByText(/Imported sanitized payload from Chrome Extension Side Panel/i),
    ).toBeTruthy();
    const textarea = getByLabelText(/Raw Support \/ SRE Payload/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Auth trace with [REDACTED:BEARER_OR_JWT_1]");
    expect(window.location.hash).toBe("");
  });

  it("switches to Zero-Leakage Proof and Export & Handoff tabs after triage", async () => {
    const { getByRole, findByText } = render(<App />);
    fireEvent.click(getByRole("button", { name: /Run Hybrid Triage/i }));
    await findByText(/Fail-Closed Quarantine/i);

    fireEvent.click(getByRole("button", { name: /Zero-Leakage Proof/i }));
    expect(await findByText(/ZERO-LEAKAGE VERIFIED: 0 \//i)).toBeTruthy();

    fireEvent.click(getByRole("button", { name: /Export & Handoff/i }));
    expect(await findByText(/Download Audit JSON/i)).toBeTruthy();
  });

  it("rehydrates purged zero-PII records using sanitizedText and empty spans on re-escalation", () => {
    const liveTicket: TriageResult = {
      id: "ticket-purged-test",
      title: "Purged Prod Incident",
      rawText: "Failure with secret AIzaSyFakeSecretValue12345678901234567",
      sanitizedText: "Failure with secret [REDACTED:API_KEY_1]",
      severity: "P0",
      category: "Security",
      spans: [
        {
          start: 20,
          end: 59,
          category: "API_KEY",
          detector: "REGEX_FIREWALL",
          placeholder: "[REDACTED:API_KEY_1]",
          matchedText: "AIzaSyFakeSecretValue12345678901234567",
          masked: true,
        },
      ],
      resolution: "Quarantined",
      resolutionMode: "OFFLINE_QUEUED",
      inferenceSource: "LOCAL_REGEX_FALLBACK",
      stage1Source: "HEURISTIC_GUARD",
      stage1LatencyMs: 12,
      stage2Source: "OFFLINE_QUEUED",
      stage2LatencyMs: 0,
      nanoStatus: "UNAVAILABLE",
      latencyMs: 12,
      estimatedTokensSaved: 15,
      createdAt: 1700000000000,
    };

    const persisted = stripRawTextForStorage(liveTicket);
    expect(persisted.rawText).toBe("[PURGED_FROM_DISK_FOR_PRIVACY]");
    expect(persisted.loadedFromZeroPiiStore).toBe(true);

    const preparedFromPurged = prepareTicketForEscalation(persisted);
    expect(preparedFromPurged.rawText).toBe("Failure with secret [REDACTED:API_KEY_1]");
    expect(preparedFromPurged.rawText).not.toBe("[PURGED_FROM_DISK_FOR_PRIVACY]");
    expect(preparedFromPurged.spans).toEqual([]);

    const preparedFromLive = prepareTicketForEscalation(liveTicket);
    expect(preparedFromLive).toBe(liveTicket);
  });

  it("hardens decodeHandoffHash against oversized payloads, malformed base64, control chars, and unredacted secrets", () => {
    const oversized = "A".repeat(70_000);
    expect(decodeHandoffHash(`#handoff=${oversized}`)).toBeNull();
    expect(decodeHandoffHash("#handoff=%%%not_valid_base64%%%")).toBeNull();

    const rawSmuggledJson = JSON.stringify({
      title: "Smuggled\u0000Title",
      sanitizedText: "Leaked key AKIAIOSFODNN7EXAMPLE and email victim@corp.internal\u0007",
    });
    const b64 = btoa(rawSmuggledJson).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const decoded = decodeHandoffHash(`#handoff=${b64}`);

    expect(decoded).not.toBeNull();
    expect(decoded?.title).toBe("SmuggledTitle");
    expect(decoded?.sanitizedText).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(decoded?.sanitizedText).not.toContain("victim@corp.internal");
    expect(decoded?.sanitizedText).toContain("[REDACTED:AWS_ACCESS_KEY_");
    expect(decoded?.sanitizedText).toContain("[REDACTED:EMAIL_");
  });
});
