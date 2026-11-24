import type { DetectorSource, ProtectionLevel, RedactionSpan } from "../types/triage";
import {
  mergeAndRedactSpans,
  prepareNormalizedScanView,
  stripZeroWidthAndObfuscation,
  type NormalizedScanView,
} from "./spanMerger";

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
  const cleaned = raw.replace(/[\s\u00A0\u00AD\u200B-\u200D\uFEFF-]/g, "").toUpperCase();
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
      /-----BEGIN(?:%20|\s)+(?:RSA(?:%20|\s)+|EC(?:%20|\s)+|DSA(?:%20|\s)+|OPENSSH(?:%20|\s)+|ENCRYPTED(?:%20|\s)+|PGP(?:%20|\s)+)?PRIVATE(?:%20|\s)+KEY(?:(?:%20|\s)+BLOCK)?-----[\s\S]{1,16384}?-----END(?:%20|\s)+(?:RSA(?:%20|\s)+|EC(?:%20|\s)+|DSA(?:%20|\s)+|OPENSSH(?:%20|\s)+|ENCRYPTED(?:%20|\s)+|PGP(?:%20|\s)+)?PRIVATE(?:%20|\s)+KEY(?:(?:%20|\s)+BLOCK)?-----/gi,
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
    // The optional quote after the name covers JSON camelCase: "SecretAccessKey".
    category: "AWS_SECRET_KEY",
    detector: "REGEX_FIREWALL",
    pattern:
      /\b(?:aws[_-]?)?secret[_-]?access[_-]?key\b["']?\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/gi,
  },
  {
    category: "API_KEY",
    detector: "REGEX_FIREWALL",
    pattern:
      /\b(?:AIza[0-9A-Za-z\-_]{20,}|(?:sk|pk|rk)_(?:live|test)_[ \t]?[0-9A-Za-z]{16,}|sk-(?:proj-|ant-)?[0-9A-Za-z\-_]{20,}|(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{22,}|xox[baprs]-[0-9A-Za-z\-]{10,}|glpat-[A-Za-z0-9_-]{15,}|hf_[A-Za-z0-9]{20,}|SK[0-9a-fA-F]{32}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{20,}|pypi-[A-Za-z0-9_-]{20,}|shp(?:at|ca|pa|ss)_[0-9a-fA-F]{20,}|ddapi_[A-Za-z0-9_-]{16,}|lin_api_[A-Za-z0-9]{20,}|sbp_[0-9a-fA-F]{20,}|glsa_[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{14}\.atlasv1\.[A-Za-z0-9_-]{20,}|PMAK-[0-9a-fA-F]{20,}-[0-9a-fA-F]{20,}|pul-[0-9a-fA-F]{20,}|pplx-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}|dop_v1_[0-9a-fA-F]{32,})\b/g,
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
    pattern: /(?<![\d.-])\b\d(?:[ .-]?\d){12,18}\b/g,
    validator: (matched) => {
      const digits = matched.replace(/\D/g, "");
      if (digits.length < 13 || digits.length > 19) return false;
      // Recognised IIN prefix (Visa, Mastercard, Amex, RuPay) + Luhn, so a 16-digit order id
      // is not a card.
      const isKnownCardPrefix =
        /^(?:4\d{12}(?:\d{3})?(?:\d{3})?|5[1-5]\d{14}|2(?:2[2-9]\d{12}|[3-6]\d{13}|7[01]\d{12}|720\d{12})|3[47]\d{13}|6(?:011|5\d{2})\d{12}|(?:60|81|82)\d{14}|508\d{13})$/.test(
          digits,
        );
      if (!isKnownCardPrefix) return false;
      return passesLuhnCheck(digits);
    },
  },
  {
    // UPI VPA. Listed before EMAIL so an NPCI handle is named for what it is; the trailing
    // lookahead keeps "user@ybl.com" an email.
    category: "UPI_ID",
    detector: "REGEX_FIREWALL",
    minLevel: "medium",
    pattern:
      /\b[A-Za-z0-9][A-Za-z0-9._-]{1,40}@(?:oksbi|okicici|okhdfcbank|okhdfc|okaxis|okbizaxis|ybl|ibl|axl|paytm|apl|upi|jupiteraxis|yapl|sliceaxis|fam|axisb|airtel|freecharge|ikwik|jio|waaxis|wahdfcbank|waicici|wasbi)(?!\.[A-Za-z])\b/gi,
    validator: (m) => !m.startsWith(".") && !m.includes(".."),
  },
  {
    // Forms often group a PAN as "ABCPD 1234 F". The cue keeps the spaced shape from firing on
    // prose that happens to look like five letters and four digits.
    category: "PAN_ID",
    detector: "REGEX_FIREWALL",
    captureGroup: 1,
    pattern:
      /\b(?:pan|permanent\s+account\s+number)\s*(?:no\.?|number)?\s*[:#-]?\s*([A-Z]{3}[PCHFATBLJG][A-Z][ ]?\d{4}[ ]?[A-Z])\b/gi,
  },
  {
    // Indian PAN: 5 letters (4th is the assessee type), 4 digits, 1 letter.
    category: "PAN_ID",
    detector: "REGEX_FIREWALL",
    pattern: /\b[A-Z]{3}[PCHFATBLJG][A-Z](?!0000)\d{4}[A-Z]\b/gi,
  },
  {
    // Indian IFSC: 4 bank letters, a literal 0, then the branch code.
    category: "IFSC",
    detector: "REGEX_FIREWALL",
    pattern: /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi,
  },
  {
    category: "CARD_EXPIRY",
    detector: "REGEX_FIREWALL",
    captureGroup: 1,
    minLevel: "medium",
    pattern:
      /\b(?:exp(?:iry|iration)?\s*(?:date)?|valid\s*(?:thru|through|until|till))\s*[:\-]?\s*((?:0?[1-9]|1[0-2])\s*[/\-]\s*(?:\d{2}|\d{4}))\b/gi,
    validator: (m) => {
      const [month, year] = m.split(/[/\-]/).map((part) => part.trim());
      const y = Number(year);
      return (
        Number(month) >= 1 &&
        Number(month) <= 12 &&
        (year.length === 4 ? y >= 2000 && y <= 2099 : y >= 0 && y <= 99)
      );
    },
  },
  {
    category: "CVV",
    detector: "REGEX_FIREWALL",
    captureGroup: 1,
    minLevel: "medium",
    pattern:
      /\b(?:cvv2?|cvc2?|cid|csc|security\s*code|card\s*verification(?:\s*(?:value|code))?)\b\s*(?:is|:|=|#|-)?\s*(\d{3,4})(?!\d)/gi,
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
    // Aadhaar's 4-4-4 shape. The trailing lookahead stops a card from being read as a 12-digit
    // Aadhaar prefix while the user is still typing it ("4111 1111 1111 1111").
    pattern: /\b\d{4}[\s-]\d{4}[\s-]\d{4}(?![\s-]\d)\b/g,
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
      /\b(?:credit\s*card|debit\s*card|card\s*(?:number|no\.?|#)|cc\s*[:#])\b[^0-9\n]{0,30}(\d(?:[ .-]?\d){12,18})\b/gi,
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
      // "invoice number INV-2026-0042" is an identifier, not a line. A bare NNNN-NNNN is never
      // dialable; the space form (Hong Kong's 2345 6789) still is.
      if (/^\d{4}[-.]\d{4}$/.test(m)) return false;
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
      // "invoice number INV-2026-0042" is an identifier, not a line. A bare NNNN-NNNN is never
      // dialable; the space form (Hong Kong's 2345 6789) still is.
      if (/^\d{4}[-.]\d{4}$/.test(m)) return false;
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

// A door/plot/block identifier. The leading lookbehind stops the match starting inside a
// version string ("v2.1/A") or an identifier ("INV-2026-0042").
const ADDRESS_DOOR_REGEX =
  /(?<![\w.])(?:\d{1,5}[A-Za-z]?[/-][A-Za-z0-9]{1,4}|#\s?\d{1,5}[A-Za-z]?|[A-Z]-\d{1,4}|(?:plot|flat|door|house)(?!\s*(?:no\.?|number|#))\s*[A-Z]?\d{1,5}[A-Za-z]?|(?:block|unit|apt|apartment|suite)\s*(?:no\.?|#)?\s*[A-Z]?\d{1,5}[A-Za-z]?)(?![\w/])/i;

const ADDRESS_LOCALITY_REGEX =
  /\b(?:main|cross|layout|nagar|colony|phase|sector|block|enclave|extension|marg|gali|street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|way|highway|hwy\.?|parkway|pkwy\.?|court|ct\.?|place|terrace|apartments?|flats?|residency|vihar|pura|bagh|chowk)\b/i;

const ADDRESS_LOCALITY_AT_END =
  /\b(?:main|cross|layout|nagar|colony|phase|sector|block|enclave|extension|marg|gali|street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|way|highway|hwy\.?|parkway|pkwy\.?|court|ct\.?|place|terrace|apartments?|flats?|residency|vihar|pura|bagh|chowk)\s*$/i;

const ADDRESS_PIN_AT_END = /(?:\b\d{6}|\b\d{5}(?:-\d{4})?)\s*$/;

function looksLikeAddressBody(body: string): boolean {
  const text = body.trim();
  if (!/\d/.test(text)) return false;
  if (ADDRESS_DOOR_REGEX.test(text)) return true;
  const hasLocality = ADDRESS_LOCALITY_REGEX.test(text);
  if (!hasLocality) return false;
  // "address 12 main street" has no comma but is unambiguous: a number opens the body.
  if (/^\s*(?:#\s*)?\d{1,5}[A-Za-z]?(?![\w.])/.test(text)) return true;
  return ADDRESS_PIN_AT_END.test(text) || text.includes(",");
}

function looksLikeStandaloneAddress(body: string): boolean {
  const text = body.trim();
  if (!/\d/.test(text)) return false;
  // A year-serial pair ("2026-0042") or a date ("2026-11-22") is an identifier, not a door number.
  if (/^(?:\d{4}-\d{4}|\d{4}-\d{2}-\d{2})\b/.test(text)) return false;
  if (ADDRESS_PIN_AT_END.test(text)) return true;
  if (!ADDRESS_LOCALITY_REGEX.test(text)) return false;
  if (text.includes(",")) return true;
  // No comma, no PIN: the street marker has to close the span, so "7 main street cafe"
  // stays a sentence and "742 Evergreen Terrace" stays an address.
  return ADDRESS_LOCALITY_AT_END.test(text) && /^\s*(?:\d{1,5}[A-Za-z]?[/-]|#)/.test(text);
}

const ORG_IDIOM_BLOCKLIST = new Set([
  "progress", "production", "tech", "software", "silence", "general",
  "home", "night", "remote", "shift", "me", "you", "us", "now", "free", "fine", "well", "scale",
]);

/**
 * Words that follow "I am", "this is" or "call me" far more often than a real name does.
 * The weak cues only fire on a capitalised token outside this set, which is what keeps
 * "i am ready", "i am testing" and "this is fine" out of the PERSON bucket.
 */
const NAME_STOPWORDS = new Set([
  "ready", "testing", "test", "done", "here", "there", "going", "working", "fine", "good",
  "great", "bad", "ok", "okay", "sure", "sorry", "busy", "happy", "tired", "new", "back",
  "out", "in", "on", "up", "not", "no", "yes", "still", "also", "just", "very", "really",
  "the", "a", "an", "this", "that", "it", "he", "she", "they", "we", "you", "i",
  "afraid", "glad", "sad", "angry", "late", "early", "free", "available", "online",
  "offline", "using", "trying", "looking", "writing", "reading", "learning", "building",
  "running", "waiting", "checking", "asking", "curious", "confused", "stuck", "blocked",
  "hungry", "sleepy", "wrong", "correct", "right", "important", "possible", "clear",
  "unclear", "awesome", "amazing", "terrible", "broken", "fixed", "live", "dead",
  "production", "staging", "development", "deploying", "merging", "pushing", "reviewing",
  "updating", "migrating", "debugging", "coding", "shipping", "releasing", "investigating",
  "monitoring", "restarting", "responding", "reporting", "sending", "joining", "leaving",
  "finished", "complete", "completed", "starting", "stopping", "installing",
]);

function looksLikePersonName(m: string): boolean {
  const text = m.trim();
  if (!text) return false;
  return !NAME_STOPWORDS.has(text.split(" ")[0].toLowerCase());
}

function looksLikeWeakPersonName(m: string): boolean {
  const text = m.trim();
  if (!text || !/^[A-Z]/.test(text)) return false;
  return looksLikePersonName(text);
}

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
    // Weak self-introduction cues. The name must start with a capital, so "i am ready" never
    // reaches the validator, and the stopword list catches "I am Testing the build".
    category: "PERSON",
    detector: "HEURISTIC_GUARD",
    captureGroup: 1,
    minLevel: "medium",
    pattern:
      /\b(?:i\s+am|i'm|call\s+me|this\s+is)\s+([A-Za-z][A-Za-z'-]{1,24}(?:\s+(?!(?:and|is|was|from|at|in|who|with|but|so|to|for|on|please|can|will|working|living|the|a|an)\b)[A-Za-z][A-Za-z'-]{1,24}){0,2})/gi,
    validator: looksLikeWeakPersonName,
  },
  {
    // KYC forms sign off with a name after "Signature:"; without this the block's last line
    // survives while the address above it is redacted.
    category: "PERSON",
    detector: "HEURISTIC_GUARD",
    captureGroup: 1,
    minLevel: "medium",
    pattern:
      /\b(?:signature|signed\s+by|authorised\s+signatory|authorized\s+signatory)\s*[:=]?\s*([A-Za-z][A-Za-z.'-]{1,24}(?:\s+[A-Za-z][A-Za-z.'-]{1,24}){0,3})/gi,
    validator: looksLikePersonName,
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
    // Cue-anchored address. The cue stays outside the span so the cloud model still knows what
    // the placeholder means. A newline continues the address only when the next line still looks
    // like one (a digit or a comma); a blank line, a lower-case prose line or a "Field:" label
    // ends it, so "address 143/A\n2nd Cross, Bengaluru 560038" is one span while
    // "address 143/A\nthe build failed" is not.
    category: "ADDRESS",
    detector: "HEURISTIC_GUARD",
    captureGroup: 1,
    minLevel: "medium",
    pattern:
      /\b(?:address|addr|house\s*(?:no\.?|number)|flat\s*(?:no\.?|number)|door\s*(?:no\.?|number)|plot\s*(?:no\.?|number)|residing\s+at|resides?\s+at|shipping\s+(?:to|address)|deliver(?:y)?\s+to|lives?\s+at|located\s+at)\b\s*(?:is|was|:|=|-)?\s*((?=[^\n]{0,160}?\d)(?:(?!\s+(?:and|but)\s+(?:my|the|i|we|please|call|email|phone|contact)\b)[^\[\]\u0000]){4,160}?)(?=\s*(?:[;|!?](?:\s|$)|\n\s*\n|\n\s*[A-Za-z][A-Za-z ]{1,18}[:=]|\n(?!\s*[^\n]{0,60}(?:\d|,))|$|\.(?=\s+[A-Z]|\s*$)|(?:card|upi|pan|ifsc|cvv|cvc|cid|csc|exp|expiry|account|acct|iban|vpa)\b))/gi,
    validator: looksLikeAddressBody,
  },
  {
    // Standalone address: no cue, so a door token plus a locality marker or a terminal PIN/ZIP
    // is required. A version string like v2.1/A never reaches this point.
    category: "ADDRESS",
    detector: "HEURISTIC_GUARD",
    captureGroup: 1,
    minLevel: "medium",
    pattern:
      /(?<![\w.])((?:\d{1,5}[A-Za-z]?[/-][A-Za-z0-9]{1,4}|#\s?\d{1,5}[A-Za-z]?|[A-Z]-\d{1,4}|(?:plot|flat|door|house)(?!\s*(?:no\.?|number|#))\s*[A-Z]?\d{1,5}[A-Za-z]?|(?:block|unit|apt|apartment|suite)\s*(?:no\.?|#)?\s*[A-Z]?\d{1,5}[A-Za-z]?)(?:(?![.;!?](?:\s|$))[^\n\[\]\u0000]){0,80}?)(?=\s*(?:[;|!?](?:\s|$)|\n|$|\.(?=\s+[A-Z]|\s*$)|(?:card|upi|pan|ifsc|cvv|cvc|cid|csc|exp|expiry|account|acct|iban|vpa)\b))/gi,
    validator: looksLikeStandaloneAddress,
  },
  {
    // Secondary address line: "Apt 4B", "Suite 200", "Flat 302". Unambiguous unit words only,
    // so "unit 5 failed" in a test log stays prose.
    category: "ADDRESS",
    detector: "HEURISTIC_GUARD",
    captureGroup: 1,
    minLevel: "medium",
    pattern:
      /(?<![\w.])((?:apt|apartment|suite|ste|flat)\.?\s*[A-Z]?\d{1,5}[A-Za-z]?(?:\s*[,·]\s*(?:(?!(?:card|upi|pan|ifsc|cvv|cvc|cid|csc|exp|expiry|account|acct|iban|vpa)\b)[A-Za-z0-9 '-]){2,30})?)/gi,
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
    // Standalone Western street. The trailing group carries the city and ZIP that follow the
    // street word, but only when a 5/6-digit postal code closes them, so prose after the comma
    // ("221 Baker Street, and then we left") stays prose.
    category: "ADDRESS",
    detector: "HEURISTIC_GUARD",
    minLevel: "medium",
    pattern:
      /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9.'-]{2,25}(?:\s+[A-Za-z0-9.'-]{2,25}){0,3}\s+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?|Way|Highway|Hwy\.?|Parkway|Pkwy\.?|Court|Ct\.?|Place|Pl\.?|Circle|Cir\.?|Terrace|Ter\.?|Trail|Trl\.?|Square|Sq\.?|Cross|Main|Nagar|Layout|Sector)\b(?:,\s*[A-Za-z0-9 .,'-]{1,40}?\d{5,6}(?:-\d{4})?)?/gi,
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
  precomputedView?: NormalizedScanView,
): RedactionSpan[] {
  const spans: RedactionSpan[] = [];
  const view = precomputedView ?? prepareNormalizedScanView(text);
  let counter = startCounter;
  const activeRank = LEVEL_RANK[protectionLevel];

  for (const rule of rules) {
    const reqRank = LEVEL_RANK[rule.minLevel ?? "low"];
    if (activeRank < reqRank) {
      continue;
    }
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(view.scanBuffer)) !== null) {
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
      const normStart =
        typeof groupIdx === "number"
          ? match.index + Math.max(0, fullMatch.lastIndexOf(matchedText))
          : match.index;
      const normEnd = normStart + matchedText.length;
      if (normStart < 0 || normEnd <= normStart || normEnd > view.scanBuffer.length) {
        continue;
      }
      const start = view.rawStart(normStart);
      const end = view.rawEnd(normEnd);
      if (
        start < 0 ||
        end <= start ||
        end > text.length ||
        view.protectedRanges.some((pr) => start < pr.end && end > pr.start)
      ) {
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
  const view = prepareNormalizedScanView(text);
  const spans = runRules(text, DETERMINISTIC_REGEX_RULES, 1, protectionLevel, view);
  const cards = spans.filter((span) => span.category === "CREDIT_CARD");
  if (cards.length === 0) return spans;
  for (const extra of detectCardBundleSpans(text, cards, spans.length + 1, view)) {
    if (!spans.some((span) => span.start === extra.start)) spans.push(extra);
  }
  return spans;
}

const CARD_EXPIRY_TOKEN = /(?<![\d.\-/])(?:0?[1-9]|1[0-2])\s*[/\-]\s*(?:\d{2}|\d{4})(?![\d.\-/T])/g;
const CARD_CVV_LABEL =
  /\b(?:cvv2?|cvc2?|cid|csc|security\s*code|card\s*verification(?:\s*(?:value|code))?)\b\s*(?:is|:|=|#|-)?\s*(\d{3,4})(?!\d)/gi;
const CARD_BARE_DIGITS = /(?<![\d.\-/=])(\d{3,4})(?![\d.\-/])/g;
const CARD_UNIT_AFTER =
  /^\s*(?:%|ms\b|px\b|k\b|m\b|gb\b|mb\b|kb\b|hrs?\b|am\b|pm\b|orders?\b|days?\b|hours?\b|mins?\b|seconds?\b|items?\b|users?\b|requests?\b|retries?\b)/i;
const CARD_YEAR_LIKE = /^(?:19|20)\d{2}$/;

/**
 * CVV and expiry only mean something next to a card. A bare 3-digit number is never a CVV
 * unless a Luhn-valid card (or that card's expiry) sits within 80 characters of it.
 *
 * The token regexes always run over the whole buffer: slicing a window would let a lookbehind
 * succeed at index 0 and turn "4111-1111" into an expiry, which then licenses unrelated digits.
 */
export function detectCardBundleSpans(
  text: string,
  cardSpans: RedactionSpan[],
  startCounter: number,
  precomputedView?: NormalizedScanView,
): RedactionSpan[] {
  const view = precomputedView ?? prepareNormalizedScanView(text);
  const buf = view.scanBuffer;
  const extras: RedactionSpan[] = [];
  let counter = startCounter;
  const push = (normStart: number, normEnd: number, category: string) => {
    if (normStart < 0 || normEnd <= normStart || normEnd > buf.length) return;
    const start = view.rawStart(normStart);
    const end = view.rawEnd(normEnd);
    if (start < 0 || end <= start || end > text.length) return;
    if (view.protectedRanges.some((pr) => start < pr.end && end > pr.start)) return;
    if (extras.some((span) => start < span.end && end > span.start)) return;
    extras.push({
      start,
      end,
      category,
      detector: "HEURISTIC_GUARD",
      placeholder: `[REDACTED:${category}_${counter++}]`,
      matchedText: text.slice(start, end),
      masked: true,
    });
  };
  const normCards = cardSpans.map((card) => ({
    start: view.toNormIndex(card.start),
    end: view.toNormIndex(card.end),
  }));
  const overlapsCard = (start: number, end: number) =>
    normCards.some((card) => start < card.end && end > card.start);

  for (const card of normCards) {
    const from = Math.max(0, card.start - 80);
    const to = Math.min(buf.length, card.end + 80);
    const inWindow = (start: number, end: number) => start >= from && end <= to;
    const expiries: Array<{ start: number; end: number }> = [];

    CARD_EXPIRY_TOKEN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CARD_EXPIRY_TOKEN.exec(buf)) !== null) {
      if (match[0].includes("\u0000")) continue;
      const start = match.index;
      const end = start + match[0].length;
      if (!inWindow(start, end) || overlapsCard(start, end)) continue;
      expiries.push({ start, end });
      push(start, end, "CARD_EXPIRY");
    }

    CARD_CVV_LABEL.lastIndex = 0;
    while ((match = CARD_CVV_LABEL.exec(buf)) !== null) {
      if (match[0].includes("\u0000")) continue;
      const start = match.index + match[0].lastIndexOf(match[1]);
      const end = start + match[1].length;
      if (!inWindow(start, end)) continue;
      push(start, end, "CVV");
    }

    // A bare code is only accepted when the window also carries an expiry, which is what
    // separates a card bundle from an order number sitting near a card number.
    if (expiries.length === 0) continue;
    CARD_BARE_DIGITS.lastIndex = 0;
    while ((match = CARD_BARE_DIGITS.exec(buf)) !== null) {
      if (match[0].includes("\u0000")) continue;
      const start = match.index;
      const end = start + match[0].length;
      if (!inWindow(start, end) || overlapsCard(start, end)) continue;
      if (expiries.some((e) => start < e.end && end > e.start)) continue;
      if (CARD_YEAR_LIKE.test(match[1])) continue;
      if (CARD_UNIT_AFTER.test(buf.slice(end, end + 12))) continue;
      push(start, end, "CVV");
    }
  }
  return extras;
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
  const view = prepareNormalizedScanView(text);
  const normalizedThreshold = Number.isFinite(entropyThreshold) ? entropyThreshold : 3.25;
  const assignmentRegex =
    /\b(?:api[_-]?key|x[_-]?api[_-]?key|secret|token|access[_-]?token|refresh[_-]?token|session[_-]?token|id[_-]?token|password|passwd|pwd|client[_-]?secret|signing[_-]?key|webhook[_-]?secret|private[_-]?key|auth[_-]?secret)\\?["']?\s*(?:[:=]|%3D)\s*\\?["']?([^\s"',;\[\]\\/\u0000]{16,})\\?["']?/gi;
  let counter = 50;
  let match: RegExpExecArray | null;

  while ((match = assignmentRegex.exec(view.scanBuffer)) !== null) {
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
      const normStart = match.index + Math.max(0, valueOffset);
      const normEnd = normStart + secretValue.length;
      if (normStart < 0 || normEnd <= normStart || normEnd > view.scanBuffer.length) {
        continue;
      }
      const start = view.rawStart(normStart);
      const end = view.rawEnd(normEnd);
      if (
        start < 0 ||
        end <= start ||
        end > text.length ||
        view.protectedRanges.some((pr) => start < pr.end && end > pr.start)
      ) {
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
  const view = prepareNormalizedScanView(text);
  let counter = startCounter;

  for (const rawTerm of customTerms) {
    const term = stripZeroWidthAndObfuscation(rawTerm).trim();
    if (term.length < 3) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const leading = /^[A-Za-z0-9_]/.test(term) ? "\\b" : "";
    const trailing = /[A-Za-z0-9_]$/.test(term) ? "\\b" : "";
    const regex = new RegExp(`${leading}${escaped}${trailing}`, "gi");
    let match: RegExpExecArray | null;

    while ((match = regex.exec(view.scanBuffer)) !== null) {
      if (match[0].includes("\u0000")) continue;
      const normStart = match.index;
      const normEnd = normStart + match[0].length;
      if (normStart < 0 || normEnd <= normStart || normEnd > view.scanBuffer.length) continue;
      const start = view.rawStart(normStart);
      const end = view.rawEnd(normEnd);
      if (
        start < 0 ||
        end <= start ||
        end > text.length ||
        view.protectedRanges.some((pr) => start < pr.end && end > pr.start)
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
    let encoded = hash.split("handoff=")[1]?.split("&")[0] ?? "";
    if (!encoded || encoded.length > MAX_HANDOFF_ENCODED_CHARS) return null;
    if (encoded.includes("%")) {
      encoded = decodeURIComponent(encoded);
    }
    if (
      !encoded ||
      encoded.length > MAX_HANDOFF_ENCODED_CHARS ||
      !/^[A-Za-z0-9\-_+/]+=*$/.test(encoded)
    ) {
      return null;
    }
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as { title?: unknown; sanitizedText?: unknown };
    if (typeof record.sanitizedText === "string" && record.sanitizedText.trim()) {
      const cleanBody = stripUnsafeControlChars(record.sanitizedText).slice(
        0,
        MAX_HANDOFF_TEXT_CHARS,
      );
      if (!cleanBody.trim()) return null;
      const handoffScanOpts: LocalFirewallScanOptions = {
        protectionLevel: "medium",
        includeHeuristics: true,
        enableEntropyScanner: true,
        remoteBlockedTerms: ["Project-Apollo", "Project-Valkyrie"],
      };
      const { sanitizedText } = scanAndRedactLocal(cleanBody, handoffScanOpts);
      const rawTitle =
        typeof record.title === "string" && record.title.trim()
          ? stripUnsafeControlChars(record.title.trim()).slice(0, MAX_HANDOFF_TITLE_CHARS)
          : "Chrome Extension Capture";
      const scrubbedTitle = rawTitle
        ? scanAndRedactLocal(rawTitle, handoffScanOpts).sanitizedText.slice(
            0,
            MAX_HANDOFF_TITLE_CHARS,
          )
        : "Chrome Extension Capture";
      return {
        title: scrubbedTitle || "Chrome Extension Capture",
        sanitizedText,
      };
    }
  } catch {
    return null;
  }
  return null;
}
