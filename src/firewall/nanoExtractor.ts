import { getGenerativeModel, InferenceMode } from "firebase/ai";
import { getHybridAI } from "../config/firebase";
import type {
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

export interface NanoExtractorDeps {
  timeoutMs?: number;
  maxChunkChars?: number;
  overlapChars?: number;
  checkAvailability?: () => Promise<"readily" | "after-download" | "no">;
  triggerDownload?: () => void;
  callNano?: (prompt: string) => Promise<string>;
}

interface ParsedNanoPayload {
  entities: SemanticExtractionItem[];
  severity: Severity;
  runbookId: string | null;
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
      typeof parsed.runbookId === "string" && parsed.runbookId.trim()
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
    LanguageModel?: { create?: () => Promise<unknown> };
    ai?: { languageModel?: { create?: () => Promise<unknown> } };
  };
  try {
    if (g.LanguageModel?.create) {
      void g.LanguageModel.create().catch(() => undefined);
    } else if (g.ai?.languageModel?.create) {
      void g.ai.languageModel.create().catch(() => undefined);
    }
  } catch {
    // Non-blocking background download trigger
  }
}

export async function checkChromeNanoAvailability(): Promise<"readily" | "after-download" | "no"> {
  if (typeof globalThis === "undefined") {
    return "no";
  }

  const g = globalThis as unknown as {
    LanguageModel?: {
      availability?: () => Promise<string>;
    };
    ai?: {
      languageModel?: {
        capabilities?: () => Promise<{ available?: string }>;
      };
    };
  };

  try {
    if (g.LanguageModel?.availability) {
      const state = await g.LanguageModel.availability();
      if (state === "available" || state === "readily") return "readily";
      if (state === "downloading" || state === "downloadable" || state === "after-download") {
        return "after-download";
      }
    }
    if (g.ai?.languageModel?.capabilities) {
      const caps = await g.ai.languageModel.capabilities();
      if (caps?.available === "readily" || caps?.available === "available") return "readily";
      if (
        caps?.available === "after-download" ||
        caps?.available === "downloadable" ||
        caps?.available === "downloading"
      ) {
        return "after-download";
      }
    }
  } catch {
    return "no";
  }

  return "no";
}

async function defaultCallNanoOnDevice(prompt: string): Promise<string> {
  const ai = getHybridAI();
  if (!ai) {
    throw new Error("Firebase AI not configured");
  }
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
  });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

function heuristicSeverity(text: string): Severity {
  const lower = text.toLowerCase();
  if (lower.includes("p0") || lower.includes("outage") || lower.includes("leaked")) return "P0";
  if (lower.includes("p1") || lower.includes("deadlock") || lower.includes("429")) return "P1";
  if (lower.includes("p3") || lower.includes("cert_has_expired") || lower.includes("localhost")) {
    return "P3";
  }
  return "P2";
}

const SEVERITY_RANK: Record<Severity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export async function extractSemanticSecretsWithNano(
  text: string,
  deps: NanoExtractorDeps = {},
): Promise<NanoExtractionResult> {
  const timeoutMs = deps.timeoutMs ?? 8000;
  const maxChunkChars = deps.maxChunkChars ?? 1400;
  const overlapChars = deps.overlapChars ?? 120;
  const checkAvail = deps.checkAvailability ?? checkChromeNanoAvailability;
  const triggerDownload = deps.triggerDownload ?? triggerChromeNanoBackgroundDownload;
  const callNano = deps.callNano ?? defaultCallNanoOnDevice;

  const availability = await checkAvail();
  if (availability === "after-download") {
    // Non-blocking trigger so Chrome actually starts pulling Nano weights
    triggerDownload();
    return {
      nanoStatus: "MODEL_DOWNLOADING",
      inferenceSource: "LOCAL_REGEX_FALLBACK",
      severity: heuristicSeverity(text),
      runbookId: null,
      category: "GENERAL_INCIDENT",
      spans: [],
    };
  }

  if (availability === "no" && !deps.callNano && !getHybridAI()) {
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
  const chunks = chunkText(proseOnly, maxChunkChars, overlapChars);
  const allItems: SemanticExtractionItem[] = [];
  let bestSeverity: Severity = "P3";
  let candidateRunbookId: string | null = null;

  try {
    for (const chunk of chunks) {
      const prompt = [
        'Return ONLY valid JSON: {"severity":"P0|P1|P2|P3","runbookId":string|null,"entities":[{"type":"CONTEXTUAL_PHI|M_AND_A_SECRET|NATURAL_SECRET","value":"exact verbatim substring"}]}',
        "Do NOT generate prose replies. Only copy exact verbatim sensitive substrings.",
        "Text:",
        chunk,
      ].join("\n");

      const raw = await Promise.race([
        callNano(prompt),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("NANO_TIMEOUT")), timeoutMs),
        ),
      ]);

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

    return {
      nanoStatus: "READY",
      inferenceSource: "ON_DEVICE",
      severity: bestSeverity,
      runbookId: finalRunbookId,
      category: finalRunbookId ?? "GENERAL_INCIDENT",
      spans: buildSemanticSpans(text, allItems),
    };
  } catch {
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
