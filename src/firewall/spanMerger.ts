import type {
  DetectorSource,
  RedactionSpan,
  SemanticExtractionItem,
  ZeroLeakageAudit,
} from "../types/triage";

const TECHNICAL_ALLOWLIST = new Set([
  "pg_locks",
  "invalid_grant",
  "oauth2",
  "err_cert_date_invalid",
  "cert_has_expired",
  "econnrefused",
  "etimedout",
  "typeerror",
  "referenceerror",
  "http 500",
  "http 502",
  "http 503",
  "http 504",
  "http 429",
  "deadlock in pg_locks",
  "postgresql",
  "stripe",
  "kubernetes",
  "localhost",
  "127.0.0.1",
]);

const DETECTOR_PRIORITY: Record<DetectorSource, number> = {
  MANUAL_MASK: 5,
  NANO_SEMANTIC_FIREWALL: 4,
  POLICY_TERM: 3,
  REGEX_FIREWALL: 2,
  ENTROPY_SCANNER: 2,
  HEURISTIC_GUARD: 1,
};

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isTechnicalAllowlisted(phrase: string): boolean {
  const normalized = phrase.trim().toLowerCase();
  if (!normalized) return true;
  if (TECHNICAL_ALLOWLIST.has(normalized)) return true;
  if (/^(?:http\s+\d{3}|err_[a-z0-9_]+)$/i.test(normalized)) return true;
  return false;
}

const NANO_STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "have", "will", "can",
  "please", "help", "later", "tomorrow", "progress", "production", "scale",
  "localhost", "you", "are", "was", "were", "not", "but", "all", "any",
  "how", "who", "what", "when", "where", "why",
]);

export function isValidNanoPhrase(phrase: string): boolean {
  const trimmed = phrase.trim();
  if (trimmed.length < 3) return false;
  if (trimmed.includes("[REDACTED:") || trimmed.includes("\u0000")) return false;
  if (!/[A-Za-z0-9]/.test(trimmed)) return false;
  if (isTechnicalAllowlisted(trimmed)) return false;
  if (NANO_STOPWORDS.has(trimmed.toLowerCase())) return false;
  return true;
}

export function maskProtectedTokens(rawText: string): {
  scanBuffer: string;
  protectedRanges: Array<{ start: number; end: number }>;
} {
  const protectedRanges = getProtectedPlaceholderRanges(rawText);
  if (protectedRanges.length === 0) {
    return { scanBuffer: rawText, protectedRanges };
  }
  let scanBuffer = "";
  let cursor = 0;
  for (const pr of protectedRanges) {
    scanBuffer += rawText.slice(cursor, pr.start);
    scanBuffer += "\u0000".repeat(pr.end - pr.start);
    cursor = pr.end;
  }
  scanBuffer += rawText.slice(cursor);
  return { scanBuffer, protectedRanges };
}

