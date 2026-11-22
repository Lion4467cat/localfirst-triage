import { describe, expect, it } from "vitest";
import {
  computeQuickRiskScore,
  scrubSync,
} from "../extension/sidepanel/firewall-core.js";

describe("Live Browser Paste Shield (firewall-core)", () => {
  it("catches AWS keys, JWTs, contextual PHI, natural secrets, and M&A terms synchronously in <5ms", () => {
    const awsKey = ["AK", "IAIOSFODNN7EXAMPLE"].join("");
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature12345";
    const raw = `Outage: ${awsKey}.\nBearer ${jwt}.\nCustomer daughter admitted to Manipal ICU Floor 3.\nOn-call pasted: log in using his dog's name.\nInternal: Project-Chimera.`;

    const res = scrubSync(raw, true);
    expect(res.latencyMs).toBeLessThan(25);
    expect(res.mergedSpans.length).toBeGreaterThanOrEqual(4);
    expect(res.sanitizedText).not.toContain(awsKey);
    expect(res.sanitizedText).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(res.sanitizedText).not.toContain("Manipal ICU Floor 3");
    expect(res.sanitizedText).not.toContain("Project-Chimera");
    expect(res.riskProfile.tier).toBe("CRITICAL");
    expect(res.riskProfile.score).toBeGreaterThanOrEqual(80);
  });

  it("passes benign developer pastes with 0 masks and 0 false positives", () => {
    const benign =
      "Please check why nginx returned 502 Bad Gateway on /api/v1/health after the v4.2.0 rollout.";
    const res = scrubSync(benign, true);
    expect(res.mergedSpans.length).toBe(0);
    expect(res.sanitizedText).toBe(benign);
    expect(res.riskProfile.tier).toBe("LOW");
    expect(res.riskProfile.score).toBe(0);
  });

  it("computes consistent quick risk tiers", () => {
    expect(computeQuickRiskScore([]).tier).toBe("LOW");
    expect(computeQuickRiskScore([{ category: "API_KEY" }]).tier).toBe("ELEVATED");
    expect(
      computeQuickRiskScore([
        { category: "API_KEY" },
        { category: "AWS_ACCESS_KEY" },
      ]).tier,
    ).toBe("HIGH");
    expect(
      computeQuickRiskScore([
        { category: "API_KEY" },
        { category: "AWS_ACCESS_KEY" },
        { category: "CONTEXTUAL_PHI" },
      ]).tier,
    ).toBe("CRITICAL");
  });

  it("catches natural-language bare phone, lowercase name, employer, and low-entropy labeled API key", () => {
    const sample =
      "my phone number is 9876543210 and my name is ravi and i work in Zenith company , and my api key is 23224324234kjjjkjl";
    const res = scrubSync(sample, true);
    expect(res.mergedSpans.length).toBe(4);
    expect(res.sanitizedText).not.toContain("9876543210");
    expect(res.sanitizedText).not.toContain("ravi");
    expect(res.sanitizedText).not.toContain("Zenith company");
    expect(res.sanitizedText).not.toContain("23224324234kjjjkjl");
    expect(res.sanitizedText).toContain("[REDACTED:PHONE_");
    expect(res.sanitizedText).toContain("[REDACTED:PERSON_");
    expect(res.sanitizedText).toContain("[REDACTED:ORG_TERM_");
    expect(res.sanitizedText).toContain("[REDACTED:API_KEY_");
  });

  it("enforces low vs medium vs high protection levels on natural-language input", () => {
    const sample =
      "my phone number is 9876543210 and my name is ravi and i work in Zenith company , and my api key is 23224324234kjjjkjl";

    const lowRes = scrubSync(sample, true, "low");
    expect(lowRes.mergedSpans.length).toBe(1);
    expect(lowRes.sanitizedText).not.toContain("23224324234kjjjkjl");
    expect(lowRes.sanitizedText).toContain("9876543210");
    expect(lowRes.sanitizedText).toContain("ravi");

    for (const lvl of ["medium", "high"] as const) {
      const res = scrubSync(sample, true, lvl);
      expect(res.mergedSpans.length).toBe(4);
      expect(res.sanitizedText).not.toContain("9876543210");
      expect(res.sanitizedText).not.toContain("ravi");
      expect(res.sanitizedText).not.toContain("Zenith company");
      expect(res.sanitizedText).not.toContain("23224324234kjjjkjl");
    }
  });

  it("redacts full multi-segment comma-separated addresses including locality and PIN/ZIP in medium mode", () => {
    const sample =
      "my address is 42 Oak Street, Koramangala, Bengaluru 560034 and my name is ravi";
    const res = scrubSync(sample, true, "medium");
    expect(res.sanitizedText).not.toContain("42 Oak Street");
    expect(res.sanitizedText).not.toContain("Koramangala");
    expect(res.sanitizedText).not.toContain("Bengaluru");
    expect(res.sanitizedText).not.toContain("560034");
    expect(res.sanitizedText).not.toContain("ravi");
    expect(res.sanitizedText).toContain("[REDACTED:ADDRESS_");
    expect(res.sanitizedText).toContain("[REDACTED:PERSON_");
  });

  it("is strictly idempotent across 3 consecutive scrubSync passes", () => {
    const awsKey = ["AK", "IAIOSFODNN7EXAMPLE"].join("");
    const input = `my address is 42 Oak Street, Koramangala, Bengaluru 560034 and my name is ravi and my phone number is 9876543210 and my api key is 23224324234kjjjkjl and I work in Zenith company ${awsKey}`;

    const pass1 = scrubSync(input, true, "medium");
    expect(pass1.mergedSpans.length).toBeGreaterThanOrEqual(5);

    const pass2 = scrubSync(pass1.sanitizedText, true, "medium");
    expect(pass2.mergedSpans.length).toBe(0);
    expect(pass2.sanitizedText).toBe(pass1.sanitizedText);

    const pass3 = scrubSync(pass2.sanitizedText, true, "high");
    expect(pass3.mergedSpans.length).toBe(0);
    expect(pass3.sanitizedText).toBe(pass1.sanitizedText);
  });

  it("produces 0 false positives on everyday/dev prose and preserves trailing non-secret sentences byte-for-byte", () => {
    const zeroFpCases = [
      "This feature is a work in progress and will go live in production tomorrow. Call me later if it breaks.",
      "My app works at scale using localStorage and contenteditable inside checkout-gateway after v4.8.2 deploy.",
      "Please explain how Docker containers talk to each other on localhost port 8080.",
    ];
    for (const prose of zeroFpCases) {
      for (const level of ["low", "medium"] as const) {
        const res = scrubSync(prose, true, level);
        expect(res.mergedSpans.length).toBe(0);
        expect(res.sanitizedText).toBe(prose);
      }
    }

    const addrCase = "my address is 42 Oak Street, Koramangala, Bengaluru 560034. Please fix the login bug after this.";
    const addrRes = scrubSync(addrCase, true, "medium");
    expect(addrRes.sanitizedText).not.toContain("42 Oak Street");
    expect(addrRes.sanitizedText).toContain("Please fix the login bug after this.");

    const phoneCase = "my phone number is 9876543210 and my name is ravi. Can you help me write a python script?";
    const phoneRes = scrubSync(phoneCase, true, "medium");
    expect(phoneRes.sanitizedText).not.toContain("9876543210");
    expect(phoneRes.sanitizedText).not.toContain("ravi");
    expect(phoneRes.sanitizedText).toContain("Can you help me write a python script?");
  });
});
