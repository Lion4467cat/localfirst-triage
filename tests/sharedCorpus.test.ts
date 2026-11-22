import { describe, expect, it } from "vitest";
import corpus from "./shared-firewall-corpus.json";
import { scanAndRedactLocal } from "../src/firewall/regexScrubber";
import { scrubSync } from "../extension/sidepanel/firewall-core.js";
import type { ProtectionLevel } from "../src/types/triage";

type LevelExpectation = {
  mustNotContain?: string[];
  mustPreserve?: string[];
  expectZeroMasks?: boolean;
};

describe("Shared Adversarial Firewall Corpus (Web + Chrome Extension parity)", () => {
  for (const item of corpus) {
    for (const [levelKey, rule] of Object.entries(item.levels) as Array<
      [ProtectionLevel, LevelExpectation]
    >) {
      it(`[${item.id} @ ${levelKey}] passes Web & Extension engines`, () => {
        const webRes = scanAndRedactLocal(item.input, {
          protectionLevel: levelKey,
          includeHeuristics: true,
        });
        const extRes = scrubSync(item.input, true, levelKey);

        for (const res of [webRes, extRes]) {
          for (const forbidden of rule.mustNotContain ?? []) {
            expect(res.sanitizedText).not.toContain(forbidden);
          }
          for (const preserved of rule.mustPreserve ?? []) {
            expect(res.sanitizedText).toContain(preserved);
          }
          if (rule.expectZeroMasks) {
            expect(res.mergedSpans.length).toBe(0);
          }
        }
      });
    }
  }
});
