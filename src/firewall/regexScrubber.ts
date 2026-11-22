import type { DetectorSource, ProtectionLevel, RedactionSpan } from "../types/triage";
import { maskProtectedTokens, mergeAndRedactSpans } from "./spanMerger";

interface RegexRule {
  category: string;
  detector: DetectorSource;
  pattern: RegExp;
  captureGroup?: number;
  minLevel?: ProtectionLevel;
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

export function passesIbanMod97(raw: string): boolean {
  const cleaned = raw.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(cleaned)) return false;
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
  let remainder = 0;
  for (let i = 0; i < rearranged.length; i++) {
    const code = rearranged.charCodeAt(i);
    const digits = code >= 65 && code <= 90 ? String(code - 55) : rearranged[i];
    for (let j = 0; j < digits.length; j++) {
      remainder = (remainder * 10 + (digits.charCodeAt(j) - 48)) % 97;
    }
  }
  return remainder === 1;
}

const PASSWORD_STOPWORDS = new Set([
  "required", "invalid", "reset", "expired", "policy", "manager", "field",
  "hash", "missing", "incorrect", "protected", "strength", "prompt",
  "input", "change", "update", "placeholder", "string", "boolean", "hints",
]);

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
    // The 40-char secret that follows AWS_SECRET_ACCESS_KEY=. Anchored to the
    // key NAME so a bare 40-char base64 hash elsewhere is not falsely redacted.
    category: "AWS_SECRET_KEY",
    detector: "REGEX_FIREWALL",
    pattern:
      /\b(?:aws_?)?secret_?access_?key\b\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/gi,
  },
  {
    category: "API_KEY",
    detector: "REGEX_FIREWALL",
    pattern:
      /\b(?:AIza[0-9A-Za-z\-_]{20,}|(?:sk|pk|rk)_(?:live|test)_[0-9A-Za-z]{16,}|sk-(?:proj-|ant-)?[0-9A-Za-z\-_]{20,}|(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{22,}|xox[baprs]-[0-9A-Za-z\-]{10,}|glpat-[A-Za-z0-9_-]{15,}|hf_[A-Za-z0-9]{20,}|SK[0-9a-fA-F]{32}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{20,}|pypi-[A-Za-z0-9_-]{20,}|shp(?:at|ca|pa|ss)_[0-9a-fA-F]{20,}|ddapi_[A-Za-z0-9_-]{16,}|lin_api_[A-Za-z0-9]{20,}|sbp_[0-9a-fA-F]{20,}|glsa_[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{14}\.atlasv1\.[A-Za-z0-9_-]{20,}|PMAK-[0-9a-fA-F]{20,}-[0-9a-fA-F]{20,}|pul-[0-9a-fA-F]{20,}|pplx-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}|dop_v1_[0-9a-fA-F]{32,})\b/g,
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
    category: "GOV_ID",
    detector: "REGEX_FIREWALL",
    pattern: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g,
  },
  {
    category: "GOV_ID",
    detector: "REGEX_FIREWALL",
    captureGroup: 1,
    pattern: /\b(?:aadhaar|aadhar|uid|uidai)\b[^0-9\n]{0,20}(\d{4}[\s-]?\d{4}[\s-]?\d{4})\b/gi,
  },
  {
    category: "GOV_ID",
    detector: "REGEX_FIREWALL",
    pattern: /\b\d{4}[\s-]\d{4}[\s-]\d{4}\b/g,
  },
  {
    category: "IBAN",
    detector: "REGEX_FIREWALL",
    pattern: /\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]){11,30}\b/g,
    validator: (m) => passesIbanMod97(m),
  },
  {
    category: "IBAN",
    detector: "REGEX_FIREWALL",
    captureGroup: 1,
    pattern: /\b(?:iban|bank|account|wire|swift|sepa)\b[^A-Z0-9\n]{0,25}([A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]){11,30})\b/gi,
  },
  {
    category: "PASSWORD",
    detector: "REGEX_FIREWALL",
    captureGroup: 1,
    pattern:
      /\b(?:password|passwd|passcode|passphrase|pwd|login\s+pass)\s*(?:is|was|are|[:=]|->)?\s*["']?([^\s"',;\[\]\u0000*]{6,64})["']?/gi,
    validator: (m) =>
      !m.includes("[REDACTED:") &&
      !m.includes("\u0000") &&
      !PASSWORD_STOPWORDS.has(m.toLowerCase()),
  },
  {
    category: "IP_ADDRESS",
    detector: "REGEX_FIREWALL",
    minLevel: "medium",
    pattern:
      /(?<![vV\d.])\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b(?![.\d])/g,
    validator: (m) => m !== "127.0.0.1" && m !== "0.0.0.0" && m !== "255.255.255.255",
  },
  {
    category: "IP_ADDRESS",
    detector: "REGEX_FIREWALL",
    minLevel: "medium",
    pattern:
      /(?<![:\w])(?:(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4})(?![:\w])/g,
    validator: (m) => m.length >= 6 && (m.match(/:/g)?.length ?? 0) >= 2,
  },
  {
    category: "CREDIT_CARD",
    detector: "REGEX_FIREWALL",
    captureGroup: 1,
    minLevel: "medium",
    pattern:
      /\b(?:credit\s*card|debit\s*card|card\s*(?:number|no\.?|#)|cc\s*[:#])\b[^0-9\n]{0,30}(\d(?:[ -]?\d){12,18})\b/gi,
  },
  {
    category: "ACCOUNT_NUMBER",
    detector: "REGEX_FIREWALL",
    captureGroup: 1,
    minLevel: "medium",
    pattern:
      /\b(?:account\s*(?:number|no\.?|#)|acct\s*(?:number|no\.?|#)|bank\s*account|routing\s*(?:number|no\.?|#))\b[^A-Za-z0-9\n]{0,25}([A-Z0-9][A-Z0-9-]{5,19})\b/gi,
    validator: (m) => (m.match(/\d/g)?.length ?? 0) >= 4,
  },
  {
    category: "EMAIL",
    detector: "REGEX_FIREWALL",
    minLevel: "medium",
    pattern: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    category: "PHONE",
    detector: "REGEX_FIREWALL",
    minLevel: "medium",
    pattern:
      /(?<!\d[.-])(?:\+\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}|\(\d{3}\)\s*\d{3}[-.\s]\d{4}|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b)(?!\s*T\d{2}:)/g,
    validator: (m) => {
      if (/^\d{4}[-.]\d{2}[-.]\d{2}$/.test(m)) return false;
      const d = m.replace(/\D/g, "");
      return d.length >= 7 && d.length <= 15;
    },
  },
  {
    category: "PHONE",
    detector: "REGEX_FIREWALL",
    captureGroup: 1,
    minLevel: "medium",
    pattern:
      /\b(?:phone|mobile|cell|call|whatsapp|contact|number|tel|fax|ext|ph)\b[^0-9\n]{0,25}((?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[-.\s]?\d{4}(?:[-.\s]?\d{2,4})?)\b/gi,
    validator: (m) => {
      if (/^\d{4}[-.]\d{2}[-.]\d{2}$/.test(m)) return false;
      const d = m.replace(/\D/g, "");
      return d.length >= 7 && d.length <= 15;
    },
  },
  {
    category: "API_KEY",
    detector: "REGEX_FIREWALL",
    captureGroup: 1,
    pattern:
      /\b(?:(?:apis?\s*key|apikey|secret\s+key|access\s+key|auth\s+token|bearer\s+token|private\s+token|client\s+secret)(?:\s+(?:is|was|are))?\s*(?:[:=]|->)?|(?:api_key)\s+(?:is|was|are|->))\s*([^\s"',;\[\]\u0000]{6,})/gi,
    validator: (m) => !m.includes("[REDACTED:") && !m.includes("\u0000"),
  },
];

const ADDRESS_INDICATOR_REGEX =
  /\b(?:\d{1,5}\s+[A-Za-z]|\d{5,6}\b|road|rd|street|st|ave|avenue|lane|ln|layout|nagar|sector|cross|main|block|apt|flat|floor)\b/i;

const ORG_IDIOM_BLOCKLIST = new Set([
  "progress", "production", "tech", "software", "silence", "general",
  "home", "night", "remote", "shift", "me", "you", "us", "now", "free", "fine", "well", "scale",
]);

const CONTEXTUAL_HEURISTIC_RULES: RegexRule[] = [
  {
    category: "PERSON",
    detector: "HEURISTIC_GUARD",
    captureGroup: 1,
    minLevel: "medium",
    pattern:
      /\b(?:my\s+name\s+is|i\s+am\s+called|patient\s+name(?:\s+is)?|customer\s+name(?:\s+is)?|full\s+name(?:\s+is)?|name\s*[:=])\s+([A-Za-z][A-Za-z'-]{1,24}(?:\s+(?!(?:and|is|was|from|at|in|who|with|but|so|to|for|on|please|can|will|working|living)\b)[A-Za-z][A-Za-z'-]{1,24}){0,2})/gi,
  },
  {
    category: "ORG_TERM",
    detector: "HEURISTIC_GUARD",
    captureGroup: 1,
    minLevel: "medium",
    pattern:
      /\b(?:i\s+work\s+(?:in|at|for)|working\s+(?:at|for)|employed\s+(?:at|by)|my\s+company\s+is)\s+(?!(?:a|an|the|my|our|this|that|progress|production|tech|software|silence|general|home|night|remote|shift|me|you|us|now|free|fine|well|scale)\b)([A-Za-z0-9&._-]{2,28}(?:\s+(?:company|corp|corporation|inc|ltd|pvt|bank|insurance|technologies|tech|labs|group))?)/gi,
    validator: (m) => !ORG_IDIOM_BLOCKLIST.has(m.trim().toLowerCase()),
  },
  {
    category: "ADDRESS",
    detector: "HEURISTIC_GUARD",
    captureGroup: 1,
    minLevel: "medium",
    pattern:
      /\b(?:my\s+address\s+is|home\s+address(?:\s+is)?|shipping\s+address(?:\s+is)?|address\s*[:=]|residing\s+at|lives?\s+at)\s+((?:(?!\s+(?:and\s+(?:my|i|the|please|can|will|help)\b|my\s+(?:phone|email|name|api)\b|please\b|can\s+you\b))[^.\n;!?\u0000\[\]]){4,120})/gi,
  },
  {
    category: "ADDRESS",
    detector: "HEURISTIC_GUARD",
    captureGroup: 1,
    minLevel: "medium",
    pattern:
      /\blive(?:s|d)?\s+(?:at|in|near)\s+((?:(?!\s+(?:and\s+(?:my|i|the|please|can|will|help)\b|my\s+(?:phone|email|name|api)\b|please\b|can\s+you\b))[^.\n;!?\u0000\[\]]){4,120})/gi,
    validator: (m) => ADDRESS_INDICATOR_REGEX.test(m),
  },
  {
    category: "POSTAL_CODE",
    detector: "HEURISTIC_GUARD",
    captureGroup: 1,
    minLevel: "medium",
    pattern:
      /\b(?:zip|postal|post\s*code|postcode|pin\s*code|pincode)\s*(?:code)?\s*(?:is|[:=])?\s*([A-Z0-9][A-Z0-9\s-]{3,9})\b/gi,
    validator: (m) => (m.match(/\d/g)?.length ?? 0) >= 2,
  },
  {
    category: "POSTAL_CODE",
    detector: "HEURISTIC_GUARD",
    minLevel: "medium",
    pattern: /\b(?:[A-Z]{2}\s+\d{5}(?:-\d{4})?|\d{5}-\d{4})\b/g,
  },
  {
    category: "ADDRESS",
    detector: "HEURISTIC_GUARD",
    minLevel: "medium",
    pattern:
      /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9.'-]{2,25}(?:\s+[A-Za-z0-9.'-]{2,25}){0,3}\s+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?|Way|Highway|Hwy\.?|Parkway|Pkwy\.?|Court|Ct\.?|Place|Pl\.?|Circle|Cir\.?|Terrace|Ter\.?|Trail|Trl\.?|Square|Sq\.?|Cross|Main|Nagar|Layout|Sector)\b/gi,
  },
  {
    category: "ADDRESS",
    detector: "HEURISTIC_GUARD",
    minLevel: "medium",
    pattern:
      /\b(?:[NSEW]\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\s+(?:Broadway|Highway|Parkway|Boulevard|Avenue|Turnpike|Expressway)\b/g,
  },
  {
    category: "CONTEXTUAL_PHI",
    detector: "HEURISTIC_GUARD",
    minLevel: "medium",
    pattern:
      /\b(?:(?:admitted to|discharged from|diagnosed with|treated at|hospitalized at|undergoing)\s+[^.\n;)\[\]\u0000]{3,70}|(?:patient|daughter|son|wife|husband|mother|father)\b[^.\n;\[\]\u0000]{0,55}\b(?:ICU|ER|NICU|ward|hospital|clinic|chemo|chemotherapy|surgery|seizure|oncology|cardiology|biopsy|MRN|prescription)\b[^.\n;)\[\]\u0000]{0,40}\)?|(?:MRN|DOB|diagnosis)\s*[:#]\s*[^\n,;\[\]\u0000]+)/gi,
  },
  {
    category: "M_AND_A_SECRET",
    detector: "HEURISTIC_GUARD",
    minLevel: "medium",
    pattern:
      /(?:\$\d+(?:\.\d+)?\s?(?:[MBK]|million|billion)\s+(?:valuation|offer|deal|acquisition|buyout|term sheet|round)|\bProject-[A-Za-z0-9_-]{2,}\b|\b(?:acquisition target|merger with|undisclosed bid|term sheet)\b)/gi,
  },
  {
    category: "NATURAL_SECRET",
    detector: "HEURISTIC_GUARD",
    minLevel: "medium",
    pattern:
      /\b(?:(?:log\s*in|sign\s*in|unlock|authenticate)\s+using\s+(?:[^.\n'"\[\]\u0000]|'[A-Za-z]){4,80}|(?:password|passcode|passphrase|pin|credentials?)\s+(?:is|was|are|:)\s+(?:[^.\n'"\[\]\u0000]|'[A-Za-z]){3,80}|(?:admin|root|prod)\s+(?:password|passphrase)\s*[:=]\s*[^\s,;\[\]\u0000]+)/gi,
  },
  {
    category: "PERSONAL_PII_LOCATION",
    detector: "HEURISTIC_GUARD",
    minLevel: "medium",
    pattern:
      /(?:\b(?:lives?\s+(?:near|at|on|in)|home\s+address|resides?\s+at)\s+[A-Z0-9][^.\n;!?\)\[\]\u0000]{3,60}|\b(?:VP|CEO|CFO|CTO|Director|Customer|Client|Patient)\s+(?:of\s+[A-Za-z]+\s+)?\([A-Z][a-z]+\s+[A-Z][a-z]+[^)\n\[\]\u0000]{0,60}\))/g,
    validator: (m) =>
      !/^lives?\s+/i.test(m) || ADDRESS_INDICATOR_REGEX.test(m),
  },
];

const LEVEL_RANK: Record<ProtectionLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

function runRules(
  text: string,
  rules: RegexRule[],
  startCounter = 1,
  protectionLevel: ProtectionLevel = "medium",
): RedactionSpan[] {
  const spans: RedactionSpan[] = [];
  const { scanBuffer, protectedRanges } = maskProtectedTokens(text);
  let counter = startCounter;
  const activeRank = LEVEL_RANK[protectionLevel];

  for (const rule of rules) {
    const reqRank = LEVEL_RANK[rule.minLevel ?? "low"];
    if (activeRank < reqRank) {
      continue;
    }
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(scanBuffer)) !== null) {
      const fullMatch = match[0];
      if (!fullMatch) {
        break;
      }
      const groupIdx = rule.captureGroup;
      const matchedText =
        typeof groupIdx === "number" ? (match[groupIdx] ?? "") : fullMatch;
      if (!matchedText || matchedText.includes("\u0000")) {
        continue;
      }
      if (rule.validator && !rule.validator(matchedText)) {
        continue;
      }
      const start =
        typeof groupIdx === "number"
          ? match.index + Math.max(0, fullMatch.lastIndexOf(matchedText))
          : match.index;
      const end = start + matchedText.length;
      if (protectedRanges.some((pr) => start < pr.end && end > pr.start)) {
        continue;
      }
      spans.push({
        start,
        end,
        category: rule.category,
        detector: rule.detector,
        placeholder: `[REDACTED:${rule.category}_${counter++}]`,
        matchedText: text.slice(start, end),
        masked: true,
      });
    }
  }

  return spans;
}

