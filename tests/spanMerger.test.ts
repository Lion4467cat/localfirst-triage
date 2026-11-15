import { describe, it, expect } from "vitest";
import { applyMaskedSpans, buildSemanticSpans, mergeAndRedactSpans } from "../src/firewall/spanMerger";
import type { RedactionSpan } from "../src/types/triage";

describe("spanMerger", () => {
  it("respects word boundaries so short semantic words do not corrupt unrelated domains", () => {
    const raw = "Call May at api.may.com/v1/status regarding May.";
    const spans = buildSemanticSpans(raw, [{ phrase: "May", category: "PERSON_NAME" }]);
    const { sanitizedText, mergedSpans } = mergeAndRedactSpans(raw, spans);

    expect(mergedSpans.length).toBe(2);
    expect(sanitizedText).toContain("api.may.com/v1/status");
    expect(sanitizedText).not.toContain("Call May");
  });

  it("matches non-word prefixed secrets like $42M, +91 99000 54954, and [Project-Chimera]", () => {
    const raw = "Deal [Project-Chimera] valued at $42M; call +91 99000 54954 immediately.";
    const spans = buildSemanticSpans(raw, [
      { phrase: "$42M", category: "M_AND_A_VALUATION" },
      { phrase: "+91 99000 54954", category: "PHONE" },
      { phrase: "[Project-Chimera]", category: "INTERNAL_CODENAME" },
    ]);
    const { sanitizedText, mergedSpans } = mergeAndRedactSpans(raw, spans);

    expect(mergedSpans.length).toBe(3);
    expect(sanitizedText).not.toContain("$42M");
    expect(sanitizedText).not.toContain("+91 99000 54954");
    expect(sanitizedText).not.toContain("[Project-Chimera]");
  });

  it("never redacts technical allowlist identifiers like pg_locks or invalid_grant", () => {
    const raw = "Deadlock in pg_locks caused OAuth2 invalid_grant on checkout.";
    const spans = buildSemanticSpans(raw, [
      { phrase: "pg_locks", category: "PROPRIETARY_SECRET" },
      { phrase: "invalid_grant", category: "PROPRIETARY_SECRET" },
      { phrase: "OAuth2", category: "PROPRIETARY_SECRET" },
    ]);
    const { sanitizedText, mergedSpans } = mergeAndRedactSpans(raw, spans);

    expect(mergedSpans).toEqual([]);
    expect(sanitizedText).toBe(raw);
  });

  it("supports toggling mask/unmask cleanly via applyMaskedSpans", () => {
    const raw = "Email john.doe@hospital.org about Project-Chimera.";
    const spans: RedactionSpan[] = [
      {
        start: 6,
        end: 27,
        category: "EMAIL",
        detector: "REGEX_FIREWALL",
        placeholder: "[REDACTED:EMAIL_1]",
        matchedText: "john.doe@hospital.org",
        masked: true,
      },
      {
        start: 33,
        end: 48,
        category: "INTERNAL_CODENAME",
        detector: "NANO_SEMANTIC_FIREWALL",
        placeholder: "[REDACTED:INTERNAL_CODENAME_1]",
        matchedText: "Project-Chimera",
        masked: true,
      },
    ];

    const unmaskedSecond = spans.map((s, i) => (i === 1 ? { ...s, masked: false } : s));
    const result = applyMaskedSpans(raw, unmaskedSecond);
    expect(result).toBe("Email [REDACTED:EMAIL_1] about Project-Chimera.");
  });

  it("prioritizes NANO_SEMANTIC_FIREWALL over HEURISTIC_GUARD on overlapping spans", () => {
    const raw = "Patient admitted to Manipal ICU Floor 3.";
    const heuristicSpan: RedactionSpan = {
      start: 8,
      end: 39,
      category: "CONTEXTUAL_PHI",
      detector: "HEURISTIC_GUARD",
      placeholder: "[REDACTED:CONTEXTUAL_PHI_100]",
      matchedText: "admitted to Manipal ICU Floor 3",
      masked: true,
    };
    const nanoSpan: RedactionSpan = {
      start: 20,
      end: 39,
      category: "CONTEXTUAL_PHI",
      detector: "NANO_SEMANTIC_FIREWALL",
      placeholder: "[REDACTED:CONTEXTUAL_PHI_1]",
      matchedText: "Manipal ICU Floor 3",
      masked: true,
    };

    const { mergedSpans } = mergeAndRedactSpans(raw, [heuristicSpan, nanoSpan]);
    expect(mergedSpans).toHaveLength(1);
    expect(mergedSpans[0].detector).toBe("NANO_SEMANTIC_FIREWALL");
  });

  it("redacts hyphenated codenames inside URL paths and CLI flags while protecting short words in domains", () => {
    const raw =
      "Call May at api.may.com; GET https://internal.corp/deals/Project-Chimera/valuation failed on --tenant=Project-Chimera.";
    const spans = buildSemanticSpans(raw, [
      { phrase: "May", category: "PERSON_NAME" },
      { phrase: "Project-Chimera", category: "INTERNAL_CODENAME" },
    ]);
    const { sanitizedText } = mergeAndRedactSpans(raw, spans);

    expect(sanitizedText).toContain("api.may.com");
    expect(sanitizedText).not.toContain("Call May");
    expect(sanitizedText).not.toContain("/deals/Project-Chimera/valuation");
    expect(sanitizedText).not.toContain("--tenant=Project-Chimera");
  });
});
