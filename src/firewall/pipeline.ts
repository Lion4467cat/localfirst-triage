import { getGenerativeModel, InferenceMode } from "firebase/ai";
import { getHybridAI, loadRuntimeConfig, type RuntimeConfigValues } from "../config/firebase";
import { getRunbookById, matchLocalRunbook } from "../config/demoScenarios";
import type { InferenceSource, RedactionSpan, TriageResult } from "../types/triage";
import { extractSemanticSecretsWithNano, type NanoExtractionResult } from "./nanoExtractor";
import { detectContextualHeuristicSpans, detectRegexSpans } from "./regexScrubber";
import { applyMaskedSpans, mergeAndRedactSpans } from "./spanMerger";

export interface PipelineInput {
  id?: string;
  title: string;
  rawText: string;
  offlineMode: boolean;
  approveCloudEscalation?: boolean;
}

export interface PipelineDeps {
  extractWithNano?: (text: string) => Promise<NanoExtractionResult>;
  loadConfig?: () => Promise<RuntimeConfigValues>;
  callCloud?: (
    sanitizedPrompt: string,
    config: RuntimeConfigValues,
  ) => Promise<{ text: string; inferenceSource: InferenceSource }>;
}

async function defaultCallCloud(
  sanitizedPrompt: string,
  config: RuntimeConfigValues,
): Promise<{ text: string; inferenceSource: InferenceSource }> {
  const ai = getHybridAI();
  if (!ai) {
    return {
      text: "Cloud Firebase AI is not configured yet (add .env.local keys to enable live Gemini escalation). Sanitized payload remained 100% protected locally.",
      inferenceSource: "LOCAL_REGEX_FALLBACK",
    };
  }

  const candidateModels = [config.cloudModel, config.cloudFallbackModel].filter(Boolean);
  for (const modelName of candidateModels) {
    try {
      const model = getGenerativeModel(ai, {
        model: modelName,
        mode: InferenceMode.PREFER_IN_CLOUD,
      });
      const res = await model.generateContent(sanitizedPrompt);
      const source =
        (res.response as unknown as { inferenceSource?: string })?.inferenceSource === "ON_DEVICE"
          ? "ON_DEVICE"
          : "IN_CLOUD";
      return { text: res.response.text(), inferenceSource: source };
    } catch {
      // Try fallback model
    }
  }

  return {
    text: "Cloud model unavailable or rate-limited; sanitized ticket queued locally with zero raw PII exposed.",
    inferenceSource: "LOCAL_REGEX_FALLBACK",
  };
}