export function detectRegexSpans(
  text: string,
  protectionLevel: ProtectionLevel = "medium",
): RedactionSpan[] {
  return runRules(text, DETERMINISTIC_REGEX_RULES, 1, protectionLevel);
}

function isLikelyNormalIdentifier(val: string): boolean {
  if (val.includes("/") || /\s/.test(val)) return true;
  if (/^[a-z]+(?:[A-Z][a-z]+)+$/.test(val)) return true; // camelCase (localStorage, useEffect)
  if (/^[a-z]+(?:-[a-z]+)+$/.test(val)) return true; // kebab-case (checkout-gateway)
  return false;
}

export function detectHighEntropySecrets(
  text: string,
  entropyThreshold = 3.25,
): RedactionSpan[] {
  const spans: RedactionSpan[] = [];
  const { scanBuffer, protectedRanges } = maskProtectedTokens(text);
  const normalizedThreshold = Number.isFinite(entropyThreshold) ? entropyThreshold : 3.25;
  const assignmentRegex =
    /\b(?:api[_-]?key|x[_-]?api[_-]?key|secret|token|access[_-]?token|refresh[_-]?token|session[_-]?token|id[_-]?token|password|passwd|pwd|client[_-]?secret|signing[_-]?key|webhook[_-]?secret|private[_-]?key|auth[_-]?secret)\\?["']?\s*(?:[:=]|%3D)\s*\\?["']?([^\s"',;\[\]\\/\u0000]{16,})\\?["']?/gi;
  let counter = 50;
  let match: RegExpExecArray | null;

  while ((match = assignmentRegex.exec(scanBuffer)) !== null) {
    const secretValue = match[1];
    if (
      !secretValue ||
      secretValue.includes("[REDACTED:") ||
      secretValue.includes("\u0000") ||
      isLikelyNormalIdentifier(secretValue)
    ) {
      continue;
    }
    const entropy = shannonEntropy(secretValue);
    const hasLower = /[a-z]/.test(secretValue);
    const hasUpper = /[A-Z]/.test(secretValue);
    const hasDigit = /[0-9]/.test(secretValue);
    const hasSymbol = /[^A-Za-z0-9]/.test(secretValue);
    const classCount = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;
    const hasStrongMix = classCount >= 3 || (hasDigit && /[_-]/.test(secretValue));

    const meetsThreshold =
      normalizedThreshold < 3.0
        ? entropy >= normalizedThreshold
        : !/^[a-z]+$/.test(secretValue) && hasStrongMix && entropy >= normalizedThreshold;

    if (meetsThreshold) {
      const valueOffset = match[0].lastIndexOf(secretValue);
      const start = match.index + Math.max(0, valueOffset);
      const end = start + secretValue.length;
      if (protectedRanges.some((pr) => start < pr.end && end > pr.start)) {
        continue;
      }
      spans.push({
        start,
        end,
        category: "HIGH_ENTROPY_SECRET",
        detector: "ENTROPY_SCANNER",
        placeholder: `[REDACTED:HIGH_ENTROPY_SECRET_${counter++}]`,
        matchedText: text.slice(start, end),
        masked: true,
      });
    }
  }

  return spans;
}

