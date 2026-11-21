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
): ExtensionSpan[];

export function mergeSpans(
  rawText: string,
  spans: ExtensionSpan[],
): { sanitizedText: string; mergedSpans: ExtensionSpan[] };

export function runExtensionNanoScan(
  rawText: string,
): Promise<{
  nanoActive: boolean;
  nanoState?: string;
  sanitizedText: string;
  mergedSpans: ExtensionSpan[];
}>;

export function buildSanitizedHandoffUrl(
  title: string,
  sanitizedText: string,
  baseUrl?: string,
): string;
