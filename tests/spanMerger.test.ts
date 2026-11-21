import { describe, it, expect } from "vitest";
import {
  addManualSpan,
  applyMaskedSpans,
  buildSemanticSpans,
  mergeAndRedactSpans,
  verifyZeroLeakage,
} from "../src/firewall/spanMerger";
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

  it("supports manual span masking and programmatic zero-leakage verification", () => {
    const raw = "Secret phrase AlphaSecretCode leaked on shard-9.";
    const { sanitizedText, mergedSpans } = addManualSpan(raw, [], 14, 29);
    expect(sanitizedText).toBe("Secret phrase [REDACTED:MANUAL_SECRET_1] leaked on shard-9.");

    const cleanAudit = verifyZeroLeakage(sanitizedText, mergedSpans);
    expect(cleanAudit.verified).toBe(true);
    expect(cleanAudit.leakedSpansCount).toBe(0);

    const dirtyAudit = verifyZeroLeakage(raw, mergedSpans);
    expect(dirtyAudit.verified).toBe(false);
    expect(dirtyAudit.leakedSpansCount).toBe(1);
    expect(dirtyAudit.leakedCategories).toEqual(["MANUAL_SECRET"]);
  });

  it("ignores out-of-bounds spans cleanly without corrupting text", () => {
    const raw = "Short text";
    const out = applyMaskedSpans(raw, [
      {
        start: -1,
        end: 5,
        category: "BAD",
        detector: "MANUAL_MASK",
        placeholder: "[REDACTED:BAD]",
        matchedText: "Short",
      },
      {
        start: 2,
        end: 999,
        category: "BAD2",
        detector: "MANUAL_MASK",
        placeholder: "[REDACTED:BAD2]",
        matchedText: "ort",
      },
    ]);
    expect(out).toBe(raw);
  });

  it("preserves constituent sub-secrets across overlapping spans, detects URL/JSON-encoded leaks, and handles UTF-16 emoji surrogate pairs accurately", () => {
    const rawWithEmoji = "Alert 🚨🔥: secret AlphaKey999BetaKey888 leaked after 👩‍💻 deploy.";
    const spanA: RedactionSpan = {
      start: rawWithEmoji.indexOf("AlphaKey999"),
      end: rawWithEmoji.indexOf("AlphaKey999") + "AlphaKey999Beta".length,
      category: "API_KEY",
      detector: "REGEX_FIREWALL",
      placeholder: "[REDACTED:API_KEY_1]",
      matchedText: "AlphaKey999Beta",
      masked: true,
    };
    const spanB: RedactionSpan = {
      start: rawWithEmoji.indexOf("BetaKey888"),
      end: rawWithEmoji.indexOf("BetaKey888") + "BetaKey888".length,
      category: "HIGH_ENTROPY_SECRET",
      detector: "ENTROPY_SCANNER",
      placeholder: "[REDACTED:HIGH_ENTROPY_SECRET_50]",
      matchedText: "BetaKey888",
      masked: true,
    };

    const { sanitizedText, mergedSpans } = mergeAndRedactSpans(rawWithEmoji, [spanA, spanB]);
    expect(sanitizedText).toContain("Alert 🚨🔥: secret [REDACTED:API_KEY_1] leaked after 👩‍💻 deploy.");
    expect(mergedSpans).toHaveLength(1);
    expect(mergedSpans[0].constituentTexts).toContain("AlphaKey999Beta");
    expect(mergedSpans[0].constituentTexts).toContain("BetaKey888");

    // Even if only one constituent sub-secret leaks (not the full merged string), verifyZeroLeakage catches it
    const subLeakAudit = verifyZeroLeakage("Outbound prompt leaking BetaKey888 alone", mergedSpans);
    expect(subLeakAudit.verified).toBe(false);
    expect(subLeakAudit.leakedSpansCount).toBe(1);

    // Also detects URL-encoded leak of a secret containing special characters
    const specialSecretSpan: RedactionSpan = {
      start: 0,
      end: 18,
      category: "DB_PASS",
      detector: "MANUAL_MASK",
      placeholder: "[REDACTED:DB_PASS_1]",
      matchedText: "p@ss/w0rd#2026!xyz",
      masked: true,
    };
    const encodedLeakAudit = verifyZeroLeakage(
      `Prompt with ${encodeURIComponent("p@ss/w0rd#2026!xyz")} inside`,
      [specialSecretSpan],
    );
    expect(encodedLeakAudit.verified).toBe(false);
  });
});
