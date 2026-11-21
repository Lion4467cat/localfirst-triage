import { describe, it, expect, vi } from "vitest";
import {
  addManualTicketMask,
  escalateApprovedTicket,
  generateSanitizedHybridBrief,
  prepareTicketForEscalation,
  recordCloudEscalationTelemetry,
  recordTriageRunTelemetry,
  runTriagePipeline,
  toggleTicketSpanMask,
} from "../src/firewall/pipeline";
import type { CustomRunbook, HybridTelemetry } from "../src/types/triage";

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
      ok: true,
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
    expect(escalated.zeroLeakageAudit?.verified).toBe(true);
  });

  it("blocks cloud calls in Airplane/Offline mode and queues sanitized ticket for reconnect", async () => {
    const cloudCaller = vi.fn();
    const raw =
      "P0 Database outage after deploy with key sk-proj-abcdefghijklmnopqrstuvwxyz123456.";

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
    expect(result.resolutionMode).toBe("OFFLINE_QUEUED");
    expect(result.queuedForReconnect).toBe(true);
    expect(result.sanitizedText).not.toContain("sk-proj-");

    // Also verify escalateApprovedTicket honors offlineMode even if invoked on quarantined ticket
    const blockedRetry = await escalateApprovedTicket(result, result.spans, {
      offlineMode: true,
      callCloud: cloudCaller,
    });
    expect(cloudCaller).not.toHaveBeenCalled();
    expect(blockedRetry.resolutionMode).toBe("OFFLINE_QUEUED");
  });

  it("truthfully reports CLOUD_ERROR instead of OFFLINE_BLOCKED when cloud escalation fails", async () => {
    const cloudCaller = vi.fn(async () => ({
      ok: false,
      text: "Cloud error: 403 App Check token rejected.",
      inferenceSource: "CLOUD_ERROR" as const,
      error: "403 App Check token rejected",
    }));

    const res = await runTriagePipeline(
      {
        id: "t-err",
        title: "Cloud Error Test",
        rawText: "P0 Outage with token ghp_1234567890abcdefghijklmnopqrstuvwxyz",
        offlineMode: false,
        approveCloudEscalation: true,
      },
      {
        callCloud: cloudCaller,
        extractWithNano: async () => ({
          nanoStatus: "READY",
          inferenceSource: "ON_DEVICE",
          severity: "P0",
          runbookId: null,
          category: "OUTAGE",
          spans: [],
        }),
        loadConfig: async () => ({
          cloudModel: "gemini-3.5-flash-lite",
          cloudFallbackModel: "gemini-3.8-flash",
          enableCloudEscalation: true,
        }),
      },
    );

    expect(res.resolutionMode).toBe("CLOUD_ERROR");
    expect(res.stage2Source).toBe("CLOUD_ERROR");
    expect(res.inferenceSource).toBe("CLOUD_ERROR");
    expect(res.cloudError).toContain("403");
  });

  it("aborts Stage 2 cloud call via Zero-Leakage Gate if a masked secret remains unredacted", async () => {
    const cloudCaller = vi.fn();
    const ticket = await runTriagePipeline(
      {
        id: "t-leak",
        title: "Leak Gate Test",
        rawText: "P0 outage with key AIzaSyD-1234567890abcdefghijklmnopqrs",
        offlineMode: false,
      },
      {
        extractWithNano: async () => ({
          nanoStatus: "UNAVAILABLE",
          inferenceSource: "LOCAL_REGEX_FALLBACK",
          severity: "P0",
          runbookId: null,
          category: "OUTAGE",
          spans: [],
        }),
      },
    );

    // Simulate a corrupted/skipped span replacement so raw API key stays in sanitizedText
    const brokenSpans = ticket.spans.map((s) => ({ ...s, start: -1, end: -1 }));
    const blocked = await escalateApprovedTicket(ticket, brokenSpans, {
      callCloud: cloudCaller,
    });

    expect(cloudCaller).not.toHaveBeenCalled();
    expect(blocked.resolutionMode).toBe("QUARANTINED_PENDING_APPROVAL");
    expect(blocked.zeroLeakageAudit?.verified).toBe(false);
    expect(blocked.zeroLeakageAudit?.leakedSpansCount).toBeGreaterThan(0);
  });

  it("streams Cloud RCA chunks via onStreamChunk and enforces PRE_CLOUD_COUNTDOWN when Nano 4 is READY", async () => {
    const countdown = await runTriagePipeline(
      {
        id: "t-ready-p0",
        title: "Ready Nano P0",
        rawText: "P0 outage in checkout",
        offlineMode: false,
      },
      {
        extractWithNano: async () => ({
          nanoStatus: "READY",
          inferenceSource: "ON_DEVICE",
          severity: "P0",
          runbookId: null,
          category: "OUTAGE",
          spans: [],
        }),
      },
    );
    expect(countdown.resolutionMode).toBe("PRE_CLOUD_COUNTDOWN");

    const streamedChunks: string[] = [];
    const escalated = await escalateApprovedTicket(countdown, countdown.spans, {
      onStreamChunk: (partial) => streamedChunks.push(partial),
      callCloud: async (_prompt, _cfg, onChunk) => {
        onChunk?.("### Root Cause\n");
        onChunk?.("### Root Cause\nConnection pool saturated.");
        return {
          ok: true,
          text: "### Root Cause\nConnection pool saturated.",
          inferenceSource: "IN_CLOUD" as const,
          modelUsed: "gemini-3.5-flash-lite",
        };
      },
      loadConfig: async () => ({
        cloudModel: "gemini-3.5-flash-lite",
        cloudFallbackModel: "gemini-3.8-flash",
        enableCloudEscalation: true,
      }),
    });

    expect(streamedChunks).toHaveLength(2);
    expect(escalated.resolutionMode).toBe("CLOUD_ESCALATION");
    expect(escalated.activeCloudModel).toBe("gemini-3.5-flash-lite");
  });

  it("resolves user-created custom runbooks on-device and supports PREFER_ON_DEVICE hybrid brief", async () => {
    const customRunbooks: CustomRunbook[] = [
      {
        id: "RB_VPN_SPLIT_DNS",
        title: "Corp VPN Split DNS Loop",
        category: "VPN_DNS",
        severity: "P3",
        keywords: ["split-dns", "vpn_dns_timeout"],
        resolution: "Flush systemd-resolved cache and reconnect WireGuard.",
      },
    ];

    const res = await runTriagePipeline(
      {
        id: "t-custom-rb",
        title: "VPN DNS",
        rawText: "Developer hitting vpn_dns_timeout on macOS.",
        offlineMode: true,
        customRunbooks,
      },
      {
        extractWithNano: async () => ({
          nanoStatus: "UNAVAILABLE",
          inferenceSource: "LOCAL_REGEX_FALLBACK",
          severity: "P3",
          runbookId: null,
          category: "GENERAL_INCIDENT",
          spans: [],
        }),
      },
    );

    expect(res.resolutionMode).toBe("LOCAL_RUNBOOK");
    expect(res.runbookId).toBe("RB_VPN_SPLIT_DNS");

    const brief = await generateSanitizedHybridBrief(res, {
      offlineMode: false,
      deps: {
        loadConfig: async () => ({
          cloudModel: "gemini-3.5-flash-lite",
          cloudFallbackModel: "gemini-3.8-flash",
          enableCloudEscalation: true,
        }),
        callHybridBrief: async () => ({
          text: "On-device brief generated cleanly.",
          inferenceSource: "ON_DEVICE",
        }),
      },
    });
    expect(brief.inferenceSource).toBe("ON_DEVICE");
    expect(brief.stakeholderDraft).toContain("On-device brief generated cleanly.");

    const offlineBrief = await generateSanitizedHybridBrief(res, { offlineMode: true });
    expect(offlineBrief.inferenceSource).toBe("LOCAL_FALLBACK");
    expect(offlineBrief.stakeholderDraft).toContain("LocalFirst Privacy Firewall");
  });

  it("deepens ticket span mutation (toggleTicketSpanMask, addManualTicketMask, prepareTicketForEscalation) and blocks ZeroPiiStore unmasking", async () => {
    const ticket = await runTriagePipeline(
      {
        id: "t-mut",
        title: "Mutation Seam Test",
        rawText: "Contact alice.ops@example.com about SecretCodenameX.",
        offlineMode: false,
      },
      {
        extractWithNano: async () => ({
          nanoStatus: "UNAVAILABLE",
          inferenceSource: "LOCAL_REGEX_FALLBACK",
          severity: "P1",
          runbookId: null,
          category: "GENERAL_INCIDENT",
          spans: [],
        }),
      },
    );

    const toggled = toggleTicketSpanMask({ ...ticket, resolutionMode: "CLOUD_ESCALATION" }, 0);
    expect(toggled.ticket.sanitizedText).toContain("alice.ops@example.com");
    expect(toggled.maskDirtySinceCloud).toBe(true);

    const startIdx = ticket.rawText.indexOf("SecretCodenameX");
    const manual = addManualTicketMask(
      { ...ticket, resolutionMode: "PRE_CLOUD_COUNTDOWN" },
      startIdx,
      startIdx + "SecretCodenameX".length,
    );
    expect(manual.ticket.sanitizedText).toContain("[REDACTED:MANUAL_SECRET_1]");
    expect(manual.shouldPauseCountdown).toBe(true);

    // Purged ZeroPiiStore record must be immutable against unmasking and rehydrate from sanitizedText
    const purged = {
      ...ticket,
      rawText: "[PURGED_FROM_DISK_FOR_PRIVACY]",
      loadedFromZeroPiiStore: true,
    };
    expect(toggleTicketSpanMask(purged, 0).ticket).toBe(purged);
    expect(addManualTicketMask(purged, 0, 5).ticket).toBe(purged);
    const prepared = prepareTicketForEscalation(purged);
    expect(prepared.rawText).toBe(ticket.sanitizedText);
    expect(prepared.spans).toEqual([]);
  });

  it("deepens telemetry transitions (recordTriageRunTelemetry & recordCloudEscalationTelemetry) with deduplicated escalation counting", async () => {
    const baseTelemetry: HybridTelemetry = {
      nanoStatus: "UNAVAILABLE",
      totalRuns: 0,
      localResolvedCount: 0,
      cloudEscalatedCount: 0,
      estimatedTokensSaved: 0,
      lastLatencyMs: 0,
      offlineMode: false,
      browserOnline: true,
      activeCloudModel: "gemini-3.5-flash-lite",
      remoteConfigStatus: "LOADED",
      appCheckProvider: "RECAPTCHA_ENTERPRISE",
      downloadProgress: null,
      queuedOfflineCount: 0,
    };

    const p3Result = await runTriagePipeline({
      id: "t-tel-1",
      title: "TLS",
      rawText: "CERT_HAS_EXPIRED on localhost",
      offlineMode: true,
    });
    const afterRun = recordTriageRunTelemetry(baseTelemetry, p3Result);
    expect(afterRun.totalRuns).toBe(1);
    expect(afterRun.localResolvedCount).toBe(1);
    expect(afterRun.estimatedTokensSaved).toBeGreaterThan(0);

    const escalatedIds = new Set<string>();
    const cloudResult = {
      ...p3Result,
      id: "t-cloud-1",
      resolutionMode: "CLOUD_ESCALATION" as const,
      activeCloudModel: "gemini-3.8-flash",
      latencyMs: 420,
    };
    const firstEsc = recordCloudEscalationTelemetry(afterRun, cloudResult, escalatedIds);
    expect(firstEsc.cloudEscalatedCount).toBe(1);
    expect(firstEsc.activeCloudModel).toBe("gemini-3.8-flash");

    // Re-running cloud escalation on the same ticket ID must not double-count cloudEscalatedCount
    const secondEsc = recordCloudEscalationTelemetry(firstEsc, cloudResult, escalatedIds);
    expect(secondEsc.cloudEscalatedCount).toBe(1);
  });
});
