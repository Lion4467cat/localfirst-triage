import {
  createOnDeviceFirewallModel,
  getHybridAI,
  TEXT_ONLY_ON_DEVICE_CREATE_OPTIONS,
} from "../config/firebase";
import { DEFAULT_RUNBOOKS } from "../config/demoScenarios";
import type {
  CustomRunbook,
  InferenceSource,
  NanoStatus,
  RedactionSpan,
  SemanticExtractionItem,
  Severity,
} from "../types/triage";
import { buildSemanticSpans } from "./spanMerger";

export interface NanoExtractionResult {
  nanoStatus: NanoStatus;
  inferenceSource: InferenceSource;
  severity: Severity;
  runbookId: string | null;
  category: string;
  spans: RedactionSpan[];
}

export type ChromeRawAvailability =
  | "readily"
  | "downloadable"
  | "downloading"
  | "after-download"
  | "no";

export interface NanoExtractorDeps {
  timeoutMs?: number;
  maxChunkChars?: number;
  overlapChars?: number;
  maxChunks?: number;
  availableRunbooks?: CustomRunbook[];
  checkAvailability?: () => Promise<ChromeRawAvailability>;
  triggerDownload?: () => void;
  callNano?: (prompt: string) => Promise<string>;
}

interface ParsedNanoPayload {
  entities: SemanticExtractionItem[];
  severity: Severity;
  runbookId: string | null;
}

export const NANO_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    severity: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
    runbookId: { type: "string" },
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          value: { type: "string" },
        },
        required: ["type", "value"],
      },
    },
  },
  required: ["severity", "entities"],
};

let activeNanoSessionMutex: Promise<void> = Promise.resolve();
let lastNanoDiagnostic: string | null = null;

export function getLastNanoDiagnostic(): string | null {
  return lastNanoDiagnostic;
}

function serializeNanoSession<T>(work: () => Promise<T>): Promise<T> {
  const next = activeNanoSessionMutex.then(work, work);
  activeNanoSessionMutex = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function stripStackFrames(text: string): string {
  // Remove ONLY pure call-site stack frame lines and hex pointer lines;
  // preserve top-level Error: messages, SQL queries, and variable dumps!
  return text
    .split("\n")
    .filter((line) => {
      if (/^\s*at\s+[\w$.<>[\]\s]+\s*\([^)]*:\d+:\d+\)\s*$/.test(line)) return false;
      if (/^\s*at\s+[^\s()]+:\d+:\d+\s*$/.test(line)) return false;
      if (/^\s*0x[0-9a-f]{8,}\s*$/i.test(line)) return false;
      return true;
    })
    .join("\n")
    .trim();
}

export function chunkText(text: string, maxChars = 1400, overlapChars = 120): string[] {
  if (text.length <= maxChars) {
    return [text];
  }
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const windowSlice = text.slice(start, end);
      const lastBoundary = Math.max(
        windowSlice.lastIndexOf("\n"),
        windowSlice.lastIndexOf(". "),
      );
      if (lastBoundary > maxChars * 0.4) {
        end = start + lastBoundary + 1;
      }
    }

    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlapChars);
  }

  return chunks.filter(Boolean);
}

export function parseDefensiveSemanticJson(raw: string): ParsedNanoPayload {
  const fallback: ParsedNanoPayload = {
    entities: [],
    severity: "P2",
    runbookId: null,
  };

  if (!raw || typeof raw !== "string") {
    return fallback;
  }

  const stripped = raw
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();

  const startIdx = stripped.indexOf("{");
  const endIdx = stripped.lastIndexOf("}");
  if (startIdx === -1 || endIdx <= startIdx) {
    return fallback;
  }

  try {
    const jsonSlice = stripped
      .slice(startIdx, endIdx + 1)
      .replace(/,\s*([}\]])/g, "$1");
    const parsed = JSON.parse(jsonSlice) as {
      entities?: Array<{ type?: unknown; value?: unknown }>;
      sensitive?: Array<{ phrase?: unknown; category?: unknown }>;
      severity?: unknown;
      runbookId?: unknown;
    };

    const rawList = Array.isArray(parsed.entities)
      ? parsed.entities.map((e) => ({ phrase: e?.value, category: e?.type }))
      : Array.isArray(parsed.sensitive)
        ? parsed.sensitive
        : [];

    const entities: SemanticExtractionItem[] = rawList
      .filter(
        (item): item is { phrase: string; category?: string } =>
          Boolean(item && typeof item.phrase === "string" && item.phrase.trim().length >= 3),
      )
      .map((item) => ({
        phrase: item.phrase.trim(),
        category: typeof item.category === "string" ? item.category : "SEMANTIC_PII",
      }));

    const sev =
      parsed.severity === "P0" ||
      parsed.severity === "P1" ||
      parsed.severity === "P2" ||
      parsed.severity === "P3"
        ? parsed.severity
        : "P2";

    const runbookId =
      typeof parsed.runbookId === "string" &&
      parsed.runbookId.trim() &&
      parsed.runbookId.trim().toLowerCase() !== "null" &&
      parsed.runbookId.trim().toLowerCase() !== "none"
        ? parsed.runbookId.trim()
        : null;

    return { entities, severity: sev, runbookId };
  } catch {
    return fallback;
  }
}

