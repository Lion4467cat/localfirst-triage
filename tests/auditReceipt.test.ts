import { describe, expect, it } from "vitest";
import {
  mintZeroLeakageAuditReceipt,
  verifyAuditReceipt,
} from "../src/firewall/auditReceipt";
import type { TriageResult } from "../src/types/triage";

describe("auditReceipt (ECDSA P-256)", () => {
  const rawSecret = "AKIA" + "IOSFODNN7EXAMPLE";
  const rawText = `Outage with AWS key ${rawSecret} in Manipal ICU Floor 3`;
  const sanitizedText = "Outage with AWS key [REDACTED:AWS_1] in [REDACTED:PHI_1]";

  const baseResult: TriageResult = {
    id: "ticket-rcpt-1",
    title: "P0 Outage",
    rawText,
    sanitizedText,
    severity: "P0",
    category: "CREDENTIAL_LEAK",
    spans: [
      {
        start: 20,
        end: 40,
        category: "AWS_ACCESS_KEY",
        detector: "REGEX_FIREWALL",
        placeholder: "[REDACTED:AWS_1]",
        matchedText: rawSecret,
        masked: true,
      },
      {
        start: 44,
        end: 63,
        category: "CONTEXTUAL_PHI",
        detector: "NANO_SEMANTIC_FIREWALL",
        placeholder: "[REDACTED:PHI_1]",
        matchedText: "Manipal ICU Floor 3",
        masked: true,
      },
    ],
    resolution: "Rotate key.",
    resolutionMode: "QUARANTINED_PENDING_APPROVAL",
    inferenceSource: "LOCAL_REGEX_FALLBACK",
    stage1Source: "HEURISTIC_GUARD",
    stage1LatencyMs: 3,
    stage2Source: "HELD_QUARANTINE",
    stage2LatencyMs: 0,
    nanoStatus: "UNAVAILABLE",
    latencyMs: 3,
    estimatedTokensSaved: 40,
    createdAt: Date.now(),
    zeroLeakageAudit: {
      verified: true,
      checkedSpansCount: 2,
      leakedSpansCount: 0,
      leakedCategories: [],
      outboundPromptPreview: sanitizedText,
      verifiedAt: Date.now(),
    },
  };

  it("mints a valid ECDSA P-256 receipt, verifies it, and rejects 1-byte tampering", async () => {
    const receipt = await mintZeroLeakageAuditReceipt({
      rawText,
      sanitizedText,
      result: baseResult,
    });

    // Raw secret & salt must never appear in serialized receipt JSON
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain(rawSecret);
    expect(serialized).not.toContain("Manipal ICU Floor 3");
    expect(receipt.leakedCount).toBe(0);
    expect(receipt.zeroLeakageVerified).toBe(true);
    expect(receipt.layerBreakdown.regex).toBe(1);
    expect(receipt.layerBreakdown.nano4).toBe(1);

    const genuine = await verifyAuditReceipt(receipt);
    expect(genuine.valid).toBe(true);

    // Flip 1 character in sanitizedSha256 -> signature verification MUST fail
    const tamperedChar = receipt.sanitizedSha256[0] === "a" ? "b" : "a";
    const tampered = {
      ...receipt,
      sanitizedSha256: tamperedChar + receipt.sanitizedSha256.slice(1),
    };
    const invalid = await verifyAuditReceipt(tampered);
    expect(invalid.valid).toBe(false);
  });

  it("verifies a receipt after a JSON round-trip (export -> later verification)", async () => {
    const receipt = await mintZeroLeakageAuditReceipt({
      rawText,
      sanitizedText,
      result: baseResult,
    });
    const revived = JSON.parse(JSON.stringify(receipt));
    const result = await verifyAuditReceipt(revived);
    expect(result.valid).toBe(true);
  });

  it("uses one stable signing identity per session and rejects a tampered public key", async () => {
    const first = await mintZeroLeakageAuditReceipt({ rawText, sanitizedText, result: baseResult });
    const second = await mintZeroLeakageAuditReceipt({ rawText, sanitizedText, result: baseResult });
    expect(first.keyThumbprintSha256).toBe(second.keyThumbprintSha256);

    const originalX = second.publicKeyJwk.x ?? "";
    const flippedX = (originalX[0] === "A" ? "B" : "A") + originalX.slice(1);
    const tampered = { ...second, publicKeyJwk: { ...second.publicKeyJwk, x: flippedX } };
    const result = await verifyAuditReceipt(tampered);
    expect(result.valid).toBe(false);
  });
});
