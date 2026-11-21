import type { DetectorSource, RedactionSpan } from "../types/triage";

interface RegexRule {
  category: string;
  detector: DetectorSource;
  pattern: RegExp;
  validator?: (matched: string) => boolean;
}

export function passesLuhnCheck(rawDigits: string): boolean {
  const digits = rawDigits.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  // Reject obvious all-same-digit sequences
  if (/^(\d)\1+$/.test(digits)) return false;

  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits.charCodeAt(i) - 48;
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

export function shannonEntropy(input: string): number {
  if (!input) return 0;
  const counts = new Map<string, number>();
  for (const ch of input) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / input.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const DETERMINISTIC_REGEX_RULES: RegexRule[] = [
  {
    category: "PEM_PRIVATE_KEY",
    detector: "REGEX_FIREWALL",
    pattern:
      /-----BEGIN(?:%20|\s)+(?:RSA(?:%20|\s)+|EC(?:%20|\s)+|DSA(?:%20|\s)+|OPENSSH(?:%20|\s)+|ENCRYPTED(?:%20|\s)+|PGP(?:%20|\s)+)?PRIVATE(?:%20|\s)+KEY(?:(?:%20|\s)+BLOCK)?-----[\s\S]*?-----END(?:%20|\s)+(?:RSA(?:%20|\s)+|EC(?:%20|\s)+|DSA(?:%20|\s)+|OPENSSH(?:%20|\s)+|ENCRYPTED(?:%20|\s)+|PGP(?:%20|\s)+)?PRIVATE(?:%20|\s)+KEY(?:(?:%20|\s)+BLOCK)?-----/gi,
  },
  {
    category: "DB_CONNECTION_URI",
    detector: "REGEX_FIREWALL",
    pattern:
      /\b(?:postgres(?:ql)?|mongodb(?:\+srv)?|mysql|redis|rediss|amqp)(?::\/\/|:\\\/\\\/|%3A%2F%2F)[^:\s/@"']+(?::|%3A)[^@\s/"']+(?:@|%40)[^\s"'<>\\]+/gi,
  },
  {
    category: "AWS_ACCESS_KEY",
    detector: "REGEX_FIREWALL",
    pattern: /\b(?:AKIA|ASIA|AIDA|AROA)[0-9A-Z]{16}\b/g,
  },
  {
    category: "API_KEY",
    detector: "REGEX_FIREWALL",
    pattern:
      /\b(?:AIza[0-9A-Za-z\-_]{20,}|(?:sk|pk|rk)_(?:live|test)_[0-9A-Za-z]{16,}|sk-(?:proj-|ant-)?[0-9A-Za-z\-_]{20,}|(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{22,}|xox[baprs]-[0-9A-Za-z\-]{10,})\b/g,
  },
  {
    category: "BEARER_OR_JWT",
    detector: "REGEX_FIREWALL",
    pattern:
      /(?:Authorization\\?["']?\s*(?::|%3A)\s*\\?["']?(?:Bearer|Basic)(?:\s+|%20)[A-Za-z0-9\-._~+/=]{12,}|(?:Bearer(?:\s+|%20))?eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)/gi,
  },
  {
    category: "CREDIT_CARD",
    detector: "REGEX_FIREWALL",
    pattern: /\b\d(?:[ -]?\d){12,18}\b/g,
    validator: (matched) => {
      const digits = matched.replace(/\D/g, "");
      if (digits.length < 13 || digits.length > 19) return false;
      // Require recognized payment network IIN prefix + Luhn checksum to avoid trace ID false positives
      const isKnownCardPrefix =
        /^(?:4\d{12}(?:\d{3})?(?:\d{3})?|5[1-5]\d{14}|2(?:2[2-9]\d{12}|[3-6]\d{13}|7[01]\d{12}|720\d{12})|3[47]\d{13}|6(?:011|5\d{2})\d{12})$/.test(
          digits,
        );
      if (!isKnownCardPrefix) return false;
      return passesLuhnCheck(digits);
    },
  },
  {
    category: "US_SSN",
    detector: "REGEX_FIREWALL",
    pattern: /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
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
      /\b(?:(?:admitted to|discharged from|diagnosed with|treated at|hospitalized at|undergoing)\s+[^.\n;]{3,70}|(?:patient|daughter|son|wife|husband|mother|father)\b[^.\n;]{0,55}\b(?:ICU|ER|NICU|ward|hospital|clinic|chemo|chemotherapy|surgery|seizure|oncology|cardiology|biopsy|MRN|prescription)\b[^.\n;]{0,40}|(?:MRN|DOB|diagnosis)\s*[:#]\s*[^\n,;]+)/gi,
  },
  {
    category: "M_AND_A_SECRET",
    detector: "HEURISTIC_GUARD",
    pattern:
      /(?:\$\d+(?:\.\d+)?\s?(?:[MBK]|million|billion)\s+(?:valuation|offer|deal|acquisition|buyout|term sheet|round)|\bProject-[A-Za-z0-9_-]{2,}\b|\b(?:acquisition target|merger with|undisclosed bid|term sheet)\b)/gi,
  },
  {
    category: "NATURAL_SECRET",
    detector: "HEURISTIC_GUARD",
    pattern:
      /\b(?:(?:log\s*in|sign\s*in|unlock|authenticate)\s+using\s+[^.\n'"]{4,80}|(?:password|passcode|passphrase|pin|credentials?)\s+(?:is|was|are|:)\s+[^.\n'"]{3,80}|(?:admin|root|prod)\s+(?:password|passphrase)\s*[:=]\s*[^\s,;]+)/gi,
  },
  {
    category: "PERSONAL_PII_LOCATION",
    detector: "HEURISTIC_GUARD",
    pattern:
      /(?:\b(?:lives?\s+(?:near|at|on|in)|home\s+address|resides?\s+at)\s+[A-Z0-9][^.\n;)]{3,60}|\b(?:VP|CEO|CFO|CTO|Director|Customer|Client|Patient)\s+(?:of\s+[A-Za-z]+\s+)?\([A-Z][a-z]+\s+[A-Z][a-z]+[^)\n]{0,60}\))/g,
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
      if (rule.validator && !rule.validator(matchedText)) {
        continue;
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

export function detectHighEntropySecrets(text: string): RedactionSpan[] {
  const spans: RedactionSpan[] = [];
  const assignmentRegex =
    /\b(?:api[_-]?key|x[_-]?api[_-]?key|secret|token|access[_-]?token|refresh[_-]?token|session[_-]?token|id[_-]?token|password|passwd|pwd|client[_-]?secret|signing[_-]?key|webhook[_-]?secret|private[_-]?key|auth[_-]?secret)\\?["']?\s*(?:[:=]|%3D)\s*\\?["']?([^\s"',;\\]{12,})\\?["']?/gi;
  let counter = 50;
  let match: RegExpExecArray | null;

  while ((match = assignmentRegex.exec(text)) !== null) {
    const secretValue = match[1];
    if (!secretValue || secretValue.startsWith("[REDACTED:")) continue;
    const entropy = shannonEntropy(secretValue);
    const hasMixedClasses =
      /[a-z]/.test(secretValue) && (/[A-Z0-9_-]/.test(secretValue) || /[^a-zA-Z0-9]/.test(secretValue));

    if (entropy >= 3.25 || (secretValue.length >= 16 && hasMixedClasses)) {
      const valueOffset = match[0].lastIndexOf(secretValue);
      const start = match.index + Math.max(0, valueOffset);
      const end = start + secretValue.length;
      spans.push({
        start,
        end,
        category: "HIGH_ENTROPY_SECRET",
        detector: "ENTROPY_SCANNER",
        placeholder: `[REDACTED:HIGH_ENTROPY_SECRET_${counter++}]`,
        matchedText: secretValue,
        masked: true,
      });
    }
  }

  return spans;
}

export function detectContextualHeuristicSpans(text: string): RedactionSpan[] {
  return runRules(text, CONTEXTUAL_HEURISTIC_RULES, 100);
}

export function detectPolicyTermSpans(text: string, customTerms: string[]): RedactionSpan[] {
  if (!customTerms || customTerms.length === 0) return [];
  const spans: RedactionSpan[] = [];
  let counter = 200;

  for (const rawTerm of customTerms) {
    const term = rawTerm.trim();
    if (term.length < 3) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const leading = /^[A-Za-z0-9_]/.test(term) ? "\\b" : "";
    const trailing = /[A-Za-z0-9_]$/.test(term) ? "\\b" : "";
    const regex = new RegExp(`${leading}${escaped}${trailing}`, "gi");
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      spans.push({
        start: match.index,
        end: match.index + match[0].length,
        category: "POLICY_TERM",
        detector: "POLICY_TERM",
        placeholder: `[REDACTED:POLICY_TERM_${counter++}]`,
        matchedText: match[0],
        masked: true,
      });
    }
  }

  return spans;
}