export function triggerChromeNanoBackgroundDownload(): void {
  if (typeof globalThis === "undefined") return;
  const g = globalThis as unknown as {
    LanguageModel?: { create?: (opts?: unknown) => Promise<unknown> };
    ai?: { languageModel?: { create?: (opts?: unknown) => Promise<unknown> } };
  };
  try {
    if (g.LanguageModel?.create) {
      void g.LanguageModel.create(TEXT_ONLY_ON_DEVICE_CREATE_OPTIONS).catch(() => undefined);
    } else if (g.ai?.languageModel?.create) {
      void g.ai.languageModel.create().catch(() => undefined);
    }
  } catch {
    // Non-blocking background download trigger
  }
}

export async function checkChromeNanoAvailability(): Promise<ChromeRawAvailability> {
  if (typeof globalThis === "undefined") {
    return "no";
  }

  const g = globalThis as unknown as {
    LanguageModel?: {
      availability?: (options?: unknown) => Promise<string>;
    };
    ai?: {
      languageModel?: {
        capabilities?: () => Promise<{ available?: string }>;
      };
    };
  };

  try {
    if (g.LanguageModel?.availability) {
      const state = await g.LanguageModel.availability(TEXT_ONLY_ON_DEVICE_CREATE_OPTIONS);
      if (state === "available" || state === "readily") return "readily";
      if (state === "downloading") return "downloading";
      if (state === "downloadable" || state === "after-download") return "downloadable";
      return "no";
    }
    if (g.ai?.languageModel?.capabilities) {
      const caps = await g.ai.languageModel.capabilities();
      if (caps?.available === "readily" || caps?.available === "available") return "readily";
      if (caps?.available === "downloading") return "downloading";
      if (caps?.available === "after-download" || caps?.available === "downloadable") {
        return "after-download";
      }
    }
  } catch {
    return "no";
  }

  return "no";
}

async function defaultCallNanoOnDevice(prompt: string): Promise<string> {
  return serializeNanoSession(async () => {
    const g = globalThis as unknown as {
      LanguageModel?: {
        create?: (options?: unknown) => Promise<{
          prompt: (input: string) => Promise<string>;
          destroy?: () => void;
        }>;
      };
    };

    const ai = getHybridAI();
    if (ai) {
      try {
        // Call without complex union schema constraint first to prevent Chrome 154
        // LiteRtWebGpuAccelerator grammar constraint crashes while staying strictly ONLY_ON_DEVICE
        const model = createOnDeviceFirewallModel(ai);
        const result = await model.generateContent(prompt);
        lastNanoDiagnostic = null;
        return result.response.text();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/crashed too many times|unable to create a session|NotSupportedError/i.test(msg)) {
          lastNanoDiagnostic =
            "Chrome On-Device GPU worker reset required (chrome://on-device-internals) — Fail-Closed Guard Active";
          throw err;
        }
        if (!g.LanguageModel?.create) {
          throw err;
        }
      }
    }

    if (!g.LanguageModel?.create) {
      throw new Error("Firebase AI not configured");
    }

    let session: { prompt: (input: string) => Promise<string>; destroy?: () => void } | null =
      null;
    try {
      session = await g.LanguageModel.create(TEXT_ONLY_ON_DEVICE_CREATE_OPTIONS);
      const output = await session.prompt(prompt);
      lastNanoDiagnostic = null;
      return output;
    } finally {
      session?.destroy?.();
    }
  });
}

function heuristicSeverity(text: string): Severity {
  const lower = text.toLowerCase();
  if (
    lower.includes("p0") ||
    lower.includes("outage") ||
    lower.includes("private key") ||
    lower.includes("leaked")
  ) {
    return "P0";
  }
  if (lower.includes("p1") || lower.includes("deadlock") || lower.includes("429")) return "P1";
  if (lower.includes("p3") || lower.includes("cert_has_expired") || lower.includes("localhost")) {
    return "P3";
  }
  return "P2";
}

