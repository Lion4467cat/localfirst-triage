import { describe, it, expect, beforeEach } from "vitest";
import {
  clearSanitizedTickets,
  exportAuditReportJson,
  exportAuditReportMarkdown,
  listSanitizedTickets,
  loadCustomRunbooks,
  loadPrivacyPolicy,
  saveCustomRunbooks,
  savePrivacyPolicy,
  saveSanitizedTicket,
  sanitizeStoredPolicy,
  sanitizeStoredRunbooks,
  sanitizeStoredTicket,
  stripRawTextForStorage,
} from "../src/storage/ticketStore";
import type { TriageResult } from "../src/types/triage";

const SAMPLE_RESULT: TriageResult = {
  id: "ticket-zero-pii-1",
  title: "P0 Secret Leak",
  rawText: "Customer secret: sk-proj-supersecretkey1234567890",
  sanitizedText: "Customer secret: [REDACTED:API_KEY_1]",
  severity: "P0",
  category: "GENERAL_INCIDENT",
  spans: [
    {
      start: 17,
      end: 47,
      category: "API_KEY",
      detector: "REGEX_FIREWALL",
      placeholder: "[REDACTED:API_KEY_1]",
      matchedText: "sk-proj-supersecretkey1234567890",
      masked: true,
    },
  ],
  resolution: "Rotate leaked API key immediately.",
  resolutionMode: "CLOUD_ESCALATION",
  inferenceSource: "IN_CLOUD",
  stage1Source: "HEURISTIC_GUARD",
  stage1LatencyMs: 5,
  stage2Source: "IN_CLOUD",
  stage2LatencyMs: 120,
  nanoStatus: "UNAVAILABLE",
  latencyMs: 125,
  estimatedTokensSaved: 18,
  createdAt: 1795242000000,
};

describe("ticketStore", () => {
  beforeEach(async () => {
    await clearSanitizedTickets();
  });

  it("purges rawText and matchedText before writing to persistent store", async () => {
    const stripped = stripRawTextForStorage(SAMPLE_RESULT);
    expect(stripped.rawText).toBe("[PURGED_FROM_DISK_FOR_PRIVACY]");
    expect(stripped.loadedFromZeroPiiStore).toBe(true);
    expect(stripped.spans[0].matchedText).toBe("[REDACTED:API_KEY_1]");

    await saveSanitizedTicket(SAMPLE_RESULT);
    const items = await listSanitizedTickets();
    expect(items).toHaveLength(1);
    expect(items[0].rawText).toBe("[PURGED_FROM_DISK_FOR_PRIVACY]");
    expect(JSON.stringify(items)).not.toContain("sk-proj-supersecretkey1234567890");
  });

  it("exports JSON and Markdown audit reports without leaking raw PII", () => {
    const jsonExport = exportAuditReportJson(SAMPLE_RESULT);
    const mdExport = exportAuditReportMarkdown(SAMPLE_RESULT);

    expect(jsonExport).not.toContain("sk-proj-supersecretkey1234567890");
    expect(jsonExport).toContain("[REDACTED:API_KEY_1]");
    expect(mdExport).not.toContain("sk-proj-supersecretkey1234567890");
    expect(mdExport).toContain("Zero-PII Compliance Audit Report");
  });

  it("persists custom runbooks and workspace privacy policy cleanly", async () => {
    await savePrivacyPolicy({
      customTerms: ["Project-Apollo"],
      enableEntropyScanner: false,
      autoCountdownSeconds: 5,
    });
    const loadedPolicy = await loadPrivacyPolicy();
    expect(loadedPolicy.customTerms).toEqual(["Project-Apollo"]);
    expect(loadedPolicy.enableEntropyScanner).toBe(false);

    await saveCustomRunbooks([
      {
        id: "RB_TEST_1",
        title: "Test Runbook",
        category: "TEST",
        severity: "P3",
        keywords: ["test_err"],
        resolution: "Fix test_err locally.",
      },
    ]);
    const loadedRbs = await loadCustomRunbooks();
    expect(loadedRbs[0].id).toBe("RB_TEST_1");
  });

  it("repairs or rejects corrupted storage records and strips constituentTexts so UI never white-screens", () => {
    expect(sanitizeStoredTicket(null)).toBeNull();
    expect(sanitizeStoredTicket({ id: "", sanitizedText: "bad" })).toBeNull();

    const repaired = sanitizeStoredTicket({
      id: "legacy-record-1",
      sanitizedText: "Sanitized log with [REDACTED:EMAIL_1]",
      spans: null,
      severity: "INVALID_SEV",
    });
    expect(repaired).not.toBeNull();
    expect(repaired?.spans).toEqual([]);
    expect(repaired?.severity).toBe("P2");
    expect(repaired?.rawText).toBe("[PURGED_FROM_DISK_FOR_PRIVACY]");

    const policyRepaired = sanitizeStoredPolicy({
      customTerms: ["okTerm", 123, "ab", null],
      enableEntropyScanner: "invalid",
      autoCountdownSeconds: -5,
    });
    expect(policyRepaired?.customTerms).toEqual(["okTerm"]);
    expect(policyRepaired?.enableEntropyScanner).toBe(true);
    expect(policyRepaired?.autoCountdownSeconds).toBe(3);

    expect(sanitizeStoredRunbooks([{ broken: true }])).toBeNull();

    const strippedWithConstituents = stripRawTextForStorage({
      ...SAMPLE_RESULT,
      spans: [
        {
          ...SAMPLE_RESULT.spans[0],
          constituentTexts: ["sk-proj-supersecretkey1234567890"],
        },
      ],
    });
    expect(strippedWithConstituents.spans[0].constituentTexts).toBeUndefined();
    expect(JSON.stringify(strippedWithConstituents)).not.toContain(
      "sk-proj-supersecretkey1234567890",
    );
  });
});