export async function runTriagePipeline(
  input: PipelineInput,
  deps: PipelineDeps = {},
): Promise<TriageResult> {
  const startedAt = performance.now();
  const extractNano = deps.extractWithNano ?? extractSemanticSecretsWithNano;
  const loadConfig = deps.loadConfig ?? loadRuntimeConfig;
  const callCloud = deps.callCloud ?? defaultCallCloud;

  const regexSpans = detectRegexSpans(input.rawText);
  const nanoResult = await extractNano(input.rawText);

  const stage1Source: TriageResult["stage1Source"] =
    nanoResult.nanoStatus === "READY" ? "ON_DEVICE (Nano 4)" : "HEURISTIC_GUARD";

  const heuristicSpans =
    nanoResult.nanoStatus === "READY" ? [] : detectContextualHeuristicSpans(input.rawText);

  const { sanitizedText, mergedSpans } = mergeAndRedactSpans(input.rawText, [
    ...regexSpans,
    ...heuristicSpans,
    ...nanoResult.spans,
  ]);

  const stage1LatencyMs = Math.max(1, Math.round(performance.now() - startedAt));
  const approxTokens = Math.max(40, Math.ceil(input.rawText.length / 4));

  // Local P2/P3 Runbook check (0 cloud tokens)
  const runbook =
    nanoResult.severity === "P2" || nanoResult.severity === "P3"
      ? (getRunbookById(nanoResult.runbookId) ?? matchLocalRunbook(sanitizedText))
      : null;

  if (runbook) {
    return {
      id: input.id ?? `ticket-${Date.now()}`,
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
      createdAt: Date.now(),
    };
  }

  // Offline / Airplane mode hard block
  if (input.offlineMode) {
    return {
      id: input.id ?? `ticket-${Date.now()}`,
      title: input.title,
      rawText: input.rawText,
      sanitizedText,
      severity: nanoResult.severity,
      category: nanoResult.category,
      runbookId: nanoResult.runbookId,
      spans: mergedSpans,
      resolution:
        "AIRPLANE / OFFLINE MODE ACTIVE: Stage 1 Privacy Firewall sanitized all secrets locally. Cloud escalation was strictly blocked; ticket is queued safely for when connectivity returns.",
      resolutionMode: "LOCAL_FALLBACK_ONLY",
      inferenceSource: "OFFLINE_BLOCKED",
      stage1Source,
      stage1LatencyMs,
      stage2Source: "OFFLINE_BLOCKED",
      stage2LatencyMs: 0,
      nanoStatus: nanoResult.nanoStatus,
      latencyMs: stage1LatencyMs,
      estimatedTokensSaved: approxTokens,
      createdAt: Date.now(),
    };
  }

  // Fail-Closed Quarantine Gate: if Nano 4 is UNAVAILABLE or MODEL_DOWNLOADING, NEVER auto-send to Cloud
  if (nanoResult.nanoStatus !== "READY" && !input.approveCloudEscalation) {
    return {
      id: input.id ?? `ticket-${Date.now()}`,
      title: input.title,
      rawText: input.rawText,
      sanitizedText,
      severity: nanoResult.severity,
      category: nanoResult.category,
      runbookId: nanoResult.runbookId,
      spans: mergedSpans,
      resolution:
        "FAIL-CLOSED QUARANTINE HOLD: On-device Gemini Nano 4 is unavailable in this browser. Regex + Heuristic Guard pre-masked sensitive tokens, and Cloud escalation is HELD until you review the Diff Viewer and click 'Approve & Escalate Sanitized Payload to Cloud'.",
      resolutionMode: "QUARANTINED_PENDING_APPROVAL",
      inferenceSource: "LOCAL_REGEX_FALLBACK",
      stage1Source,
      stage1LatencyMs,
      stage2Source: "HELD_QUARANTINE",
      stage2LatencyMs: 0,
      nanoStatus: nanoResult.nanoStatus,
      latencyMs: stage1LatencyMs,
      estimatedTokensSaved: approxTokens,
      createdAt: Date.now(),
    };
  }

  // Cancelable Pre-Cloud Gate when Nano 4 is READY (unless approveCloudEscalation is explicitly true)
  if (!input.approveCloudEscalation) {
    return {
      id: input.id ?? `ticket-${Date.now()}`,
      title: input.title,
      rawText: input.rawText,
      sanitizedText,
      severity: nanoResult.severity,
      category: nanoResult.category,
      runbookId: nanoResult.runbookId,
      spans: mergedSpans,
      resolution:
        "Stage 1 (Gemini Nano 4 ON_DEVICE) completed. Waiting 3.0s pre-cloud review window — pause or click pills above to edit masks before sending to Cloud Gemini.",
      resolutionMode: "PRE_CLOUD_COUNTDOWN",
      inferenceSource: "ON_DEVICE",
      stage1Source,
      stage1LatencyMs,
      stage2Source: "PENDING_PRE_CLOUD",
      stage2LatencyMs: 0,
      nanoStatus: nanoResult.nanoStatus,
      latencyMs: stage1LatencyMs,
      estimatedTokensSaved: approxTokens,
      createdAt: Date.now(),
    };
  }

  return escalateSanitizedResult(
    {
      id: input.id ?? `ticket-${Date.now()}`,
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
      startedAt,
    },
    { loadConfig, callCloud },
  );
}

export async function escalateApprovedTicket(
  ticket: TriageResult,
  updatedSpans: RedactionSpan[],
  deps: Pick<PipelineDeps, "loadConfig" | "callCloud"> = {},
): Promise<TriageResult> {
  const startedAt = performance.now();
  const sanitizedText = applyMaskedSpans(ticket.rawText, updatedSpans);
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
    startedAt: number;
  },
  deps: Pick<PipelineDeps, "loadConfig" | "callCloud">,
): Promise<TriageResult> {
  const loadConfig = deps.loadConfig ?? loadRuntimeConfig;
  const callCloud = deps.callCloud ?? defaultCallCloud;
  const approxTokens = Math.max(40, Math.ceil(ctx.rawText.length / 4));

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
      createdAt: Date.now(),
    };
  }

  const cloudPrompt = [
    "You are an SRE Incident Triage Assistant. Produce a concise 3-bullet Root Cause & Mitigation plan.",
    "NOTE: All PII and secrets have already been redacted locally with [REDACTED:...] placeholders.",
    `Severity: ${ctx.severity} | Category: ${ctx.category}`,
    "Sanitized Ticket:",
    ctx.sanitizedText,
  ].join("\n\n");

  const cloudStart = performance.now();
  const cloudResponse = await callCloud(cloudPrompt, runtimeConfig);
  const stage2LatencyMs = Math.max(1, Math.round(performance.now() - cloudStart));
  const latencyMs = ctx.stage1LatencyMs + stage2LatencyMs;

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
    stage2Source: cloudResponse.inferenceSource === "IN_CLOUD" ? "IN_CLOUD" : "OFFLINE_BLOCKED",
    stage2LatencyMs,
    nanoStatus: ctx.nanoStatus,
    latencyMs,
    estimatedTokensSaved: ctx.spans.filter((s) => s.masked !== false).length * 18,
    createdAt: Date.now(),
  };
}
