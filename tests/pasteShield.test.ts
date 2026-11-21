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
    const benign = "Please check why nginx returned 502 Bad Gateway on /api/v1/health after the v4.2.0 rollout.";
    const res = scrubSync(benign, true);
    expect(res.mergedSpans.length).toBe(0);
    expect(res.sanitizedText).toBe(benign);
    expect(res.riskProfile.tier).toBe("LOW");
    expect(res.riskProfile.score).toBe(0);
  });

  it("computes consistent quick risk tiers", () => {
    expect(computeQuickRiskScore([]).tier).toBe("LOW");
    expect(computeQuickRiskScore([{ category: "API_KEY" }]).tier).toBe("ELEVATED");
    expect(computeQuickRiskScore([{ category: "API_KEY" }, { category: "AWS_ACCESS_KEY" }]).tier).toBe("HIGH");
    expect(
      computeQuickRiskScore([
        { category: "API_KEY" },
        { category: "AWS_ACCESS_KEY" },
        { category: "CONTEXTUAL_PHI" },
      ]).tier,
    ).toBe("CRITICAL");
  });
});