const SEVERITY_RANK: Record<Severity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export function buildNanoExtractionPrompt(
  chunk: string,
  runbooks: CustomRunbook[] = DEFAULT_RUNBOOKS,
): string {
  const runbookList = runbooks
    .map((rb) => `- ${rb.id} (${rb.severity}): ${rb.title}`)
    .join("\n");

  return [
    'Return ONLY valid JSON: {"severity":"P0|P1|P2|P3","runbookId":string|null,"entities":[{"type":"CONTEXTUAL_PHI|M_AND_A_SECRET|NATURAL_SECRET|PERSON_PII","value":"exact verbatim substring"}]}',
    "Do NOT generate prose replies. Extract EVERY sensitive substring across ALL four categories (medical/ICU/diagnosis PHI, password hints/login secrets, M&A codenames/valuations/deals, person names/addresses) — never stop after the first person name.",
    "Only copy exact verbatim sensitive substrings present in Text.",
    "Valid local runbookId values (ONLY assign one if severity is P2 or P3 and it clearly matches):",
    runbookList,
    "Text:",
    chunk,
  ].join("\n");
}

export async function extractSemanticSecretsWithNano(
  text: string,
  deps: NanoExtractorDeps = {},
): Promise<NanoExtractionResult> {
  const timeoutMs = deps.timeoutMs ?? 8000;
  const maxChunkChars = deps.maxChunkChars ?? 1400;
  const overlapChars = deps.overlapChars ?? 120;
  const maxChunks = Math.max(1, deps.maxChunks ?? 6);
  const runbooks = deps.availableRunbooks ?? DEFAULT_RUNBOOKS;
  const checkAvail = deps.checkAvailability ?? checkChromeNanoAvailability;
  const triggerDownload = deps.triggerDownload ?? triggerChromeNanoBackgroundDownload;
  const callNano = deps.callNano ?? defaultCallNanoOnDevice;

  const availability = await checkAvail();
  if (availability === "after-download" || availability === "downloading") {
    if (availability === "after-download") {
      triggerDownload();
    }
    return {
      nanoStatus: "MODEL_DOWNLOADING",
      inferenceSource: "LOCAL_REGEX_FALLBACK",
      severity: heuristicSeverity(text),
      runbookId: null,
      category: "GENERAL_INCIDENT",
      spans: [],
    };
  }

  if (availability === "downloadable") {
    return {
      nanoStatus: "DOWNLOADABLE",
      inferenceSource: "LOCAL_REGEX_FALLBACK",
      severity: heuristicSeverity(text),
      runbookId: null,
      category: "GENERAL_INCIDENT",
      spans: [],
    };
  }

  if (availability === "no" && !deps.callNano) {
    return {
      nanoStatus: "UNAVAILABLE",
      inferenceSource: "LOCAL_REGEX_FALLBACK",
      severity: heuristicSeverity(text),
      runbookId: null,
      category: "GENERAL_INCIDENT",
      spans: [],
    };
  }

  const proseOnly = stripStackFrames(text) || text;
  const allChunks = chunkText(proseOnly, maxChunkChars, overlapChars);
  const chunks =
    allChunks.length <= maxChunks
      ? allChunks
      : [
          ...allChunks.slice(0, Math.ceil(maxChunks * 0.67)),
          ...allChunks.slice(-Math.max(1, maxChunks - Math.ceil(maxChunks * 0.67))),
        ];
  const allItems: SemanticExtractionItem[] = [];
  let bestSeverity: Severity = "P3";
  let candidateRunbookId: string | null = null;

  try {
    for (const chunk of chunks) {
      const prompt = buildNanoExtractionPrompt(chunk, runbooks);

      let timer: ReturnType<typeof setTimeout> | undefined;
      const raw = await Promise.race([
        callNano(prompt),
        new Promise<string>((_, reject) => {
          timer = setTimeout(() => reject(new Error("NANO_TIMEOUT")), timeoutMs);
        }),
      ]).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      });

      const parsed = parseDefensiveSemanticJson(raw);
      allItems.push(...parsed.entities);
      if (SEVERITY_RANK[parsed.severity] < SEVERITY_RANK[bestSeverity]) {
        bestSeverity = parsed.severity;
      }
      if (parsed.runbookId && !candidateRunbookId) {
        candidateRunbookId = parsed.runbookId;
      }
    }

    // Only attach a local runbookId if aggregate severity across ALL chunks is P2 or P3
    const finalRunbookId =
      bestSeverity === "P2" || bestSeverity === "P3" ? candidateRunbookId : null;

    lastNanoDiagnostic = null;
    return {
      nanoStatus: "READY",
      inferenceSource: "ON_DEVICE",
      severity: bestSeverity,
      runbookId: finalRunbookId,
      category: finalRunbookId ?? "GENERAL_INCIDENT",
      spans: buildSemanticSpans(text, allItems),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/crashed too many times|unable to create a session|NotSupportedError/i.test(msg)) {
      lastNanoDiagnostic =
        "Chrome On-Device GPU worker reset required (chrome://on-device-internals) — Fail-Closed Guard Active";
    }
    return {
      nanoStatus: "UNAVAILABLE",
      inferenceSource: "LOCAL_REGEX_FALLBACK",
      severity: heuristicSeverity(text),
      runbookId: null,
      category: "GENERAL_INCIDENT",
      spans: [],
    };
  }
}
