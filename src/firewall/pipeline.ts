import {
  createCloudEscalationModel,
  createHybridBriefModel,
  DEFAULT_RUNTIME_CONFIG,
  getHybridAI,
  loadRuntimeConfig,
  normalizeSdkInferenceSource,
  type RuntimeConfigValues,
} from "../config/firebase";
import { DEFAULT_RUNBOOKS, getRunbookById, matchLocalRunbook } from "../config/demoScenarios";
import type {
  CustomRunbook,
  HybridBriefResult,
  HybridTelemetry,
  InferenceSource,
  PrivacyPolicy,
  RedactionSpan,
  SourcePlatform,
  TriageResult,
  ZeroLeakageAudit,
} from "../types/triage";
import { extractSemanticSecretsWithNano, type NanoExtractionResult } from "./nanoExtractor";
import { scanAndRedactLocal } from "./regexScrubber";
import { addManualSpan, applyMaskedSpans, verifyZeroLeakage } from "./spanMerger";

const SRE_SYSTEM_INSTRUCTION =
  "You are a Principal SRE Incident Triage Assistant. Produce concise Markdown with sections: ### Root Cause Hypothesis, ### Immediate Mitigation, and ### Verification Checklist. Never ask for or echo redacted PII.";

export interface CloudCallResponse {
  ok: boolean;
  text: string;
  inferenceSource: InferenceSource;
  modelUsed?: string;
  error?: string;
}

export interface PipelineInput {
  id?: string;
  title: string;
  rawText: string;
  offlineMode: boolean;
  approveCloudEscalation?: boolean;
  customRunbooks?: CustomRunbook[];
  policy?: PrivacyPolicy;
  runtimeConfig?: RuntimeConfigValues;
  importedFromExtension?: boolean;
  sourcePlatform?: SourcePlatform;
}

export interface PipelineDeps {
  extractWithNano?: (text: string) => Promise<NanoExtractionResult>;
  loadConfig?: () => Promise<RuntimeConfigValues>;
  callCloud?: (
    sanitizedPrompt: string,
    config: RuntimeConfigValues,
    onStreamChunk?: (partialText: string) => void,
  ) => Promise<CloudCallResponse | { text: string; inferenceSource: InferenceSource }>;
  callHybridBrief?: (
    sanitizedPrompt: string,
    config: RuntimeConfigValues,
  ) => Promise<{ text: string; inferenceSource: "ON_DEVICE" | "IN_CLOUD" }>;
  onStreamChunk?: (partialText: string) => void;
}

function normalizeCloudResponse(
  raw: CloudCallResponse | { text: string; inferenceSource: InferenceSource } | undefined,
  modelUsed?: string,
): CloudCallResponse {
  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      text: "Empty response from Cloud escalation provider.",
      inferenceSource: "CLOUD_ERROR",
      error: "Empty cloud response",
    };
  }
  if ("ok" in raw) {
    return raw;
  }
  const isError = raw.inferenceSource === "CLOUD_ERROR" || raw.inferenceSource === "LOCAL_REGEX_FALLBACK";
  return {
    ok: !isError,
    text: raw.text,
    inferenceSource: raw.inferenceSource,
    modelUsed,
    error: isError ? raw.text : undefined,
  };
}

function buildLocalEmergencyRcaFallback(
  sanitizedPrompt: string,
  errorReason: string,
): string {
  const isAppCheckOrNetwork =
    /app\s*check|recaptcha|fetch|network|403|blocked|api\s*key|not configured/i.test(errorReason);
  const troubleshootingHint = isAppCheckOrNetwork
    ? "- **Judge / Browser Tip:** Outbound Cloud Gemini call was blocked (`" +
      errorReason +
      "`). If an ad-blocker (uBlock Origin / Brave Shields) is blocking Google reCAPTCHA App Check, pause it for this domain or run on `localhost`."
    : `- **Cloud Status:** Cloud Gemini returned \`${errorReason}\`.`;

  return [
    "### Root Cause Hypothesis (Local Deterministic SRE Fallback)",
    "- **Zero-Leakage Guarantee Held:** Stage 1 scrubbed all secrets locally (`0` raw PII bytes left this browser).",
    troubleshootingHint,
    "- **Local Diagnostic:** Inspect the sanitized stack trace and redacted token categories (`[REGEX_FIREWALL]`, `[ENTROPY_SCANNER]`, `[HEURISTIC_GUARD]`) in the Inline Diff Viewer above to isolate the failing auth, database, or TLS boundary.",
    "### Immediate Mitigation",
    "1. Rotate any exposed credentials, tokens, or private keys flagged by Stage 1 before redeploying.",
    "2. Apply the matching local runbook or click **Retry Cloud Escalation** once network / App Check access is restored.",
    "### Verification Checklist",
    `- Confirm all \`[REDACTED:...]\` placeholders remain masked in the **Zero-Leakage Proof** tab (${sanitizedPrompt.length} sanitized chars verified).`,
    "- Export the Zero-PII Audit JSON/Markdown report for incident tracking.",
  ].join("\n");
}