export function detectContextualHeuristicSpans(
  text: string,
  protectionLevel: ProtectionLevel = "medium",
): RedactionSpan[] {
  return runRules(text, CONTEXTUAL_HEURISTIC_RULES, 100, protectionLevel);
}

export function detectPolicyTermSpans(
  text: string,
  customTerms: string[],
  category = "POLICY_TERM",
  startCounter = 200,
): RedactionSpan[] {
  if (!customTerms || customTerms.length === 0) return [];
  const spans: RedactionSpan[] = [];
  const { scanBuffer, protectedRanges } = maskProtectedTokens(text);
  let counter = startCounter;

  for (const rawTerm of customTerms) {
    const term = rawTerm.trim();
    if (term.length < 3) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const leading = /^[A-Za-z0-9_]/.test(term) ? "\\b" : "";
    const trailing = /[A-Za-z0-9_]$/.test(term) ? "\\b" : "";
    const regex = new RegExp(`${leading}${escaped}${trailing}`, "gi");
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
      spans.push({
        start,
        end,
        category,
        detector: "POLICY_TERM",
        placeholder: `[REDACTED:${category}_${counter++}]`,
        matchedText: text.slice(start, end),
        masked: true,
      });
    }
  }

  return spans;
}

export interface LocalFirewallScanOptions {
  protectionLevel?: ProtectionLevel;
  includeHeuristics?: boolean;
  enableEntropyScanner?: boolean;
  entropyThreshold?: number;
  customTerms?: string[];
  remoteBlockedTerms?: string[];
  extraSpans?: RedactionSpan[];
}

