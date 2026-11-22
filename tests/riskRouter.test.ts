import { describe, expect, it } from "vitest";
import { computeRiskProfile } from "../src/firewall/riskRouter";
import type { RedactionSpan } from "../src/types/triage";

function span(
  category: string,
  detector: RedactionSpan["detector"] = "REGEX_FIREWALL",
  matchedText = "secret",
): RedactionSpan {
  return {
    start: 0,
    end: matchedText.length,
    category,
    detector,
    placeholder: `[REDACTED:${category}_1]`,
    matchedText,
    masked: true,
  };
}

describe("riskRouter", () => {
  it("returns LOW / LOCAL_RUNBOOK when no sensitive spans are present", () => {
    const profile = computeRiskProfile("nginx 502 bad gateway", { spans: [] });
    expect(profile.score).toBe(0);
    expect(profile.tier).toBe("LOW");
    expect(profile.action).toBe("LOCAL_RUNBOOK");
  });

  it("forces HYBRID_GATED_REVIEW at score >= 40 and applies Nano 4 +10 bonus", () => {
    const profile = computeRiskProfile("cred + nano", {
      spans: [
        span("API_KEY", "REGEX_FIREWALL", "AIzaSyTestKey"),
        span("CONTEXTUAL_PHI", "NANO_SEMANTIC_FIREWALL", "ICU Floor 3"),
      ],
    });
    // 30 (API_KEY) + 20 (CONTEXTUAL_PHI) + 10 (Nano 4) = 60
    expect(profile.score).toBe(60);
    expect(profile.tier).toBe("HIGH");
    expect(profile.action).toBe("HYBRID_GATED_REVIEW");
    expect(profile.breakdown.nanoBonus).toBe(10);
  });

  it("triggers CRITICAL_AIRGAP_LOCKDOWN when score >= 80", () => {
    const profile = computeRiskProfile("critical outage", {
      spans: [
        span("AWS_ACCESS_KEY", "REGEX_FIREWALL", ["AKIA", "1234567890ABCDEF"].join("")),
        span("BEARER_OR_JWT", "REGEX_FIREWALL", "eyJ..."),
        span("MEDICAL_PHI", "NANO_SEMANTIC_FIREWALL", "seizure"),
        span("M_AND_A_SECRET", "HEURISTIC_GUARD", "Project-Chimera"),
      ],
    });
    // 60 (2 creds) + 20 (PHI) + 15 (M&A) + 10 (Nano) = 105 -> capped at 100
    expect(profile.score).toBe(100);
    expect(profile.tier).toBe("CRITICAL");
    expect(profile.action).toBe("CRITICAL_AIRGAP_LOCKDOWN");
    expect(profile.reasons.length).toBeGreaterThanOrEqual(4);
  });

  it("returns CACHE_HIT_LOCAL when cacheHit option is true", () => {
    const profile = computeRiskProfile(
      "cached",
      { spans: [span("API_KEY")] },
      undefined,
      { cacheHit: true },
    );
    expect(profile.action).toBe("CACHE_HIT_LOCAL");
  });
});
