export const TEXT_ONLY_OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

function passesLuhnCheck(rawDigits) {
  const digits = rawDigits.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (shouldDouble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

function shannonEntropy(input) {
  if (!input) return 0;
  const counts = new Map();
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

const REGEX_RULES = [
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
    validator: (m) => {
      const digits = m.replace(/\D/g, "");
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

const CONTEXTUAL_RULES = [
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

const DETECTOR_PRIORITY = {
  NANO_SEMANTIC_FIREWALL: 3,
  REGEX_FIREWALL: 2,
  ENTROPY_SCANNER: 2,
  HEURISTIC_GUARD: 1,
};

export function runLocalDeterministicScan(text, includeHeuristics = true) {
  const spans = [];
  let counter = 1;

  for (const rule of REGEX_RULES) {
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (!match[0]) break;
      if (rule.validator && !rule.validator(match[0])) continue;
      spans.push({
        start: match.index,
        end: match.index + match[0].length,
        category: rule.category,
        detector: rule.detector,
        placeholder: `[REDACTED:${rule.category}_${counter++}]`,
        matchedText: match[0],
      });
    }
  }

  const assignmentRegex =
    /\b(?:api[_-]?key|x[_-]?api[_-]?key|secret|token|access[_-]?token|refresh[_-]?token|session[_-]?token|id[_-]?token|password|passwd|pwd|client[_-]?secret|signing[_-]?key|webhook[_-]?secret|private[_-]?key|auth[_-]?secret)\\?["']?\s*(?:[:=]|%3D)\s*\\?["']?([^\s"',;\\]{12,})\\?["']?/gi;
  let eMatch;
  while ((eMatch = assignmentRegex.exec(text)) !== null) {
    const val = eMatch[1];
    if (!val || val.startsWith("[REDACTED:")) continue;
    const entropy = shannonEntropy(val);
    const hasMixedClasses =
      /[a-z]/.test(val) && (/[A-Z0-9_-]/.test(val) || /[^a-zA-Z0-9]/.test(val));
    if (entropy >= 3.25 || (val.length >= 16 && hasMixedClasses)) {
      const start = eMatch.index + Math.max(0, eMatch[0].lastIndexOf(val));
      spans.push({
        start,
        end: start + val.length,
        category: "HIGH_ENTROPY_SECRET",
        detector: "ENTROPY_SCANNER",
        placeholder: `[REDACTED:HIGH_ENTROPY_SECRET_${counter++}]`,
        matchedText: val,
      });
    }
  }

  if (includeHeuristics) {
    for (const rule of CONTEXTUAL_RULES) {
      const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
      let match;
      while ((match = regex.exec(text)) !== null) {
        if (!match[0]) break;
        spans.push({
          start: match.index,
          end: match.index + match[0].length,
          category: rule.category,
          detector: rule.detector,
          placeholder: `[REDACTED:${rule.category}_${counter++}]`,
          matchedText: match[0],
        });
      }
    }
  }

  return spans;
}

export function mergeSpans(rawText, spans) {
  if (spans.length === 0) return { sanitizedText: rawText, mergedSpans: [] };
  const sorted = [...spans].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const lenDiff = b.end - b.start - (a.end - a.start);
    if (lenDiff !== 0) return lenDiff;
    return (DETECTOR_PRIORITY[b.detector] ?? 0) - (DETECTOR_PRIORITY[a.detector] ?? 0);
  });

  const merged = [];
  for (const span of sorted) {
    const prev = merged[merged.length - 1];
    if (!prev || span.start >= prev.end) {
      merged.push({ ...span });
      continue;
    }
    if (span.end > prev.end) {
      prev.end = span.end;
      prev.matchedText = rawText.slice(prev.start, prev.end);
    }
    if ((DETECTOR_PRIORITY[span.detector] ?? 0) > (DETECTOR_PRIORITY[prev.detector] ?? 0)) {
      prev.detector = span.detector;
      prev.category = span.category;
      prev.placeholder = span.placeholder;
    }
  }

  let sanitizedText = rawText;
  for (let i = merged.length - 1; i >= 0; i--) {
    const s = merged[i];
    sanitizedText = sanitizedText.slice(0, s.start) + s.placeholder + sanitizedText.slice(s.end);
  }
  return { sanitizedText, mergedSpans: merged };
}

export async function runExtensionNanoScan(rawText) {
  if (!globalThis.LanguageModel?.availability) {
    const spans = runLocalDeterministicScan(rawText, true);
    return { nanoActive: false, ...mergeSpans(rawText, spans) };
  }

  const avail = await globalThis.LanguageModel.availability(TEXT_ONLY_OPTIONS);
  if (avail !== "available" && avail !== "readily") {
    const spans = runLocalDeterministicScan(rawText, true);
    return { nanoActive: false, nanoState: avail, ...mergeSpans(rawText, spans) };
  }

  let session = null;
  try {
    const params = globalThis.LanguageModel.params ? await globalThis.LanguageModel.params() : null;
    session = await globalThis.LanguageModel.create({
      ...TEXT_ONLY_OPTIONS,
      ...(params?.defaultTopK ? { topK: Math.min(3, params.maxTopK ?? 3), temperature: 0.1 } : {}),
    });
    const prompt = [
      'Return ONLY JSON: {"entities":[{"type":"CONTEXTUAL_PHI|M_AND_A_SECRET|NATURAL_SECRET","value":"exact substring"}]}',
      "Copy exact verbatim sensitive substrings only.",
      rawText.slice(0, 1400),
    ].join("\n");
    const rawJson = await session.prompt(prompt);
    const cleaned = rawJson.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
    const startIdx = cleaned.indexOf("{");
    const endIdx = cleaned.lastIndexOf("}");
    const parsed = startIdx !== -1 && endIdx > startIdx ? JSON.parse(cleaned.slice(startIdx, endIdx + 1)) : {};
    const nanoSpans = [];
    let counter = 1;
    for (const item of parsed.entities ?? []) {
      const phrase = typeof item?.value === "string" ? item.value.trim() : "";
      if (phrase.length < 3) continue;
      const idx = rawText.indexOf(phrase);
      if (idx !== -1) {
        const category = String(item.type || "SEMANTIC_PII").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
        nanoSpans.push({
          start: idx,
          end: idx + phrase.length,
          category,
          detector: "NANO_SEMANTIC_FIREWALL",
          placeholder: `[REDACTED:${category}_${counter++}]`,
          matchedText: phrase,
        });
      }
    }
    const baseSpans = runLocalDeterministicScan(rawText, false);
    return { nanoActive: true, nanoState: avail, ...mergeSpans(rawText, [...baseSpans, ...nanoSpans]) };
  } catch {
    const spans = runLocalDeterministicScan(rawText, true);
    return { nanoActive: false, nanoState: avail, ...mergeSpans(rawText, spans) };
  } finally {
    session?.destroy?.();
  }
}

export function buildSanitizedHandoffUrl(title, sanitizedText, baseUrl = "https://para-1-2e22b.web.app/") {
  const json = JSON.stringify({ title, sanitizedText });
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  const base64url = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${baseUrl}#handoff=${base64url}`;
}