/**
 * Deepened LocalFirewall interface: executes all deterministic on-device detectors
 * (Regex + Luhn, Shannon Entropy, Policy Terms, Remote Policy Terms, optional Contextual Heuristics)
 * and merges overlapping intervals behind a single module seam.
 */
export function scanAndRedactLocal(
  rawText: string,
  options: LocalFirewallScanOptions = {},
): { sanitizedText: string; mergedSpans: RedactionSpan[] } {
  const level: ProtectionLevel = options.protectionLevel ?? "medium";
  const defaultEntropy = level === "low" ? 3.8 : level === "high" ? 2.9 : 3.25;
  const regexSpans = detectRegexSpans(rawText, level);
  const entropySpans =
    options.enableEntropyScanner === false
      ? []
      : detectHighEntropySecrets(rawText, options.entropyThreshold ?? defaultEntropy);
  const policySpans = options.customTerms?.length
    ? detectPolicyTermSpans(rawText, options.customTerms, "POLICY_TERM", 200)
    : [];
  const remotePolicySpans = options.remoteBlockedTerms?.length
    ? detectPolicyTermSpans(rawText, options.remoteBlockedTerms, "REMOTE_POLICY", 300)
    : [];
  const heuristicSpans = options.includeHeuristics
    ? detectContextualHeuristicSpans(rawText, level)
    : [];
  const extraSpans = options.extraSpans ?? [];

  return mergeAndRedactSpans(rawText, [
    ...regexSpans,
    ...entropySpans,
    ...policySpans,
    ...remotePolicySpans,
    ...heuristicSpans,
    ...extraSpans,
  ]);
}

