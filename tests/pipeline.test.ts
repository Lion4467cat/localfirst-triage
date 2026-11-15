import { describe, it, expect, vi } from "vitest";
import { escalateApprovedTicket, runTriagePipeline } from "../src/firewall/pipeline";

describe("pipeline", () => {
  it("resolves P2/P3 local runbook tickets via runbookId entirely on-device with zero cloud calls", async () => {
    const cloudCaller = vi.fn();
    const raw =
      "User bob@acme.org cannot log in because local TLS cert expired on dev workstation. Error: CERT_HAS_EXPIRED.";

    const result = await runTriagePipeline(
      { id: "t-1", title: "Local TLS cert expired", rawText: raw, offlineMode: false },
      {
        callCloud: cloudCaller,
        extractWithNano: async () => ({
          nanoStatus: "READY",
          inferenceSource: "ON_DEVICE",
          severity: "P3",
          runbookId: "RB_LOCAL_TLS_CERT",
          category: "RB_LOCAL_TLS_CERT",
          spans: [],
        }),
        loadConfig: async () => ({
          cloudModel: "gemini-3.8-flash",
          cloudFallbackModel: "gemini-3.5-flash-lite",
          enableCloudEscalation: true,
        }),
      },
    );

    expect(cloudCaller).not.toHaveBeenCalled();
    expect(result.resolutionMode).toBe("LOCAL_RUNBOOK");
    expect(result.inferenceSource).toBe("ON_DEVICE");
    expect(result.sanitizedText).not.toContain("bob@acme.org");
    expect(result.estimatedTokensSaved).toBeGreaterThan(0);
  });

  it("fails closed into QUARANTINED_PENDING_APPROVAL when Nano 4 is UNAVAILABLE on P0/P1", async () => {
    const cloudCaller = vi.fn(async () => ({
      text: "Mitigate P0 incident.",
      inferenceSource: "IN_CLOUD" as const,
    }));
    const raw =
      "P0 Outage: Customer admitted to Manipal ICU Floor 3. Project-Chimera $42M valuation exposed.";

    const quarantined = await runTriagePipeline(
      { id: "t-q1", title: "Quarantined P0", rawText: raw, offlineMode: false },
      {
        callCloud: cloudCaller,
        extractWithNano: async () => ({
          nanoStatus: "UNAVAILABLE",
          inferenceSource: "LOCAL_REGEX_FALLBACK",
          severity: "P0",
          runbookId: null,
          category: "GENERAL_INCIDENT",
          spans: [],
        }),
        loadConfig: async () => ({
          cloudModel: "gemini-3.8-flash",
          cloudFallbackModel: "gemini-3.5-flash-lite",
          enableCloudEscalation: true,
        }),
      },
    );

    expect(cloudCaller).not.toHaveBeenCalled();
    expect(quarantined.resolutionMode).toBe("QUARANTINED_PENDING_APPROVAL");
    expect(quarantined.sanitizedText).not.toContain("Manipal ICU Floor 3");
    expect(quarantined.sanitizedText).not.toContain("$42M valuation");

    const escalated = await escalateApprovedTicket(quarantined, quarantined.spans, {
      callCloud: cloudCaller,
      loadConfig: async () => ({
        cloudModel: "gemini-3.8-flash",
        cloudFallbackModel: "gemini-3.5-flash-lite",
        enableCloudEscalation: true,
      }),
    });

    expect(cloudCaller).toHaveBeenCalledTimes(1);
    expect(escalated.resolutionMode).toBe("CLOUD_ESCALATION");
    expect(escalated.inferenceSource).toBe("IN_CLOUD");
  });

  it("blocks cloud calls in Airplane/Offline mode and degrades gracefully", async () => {
    const cloudCaller = vi.fn();
    const raw = "P0 Database outage after deploy with key sk-proj-abcdefghijklmnopqrstuvwxyz123456.";

    const result = await runTriagePipeline(
      { id: "t-3", title: "Offline P0", rawText: raw, offlineMode: true },
      {
        callCloud: cloudCaller,
        extractWithNano: async () => ({
          nanoStatus: "UNAVAILABLE",
          inferenceSource: "LOCAL_REGEX_FALLBACK",
          severity: "P0",
          runbookId: null,
          category: "OUTAGE",
          spans: [],
        }),
        loadConfig: async () => ({
          cloudModel: "gemini-3.8-flash",
          cloudFallbackModel: "gemini-3.5-flash-lite",
          enableCloudEscalation: true,
        }),
      },
    );

    expect(cloudCaller).not.toHaveBeenCalled();
    expect(result.inferenceSource).toBe("OFFLINE_BLOCKED");
    expect(result.sanitizedText).not.toContain("sk-proj-");
  });
});
