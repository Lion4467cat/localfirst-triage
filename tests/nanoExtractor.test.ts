import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildNanoExtractionPrompt,
  checkChromeNanoAvailability,
  chunkText,
  extractSemanticSecretsWithNano,
  parseDefensiveSemanticJson,
  stripStackFrames,
} from "../src/firewall/nanoExtractor";

describe("nanoExtractor", () => {
  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).LanguageModel;
  });

  it("strips pure stack-frame lines while preserving Error: header secrets", () => {
    const withStack = [
      'PostgresError: authentication failed for user "admin" with password "my_dogs_name_2026exclamation" on tenant "Project-Chimera"',
      "    at Connection.parseE (/app/node_modules/pg/lib/connection.js:614:13)",
      "    at Connection.parseMessage (/app/node_modules/pg/lib/connection.js:413:19)",
    ].join("\n");
    const prose = stripStackFrames(withStack);
    expect(prose).not.toContain("Connection.parseE");
    expect(prose).toContain("my_dogs_name_2026exclamation");
    expect(prose).toContain("Project-Chimera");

    const longText = Array.from(
      { length: 120 },
      (_, i) => `Sentence ${i}: normal log event happened here.`,
    ).join(" ");
    const chunks = chunkText(longText, 1400, 120);

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.length <= 1400)).toBe(true);
  });

  it("enforces P0 > P1 > P2 > P3 severity lattice across chunks and suppresses runbookId on P0", async () => {
    const chunk1 = "A".repeat(1450) + ". Password reset question.";
    const chunk2 = "Production database deadlocked and customer payments are throwing HTTP 500!";
    const fullText = `${chunk1}\n${chunk2}`;

    let callCount = 0;
    const result = await extractSemanticSecretsWithNano(fullText, {
      checkAvailability: async () => "readily",
      callNano: async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({ severity: "P3", runbookId: "RB_LOCAL_TLS_CERT", entities: [] });
        }
        return JSON.stringify({ severity: "P0", runbookId: null, entities: [] });
      },
    });

    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(result.severity).toBe("P0");
    expect(result.runbookId).toBeNull();
  });

  it("parses compact { severity, runbookId, entities: [{ type, value }] } JSON even with markdown fences and trailing commas", () => {
    const rawOutput = [
      "Sure! Here is the extracted JSON:",
      "```json",
      '{"severity":"P2","runbookId":"RB_OAUTH_CLOCK_SKEW","entities":[{"type":"CONTEXTUAL_PHI","value":"Manipal ICU Floor 3",},],}',
      "```",
    ].join("\n");

    const parsed = parseDefensiveSemanticJson(rawOutput);
    expect(parsed.severity).toBe("P2");
    expect(parsed.runbookId).toBe("RB_OAUTH_CLOCK_SKEW");
    expect(parsed.entities).toEqual([{ phrase: "Manipal ICU Floor 3", category: "CONTEXTUAL_PHI" }]);

    const nullStr = parseDefensiveSemanticJson('{"severity":"P3","runbookId":"null","entities":[]}');
    expect(nullStr.runbookId).toBeNull();
  });

  it("enforces per-chunk timeout and returns UNAVAILABLE without throwing when Nano 4 hangs", async () => {
    const hangingCaller = vi.fn(
      () =>
        new Promise<string>(() => {
          // intentionally never resolves
        }),
    );

    const result = await extractSemanticSecretsWithNano("Some secret text", {
      timeoutMs: 30,
      callNano: hangingCaller,
      checkAvailability: async () => "readily",
    });

    expect(result.nanoStatus).toBe("UNAVAILABLE");
    expect(result.spans).toEqual([]);
  });

  it("surfaces MODEL_DOWNLOADING and triggers background download when Chrome reports after-download", async () => {
    const triggerDownload = vi.fn();
    const result = await extractSemanticSecretsWithNano("Some text", {
      checkAvailability: async () => "after-download",
      triggerDownload,
    });

    expect(result.nanoStatus).toBe("MODEL_DOWNLOADING");
    expect(triggerDownload).toHaveBeenCalledTimes(1);
    expect(result.spans).toEqual([]);
  });

  it("surfaces DOWNLOADABLE without triggering un-gestured download and passes text-only expectedInputs to availability", async () => {
    const availSpy = vi.fn(async () => "downloadable");
    (globalThis as unknown as Record<string, unknown>).LanguageModel = {
      availability: availSpy,
    };

    const avail = await checkChromeNanoAvailability();
    expect(avail).toBe("downloadable");
    expect(availSpy).toHaveBeenCalledWith({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    });

    const triggerDownload = vi.fn();
    const extracted = await extractSemanticSecretsWithNano("Some text", { triggerDownload });
    expect(extracted.nanoStatus).toBe("DOWNLOADABLE");
    expect(triggerDownload).not.toHaveBeenCalled();
  });

  it("injects valid runbookIds into Nano extraction prompt dynamically", () => {
    const prompt = buildNanoExtractionPrompt("Sample chunk", [
      {
        id: "RB_CUSTOM_TEST",
        title: "Custom Test Runbook",
        category: "CUSTOM_TEST",
        severity: "P2",
        keywords: ["custom"],
        resolution: "Do X",
      },
    ]);
    expect(prompt).toContain("RB_CUSTOM_TEST (P2): Custom Test Runbook");
  });

  it("handles malformed Nano JSON gracefully without throwing", async () => {
    const res = await extractSemanticSecretsWithNano("Normal ticket text", {
      checkAvailability: async () => "readily",
      callNano: async () => "Sorry, I cannot output JSON here {{{ broken",
    });
    expect(res.nanoStatus).toBe("READY");
    expect(res.spans).toEqual([]);
    expect(res.severity).toBe("P2");
  });

  it("caps on-device Nano 4 invocations to maxChunks on massive 50KB+ stack traces without stalling", async () => {
    const hugeTrace = Array.from(
      { length: 900 },
      (_, i) => `Log line ${i}: service check event with payload marker ${i}.`,
    ).join("\n");
    expect(hugeTrace.length).toBeGreaterThan(50_000);

    const callNano = vi.fn(async () =>
      JSON.stringify({ severity: "P1", runbookId: null, entities: [] }),
    );

    const res = await extractSemanticSecretsWithNano(hugeTrace, {
      checkAvailability: async () => "readily",
      callNano,
      maxChunks: 6,
    });

    expect(res.nanoStatus).toBe("READY");
    expect(res.severity).toBe("P1");
    expect(callNano).toHaveBeenCalledTimes(6);
  });
});