const MAX_HANDOFF_ENCODED_CHARS = 65_536;
const MAX_HANDOFF_TEXT_CHARS = 50_000;
const MAX_HANDOFF_TITLE_CHARS = 200;

function stripUnsafeControlChars(input: string): string {
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export function encodeHandoffPayload(payload: { title?: string; sanitizedText: string }): string {
  const json = JSON.stringify({
    title: payload.title ?? "Chrome Extension Capture",
    sanitizedText: payload.sanitizedText,
  });
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeHandoffPayload(
  hash: string,
): { title: string; sanitizedText: string } | null {
  if (!hash || !hash.includes("handoff=")) return null;
  try {
    const encoded = hash.split("handoff=")[1]?.split("&")[0] ?? "";
    if (
      !encoded ||
      encoded.length > MAX_HANDOFF_ENCODED_CHARS ||
      !/^[A-Za-z0-9\-_]+=*$/.test(encoded)
    ) {
      return null;
    }
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = JSON.parse(json) as { title?: unknown; sanitizedText?: unknown };
    if (typeof parsed.sanitizedText === "string" && parsed.sanitizedText.trim()) {
      const cleanBody = stripUnsafeControlChars(parsed.sanitizedText).slice(
        0,
        MAX_HANDOFF_TEXT_CHARS,
      );
      if (!cleanBody.trim()) return null;
      const { sanitizedText } = scanAndRedactLocal(cleanBody, {
        includeHeuristics: false,
        enableEntropyScanner: true,
      });
      const rawTitle =
        typeof parsed.title === "string" && parsed.title.trim()
          ? stripUnsafeControlChars(parsed.title.trim()).slice(0, MAX_HANDOFF_TITLE_CHARS)
          : "Chrome Extension Capture";
      return {
        title: rawTitle || "Chrome Extension Capture",
        sanitizedText,
      };
    }
  } catch {
    return null;
  }
  return null;
}
