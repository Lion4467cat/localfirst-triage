import { describe, expect, it } from "vitest";
import { scanAndRedactLocal } from "../src/firewall/regexScrubber";
import { extractSemanticSecretsWithNano } from "../src/firewall/nanoExtractor";
import { addManualSpan, mergeAndRedactSpans, verifyZeroLeakage } from "../src/firewall/spanMerger";
import { generateSanitizedHybridBrief, runTriagePipeline } from "../src/firewall/pipeline";
import { sanitizeStoredTicket } from "../src/storage/ticketStore";
import type { ProtectionLevel } from "../src/types/triage";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("Chaos & Adversarial Fuzz Stress Suite (500+ cases)", () => {
  const LEVELS: ProtectionLevel[] = ["low", "medium", "high"];
  const CANARY_AWS = ["AK", "IAIOSFODNN7EXAMPLE"].join("");
  const CANARY_STRIPE = ["sk_live_", "51H8xYzAbCdEfGhIjKlMnOpQr"].join("");
  const CANARY_JWT =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

  const ADVERSARIAL_FRAGMENTS = [
    "",
    "   \n\t\r\n  ",
    "\u0000\u0001\u0007\u200B\u200D\uFEFF",
    "\u202Ereversed_rtl\u202C",
    "🔥🛡️💀\uD83D\uDE80\uD83E\uDD16",
    "\uD800", // lone high surrogate
    "a".repeat(2048),
    "{".repeat(120) + '"secret":"' + CANARY_STRIPE + '"' + "}".repeat(120),
    `SELECT * FROM users WHERE token='${CANARY_JWT}' AND phone='+1-415-555-0199';`,
    `Error: ENOENT at ${"a/".repeat(80)}config.json (${CANARY_AWS})`,
    "email=ops+alert@acme-corp.io; ip=10.240.12.88; card=4111-1111-1111-1111",
    "a\u200Bb\u200Cc@acme.io",
  ];

  it("handles 520 generated adversarial fuzz payloads in <50ms each with 0 exceptions and 0 canary leaks", () => {
    const rng = mulberry32(424242);
    let maxDurationMs = 0;

    for (let i = 0; i < 520; i++) {
      const level = LEVELS[i % LEVELS.length];
      const piecesCount = 1 + Math.floor(rng() * 5);
      const parts: string[] = [];
      let expectedAws = false;
      let expectedStripe = false;
      let expectedJwt = false;

      for (let p = 0; p < piecesCount; p++) {
        const frag = ADVERSARIAL_FRAGMENTS[Math.floor(rng() * ADVERSARIAL_FRAGMENTS.length)];
        parts.push(frag);
      }

      if (i % 4 === 0) {
        parts.push(`aws_access_key_id=${CANARY_AWS}`);
        expectedAws = true;
      }
      if (i % 5 === 0) {
        parts.push(`Authorization: Bearer ${CANARY_JWT}`);
        expectedJwt = true;
      }
      if (i % 7 === 0) {
        parts.push(`stripe_key=${CANARY_STRIPE}`);
        expectedStripe = true;
      }

      const payload = parts.join(" | ");
      const t0 = performance.now();
      const res = scanAndRedactLocal(payload, {
        protectionLevel: level,
        includeHeuristics: true,
      });
      const dt = performance.now() - t0;
      if (dt > maxDurationMs) maxDurationMs = dt;

      expect(typeof res.sanitizedText).toBe("string");
      expect(dt).toBeLessThan(50);

      if (expectedAws) expect(res.sanitizedText).not.toContain(CANARY_AWS);
      if (expectedJwt) expect(res.sanitizedText).not.toContain(CANARY_JWT);
      if (expectedStripe) expect(res.sanitizedText).not.toContain(CANARY_STRIPE);

      const audit = verifyZeroLeakage(res.sanitizedText, res.mergedSpans);
      expect(audit.verified).toBe(true);
    }

    expect(maxDurationMs).toBeLessThan(50);
  });

  it("survives 55 KB+ payload with embedded secrets without ReDoS (<50ms)", () => {
    const hugeNoise = "2026-11-22T12:00:00Z INFO worker-7 heartbeat ok latency=12ms\n".repeat(900);
    const payload = `${hugeNoise}\nLEAKED_KEY=${CANARY_AWS}\n${hugeNoise.slice(0, 2000)}`;
    expect(payload.length).toBeGreaterThan(55_000);

    const t0 = performance.now();
    const res = scanAndRedactLocal(payload, { protectionLevel: "medium", includeHeuristics: true });
    const dt = performance.now() - t0;

    expect(dt).toBeLessThan(50);
    expect(res.sanitizedText).not.toContain(CANARY_AWS);
    expect(verifyZeroLeakage(res.sanitizedText, res.mergedSpans).verified).toBe(true);
  });

  it("handles emoji surrogate pairs and lone surrogates in spanMerger & verifyZeroLeakage without throwing", () => {
    const text = `🔥🛡️ Alert \uD800 token=${CANARY_AWS} 🚀`;
    const scan = scanAndRedactLocal(text, { protectionLevel: "medium" });
    const manual = addManualSpan(text, scan.mergedSpans, 0, 4, "EMOJI_TEST");
    const merged = mergeAndRedactSpans(text, manual.mergedSpans);
    const audit = verifyZeroLeakage(merged.sanitizedText, merged.mergedSpans);

    expect(merged.sanitizedText).not.toContain(CANARY_AWS);
    expect(audit.verified).toBe(true);
  });

  it("fails closed on LanguageModel chaos (throws, malformed JSON) and corrupted stored tickets", async () => {
    const raw = `URGENT: ${CANARY_AWS} and patient Ravi Kumar in ICU`;

    const nanoMalformed = await extractSemanticSecretsWithNano(raw, {
      checkAvailability: async () => "readily",
      callNano: async () => "{not valid json <<<",
    });
    expect(Array.isArray(nanoMalformed.spans)).toBe(true);

    const resThrow = await runTriagePipeline(
      { title: "Chaos Throw", rawText: raw, offlineMode: false, protectionLevel: "high" },
      {
        extractWithNano: async () => {
          throw new Error("Simulated Nano crash");
        },
      },
    );
    expect(resThrow.sanitizedText).not.toContain(CANARY_AWS);
    expect(resThrow.stage1Source).toBe("HEURISTIC_GUARD");

    const brief = await generateSanitizedHybridBrief(resThrow, {
      offlineMode: false,
      deps: {
        callHybridBrief: async () => {
          throw new Error("Model process crashed");
        },
        callCloud: async (sanitizedPrompt) => {
          expect(sanitizedPrompt).not.toContain(CANARY_AWS);
          return { text: "Safe brief", inferenceSource: "IN_CLOUD" };
        },
      },
    });
    expect(brief.stakeholderDraft).toBe("Safe brief");

    // Corrupted ticket payloads must sanitize cleanly without throwing
    expect(sanitizeStoredTicket(null)).toBeNull();
    expect(sanitizeStoredTicket({ id: "", sanitizedText: 123 })).toBeNull();
    const recovered = sanitizeStoredTicket({ id: "t-1", sanitizedText: "[REDACTED:AWS_ACCESS_KEY_1]" });
    expect(recovered?.rawText).toBe("[PURGED_FROM_DISK_FOR_PRIVACY]");
  });
});