export function buildSemanticSpans(
  text: string,
  items: SemanticExtractionItem[],
): RedactionSpan[] {
  const spans: RedactionSpan[] = [];
  const { scanBuffer, protectedRanges } = maskProtectedTokens(text);
  let counter = 1;

  for (const item of items) {
    const phrase = item.phrase?.trim();
    if (!phrase || !isValidNanoPhrase(phrase)) {
      continue;
    }

    const escaped = escapeRegExp(phrase);
    const leadingBoundary = /^[A-Za-z0-9_]/.test(phrase) ? "\\b" : "";
    const trailingBoundary = /[A-Za-z0-9_]$/.test(phrase) ? "\\b" : "";
    // Apply strict URL/path lookarounds ONLY to short, ambiguous single-word alphabetic tokens (e.g. "May")
    // so multi-word or hyphenated codenames (e.g. "Project-Chimera") still match inside URL paths and CLI flags.
    const isShortAmbiguousWord = /^[A-Za-z]{1,6}$/.test(phrase);
    const pattern = isShortAmbiguousWord
      ? `(?<![/@-])(?<!\\w\\.)${leadingBoundary}${escaped}${trailingBoundary}(?![/@-])(?!\\.\\w)`
      : `${leadingBoundary}${escaped}${trailingBoundary}`;
    const regex = new RegExp(pattern, "gi");
    let match: RegExpExecArray | null;

    while ((match = regex.exec(scanBuffer)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (
        match[0].includes("\u0000") ||
        protectedRanges.some((pr) => start < pr.end && end > pr.start)
      ) {
        continue;
      }

      const category = (item.category || "SEMANTIC_PII").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
      spans.push({
        start,
        end,
        category,
        detector: "NANO_SEMANTIC_FIREWALL",
        placeholder: `[REDACTED:${category}_${counter++}]`,
        matchedText: text.slice(start, end),
        masked: true,
      });
    }
  }

  return spans;
}

export function applyMaskedSpans(rawText: string, spans: RedactionSpan[]): string {
  const activeSpans = spans
    .filter((s) => s.masked !== false && s.start >= 0 && s.end <= rawText.length && s.start < s.end)
    .sort((a, b) => a.start - b.start);

  let sanitizedText = rawText;
  for (let i = activeSpans.length - 1; i >= 0; i--) {
    const s = activeSpans[i];
    sanitizedText =
      sanitizedText.slice(0, s.start) + s.placeholder + sanitizedText.slice(s.end);
  }
  return sanitizedText;
}

const PROTECTED_PLACEHOLDER_REGEX = /\[REDACTED:[A-Z0-9_]+\]/g;

function getProtectedPlaceholderRanges(rawText: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const regex = new RegExp(PROTECTED_PLACEHOLDER_REGEX.source, "g");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(rawText)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

function overlapsProtectedRange(
  span: RedactionSpan,
  protectedRanges: Array<{ start: number; end: number }>,
): boolean {
  if (span.matchedText.includes("[REDACTED:") || span.matchedText.includes("\u0000")) return true;
  return protectedRanges.some((pr) => span.start < pr.end && span.end > pr.start);
}

export function mergeAndRedactSpans(
  rawText: string,
  spans: RedactionSpan[],
): { sanitizedText: string; mergedSpans: RedactionSpan[] } {
  if (spans.length === 0) {
    return { sanitizedText: rawText, mergedSpans: [] };
  }

  const protectedRanges = getProtectedPlaceholderRanges(rawText);
  const safeSpans = spans.filter((s) => !overlapsProtectedRange(s, protectedRanges));
  if (safeSpans.length === 0) {
    return { sanitizedText: rawText, mergedSpans: [] };
  }

  // Sort by start ascending, then longest span first, then detector priority
  const sorted = [...safeSpans].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const lenDiff = b.end - b.start - (a.end - a.start);
    if (lenDiff !== 0) return lenDiff;
    return DETECTOR_PRIORITY[b.detector] - DETECTOR_PRIORITY[a.detector];
  });

  const mergedSpans: RedactionSpan[] = [];
  for (const span of sorted) {
    if (span.start < 0 || span.end > rawText.length || span.start >= span.end) {
      continue;
    }
    if (span.detector !== "MANUAL_MASK" && isTechnicalAllowlisted(span.matchedText)) {
      continue;
    }
    const prev = mergedSpans[mergedSpans.length - 1];
    if (!prev) {
      mergedSpans.push({
        ...span,
        masked: span.masked ?? true,
        constituentTexts: [span.matchedText],
      });
      continue;
    }

    if (span.start < prev.end) {
      const existingConstituents = prev.constituentTexts ?? [prev.matchedText];
      if (!existingConstituents.includes(span.matchedText)) {
        existingConstituents.push(span.matchedText);
      }
      prev.constituentTexts = existingConstituents;
      if (span.end > prev.end) {
        prev.end = span.end;
        prev.matchedText = rawText.slice(prev.start, prev.end);
      }
      if (DETECTOR_PRIORITY[span.detector] > DETECTOR_PRIORITY[prev.detector]) {
        prev.detector = span.detector;
        prev.category = span.category;
        prev.placeholder = span.placeholder;
      }
    } else {
      mergedSpans.push({
        ...span,
        masked: span.masked ?? true,
        constituentTexts: [span.matchedText],
      });
    }
  }

  const categoryCounts = new Map<string, number>();
  const normalizedSpans = mergedSpans.map((span) => {
    const next = (categoryCounts.get(span.category) ?? 0) + 1;
    categoryCounts.set(span.category, next);
    return {
      ...span,
      placeholder: `[REDACTED:${span.category}_${next}]`,
    };
  });

  return {
    sanitizedText: applyMaskedSpans(rawText, normalizedSpans),
    mergedSpans: normalizedSpans,
  };
}

export function addManualSpan(
  rawText: string,
  existingSpans: RedactionSpan[],
  start: number,
  end: number,
  category = "MANUAL_SECRET",
): { sanitizedText: string; mergedSpans: RedactionSpan[] } {
  const safeStart = Math.max(0, start);
  const safeEnd = Math.min(rawText.length, end);
  if (safeEnd <= safeStart) {
    return mergeAndRedactSpans(rawText, existingSpans);
  }
  const manualCount = existingSpans.filter((s) => s.detector === "MANUAL_MASK").length + 1;
  const cleanCategory = category.toUpperCase().replace(/[^A-Z0-9_]/g, "_") || "MANUAL_SECRET";
  const manualSpan: RedactionSpan = {
    start: safeStart,
    end: safeEnd,
    category: cleanCategory,
    detector: "MANUAL_MASK",
    placeholder: `[REDACTED:${cleanCategory}_${manualCount}]`,
    matchedText: rawText.slice(safeStart, safeEnd),
    masked: true,
  };
  return mergeAndRedactSpans(rawText, [...existingSpans, manualSpan]);
}

/**
 * Programmatic Zero-Leakage Gate executed immediately prior to Stage 2 Cloud calls.
 * Asserts 0 active masked raw values appear verbatim inside the outbound prompt.
 */
export function verifyZeroLeakage(
  outboundPrompt: string,
  spans: RedactionSpan[],
): ZeroLeakageAudit {
  const activeMasked = spans.filter(
    (s) => s.masked !== false && s.matchedText && s.matchedText.trim().length >= 3,
  );
  const leakedCategories: string[] = [];

  for (const span of activeMasked) {
    const candidates = new Set<string>([
      span.matchedText,
      ...(span.constituentTexts ?? []),
    ]);

    let leaked = false;
    for (const rawCandidate of candidates) {
      const candidate = rawCandidate.trim();
      if (candidate.length < 3 || candidate.startsWith("[REDACTED:")) continue;
      const urlEncoded = encodeURIComponent(candidate);
      const jsonEscaped = JSON.stringify(candidate).slice(1, -1);

      if (
        outboundPrompt.includes(candidate) ||
        (urlEncoded.length >= 3 && outboundPrompt.includes(urlEncoded)) ||
        (jsonEscaped.length >= 3 && outboundPrompt.includes(jsonEscaped))
      ) {
        leaked = true;
        break;
      }
    }

    if (leaked) {
      leakedCategories.push(span.category);
    }
  }

  return {
    verified: leakedCategories.length === 0,
    checkedSpansCount: activeMasked.length,
    leakedSpansCount: leakedCategories.length,
    leakedCategories: [...new Set(leakedCategories)],
    outboundPromptPreview: outboundPrompt,
    verifiedAt: Date.now(),
  };
}