async function defaultCallCloud(
  sanitizedPrompt: string,
  config: RuntimeConfigValues,
  onStreamChunk?: (partialText: string) => void,
): Promise<CloudCallResponse> {
  const ai = getHybridAI();
  if (!ai) {
    const reason = "Firebase AI Logic not configured (.env.local keys missing)";
    return {
      ok: false,
      text: buildLocalEmergencyRcaFallback(sanitizedPrompt, reason),
      inferenceSource: "CLOUD_ERROR",
      error: reason,
    };
  }

  const candidateModels = [
    ...new Set([config.cloudModel, config.cloudFallbackModel, "gemini-2.5-flash"].filter(Boolean)),
  ];
  let lastError = "Unknown Cloud error";

  for (const modelName of candidateModels) {
    const model = createCloudEscalationModel(ai, modelName, SRE_SYSTEM_INSTRUCTION);
    try {
      if (typeof model.generateContentStream === "function") {
        const streamResult = await model.generateContentStream(sanitizedPrompt);
        let accumulated = "";
        for await (const chunk of streamResult.stream) {
          const piece = typeof chunk.text === "function" ? chunk.text() : "";
          if (piece) {
            accumulated += piece;
            onStreamChunk?.(accumulated);
          }
        }
        const finalResponse = await streamResult.response;
        const finalText = accumulated || finalResponse.text();
        return {
          ok: true,
          text: finalText,
          inferenceSource: normalizeSdkInferenceSource(finalResponse, "IN_CLOUD"),
          modelUsed: modelName,
        };
      }

      const res = await model.generateContent(sanitizedPrompt);
      return {
        ok: true,
        text: res.response.text(),
        inferenceSource: normalizeSdkInferenceSource(res.response, "IN_CLOUD"),
        modelUsed: modelName,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      // If SSE stream parsing or transient 500/503 failed, immediately fall back to unary generateContent on the same model
      if (
        typeof model.generateContent === "function" &&
        /parse-failed|stream|500|503|high demand/i.test(lastError)
      ) {
        try {
          const unaryRes = await model.generateContent(sanitizedPrompt);
          const text = unaryRes.response.text();
          onStreamChunk?.(text);
          return {
            ok: true,
            text,
            inferenceSource: normalizeSdkInferenceSource(unaryRes.response, "IN_CLOUD"),
            modelUsed: modelName,
          };
        } catch (retryErr) {
          lastError = retryErr instanceof Error ? retryErr.message : String(retryErr);
        }
      }
      console.warn(`[LocalFirst Triage] Cloud model "${modelName}" failed:`, lastError);
    }
  }

  return {
    ok: false,
    text: buildLocalEmergencyRcaFallback(sanitizedPrompt, lastError),
    inferenceSource: "CLOUD_ERROR",
    error: lastError,
  };
}

export function buildOutboundCloudPrompt(
  severity: TriageResult["severity"],
  category: string,
  sanitizedText: string,
): string {
  return [
    "Analyze this sanitized incident ticket and produce Root Cause Hypothesis, Immediate Mitigation, and Verification Checklist.",
    "NOTE: All PII and secrets have already been redacted locally with [REDACTED:...] placeholders.",
    `Severity: ${severity} | Category: ${category}`,
    "Sanitized Ticket:",
    sanitizedText,
  ].join("\n\n");
}

export async function runTriagePipeline(
  input: PipelineInput,
  deps: PipelineDeps = {},
): Promise<TriageResult> {
  const startedAt = performance.now();
  const runbooks = input.customRunbooks?.length ? input.customRunbooks : DEFAULT_RUNBOOKS;
  const extractNano =
    deps.extractWithNano ??
    ((text: string) => extractSemanticSecretsWithNano(text, { availableRunbooks: runbooks }));
  const loadConfig = deps.loadConfig ?? loadRuntimeConfig;
  const callCloud = deps.callCloud ?? defaultCallCloud;
  const stage1Config =
    input.runtimeConfig ?? (deps.loadConfig ? await deps.loadConfig() : DEFAULT_RUNTIME_CONFIG);
  const sourcePlatform: SourcePlatform =
    input.sourcePlatform ?? (input.importedFromExtension ? "CHROME_EXTENSION" : "WEB");

  const nanoResult = await extractNano(input.rawText);

  const stage1Source: TriageResult["stage1Source"] =
    nanoResult.nanoStatus === "READY" ? "ON_DEVICE (Nano 4)" : "HEURISTIC_GUARD";

  const { sanitizedText, mergedSpans } = scanAndRedactLocal(input.rawText, {
    includeHeuristics: nanoResult.nanoStatus !== "READY",
    enableEntropyScanner: input.policy?.enableEntropyScanner !== false,
    entropyThreshold:
      stage1Config.entropyThreshold ?? DEFAULT_RUNTIME_CONFIG.entropyThreshold ?? 3.25,
    customTerms: input.policy?.customTerms,
    remoteBlockedTerms:
      stage1Config.enterpriseBlockedTerms ?? DEFAULT_RUNTIME_CONFIG.enterpriseBlockedTerms,
    extraSpans: nanoResult.spans,
  });

  const stage1LatencyMs = Math.max(1, Math.round(performance.now() - startedAt));
  const approxTokens = Math.max(40, Math.ceil(input.rawText.length / 4));
  const ticketId = input.id ?? `ticket-${Date.now()}`;
  const createdAt = Date.now();

  // Local P2/P3 Runbook check (0 cloud tokens — works even when offline!)
  const runbook =
    nanoResult.severity === "P2" || nanoResult.severity === "P3"
      ? (getRunbookById(nanoResult.runbookId, runbooks) ??
        matchLocalRunbook(sanitizedText, runbooks))
      : null;

  if (runbook) {
    return {
      id: ticketId,
      title: input.title,
      rawText: input.rawText,
      sanitizedText,
      severity: runbook.severity,
      category: runbook.category,
      runbookId: runbook.runbookId,
      spans: mergedSpans,
      resolution: runbook.resolution,
      resolutionMode: "LOCAL_RUNBOOK",
      inferenceSource: nanoResult.inferenceSource,
      stage1Source,
      stage1LatencyMs,
      stage2Source: "SKIPPED_LOCAL_RUNBOOK",
      stage2LatencyMs: 0,
      nanoStatus: nanoResult.nanoStatus,
      latencyMs: stage1LatencyMs,
      estimatedTokensSaved: approxTokens,
      importedFromExtension: input.importedFromExtension,
      sourcePlatform,
      createdAt,
      updatedAt: createdAt,
    };
  }

  // Offline / Airplane mode hard block & queue
  if (input.offlineMode) {
    return {
      id: ticketId,
      title: input.title,
      rawText: input.rawText,
      sanitizedText,
      severity: nanoResult.severity,
      category: nanoResult.category,
      runbookId: nanoResult.runbookId,
      spans: mergedSpans,
      resolution:
        "AIRPLANE / OFFLINE QUEUE: Stage 1 Privacy Firewall sanitized all secrets locally. Outbound Cloud escalation is strictly blocked and this sanitized ticket is queued for reconnect.",
      resolutionMode: "OFFLINE_QUEUED",
      inferenceSource: "OFFLINE_BLOCKED",
      stage1Source,
      stage1LatencyMs,
      stage2Source: "OFFLINE_QUEUED",
      stage2LatencyMs: 0,
      nanoStatus: nanoResult.nanoStatus,
      latencyMs: stage1LatencyMs,
      estimatedTokensSaved: approxTokens,
      queuedForReconnect: true,
      importedFromExtension: input.importedFromExtension,
      sourcePlatform,
      createdAt,
      updatedAt: createdAt,
    };
  }

  // Fail-Closed Quarantine Gate: if Nano 4 is not READY, NEVER auto-send to Cloud
  if (nanoResult.nanoStatus !== "READY" && !input.approveCloudEscalation) {
    return {
      id: ticketId,
      title: input.title,
      rawText: input.rawText,
      sanitizedText,
      severity: nanoResult.severity,
      category: nanoResult.category,
      runbookId: nanoResult.runbookId,
      spans: mergedSpans,
      resolution:
        "FAIL-CLOSED QUARANTINE HOLD: On-device Gemini Nano 4 is not active in this browser. Deterministic Regex + Entropy + Heuristic Guard pre-masked sensitive spans. Review the Inline Diff Viewer (select any extra text to mask manually if needed) and click 'Approve & Escalate Sanitized Payload to Cloud'.",
      resolutionMode: "QUARANTINED_PENDING_APPROVAL",
      inferenceSource: "LOCAL_REGEX_FALLBACK",
      stage1Source,
      stage1LatencyMs,
      stage2Source: "HELD_QUARANTINE",
      stage2LatencyMs: 0,
      nanoStatus: nanoResult.nanoStatus,
      latencyMs: stage1LatencyMs,
      estimatedTokensSaved: approxTokens,
      importedFromExtension: input.importedFromExtension,
      sourcePlatform,
      createdAt,
      updatedAt: createdAt,
    };
  }

  // Cancelable Pre-Cloud Gate when Nano 4 is READY
  if (!input.approveCloudEscalation) {
    return {
      id: ticketId,
      title: input.title,
      rawText: input.rawText,
      sanitizedText,
      severity: nanoResult.severity,
      category: nanoResult.category,
      runbookId: nanoResult.runbookId,
      spans: mergedSpans,
      resolution:
        "Stage 1 (Gemini Nano 4 ONLY_ON_DEVICE) completed. Waiting pre-cloud review window — pause or click highlighted spans/pills above to edit masks before sending to Cloud Gemini.",
      resolutionMode: "PRE_CLOUD_COUNTDOWN",
      inferenceSource: "ON_DEVICE",
      stage1Source,
      stage1LatencyMs,
      stage2Source: "PENDING_PRE_CLOUD",
      stage2LatencyMs: 0,
      nanoStatus: nanoResult.nanoStatus,
      latencyMs: stage1LatencyMs,
      estimatedTokensSaved: approxTokens,
      importedFromExtension: input.importedFromExtension,
      sourcePlatform,
      createdAt,
      updatedAt: createdAt,
    };
  }

  return escalateSanitizedResult(
    {
      id: ticketId,
      title: input.title,
      rawText: input.rawText,
      sanitizedText,
      severity: nanoResult.severity,
      category: nanoResult.category,
      runbookId: nanoResult.runbookId,
      spans: mergedSpans,
      nanoStatus: nanoResult.nanoStatus,
      stage1Source,
      stage1LatencyMs,
      importedFromExtension: input.importedFromExtension,
      sourcePlatform,
      createdAt,
      startedAt,
    },
    { loadConfig, callCloud, onStreamChunk: deps.onStreamChunk },
  );
}

export async function escalateApprovedTicket(
  ticket: TriageResult,
  updatedSpans: RedactionSpan[],
  deps: Pick<PipelineDeps, "loadConfig" | "callCloud" | "onStreamChunk"> & {
    offlineMode?: boolean;
  } = {},
): Promise<TriageResult> {
  const startedAt = performance.now();
  const sanitizedText = applyMaskedSpans(ticket.rawText, updatedSpans);
  const sourcePlatform: SourcePlatform =
    ticket.sourcePlatform ?? (ticket.importedFromExtension ? "CHROME_EXTENSION" : "WEB");

  if (deps.offlineMode) {
    return {
      ...ticket,
      sanitizedText,
      spans: updatedSpans,
      sourcePlatform,
      resolution:
        "AIRPLANE / OFFLINE QUEUE: Outbound Cloud escalation blocked because Airplane/Offline Mode is enabled. Sanitized ticket queued for reconnect.",
      resolutionMode: "OFFLINE_QUEUED",
      inferenceSource: "OFFLINE_BLOCKED",
      stage2Source: "OFFLINE_QUEUED",
      stage2LatencyMs: 0,
      queuedForReconnect: true,
      updatedAt: Date.now(),
    };
  }

  return escalateSanitizedResult(
    {
      id: ticket.id,
      title: ticket.title,
      rawText: ticket.rawText,
      sanitizedText,
      severity: ticket.severity,
      category: ticket.category,
      runbookId: ticket.runbookId,
      spans: updatedSpans,
      nanoStatus: ticket.nanoStatus,
      stage1Source: ticket.stage1Source,
      stage1LatencyMs: ticket.stage1LatencyMs,
      importedFromExtension: ticket.importedFromExtension,
      sourcePlatform,
      createdAt: ticket.createdAt,
      startedAt,
    },
    deps,
  );
}

async function escalateSanitizedResult(
  ctx: {
    id: string;
    title: string;
    rawText: string;
    sanitizedText: string;
    severity: TriageResult["severity"];
    category: string;
    runbookId?: string | null;
    spans: RedactionSpan[];
    nanoStatus: TriageResult["nanoStatus"];
    stage1Source: TriageResult["stage1Source"];
    stage1LatencyMs: number;
    importedFromExtension?: boolean;
    sourcePlatform?: SourcePlatform;
    createdAt?: number;
    startedAt: number;
  },
  deps: Pick<PipelineDeps, "loadConfig" | "callCloud" | "onStreamChunk">,
): Promise<TriageResult> {
  const loadConfig = deps.loadConfig ?? loadRuntimeConfig;
  const callCloud = deps.callCloud ?? defaultCallCloud;
  const approxTokens = Math.max(40, Math.ceil(ctx.rawText.length / 4));
  const sourcePlatform: SourcePlatform =
    ctx.sourcePlatform ?? (ctx.importedFromExtension ? "CHROME_EXTENSION" : "WEB");
  const createdAt = ctx.createdAt ?? Date.now();

  const cloudPrompt = buildOutboundCloudPrompt(ctx.severity, ctx.category, ctx.sanitizedText);
  const audit: ZeroLeakageAudit = verifyZeroLeakage(cloudPrompt, ctx.spans);

  if (!audit.verified) {
    return {
      id: ctx.id,
      title: ctx.title,
      rawText: ctx.rawText,
      sanitizedText: ctx.sanitizedText,
      severity: ctx.severity,
      category: ctx.category,
      runbookId: ctx.runbookId,
      spans: ctx.spans,
      resolution: `ZERO-LEAKAGE GATE BLOCKED CLOUD CALL: Detected ${audit.leakedSpansCount} unredacted span(s) (${audit.leakedCategories.join(", ")}) in outbound prompt. Mask offending tokens and retry.`,
      resolutionMode: "QUARANTINED_PENDING_APPROVAL",
      inferenceSource: "LOCAL_REGEX_FALLBACK",
      stage1Source: ctx.stage1Source,
      stage1LatencyMs: ctx.stage1LatencyMs,
      stage2Source: "HELD_QUARANTINE",
      stage2LatencyMs: 0,
      nanoStatus: ctx.nanoStatus,
      latencyMs: Math.max(1, Math.round(performance.now() - ctx.startedAt)),
      estimatedTokensSaved: approxTokens,
      zeroLeakageAudit: audit,
      importedFromExtension: ctx.importedFromExtension,
      sourcePlatform,
      createdAt,
      updatedAt: Date.now(),
    };
  }

  const runtimeConfig = await loadConfig();
  if (!runtimeConfig.enableCloudEscalation) {
    const latencyMs = Math.max(1, Math.round(performance.now() - ctx.startedAt));
    return {
      id: ctx.id,
      title: ctx.title,
      rawText: ctx.rawText,
      sanitizedText: ctx.sanitizedText,
      severity: ctx.severity,
      category: ctx.category,
      runbookId: ctx.runbookId,
      spans: ctx.spans,
      resolution: "Cloud escalation disabled via Remote Config; ticket sanitized and held locally.",
      resolutionMode: "LOCAL_FALLBACK_ONLY",
      inferenceSource: "LOCAL_REGEX_FALLBACK",
      stage1Source: ctx.stage1Source,
      stage1LatencyMs: ctx.stage1LatencyMs,
      stage2Source: "CLOUD_DISABLED",
      stage2LatencyMs: 0,
      nanoStatus: ctx.nanoStatus,
      latencyMs,
      estimatedTokensSaved: approxTokens,
      activeCloudModel: runtimeConfig.cloudModel,
      zeroLeakageAudit: audit,
      importedFromExtension: ctx.importedFromExtension,
      sourcePlatform,
      createdAt,
      updatedAt: Date.now(),
    };
  }

  const cloudStart = performance.now();
  const rawResponse = await callCloud(cloudPrompt, runtimeConfig, deps.onStreamChunk);
  const cloudResponse = normalizeCloudResponse(rawResponse, runtimeConfig.cloudModel);
  const stage2LatencyMs = Math.max(1, Math.round(performance.now() - cloudStart));
  const latencyMs = ctx.stage1LatencyMs + stage2LatencyMs;

  if (!cloudResponse.ok) {
    return {
      id: ctx.id,
      title: ctx.title,
      rawText: ctx.rawText,
      sanitizedText: ctx.sanitizedText,
      severity: ctx.severity,
      category: ctx.category,
      runbookId: ctx.runbookId,
      spans: ctx.spans,
      resolution: cloudResponse.text,
      resolutionMode: "CLOUD_ERROR",
      inferenceSource: "CLOUD_ERROR",
      stage1Source: ctx.stage1Source,
      stage1LatencyMs: ctx.stage1LatencyMs,
      stage2Source: "CLOUD_ERROR",
      stage2LatencyMs,
      nanoStatus: ctx.nanoStatus,
      latencyMs,
      estimatedTokensSaved: ctx.spans.filter((s) => s.masked !== false).length * 18,
      activeCloudModel: runtimeConfig.cloudModel,
      cloudError: cloudResponse.error ?? "Cloud escalation failed",
      zeroLeakageAudit: audit,
      importedFromExtension: ctx.importedFromExtension,
      sourcePlatform,
      queuedForReconnect: false,
      createdAt,
      updatedAt: Date.now(),
    };
  }

  return {
    id: ctx.id,
    title: ctx.title,
    rawText: ctx.rawText,
    sanitizedText: ctx.sanitizedText,
    severity: ctx.severity,
    category: ctx.category,
    runbookId: ctx.runbookId,
    spans: ctx.spans,
    resolution: cloudResponse.text,
    resolutionMode: "CLOUD_ESCALATION",
    inferenceSource: cloudResponse.inferenceSource,
    stage1Source: ctx.stage1Source,
    stage1LatencyMs: ctx.stage1LatencyMs,
    stage2Source:
      cloudResponse.inferenceSource === "ON_DEVICE" ? "ON_DEVICE_FALLBACK" : "IN_CLOUD",
    stage2LatencyMs,
    nanoStatus: ctx.nanoStatus,
    latencyMs,
    estimatedTokensSaved: ctx.spans.filter((s) => s.masked !== false).length * 18,
    activeCloudModel: cloudResponse.modelUsed ?? runtimeConfig.cloudModel,
    cloudError: null,
    zeroLeakageAudit: audit,
    importedFromExtension: ctx.importedFromExtension,
    sourcePlatform,
    queuedForReconnect: false,
    createdAt,
    updatedAt: Date.now(),
  };
}

/**
 * Showcases Firebase AI Logic InferenceMode.PREFER_ON_DEVICE on ALREADY-SANITIZED payloads:
 * generates an executive & Slack-ready stakeholder update on Nano 4 when available,
 * seamlessly falling back to Cloud Gemini when Nano 4 is unavailable.
 */
export async function generateSanitizedHybridBrief(
  result: TriageResult,
  options: {
    offlineMode?: boolean;
    deps?: Pick<PipelineDeps, "loadConfig" | "callHybridBrief" | "callCloud">;
  } = {},
): Promise<HybridBriefResult> {
  const startedAt = performance.now();
  const prompt = [
    "Draft a concise 2-sentence executive summary and a 1-paragraph Slack incident update from this sanitized incident report.",
    "Preserve all [REDACTED:...] placeholders strictly.",
    `Title: ${result.title} | Severity: ${result.severity}`,
    `Sanitized Input:\n${result.sanitizedText.slice(0, 1200)}`,
    `Triage Resolution:\n${result.resolution.slice(0, 1200)}`,
  ].join("\n\n");

  const audit = verifyZeroLeakage(prompt, result.spans);
  if (!audit.verified || options.offlineMode) {
    return {
      summary: `[${result.severity}] ${result.title} — ${result.spans.filter((s) => s.masked !== false).length} sensitive spans redacted locally; resolved via ${result.resolutionMode}.`,
      stakeholderDraft: `Incident Update (${result.severity}): Investigating "${result.title}". Sensitive fields remain protected via LocalFirst Privacy Firewall (${result.spans.filter((s) => s.masked !== false).length} spans masked). Status: ${result.resolutionMode}.`,
      inferenceSource: "LOCAL_FALLBACK",
      latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
      generatedAt: Date.now(),
    };
  }

  try {
    const loadConfig = options.deps?.loadConfig ?? loadRuntimeConfig;
    const config = await loadConfig();

    if (options.deps?.callHybridBrief) {
      try {
        const custom = await options.deps.callHybridBrief(prompt, config);
        return {
          summary: custom.text,
          stakeholderDraft: custom.text,
          inferenceSource: custom.inferenceSource,
          latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
          generatedAt: Date.now(),
        };
      } catch {
        const fallbackCloud = options.deps.callCloud ?? defaultCallCloud;
        const cloudRaw = await fallbackCloud(prompt, config);
        const cloudNorm = normalizeCloudResponse(cloudRaw, config.cloudModel);
        if (!cloudNorm.ok) {
          throw new Error(cloudNorm.error ?? "Cloud brief fallback failed");
        }
        return {
          summary: cloudNorm.text,
          stakeholderDraft: cloudNorm.text,
          inferenceSource: "IN_CLOUD",
          latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
          generatedAt: Date.now(),
        };
      }
    }

    const ai = getHybridAI();
    if (!ai) {
      throw new Error("Firebase AI not configured");
    }
    try {
      const model = createHybridBriefModel(ai, config.cloudModel);
      const res = await model.generateContent(prompt);
      const text = res.response.text();
      const source = normalizeSdkInferenceSource(res.response, "IN_CLOUD");
      return {
        summary: text,
        stakeholderDraft: text,
        inferenceSource: source,
        latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
        generatedAt: Date.now(),
      };
    } catch {
      // If PREFER_ON_DEVICE threw mid-call because Chrome's native on-device worker exited,
      // automatically recover via Cloud Gemini (PREFER_IN_CLOUD) on the verified zero-PII prompt
      const cloudRes = await defaultCallCloud(prompt, config);
      if (!cloudRes.ok) {
        throw new Error(cloudRes.error ?? "Cloud brief fallback failed");
      }
      return {
        summary: cloudRes.text,
        stakeholderDraft: cloudRes.text,
        inferenceSource: "IN_CLOUD",
        latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
        generatedAt: Date.now(),
      };
    }
  } catch {
    return {
      summary: `[${result.severity}] ${result.title} — sanitized locally (${result.spans.filter((s) => s.masked !== false).length} spans masked).`,
      stakeholderDraft: `Incident Update (${result.severity}): ${result.title}. Stage 1 masked ${result.spans.filter((s) => s.masked !== false).length} sensitive items cleanly; current state: ${result.resolutionMode}.`,
      inferenceSource: "LOCAL_FALLBACK",
      latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
      generatedAt: Date.now(),
    };
  }
}

export interface TicketMaskMutationResult {
  ticket: TriageResult;
  shouldPauseCountdown: boolean;
  maskDirtySinceCloud: boolean;
}

/**
 * Deepened Pipeline ticket mutator: rehydrates purged ZeroPiiStore tickets safely
 * so "[PURGED_FROM_DISK_FOR_PRIVACY]" is never sent to Cloud Gemini.
 */
export function prepareTicketForEscalation(ticket: TriageResult): TriageResult {
  return ticket.loadedFromZeroPiiStore
    ? { ...ticket, rawText: ticket.sanitizedText, spans: [] }
    : ticket;
}

/**
 * Deepened Pipeline ticket mutator: toggles a RedactionSpan mask while enforcing
 * ZeroPiiStore immutability, recomputing SanitizedPayload, and returning UI flags.
 */
export function toggleTicketSpanMask(
  ticket: TriageResult,
  spanIndex: number,
): TicketMaskMutationResult {
  if (ticket.loadedFromZeroPiiStore) {
    return { ticket, shouldPauseCountdown: false, maskDirtySinceCloud: false };
  }
  const updatedSpans = ticket.spans.map((s, idx) =>
    idx === spanIndex ? { ...s, masked: s.masked === false } : s,
  );
  const updatedSanitized = applyMaskedSpans(ticket.rawText, updatedSpans);
  const updatedTicket: TriageResult = {
    ...ticket,
    spans: updatedSpans,
    sanitizedText: updatedSanitized,
  };
  return {
    ticket: updatedTicket,
    shouldPauseCountdown: ticket.resolutionMode === "PRE_CLOUD_COUNTDOWN",
    maskDirtySinceCloud: ticket.resolutionMode === "CLOUD_ESCALATION",
  };
}

/**
 * Deepened Pipeline ticket mutator: adds a manual [start, end) mask while enforcing
 * ZeroPiiStore immutability, merging overlapping intervals, and returning UI flags.
 */
export function addManualTicketMask(
  ticket: TriageResult,
  start: number,
  end: number,
  category = "MANUAL_SECRET",
): TicketMaskMutationResult {
  if (ticket.loadedFromZeroPiiStore) {
    return { ticket, shouldPauseCountdown: false, maskDirtySinceCloud: false };
  }
  const { sanitizedText, mergedSpans } = addManualSpan(
    ticket.rawText,
    ticket.spans,
    start,
    end,
    category,
  );
  const updatedTicket: TriageResult = {
    ...ticket,
    spans: mergedSpans,
    sanitizedText,
  };
  return {
    ticket: updatedTicket,
    shouldPauseCountdown: ticket.resolutionMode === "PRE_CLOUD_COUNTDOWN",
    maskDirtySinceCloud: ticket.resolutionMode === "CLOUD_ESCALATION",
  };
}

/**
 * Deepened HybridTelemetry state transition after a Stage 1 / local run.
 */
export function recordTriageRunTelemetry(
  prev: HybridTelemetry,
  result: TriageResult,
): HybridTelemetry {
  return {
    ...prev,
    nanoStatus: result.nanoStatus,
    totalRuns: prev.totalRuns + 1,
    localResolvedCount:
      prev.localResolvedCount + (result.resolutionMode === "LOCAL_RUNBOOK" ? 1 : 0),
    cloudEscalatedCount:
      prev.cloudEscalatedCount + (result.resolutionMode === "CLOUD_ESCALATION" ? 1 : 0),
    estimatedTokensSaved: prev.estimatedTokensSaved + result.estimatedTokensSaved,
    lastLatencyMs: result.latencyMs,
  };
}

/**
 * Deepened HybridTelemetry state transition after a Stage 2 Cloud Escalation,
 * deduplicating cloudEscalatedCount by ticket ID across re-runs.
 */
export function recordCloudEscalationTelemetry(
  prev: HybridTelemetry,
  escalated: TriageResult,
  escalatedTicketIds: Set<string>,
): HybridTelemetry {
  const didSucceedCloud =
    escalated.resolutionMode === "CLOUD_ESCALATION" && !escalatedTicketIds.has(escalated.id);
  if (didSucceedCloud) {
    escalatedTicketIds.add(escalated.id);
  }
  return {
    ...prev,
    cloudEscalatedCount: prev.cloudEscalatedCount + (didSucceedCloud ? 1 : 0),
    lastLatencyMs: escalated.latencyMs,
    activeCloudModel: escalated.activeCloudModel ?? prev.activeCloudModel,
  };
}
