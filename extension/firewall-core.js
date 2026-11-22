(function (root) {
  "use strict";

  const TEXT_ONLY_OPTIONS = {
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

  function passesIbanMod97(raw) {
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

  const CANONICAL_CATEGORIES = new Set([
    "API_KEY", "AWS_ACCESS_KEY", "AWS_SECRET_KEY", "SECRET", "PASSWORD", "BEARER_OR_JWT",
    "PRIVATE_KEY", "DB_URI", "CREDIT_CARD", "GOV_ID", "PHONE", "EMAIL",
    "ADDRESS", "PERSON", "ORG_TERM", "PHI", "M_AND_A_SECRET", "HIGH_ENTROPY",
    "IP_ADDRESS", "IBAN", "ACCOUNT_NUMBER", "POSTAL_CODE", "SENSITIVE",
  ]);

  const CATEGORY_SYNONYMS = {
    KEY: "API_KEY", TOKEN: "API_KEY", CREDENTIAL: "API_KEY", APIKEY: "API_KEY",
    NAME: "PERSON", PERSON_PII: "PERSON", FIRSTNAME: "PERSON", LASTNAME: "PERSON",
    COMPANY: "ORG_TERM", ORG: "ORG_TERM", ORGANIZATION: "ORG_TERM",
    LOCATION: "ADDRESS", STREET: "ADDRESS", PERSONAL_PII_LOCATION: "ADDRESS",
    MEDICAL: "PHI", HEALTH: "PHI", CONTEXTUAL_PHI: "PHI", MEDICAL_PHI: "PHI",
    SSN: "GOV_ID", US_SSN: "GOV_ID", PAN: "GOV_ID", PASSPORT: "GOV_ID", AADHAAR: "GOV_ID",
    MOBILE: "PHONE", TEL: "PHONE", TELEPHONENUM: "PHONE", PHONENUMBER: "PHONE",
    IP: "IP_ADDRESS", IPV4: "IP_ADDRESS", IPV6: "IP_ADDRESS",
    ZIP: "POSTAL_CODE", ZIPCODE: "POSTAL_CODE", PINCODE: "POSTAL_CODE",
    PEM_PRIVATE_KEY: "PRIVATE_KEY", DB_CONNECTION_URI: "DB_URI",
    HIGH_ENTROPY_SECRET: "HIGH_ENTROPY", NATURAL_SECRET: "SECRET",
  };

  function normalizeRedactionCategory(rawType) {
    if (!rawType || typeof rawType !== "string") return "SENSITIVE";
    const cleaned = rawType.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    if (!cleaned) return "SENSITIVE";
    if (CANONICAL_CATEGORIES.has(cleaned)) return cleaned;
    if (CATEGORY_SYNONYMS[cleaned]) return CATEGORY_SYNONYMS[cleaned];
    if (/\d/.test(cleaned) || cleaned.length > 24) return "SENSITIVE";
    return "SENSITIVE";
  }

  const NANO_CUE_PHRASE_REGEX =
    /^(?:my\s+)?(?:apis?\s*key|secret\s*key|access\s*key|auth\s*token|password|passcode|passphrase|pin|phone(?:\s+number)?|email|address|full\s+name|name|company)\s*(?:is|was|are|:|=)?$/i;

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

  const NANO_STOPWORDS = new Set([
    "the", "and", "for", "with", "this", "that", "from", "have", "will", "can",
    "please", "help", "later", "tomorrow", "progress", "production", "scale",
    "localhost", "you", "are", "was", "were", "not", "but", "all", "any",
    "how", "who", "what", "when", "where", "why",
  ]);

  function getProtectedPlaceholderRanges(rawText) {
    const ranges = [];
    const regex = /\[REDACTED:[A-Z0-9_]+\]/g;
    let m;
    while ((m = regex.exec(rawText)) !== null) {
      ranges.push({ start: m.index, end: m.index + m[0].length });
    }
    return ranges;
  }

  function maskProtectedTokens(rawText) {
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

  function isLikelyNormalIdentifier(val) {
    if (val.includes("/") || /\s/.test(val)) return true;
    if (/^[a-z]+(?:[A-Z][a-z]+)+$/.test(val)) return true;
    if (/^[a-z]+(?:-[a-z]+)+$/.test(val)) return true;
    return false;
  }

  const CONTEXTUAL_RULES = [
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
      validator: (m) => !/^lives?\s+/i.test(m) || ADDRESS_INDICATOR_REGEX.test(m),
    },
  ];

  const LEVEL_RANK = { low: 0, medium: 1, high: 2 };

  const DETECTOR_PRIORITY = {
    NANO_SEMANTIC_FIREWALL: 3,
    REGEX_FIREWALL: 2,
    ENTROPY_SCANNER: 2,
    HEURISTIC_GUARD: 1,
  };

  function runLocalDeterministicScan(text, includeHeuristics = true, protectionLevel = "medium") {
    const spans = [];
    const { scanBuffer, protectedRanges } = maskProtectedTokens(text);
    let counter = 1;
    const activeRank = LEVEL_RANK[protectionLevel] ?? 1;
    const entropyThreshold = protectionLevel === "low" ? 3.8 : protectionLevel === "high" ? 2.9 : 3.25;

    for (const rule of REGEX_RULES) {
      if (activeRank < (LEVEL_RANK[rule.minLevel || "low"] ?? 0)) continue;
      const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
      let match;
      while ((match = regex.exec(scanBuffer)) !== null) {
        if (!match[0]) break;
        const matchedText =
          typeof rule.captureGroup === "number" ? (match[rule.captureGroup] || "") : match[0];
        if (!matchedText || matchedText.includes("\u0000")) continue;
        if (rule.validator && !rule.validator(matchedText)) continue;
        const start =
          typeof rule.captureGroup === "number"
            ? match.index + Math.max(0, match[0].lastIndexOf(matchedText))
            : match.index;
        const end = start + matchedText.length;
        if (protectedRanges.some((pr) => start < pr.end && end > pr.start)) continue;
        spans.push({
          start,
          end,
          category: rule.category,
          detector: rule.detector,
          placeholder: `[REDACTED:${rule.category}_${counter++}]`,
          matchedText: text.slice(start, end),
        });
      }
    }

    const assignmentRegex =
      /\b(?:api[_-]?key|x[_-]?api[_-]?key|secret|token|access[_-]?token|refresh[_-]?token|session[_-]?token|id[_-]?token|password|passwd|pwd|client[_-]?secret|signing[_-]?key|webhook[_-]?secret|private[_-]?key|auth[_-]?secret)\\?["']?\s*(?:[:=]|%3D)\s*\\?["']?([^\s"',;\[\]\\/\u0000]{16,})\\?["']?/gi;
    let eMatch;
    while ((eMatch = assignmentRegex.exec(scanBuffer)) !== null) {
      const val = eMatch[1];
      if (!val || val.includes("[REDACTED:") || val.includes("\u0000") || isLikelyNormalIdentifier(val)) {
        continue;
      }
      const entropy = shannonEntropy(val);
      const hasLower = /[a-z]/.test(val);
      const hasUpper = /[A-Z]/.test(val);
      const hasDigit = /[0-9]/.test(val);
      const hasSymbol = /[^A-Za-z0-9]/.test(val);
      const classCount = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;
      const hasStrongMix = classCount >= 3 || (hasDigit && /[_-]/.test(val));
      const meets =
        entropyThreshold < 3.0
          ? entropy >= entropyThreshold
          : !/^[a-z]+$/.test(val) && hasStrongMix && entropy >= entropyThreshold;

      if (meets) {
        const start = eMatch.index + Math.max(0, eMatch[0].lastIndexOf(val));
        const end = start + val.length;
        if (protectedRanges.some((pr) => start < pr.end && end > pr.start)) continue;
        spans.push({
          start,
          end,
          category: "HIGH_ENTROPY_SECRET",
          detector: "ENTROPY_SCANNER",
          placeholder: `[REDACTED:HIGH_ENTROPY_SECRET_${counter++}]`,
          matchedText: text.slice(start, end),
        });
      }
    }

    if (includeHeuristics) {
      for (const rule of CONTEXTUAL_RULES) {
        if (activeRank < (LEVEL_RANK[rule.minLevel || "low"] ?? 0)) continue;
        const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
        let match;
        while ((match = regex.exec(scanBuffer)) !== null) {
          if (!match[0]) break;
          const matchedText =
            typeof rule.captureGroup === "number" ? (match[rule.captureGroup] || "") : match[0];
          if (!matchedText || matchedText.includes("\u0000")) continue;
          if (rule.validator && !rule.validator(matchedText)) continue;
          const start =
            typeof rule.captureGroup === "number"
              ? match.index + Math.max(0, match[0].lastIndexOf(matchedText))
              : match.index;
          const end = start + matchedText.length;
          if (protectedRanges.some((pr) => start < pr.end && end > pr.start)) continue;
          spans.push({
            start,
            end,
            category: rule.category,
            detector: rule.detector,
            placeholder: `[REDACTED:${rule.category}_${counter++}]`,
            matchedText: text.slice(start, end),
          });
        }
      }
    }

    return spans;
  }

  function mergeSpans(rawText, spans) {
    if (spans.length === 0) return { sanitizedText: rawText, mergedSpans: [] };

    const protectedRanges = [];
    const placeholderRegex = /\[REDACTED:[A-Z0-9_]+\]/g;
    let pMatch;
    while ((pMatch = placeholderRegex.exec(rawText)) !== null) {
      protectedRanges.push({ start: pMatch.index, end: pMatch.index + pMatch[0].length });
    }
    const safeSpans = spans.filter((s) => {
      if (s.matchedText && s.matchedText.includes("[REDACTED:")) return false;
      return !protectedRanges.some((pr) => s.start < pr.end && s.end > pr.start);
    });
    if (safeSpans.length === 0) return { sanitizedText: rawText, mergedSpans: [] };

    const sorted = [...safeSpans].sort((a, b) => {
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

  const CREDENTIAL_CATS = new Set([
    "API_KEY",
    "AWS_ACCESS_KEY",
    "AWS_SECRET_KEY",
    "BEARER_OR_JWT",
    "PEM_PRIVATE_KEY",
    "PRIVATE_KEY",
    "DB_CONNECTION_URI",
    "DB_URI",
    "PASSWORD",
    "NATURAL_SECRET",
  ]);

  const PII_CATS = new Set([
    "CONTEXTUAL_PHI",
    "MEDICAL_PHI",
    "CREDIT_CARD",
    "US_SSN",
    "PHONE",
    "EMAIL",
    "PERSONAL_PII_LOCATION",
  ]);

  function computeQuickRiskScore(masks) {
    let credCount = 0;
    let piiCount = 0;
    let corpCount = 0;
    let entropyCount = 0;
    let nanoCaught = false;

    for (const m of masks || []) {
      const cat = String(m.category || "").toUpperCase();
      if (CREDENTIAL_CATS.has(cat)) credCount++;
      else if (PII_CATS.has(cat)) piiCount++;
      else if (cat === "HIGH_ENTROPY_SECRET") entropyCount++;
      else corpCount++;
      if (m.detector === "ENTROPY_SCANNER" && cat !== "HIGH_ENTROPY_SECRET") entropyCount++;
      if (m.detector === "NANO_SEMANTIC_FIREWALL") nanoCaught = true;
    }

    const score = Math.min(
      100,
      Math.min(60, credCount * 30) +
        Math.min(40, piiCount * 20) +
        Math.min(30, corpCount * 15) +
        Math.min(10, entropyCount * 5) +
        (nanoCaught ? 10 : 0),
    );
    const tier =
      score >= 80 ? "CRITICAL" : score >= 55 ? "HIGH" : score >= 25 ? "ELEVATED" : "LOW";
    return { score, tier };
  }

  function scrubSync(rawText, includeHeuristics = true, protectionLevel = "medium") {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const spans = runLocalDeterministicScan(rawText, includeHeuristics, protectionLevel);
    const { sanitizedText, mergedSpans } = mergeSpans(rawText, spans);
    const riskProfile = computeQuickRiskScore(mergedSpans);
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    return {
      sanitizedText,
      mergedSpans,
      riskProfile,
      protectionLevel,
      latencyMs: Math.max(0.1, Number((t1 - t0).toFixed(2))),
    };
  }

  async function runExtensionNanoScan(rawText, options = {}) {
    const timeoutMs = options.timeoutMs ?? 3500;
    if (!globalThis.LanguageModel?.availability) {
      const spans = runLocalDeterministicScan(rawText, true);
      const merged = mergeSpans(rawText, spans);
      return {
        nanoActive: false,
        ...merged,
        riskProfile: computeQuickRiskScore(merged.mergedSpans),
      };
    }

    const avail = await globalThis.LanguageModel.availability(TEXT_ONLY_OPTIONS);
    if (avail !== "available" && avail !== "readily") {
      const spans = runLocalDeterministicScan(rawText, true);
      const merged = mergeSpans(rawText, spans);
      return {
        nanoActive: false,
        nanoState: avail,
        ...merged,
        riskProfile: computeQuickRiskScore(merged.mergedSpans),
      };
    }

    let session = null;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const params = globalThis.LanguageModel.params ? await globalThis.LanguageModel.params() : null;
      session = await globalThis.LanguageModel.create({
        ...TEXT_ONLY_OPTIONS,
        ...(params?.defaultTopK ? { topK: Math.min(3, params.maxTopK ?? 3), temperature: 0.1 } : {}),
        ...(controller ? { signal: controller.signal } : {}),
      });
      const prompt = [
        'Return ONLY JSON: {"entities":[{"type":"CONTEXTUAL_PHI|M_AND_A_SECRET|NATURAL_SECRET","value":"exact substring"}]}',
        "Copy exact verbatim sensitive substrings only.",
        rawText.slice(0, 1400),
      ].join("\n");
      const rawJson = await session.prompt(prompt, controller ? { signal: controller.signal } : undefined);
      const cleaned = rawJson.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
      const startIdx = cleaned.indexOf("{");
      const endIdx = cleaned.lastIndexOf("}");
      const parsed = startIdx !== -1 && endIdx > startIdx ? JSON.parse(cleaned.slice(startIdx, endIdx + 1)) : {};
      const nanoSpans = [];
      let counter = 1;
      const { scanBuffer, protectedRanges } = maskProtectedTokens(rawText);
      for (const item of parsed.entities ?? []) {
        const phrase = typeof item?.value === "string" ? item.value.trim() : "";
        if (
          phrase.length < 3 ||
          phrase.includes("[REDACTED:") ||
          phrase.includes("\u0000") ||
          !/[A-Za-z0-9]/.test(phrase) ||
          NANO_CUE_PHRASE_REGEX.test(phrase) ||
          NANO_STOPWORDS.has(phrase.toLowerCase())
        ) {
          continue;
        }
        const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const leading = /^[A-Za-z0-9_]/.test(phrase) ? "\\b" : "";
        const trailing = /[A-Za-z0-9_]$/.test(phrase) ? "\\b" : "";
        const rx = new RegExp(`${leading}${escaped}${trailing}`, "gi");
        let m;
        while ((m = rx.exec(scanBuffer)) !== null) {
          const start = m.index;
          const end = start + m[0].length;
          if (
            m[0].includes("\u0000") ||
            protectedRanges.some((pr) => start < pr.end && end > pr.start)
          ) {
            continue;
          }
          const category = normalizeRedactionCategory(item.type);
          nanoSpans.push({
            start,
            end,
            category,
            detector: "NANO_SEMANTIC_FIREWALL",
            placeholder: `[REDACTED:${category}_${counter++}]`,
            matchedText: rawText.slice(start, end),
          });
        }
      }
      const baseSpans = runLocalDeterministicScan(rawText, false);
      const merged = mergeSpans(rawText, [...baseSpans, ...nanoSpans]);
      return {
        nanoActive: true,
        nanoState: avail,
        ...merged,
        riskProfile: computeQuickRiskScore(merged.mergedSpans),
      };
    } catch {
      const spans = runLocalDeterministicScan(rawText, true);
      const merged = mergeSpans(rawText, spans);
      return {
        nanoActive: false,
        nanoState: avail,
        ...merged,
        riskProfile: computeQuickRiskScore(merged.mergedSpans),
      };
    } finally {
      if (timer) clearTimeout(timer);
      session?.destroy?.();
    }
  }

  const NON_SEND_LABELS = [
    "save", "save changes", "cancel", "delete", "close", "search",
    "sign in", "sign up", "log in", "login", "upload", "attach", "add files",
  ];

  /**
   * Decides whether a keydown is a send attempt worth intercepting.
   * Plain Enter sends in rich-text composers; textareas need Ctrl/Cmd+Enter so
   * Enter keeps inserting newlines. Shift+Enter is always a newline.
   */
  function shouldInterceptSendKey({ key, isTextarea, ctrlKey, metaKey, shiftKey, altKey, level }) {
    if (key !== "Enter" || level === "low") return false;
    if (shiftKey || altKey) return false;
    if (isTextarea) return Boolean(ctrlKey || metaKey);
    return !ctrlKey && !metaKey;
  }

  /** Rejects form submits whose label is clearly not a Send action. */
  function isLikelyNonSendButton(label) {
    const norm = String(label || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!norm) return false;
    return NON_SEND_LABELS.some((bad) => norm === bad || norm.startsWith(`${bad} `));
  }

  /**
   * Plain-language label for the side panel's "Manual Mode" pill. Never returns
   * a raw extension id or an internal scheme.
   */
  function describeManualHost(tabUrl) {
    let host = "";
    try {
      const parsed = new URL(String(tabUrl || ""));
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "this browser tab";
      host = parsed.hostname || "";
    } catch {
      return "this browser tab";
    }
    // Chrome extension ids are 32 chars in the a-p range.
    if (!host || /^[a-p]{32}$/i.test(host)) return "this browser tab";
    return host;
  }

  function buildSanitizedHandoffUrl(title, sanitizedText, baseUrl = "https://para-1-2e22b.web.app/") {
    const json = JSON.stringify({ title, sanitizedText });
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    for (const b of bytes) {
      binary += String.fromCharCode(b);
    }
    const base64url = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `${baseUrl}#handoff=${base64url}`;
  }

  root.LocalFirstFirewall = {
    TEXT_ONLY_OPTIONS,
    normalizeRedactionCategory,
    runLocalDeterministicScan,
    mergeSpans,
    computeQuickRiskScore,
    scrubSync,
    runExtensionNanoScan,
    buildSanitizedHandoffUrl,
    describeManualHost,
    shouldInterceptSendKey,
    isLikelyNonSendButton,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
