import { describe, expect, it } from "vitest";
import { BENIGN, POSITIVES } from "./fixtures/extensionCorpus";

interface Firewall {
  scrubSync: (
    text: string,
    includeHeuristics?: boolean,
    level?: string,
  ) => {
    sanitizedText: string;
    mergedSpans: Array<{ category: string; matchedText: string; start: number; end: number }>;
    latencyMs: number;
  };
}

async function loadFirewall(): Promise<Firewall> {
  await import("../extension/sidepanel/firewall-core.js");
  const fw = (globalThis as unknown as { LocalFirstFirewall?: Firewall }).LocalFirstFirewall;
  if (!fw?.scrubSync) throw new Error("extension firewall did not load");
  return fw;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

describe("extension detector benchmark", () => {
  it("recalls every synthetic secret and rejects benign developer text", async () => {
    const fw = await loadFirewall();

    // Warm the JIT so the reported numbers describe steady state, not first-call setup.
    for (let pass = 0; pass < 2; pass += 1) {
      for (const testCase of POSITIVES.slice(0, 12)) fw.scrubSync(testCase.text, true, "medium");
    }

    const misses: string[] = [];
    const categoryMismatch: string[] = [];
    const perCategory = new Map<string, { total: number; hit: number }>();
    const latencies: number[] = [];

    for (const testCase of POSITIVES) {
      const bucket = perCategory.get(testCase.category) ?? { total: 0, hit: 0 };
      bucket.total += 1;

      let scan = fw.scrubSync(testCase.text, true, "medium");
      for (let repeat = 0; repeat < 5; repeat += 1) {
        const started = performance.now();
        scan = fw.scrubSync(testCase.text, true, "medium");
        latencies.push(performance.now() - started);
      }

      const detected = scan.mergedSpans.length > 0;
      if (!detected) {
        misses.push(testCase.id);
      } else {
        bucket.hit += 1;
        if (!scan.mergedSpans.some((span) => span.category === testCase.category)) {
          categoryMismatch.push(
            `${testCase.id}: expected ${testCase.category}, got ${scan.mergedSpans
              .map((span) => span.category)
              .join("+")}`,
          );
        }
        // Zero-PII: the sanitized output must never still hold the matched value.
        for (const span of scan.mergedSpans) {
          if (span.matchedText && scan.sanitizedText.includes(span.matchedText)) {
            misses.push(`${testCase.id}: sanitized output still contains the matched value`);
          }
        }
      }
      perCategory.set(testCase.category, bucket);
    }

    const falsePositives: number[] = [];
    for (const [index, prompt] of BENIGN.entries()) {
      const scan = fw.scrubSync(prompt, true, "medium");
      if (scan.mergedSpans.length > 0) falsePositives.push(index);
    }

    // A realistic long chat message, the size a user actually pastes into a composer.
    const longPrompt = `${BENIGN.join(". ")}. ${POSITIVES[0].text} ${POSITIVES[8].text}`.repeat(3);
    const longSamples: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const started = performance.now();
      fw.scrubSync(longPrompt, true, "medium");
      longSamples.push(performance.now() - started);
    }
    const longSorted = [...longSamples].sort((a, b) => a - b);

    const recall = (POSITIVES.length - misses.length) / POSITIVES.length;
    const fpRate = falsePositives.length / BENIGN.length;
    const sorted = [...latencies].sort((a, b) => a - b);

    const rows = [...perCategory.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, bucket]) => ({
        category,
        cases: bucket.total,
        recall: round((bucket.hit / bucket.total) * 100, 1),
      }));

    // Counts and timings only. The corpus text never reaches the log.
    console.log(`\n=== Cordon extension detector benchmark ===`);
    console.log(`positives=${POSITIVES.length} benign=${BENIGN.length} level=medium`);
    console.log(`recall=${round(recall * 100, 1)}%  falsePositiveRate=${round(fpRate * 100, 1)}%`);
    console.log(
      `short-prompt latency ms (${latencies.length} samples): p50=${round(percentile(sorted, 50))} p95=${round(percentile(sorted, 95))} max=${round(sorted[sorted.length - 1] ?? 0)}`,
    );
    console.log(
      `long-prompt latency ms (${longPrompt.length} chars, 20 samples): p50=${round(percentile(longSorted, 50))} p95=${round(percentile(longSorted, 95))} max=${round(longSorted[longSorted.length - 1] ?? 0)}`,
    );
    console.log("| Category | Cases | Recall |");
    console.log("| --- | --- | --- |");
    for (const row of rows) console.log(`| ${row.category} | ${row.cases} | ${row.recall}% |`);
    if (misses.length) console.log(`misses=${JSON.stringify(misses)}`);
    if (categoryMismatch.length) console.log(`categoryMismatch=${JSON.stringify(categoryMismatch)}`);
    if (falsePositives.length) console.log(`falsePositiveIndices=${JSON.stringify(falsePositives)}`);

    expect(POSITIVES.length).toBeGreaterThanOrEqual(60);
    expect(BENIGN.length).toBeGreaterThanOrEqual(30);
    expect(misses, "every synthetic secret must be detected").toEqual([]);
    expect(categoryMismatch, "each secret must land in its own category").toEqual([]);
    expect(fpRate, "benign developer text must not be flagged").toBeLessThanOrEqual(0.03);
    expect(percentile(sorted, 95), "p95 latency budget").toBeLessThan(25);
    expect(percentile(longSorted, 95), "p95 latency budget on a long prompt").toBeLessThan(50);
  });

  it("keeps recall at low and high dial positions", async () => {
    const fw = await loadFirewall();
    const credentialCases = POSITIVES.filter((testCase) =>
      ["AWS_ACCESS_KEY", "AWS_SECRET_KEY", "API_KEY", "BEARER_OR_JWT", "PEM_PRIVATE_KEY", "DB_CONNECTION_URI", "CREDIT_CARD"].includes(
        testCase.category,
      ),
    );

    for (const level of ["low", "high"]) {
      const misses = credentialCases
        .filter((testCase) => fw.scrubSync(testCase.text, true, level).mergedSpans.length === 0)
        .map((testCase) => testCase.id);
      expect(misses, `credential recall at ${level}`).toEqual([]);
    }
  });
});
