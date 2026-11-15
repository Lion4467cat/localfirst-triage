import type { DetectorSource, RedactionSpan } from "../types/triage";

interface RegexRule {
  category: string;
  detector: DetectorSource;
  pattern: RegExp;
}

const DETERMINISTIC_REGEX_RULES: RegexRule[] = [
  {
    category: "API_KEY",
    detector: "REGEX_FIREWALL",
    pattern:
      /\b(?:AIza[0-9A-Za-z\-_]{20,}|sk-(?:proj-)?[0-9A-Za-z\-_]{20,}|ghp_[0-9A-Za-z]{20,}|xox[baprs]-[0-9A-Za-z\-]{10,})\b/g,
  },
  {
    category: "BEARER_OR_JWT",
    detector: "REGEX_FIREWALL",
    pattern: /(?:Bearer\s+)?eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g,
  },
  {
    category: "EMAIL",
    detector: "REGEX_FIREWALL",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    category: "PHONE",
    detector: "REGEX_FIREWALL",
    pattern:
      /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}|\+?\d{1,3}[\s.-]\d{5}[\s.-]\d{5})\b/g,
  },
];

const CONTEXTUAL_HEURISTIC_RULES: RegexRule[] = [
  {
    category: "CONTEXTUAL_PHI",
    detector: "HEURISTIC_GUARD",
    pattern:
      /\b(?:admitted to [A-Za-z0-9\s]+?ICU(?:\s+Floor\s+\d+)?|patient\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?|diagnosis:\s*[^\n.]+|seizure)\b/gi,
  },
  {
    category: "M_AND_A_SECRET",
    detector: "HEURISTIC_GUARD",
    pattern:
      /(?:\$\d+(?:\.\d+)?[MBK]\s+valuation|\bProject-[A-Za-z0-9_-]+\b|\bacquisition target\b)/gi,
  },
  {
    category: "NATURAL_SECRET",
    detector: "HEURISTIC_GUARD",
    pattern:
      /(?:log in using [^\n.'"]+|password is [^\n.'"]+|dog's name followed by [^\n.'"]+)/gi,
  },
];

function runRules(text: string, rules: RegexRule[], startCounter = 1): RedactionSpan[] {
  const spans: RedactionSpan[] = [];
  let counter = startCounter;

  for (const rule of rules) {
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const matchedText = match[0];
      if (!matchedText) {
        break;
      }
      spans.push({
        start: match.index,
        end: match.index + matchedText.length,
        category: rule.category,
        detector: rule.detector,
        placeholder: `[REDACTED:${rule.category}_${counter++}]`,
        matchedText,
        masked: true,
      });
    }
  }

  return spans;
}

export function detectRegexSpans(text: string): RedactionSpan[] {
  return runRules(text, DETERMINISTIC_REGEX_RULES, 1);
}

export function detectContextualHeuristicSpans(text: string): RedactionSpan[] {
  return runRules(text, CONTEXTUAL_HEURISTIC_RULES, 100);
}
