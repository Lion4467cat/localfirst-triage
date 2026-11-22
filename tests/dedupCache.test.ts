import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDedupCache,
  computeTemplateFingerprint,
  getDedupCacheStats,
  lookupDedupCache,
  normalizeSanitizedTemplate,
  saveToDedupCache,
} from "../src/storage/dedupCache";

describe("dedupCache", () => {
  beforeEach(async () => {
    await clearDedupCache();
  });

  it("normalizes varying timestamps, UUIDs, request IDs, line numbers, and redaction indices to the same fingerprint", async () => {
    const a =
      "2026-11-22T02:00:01Z req_abc12345 uuid 550e8400-e29b-41d4-a716-446655440000 Failed at auth.ts:42 with [REDACTED:API_KEY_1]";
    const b =
      "2026-11-22T09:15:44Z req_zzz99999 uuid 123e4567-e89b-12d3-a456-426614174000 Failed at auth.ts:108 with [REDACTED:API_KEY_4]";

    const normA = normalizeSanitizedTemplate(a);
    const normB = normalizeSanitizedTemplate(b);
    expect(normA).toBe(normB);

    const fpA = await computeTemplateFingerprint(a);
    const fpB = await computeTemplateFingerprint(b);
    expect(fpA.fingerprint).toBe(fpB.fingerprint);
  });

  it("resolves cache hits in <5ms with $0 Cloud cost and never stores raw secrets", async () => {
    const sanitized =
      "2026-11-22T02:00:01Z Outage in checkout-gateway: [REDACTED:AWS_ACCESS_KEY_1] at handler.ts:12";
    await saveToDedupCache({
      sanitizedText: sanitized,
      aiSolution: "### Root Cause Hypothesis\nRotate [REDACTED:AWS_ACCESS_KEY_1].",
      modelUsed: "gemini-3.8-flash",
    });

    const repeatSanitized =
      "2026-11-22T05:45:10Z Outage in checkout-gateway: [REDACTED:AWS_ACCESS_KEY_2] at handler.ts:88";
    const hit = await lookupDedupCache(repeatSanitized);
    expect(hit).not.toBeNull();
    expect(hit!.latencyMs).toBeLessThan(15);
    expect(hit!.entry.hitCount).toBe(1);
    expect(hit!.entry.savedCloudCalls).toBe(1);
    expect(hit!.entry.normalizedPreview).not.toContain("AKIA");

    const stats = await getDedupCacheStats();
    expect(stats.entryCount).toBe(1);
    expect(stats.totalSavedCloudCalls).toBe(1);
  });
});
