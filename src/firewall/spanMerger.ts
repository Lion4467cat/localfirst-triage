import type { DetectorSource, RedactionSpan, SemanticExtractionItem } from "../types/triage";

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
  "http 504",
  "http 429",
  "deadlock in pg_locks",
]);

const DETECTOR_PRIORITY: Record<DetectorSource, number> = {
  NANO_SEMANTIC_FIREWALL: 3,
  REGEX_FIREWALL: 2,
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

export function buildSemanticSpans(
  text: string,
  items: SemanticExtractionItem[],
): RedactionSpan[] {
  const spans: RedactionSpan[] = [];
  let counter = 1;

  for (const item of items) {
    const phrase = item.phrase?.trim();
    if (!phrase || phrase.length < 3 || isTechnicalAllowlisted(phrase)) {
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

    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      const category = (item.category || "SEMANTIC_PII").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
      spans.push({
        start,
        end,
        category,
        detector: "NANO_SEMANTIC_FIREWALL",
        placeholder: `[REDACTED:${category}_${counter++}]`,
        matchedText: match[0],
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

export function mergeAndRedactSpans(
  rawText: string,
  spans: RedactionSpan[],
): { sanitizedText: string; mergedSpans: RedactionSpan[] } {
  if (spans.length === 0) {
    return { sanitizedText: rawText, mergedSpans: [] };
  }

  // Sort by start ascending, then longest span first, then detector priority (NANO_SEMANTIC_FIREWALL > REGEX_FIREWALL > HEURISTIC_GUARD)
  const sorted = [...spans].sort((a, b) => {
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
    if (isTechnicalAllowlisted(span.matchedText)) {
      continue;
    }
    const prev = mergedSpans[mergedSpans.length - 1];
    if (!prev) {
      mergedSpans.push({ ...span, masked: span.masked ?? true });
      continue;
    }

    if (span.start < prev.end) {
      if (span.end > prev.end) {
        prev.end = span.end;
        prev.matchedText = rawText.slice(prev.start, prev.end);
      }
      // NANO_SEMANTIC_FIREWALL always wins attribution over HEURISTIC_GUARD / REGEX_FIREWALL on overlapping semantic entities
      if (DETECTOR_PRIORITY[span.detector] > DETECTOR_PRIORITY[prev.detector]) {
        prev.detector = span.detector;
        prev.category = span.category;
        prev.placeholder = span.placeholder;
      }
    } else {
      mergedSpans.push({ ...span, masked: span.masked ?? true });
    }
  }

  return {
    sanitizedText: applyMaskedSpans(rawText, mergedSpans),
    mergedSpans,
  };
}
