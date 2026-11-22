export interface ExtensionSpan {
  start: number;
  end: number;
  category: string;
  detector: string;
  placeholder: string;
  matchedText: string;
}

export const TEXT_ONLY_OPTIONS: {
  expectedInputs: Array<{ type: string; languages: string[] }>;
  expectedOutputs: Array<{ type: string; languages: string[] }>;
};

export function runLocalDeterministicScan(
  text: string,
  includeHeuristics?: boolean,
  protectionLevel?: "low" | "medium" | "high",
): ExtensionSpan[];

export function mergeSpans(
  rawText: string,
  spans: ExtensionSpan[],
): { sanitizedText: string; mergedSpans: ExtensionSpan[] };

export function computeQuickRiskScore(
  masks: Array<{ category: string; detector?: string }>,
): { score: number; tier: "LOW" | "ELEVATED" | "HIGH" | "CRITICAL" };

export function scrubSync(
  rawText: string,
  includeHeuristics?: boolean,
  protectionLevel?: "low" | "medium" | "high",
): {
  sanitizedText: string;
  mergedSpans: ExtensionSpan[];
  riskProfile: { score: number; tier: "LOW" | "ELEVATED" | "HIGH" | "CRITICAL" };
  protectionLevel: "low" | "medium" | "high";
  latencyMs: number;
};

export function runExtensionNanoScan(
  rawText: string,
): Promise<{
  nanoActive: boolean;
  nanoState?: string;
  sanitizedText: string;
  mergedSpans: ExtensionSpan[];
}>;

export function shouldInterceptSendKey(input: {
  key: string;
  isTextarea: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  level: "low" | "medium" | "high";
}): boolean;

export function isLikelyNonSendButton(label: string | null | undefined): boolean;

export function buildSanitizedHandoffUrl(
  title: string,
  sanitizedText: string,
  baseUrl?: string,
): string;
