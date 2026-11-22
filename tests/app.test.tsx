import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, fireEvent, waitFor } from "@testing-library/react";
import App, { decodeHandoffHash, prepareTicketForEscalation } from "../src/App";
import { clearSanitizedTickets, stripRawTextForStorage } from "../src/storage/ticketStore";
import type { TriageResult } from "../src/types/triage";

function ensureMockLocalStorage(): void {
  if (typeof window.localStorage?.removeItem === "function") {
    return;
  }
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: memoryStorage,
  });
}

describe("App integration", () => {
  beforeEach(async () => {
    ensureMockLocalStorage();
    await clearSanitizedTickets();
    window.location.hash = "";
    window.localStorage.removeItem("localfirst-theme");
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

  it("renders the package version in the header pill instead of a stale literal", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
    ) as { version: string };
    const { getByText } = render(<App />);
    const escaped = pkg.version.replace(/\./g, "\\.");
    expect(getByText(new RegExp(`V${escaped} · HYBRID AIRGAP`))).toBeTruthy();
  });

  it("supports System / Light / Dark theme switching and persists non-system choice", () => {
    const { getByRole } = render(<App />);

    fireEvent.click(getByRole("button", { name: /^Dark/i }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem("localfirst-theme")).toBe("dark");

    fireEvent.click(getByRole("button", { name: /^Light/i }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(window.localStorage.getItem("localfirst-theme")).toBe("light");

    fireEvent.click(getByRole("button", { name: /^System/i }));
    expect(document.documentElement.getAttribute("data-theme-preference")).toBe("system");
    expect(window.localStorage.getItem("localfirst-theme")).toBeNull();
  });

  it("renders Cordon wordmark and toggles UI sound effects cleanly", () => {
    window.localStorage.removeItem("cordon_sfx_enabled");
    const { getByLabelText, getByRole } = render(<App />);

    expect(getByLabelText("Cordon")).toBeTruthy();
    const sfxBtn = getByRole("button", { name: "Toggle UI sound effects" });
    expect(sfxBtn.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(sfxBtn);
    expect(sfxBtn.getAttribute("aria-pressed")).toBe("false");
    expect(window.localStorage.getItem("cordon_sfx_enabled")).toBe("false");

    fireEvent.click(sfxBtn);
    expect(sfxBtn.getAttribute("aria-pressed")).toBe("true");
    expect(window.localStorage.getItem("cordon_sfx_enabled")).toBe("true");
  });

  it("runs triage on P0 scenario into fail-closed review and respects Offline Mode toggle in Cloud Sync popover", async () => {
    const { getByRole, findByText } = render(<App />);

    const runBtn = getByRole("button", { name: /Scrub & (Analyze|Fix Offline)/i });
    fireEvent.click(runBtn);

    expect(
      await findByText(/Paused for Review/i),
    ).toBeTruthy();

    // Open Cloud Sync popover and ensure Offline Mode disables escalation button safely
    fireEvent.click(getByRole("button", { name: /Cloud Sync|Sync ·|Offline \(\$0\)/i }));
    const offlineSwitch = getByRole("switch", { name: /Toggle Offline Mode/i });
    if (offlineSwitch.getAttribute("aria-checked") !== "true") {
      fireEvent.click(offlineSwitch);
    }

    await waitFor(() => {
      const sendBtn = getByRole("button", { name: /Approve & (Get Safe AI Solution|Send Scrubbed Text to Cloud AI)/i });
      expect((sendBtn as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it("switches to Privacy Rules and Runbooks views cleanly", async () => {
    const { getByRole, findByText } = render(<App />);

    fireEvent.click(getByRole("button", { name: /^Rules/i }));
    expect(await findByText(/Custom Blocked Terms/i)).toBeTruthy();

    fireEvent.click(getByRole("button", { name: /^Runbooks/i }));
    expect(await findByText(/Offline Fix Runbooks/i)).toBeTruthy();
  });

  it("resolves P3 local runbook scenario on-device", async () => {
    const { getByRole, getByText, findByText, getByLabelText } = render(<App />);

    fireEvent.click(getByText(/Build \/ TLS Fix/i));
    fireEvent.click(getByRole("button", { name: /Scrub & (Analyze|Fix Offline)/i }));

    expect(await findByText(/Instant On-Device Fix \(\$0\)/i)).toBeTruthy();

    fireEvent.click(getByText(/P0 Outage \+ PHI/i));
    const textarea = getByLabelText(/Support Ticket or Error Logs/i) as HTMLTextAreaElement;
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
    expect(await findByText(/From Browser Extension/i)).toBeTruthy();
    const textarea = getByLabelText(/Support Ticket or Error Logs/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Auth trace with [REDACTED:BEARER_OR_JWT_1]");
    expect(window.location.hash).toBe("");
  });

  it("opens Proof & SDK tab and verifies Remote Config, Audit Proof, and Exports", async () => {
    const { getByRole, findByText } = render(<App />);
    fireEvent.click(getByRole("button", { name: /Scrub & (Analyze|Fix Offline)/i }));
    await findByText(/Paused for Review/i);

    fireEvent.click(getByRole("tab", { name: /Proof & SDK/i }));
    expect(await findByText(/ZERO-LEAKAGE VERIFIED:/i)).toBeTruthy();
    expect(await findByText(/Remote Config:/i)).toBeTruthy();
    expect(getByRole("button", { name: /Refresh Policy/i })).toBeTruthy();
    expect(getByRole("button", { name: /Export Audit JSON/i })).toBeTruthy();
  });

  it("rehydrates purged zero-PII records using sanitizedText and empty spans on re-escalation", () => {
    const fakeFirebaseKey = ["AI", "zaSyFakeSecretValue12345678901234567"].join("");
    const liveTicket: TriageResult = {
      id: "ticket-purged-test",
      title: "Purged Prod Incident",
      rawText: `Failure with secret ${fakeFirebaseKey}`,
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
          matchedText: fakeFirebaseKey,
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
    const fakeAwsKey = ["AK", "IAIOSFODNN7EXAMPLE"].join("");
    const oversized = "A".repeat(70_000);
    expect(decodeHandoffHash(`#handoff=${oversized}`)).toBeNull();
    expect(decodeHandoffHash("#handoff=%%%not_valid_base64%%%")).toBeNull();

    const rawSmuggledJson = JSON.stringify({
      title: "Smuggled\u0000Title",
      sanitizedText: `Leaked key ${fakeAwsKey} and email victim@corp.internal\u0007`,
    });
    const b64 = btoa(rawSmuggledJson).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const decoded = decodeHandoffHash(`#handoff=${b64}`);

    expect(decoded).not.toBeNull();
    expect(decoded?.title).toBe("SmuggledTitle");
    expect(decoded?.sanitizedText).not.toContain(fakeAwsKey);
    expect(decoded?.sanitizedText).not.toContain("victim@corp.internal");
    expect(decoded?.sanitizedText).toContain("[REDACTED:AWS_ACCESS_KEY_");
    expect(decoded?.sanitizedText).toContain("[REDACTED:EMAIL_");
  });
});
