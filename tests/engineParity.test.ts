import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BENIGN, POSITIVES } from "./fixtures/extensionCorpus";
import { runLocalDeterministicScan, mergeSpans } from "../extension/sidepanel/firewall-core.js";
import { scanAndRedactLocal } from "../src/firewall/regexScrubber";

interface Span {
  category: string;
  matchedText: string;
}

function extensionScan(text: string) {
  const spans = runLocalDeterministicScan(text, true, "medium");
  return mergeSpans(text, spans) as { sanitizedText: string; mergedSpans: Span[] };
}

function webScan(text: string) {
  return scanAndRedactLocal(text, {
    includeHeuristics: true,
    enableEntropyScanner: true,
    protectionLevel: "medium",
  }) as { sanitizedText: string; mergedSpans: Span[] };
}

const ENGINES = [
  ["extension", extensionScan],
  ["web", webScan],
] as const;

/**
 * The extension and the web app ship independently, so the same corpus must produce the same
 * decisions in both. The contract is behavioural — the expected category is found, no raw value
 * survives, and the redaction count matches — not the exact span order, which is an
 * implementation detail of each merge.
 */
describe("cross-engine detector parity", () => {
  it("finds the expected category in both engines for every positive sample", () => {
    const misses: string[] = [];
    for (const testCase of POSITIVES) {
      for (const [engine, scan] of ENGINES) {
        const categories = scan(testCase.text).mergedSpans.map((s) => s.category);
        if (!categories.includes(testCase.category)) {
          misses.push(`${engine} ${testCase.id}: expected ${testCase.category}, got ${categories.join("+") || "none"}`);
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it("redacts the same number of spans in both engines", () => {
    const drift: string[] = [];
    for (const testCase of POSITIVES) {
      const ext = extensionScan(testCase.text).mergedSpans.length;
      const web = webScan(testCase.text).mergedSpans.length;
      if (ext !== web) drift.push(`${testCase.id}: extension=${ext} web=${web}`);
    }
    expect(drift).toEqual([]);
  });

  it("leaves every benign sample untouched in both engines", () => {
    const falsePositives: string[] = [];
    for (const text of BENIGN) {
      for (const [engine, scan] of ENGINES) {
        const hit = scan(text).mergedSpans.map((s) => s.category).join("+");
        if (hit) falsePositives.push(`${engine} flagged "${text.slice(0, 50)}" as ${hit}`);
      }
    }
    expect(falsePositives).toEqual([]);
  });

  it("removes the matched value from the output in both engines", () => {
    const leaks: string[] = [];
    for (const testCase of POSITIVES) {
      for (const [engine, scan] of ENGINES) {
        const { sanitizedText, mergedSpans } = scan(testCase.text);
        for (const span of mergedSpans) {
          if (span.matchedText && sanitizedText.includes(span.matchedText)) {
            leaks.push(`${engine} ${testCase.id} still holds ${span.category}`);
          }
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it("is idempotent, so the handoff bridge can re-scrub without changing the payload", () => {
    const drift: string[] = [];
    for (const testCase of POSITIVES) {
      for (const [engine, scan] of ENGINES) {
        const once = scan(testCase.text).sanitizedText;
        const twice = scan(once).sanitizedText;
        if (once !== twice) drift.push(`${engine} ${testCase.id}: second pass changed the text`);
      }
    }
    expect(drift).toEqual([]);
  });

  it("keeps the Android AWS secret rule in step with the JS engines", () => {
    const kotlin = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "android/app/src/main/java/com/localfirst/triage/firewall/LocalFirewallEngine.kt",
      ),
      "utf8",
    );
    // The optional quote covers JSON camelCase ("SecretAccessKey") — the same
    // widening the JS engines needed.
    expect(kotlin).toContain(String.raw`secret[_-]?access[_-]?key\b["']?`);
  });
});
