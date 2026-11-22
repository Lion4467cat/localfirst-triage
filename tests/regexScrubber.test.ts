import { describe, it, expect } from "vitest";
import {
  detectContextualHeuristicSpans,
  detectHighEntropySecrets,
  detectPolicyTermSpans,
  detectRegexSpans,
  encodeHandoffPayload,
  decodeHandoffPayload,
  passesLuhnCheck,
  scanAndRedactLocal,
  shannonEntropy,
} from "../src/firewall/regexScrubber";

describe("regexScrubber", () => {
  it("scans long hyphen/dot runs in linear time (email ReDoS guard)", () => {
    const small = "a" + "-b".repeat(2_000); // 4k chars
    const large = "a" + "-b".repeat(8_000); // 16k chars
    detectRegexSpans(large); // warm up

    const t0 = performance.now();
    detectRegexSpans(small);
    const smallMs = performance.now() - t0;

    const t1 = performance.now();
    const spans = detectRegexSpans(large);
    const largeMs = performance.now() - t1;

    expect(spans).toEqual([]);
    expect(largeMs).toBeLessThan(100);
    expect(largeMs / Math.max(smallMs, 0.1)).toBeLessThan(10);
  });

  it("detects Google/OpenAI/GitHub API keys, JWTs, Bearer tokens, emails, and phones", () => {
    const firebaseKey = ["AI", "zaSyD-1234567890abcdefghijklmnopqrs"].join("");
    const openAiKey = ["sk", "proj", "abcdefghijklmnopqrstuvwxyz123456"].join("-");
    const githubPat = ["gh", "p_1234567890abcdefghijklmnopqrstuvwxyz"].join("");
    const input = [
      "Contact alice.ops@example.com or +1 (415) 555-0199.",
      "Header: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTYifQ.signaturepart",
      `Leaked keys: ${firebaseKey} and ${openAiKey}`,
      `Token: ${githubPat}`,
    ].join("\n");

    const spans = detectRegexSpans(input);
    const categories = new Set(spans.map((s) => s.category));

    expect(categories.has("EMAIL")).toBe(true);
    expect(categories.has("PHONE")).toBe(true);
    expect(categories.has("BEARER_OR_JWT")).toBe(true);
    expect(categories.has("API_KEY")).toBe(true);
    expect(spans.every((s) => s.detector === "REGEX_FIREWALL")).toBe(true);
  });

  it("returns empty array for clean technical text", () => {
    const input = "HTTP 504 Gateway Timeout on checkout-service port 8080 after deploy v2.4.1.";
    expect(detectRegexSpans(input)).toEqual([]);
  });

  it("detects AWS keys, PEM private keys, DB URIs, SSNs, Stripe live keys, and non-JWT Bearer tokens", () => {
    const awsKey = ["AK", "IAIOSFODNN7EXAMPLE"].join("");
    const stripeKey = ["sk_", "live_51N9x8y7z6w5v4u3t2s1r"].join("");
    const pemHeader = ["-----BEGIN ", "RSA PRIVATE KEY-----"].join("");
    const pemFooter = ["-----END ", "RSA PRIVATE KEY-----"].join("");
    const input = [
      `AWS=${awsKey}`,
      "DB=postgres://svc:mySecret99@db.internal:5432/prod",
      `Stripe=${stripeKey}`,
      "Authorization: Bearer opaque_session_token_9876543210abc",
      "SSN: 123-45-6789",
      `${pemHeader}\nMIIEowIBAAKCAQEAtest\n${pemFooter}`,
    ].join("\n");

    const spans = detectRegexSpans(input);
    const categories = new Set(spans.map((s) => s.category));

    expect(categories.has("AWS_ACCESS_KEY")).toBe(true);
    expect(categories.has("DB_CONNECTION_URI")).toBe(true);
    expect(categories.has("API_KEY")).toBe(true);
    expect(categories.has("BEARER_OR_JWT")).toBe(true);
    expect(categories.has("US_SSN")).toBe(true);
    expect(categories.has("PEM_PRIVATE_KEY")).toBe(true);
  });

  it("redacts the 40-char AWS secret access key that follows an access key ID", () => {
    const accessKeyId = ["AK", "IAIOSFODNN7EXAMPLE"].join("");
    const secret = ["wJalr", "XUtnFEMI", "/K7MDENG", "/bPxRfiCYEXAMPLEKEY"].join("");
    const raw = [
      `AWS_ACCESS_KEY_ID=${accessKeyId}`,
      `AWS_SECRET_ACCESS_KEY=${secret}`,
      "region=us-east-1",
    ].join("\n");

    // Must fire at the DEFAULT protection level (medium), not only at high.
    const res = scanAndRedactLocal(raw, { protectionLevel: "medium" });
    expect(res.sanitizedText).not.toContain(secret);
    expect(res.sanitizedText).not.toContain("wJalrXUtnFEMI");
    const categories = res.mergedSpans.map((s) => s.category);
    expect(categories).toContain("AWS_SECRET_KEY");
    expect(categories).toContain("AWS_ACCESS_KEY");
    expect(res.sanitizedText).toContain("[REDACTED:AWS_SECRET_KEY_");
  });

  it("validates credit cards via Luhn checksum and rejects non-Luhn numeric IDs", () => {
    expect(passesLuhnCheck("4532-0151-1283-0366")).toBe(true);
    expect(passesLuhnCheck("4532-0151-1283-0367")).toBe(false);

    const input = "Valid card: 4532-0151-1283-0366 | Trace ID: 1795-2422-8142-4999";
    const spans = detectRegexSpans(input).filter((s) => s.category === "CREDIT_CARD");
    expect(spans).toHaveLength(1);
    expect(spans[0].matchedText).toBe("4532-0151-1283-0366");
  });

  it("detects high-entropy credential assignments locally", () => {
    expect(shannonEntropy("aaaa")).toBe(0);
    const webhookSecret = ["wh", "sec_9Kf8Lm2Qp7Zx4Tv1Bn6Yc3Rd8Wx5Hj2M"].join("");
    const input = `webhook_secret=${webhookSecret}\nlog_level=info`;
    const spans = detectHighEntropySecrets(input);
    expect(spans).toHaveLength(1);
    expect(spans[0].detector).toBe("ENTROPY_SCANNER");
    expect(spans[0].matchedText).toBe(webhookSecret);
  });

  it("generalizes contextual heuristics across unseen clinical, financial, password, and location phrases", () => {
    const input = [
      "Patient was hospitalized at St Jude Oncology Center for chemotherapy.",
      "Project-Orion $120M acquisition deal term sheet leaked.",
      "VP of Finance (Priya Nair, who lives near Indiranagar 100ft Road) escalated.",
      "Support note: passphrase is golden-otter-sunrise-99.",
    ].join("\n");

    const spans = detectContextualHeuristicSpans(input);
    const categories = new Set(spans.map((s) => s.category));
    expect(categories.has("CONTEXTUAL_PHI")).toBe(true);
    expect(categories.has("M_AND_A_SECRET")).toBe(true);
    expect(categories.has("PERSONAL_PII_LOCATION")).toBe(true);
    expect(categories.has("NATURAL_SECRET")).toBe(true);
  });

  it("applies custom workspace policy terms cleanly", () => {
    const spans = detectPolicyTermSpans("Deploy ApolloV2 on AcmeSecretCluster now.", [
      "ApolloV2",
      "AcmeSecretCluster",
    ]);
    expect(spans).toHaveLength(2);
    expect(spans.every((s) => s.detector === "POLICY_TERM")).toBe(true);
  });

  it("covers all 5 built-in demo scenarios cleanly under fallback scanning without Nano 4", async () => {
    const { DEMO_SCENARIOS } = await import("../src/config/demoScenarios");
    const { mergeAndRedactSpans } = await import("../src/firewall/spanMerger");
    for (const sc of DEMO_SCENARIOS) {
      const merged = mergeAndRedactSpans(sc.rawText, [
        ...detectRegexSpans(sc.rawText),
        ...detectHighEntropySecrets(sc.rawText),
        ...detectContextualHeuristicSpans(sc.rawText),
      ]);
      expect(merged.mergedSpans.length).toBeGreaterThan(0);
    }
  });

  it("redacts JSON-quoted high-entropy secrets, URL-encoded DB URIs/PEM blocks, and resists ReDoS on malformed digit sequences", () => {
    const adversarialInput = [
      '{"api_key": "xK9#mP2$vL5@nQ8!rT1wZ4", "client_secret": "s3cr3t_V9mK2pL8qR4tW7y"}',
      "Query param: access_token%3Dey9KmP2vL5nQ8rT1wZ4xK9mP2",
      "Encoded DB: postgresql%3A%2F%2Fadmin%3ASuperSecret99%40db.internal%3A5432%2Fprod",
      `Escaped DB: mongodb+srv:\\/\\/svc:MyMongoPass123@cluster0.example.net\\/admin`,
      `${["-----BEGIN", "%20PGP%20", "PRIVATE%20KEY%20BLOCK-----"].join("")}%0AmQINBFtestKeyData%0A${["-----END", "%20PGP%20", "PRIVATE%20KEY%20BLOCK-----"].join("")}`,
    ].join("\n");

    const regexSpans = detectRegexSpans(adversarialInput);
    const entropySpans = detectHighEntropySecrets(adversarialInput);
    const regexCategories = new Set(regexSpans.map((s) => s.category));

    expect(regexCategories.has("DB_CONNECTION_URI")).toBe(true);
    expect(regexCategories.has("PEM_PRIVATE_KEY")).toBe(true);
    expect(entropySpans.length).toBeGreaterThanOrEqual(3);

    // ReDoS linear-time check on pathological digit-hyphen string
    const pathologicalDigits = "4" + "-1".repeat(2500) + "X";
    const startMs = performance.now();
    const ccSpans = detectRegexSpans(pathologicalDigits);
    const elapsedMs = performance.now() - startMs;
    expect(ccSpans).toEqual([]);
    expect(elapsedMs).toBeLessThan(200);
  });

  it("deepens local scanning and ExtensionHandoff behind scanAndRedactLocal and encodeHandoffPayload/decodeHandoffPayload", () => {
    const raw =
      'P0 error on Project-Nebula with {"api_key": "xK9#mP2$vL5@nQ8!rT1wZ4"} and patient admitted to Manipal ICU Floor 3.';
    const result = scanAndRedactLocal(raw, {
      includeHeuristics: true,
      enableEntropyScanner: true,
      customTerms: ["Project-Nebula"],
    });

    expect(result.sanitizedText).not.toContain("Project-Nebula");
    expect(result.sanitizedText).not.toContain("xK9#mP2$vL5@nQ8!rT1wZ4");
    expect(result.sanitizedText).not.toContain("Manipal ICU Floor 3");
    expect(result.mergedSpans.length).toBeGreaterThanOrEqual(3);

    const fakeAwsKey = ["AK", "IAIOSFODNN7EXAMPLE"].join("");
    const encodedHash = encodeHandoffPayload({
      title: "Incident\u0000Title",
      sanitizedText: `Leaked ${fakeAwsKey} in handoff`,
    });
    const decoded = decodeHandoffPayload(`#handoff=${encodedHash}`);
    expect(decoded).not.toBeNull();
    expect(decoded?.title).toBe("IncidentTitle");
    expect(decoded?.sanitizedText).not.toContain(fakeAwsKey);
    expect(decoded?.sanitizedText).toContain("[REDACTED:AWS_ACCESS_KEY_");
  });

  it("applies dynamic Remote Config entropyThreshold and enterprise remoteBlockedTerms", () => {
    const lowEntropyPayload =
      "api_key=aaabbbcccdddeeefffgg\nAffected internal initiative: Project-Apollo and Project-Valkyrie.";

    // Default entropyThreshold (3.25) skips the repetitive 20-char lowercase string (entropy ~2.78)
    const defaultScan = scanAndRedactLocal(lowEntropyPayload, {
      entropyThreshold: 3.25,
    });
    expect(defaultScan.sanitizedText).toContain("aaabbbcccdddeeefffgg");

    // Hardened Remote Config (entropyThreshold: 2.5 + remoteBlockedTerms) catches both without redeploying
    const hardenedScan = scanAndRedactLocal(lowEntropyPayload, {
      entropyThreshold: 2.5,
      remoteBlockedTerms: ["Project-Apollo", "Project-Valkyrie"],
    });
    expect(hardenedScan.sanitizedText).not.toContain("aaabbbcccdddeeefffgg");
    expect(hardenedScan.sanitizedText).toContain("[REDACTED:HIGH_ENTROPY_SECRET_");
    expect(hardenedScan.sanitizedText).not.toContain("Project-Apollo");
    expect(hardenedScan.sanitizedText).not.toContain("Project-Valkyrie");
    expect(hardenedScan.sanitizedText).toContain("[REDACTED:REMOTE_POLICY_");
  });

  it("catches natural-language bare phone, lowercase name, employer, and low-entropy labeled API key", () => {
    const sample =
      "my phone number is 9876543210 and my name is ravi and i work in Zenith company , and my api key is 23224324234kjjjkjl";
    const res = scanAndRedactLocal(sample, { includeHeuristics: true });
    expect(res.mergedSpans.length).toBe(4);
    expect(res.sanitizedText).not.toContain("9876543210");
    expect(res.sanitizedText).not.toContain("ravi");
    expect(res.sanitizedText).not.toContain("Zenith company");
    expect(res.sanitizedText).not.toContain("23224324234kjjjkjl");
    expect(res.sanitizedText).toContain("[REDACTED:PHONE_");
    expect(res.sanitizedText).toContain("[REDACTED:PERSON_");
    expect(res.sanitizedText).toContain("[REDACTED:ORG_TERM_");
    expect(res.sanitizedText).toContain("[REDACTED:API_KEY_");
  });

  it("respects 3 protection levels (low vs medium vs high) and preserves surrounding text byte-for-byte", () => {
    const sample =
      "my phone number is 9876543210 and my name is ravi and i work in Zenith company , and my api key is 23224324234kjjjkjl";

    const lowRes = scanAndRedactLocal(sample, {
      protectionLevel: "low",
      includeHeuristics: true,
    });
    expect(lowRes.sanitizedText).not.toContain("23224324234kjjjkjl");
    expect(lowRes.sanitizedText).toContain("9876543210");
    expect(lowRes.sanitizedText).toContain("ravi");
    expect(lowRes.sanitizedText).toContain("Zenith company");

    for (const level of ["medium", "high"] as const) {
      const res = scanAndRedactLocal(sample, {
        protectionLevel: level,
        includeHeuristics: true,
      });
      expect(res.mergedSpans.length).toBe(4);
      expect(res.sanitizedText).not.toContain("9876543210");
      expect(res.sanitizedText).not.toContain("ravi");
      expect(res.sanitizedText).not.toContain("Zenith company");
      expect(res.sanitizedText).not.toContain("23224324234kjjjkjl");
    }

    const p0Line = "URGENT P0 Outage in checkout-gateway after v4.8.2 deploy.\nCustomer John's daughter (Manipal ICU Floor 3).";
    const mergedP0 = scanAndRedactLocal(p0Line, {
      protectionLevel: "medium",
      includeHeuristics: true,
      extraSpans: [
        {
          start: p0Line.indexOf("Manipal ICU Floor 3"),
          end: p0Line.indexOf("Manipal ICU Floor 3") + "Manipal ICU Floor 3".length,
          category: "CONTEXTUAL_PHI",
          detector: "NANO_SEMANTIC_FIREWALL",
          placeholder: "[REDACTED:CONTEXTUAL_PHI_1]",
          matchedText: "Manipal ICU Floor 3",
          masked: true,
        },
      ],
    });
    expect(mergedP0.sanitizedText.startsWith("URGENT P0 Outage in checkout-gateway after v4.8.2 deploy.")).toBe(true);
  });

  it("redacts full multi-segment comma-separated addresses including locality and PIN/ZIP in medium mode", () => {
    const sample =
      "my address is 42 Oak Street, Koramangala, Bengaluru 560034 and my name is ravi";
    const res = scanAndRedactLocal(sample, {
      protectionLevel: "medium",
      includeHeuristics: true,
    });
    expect(res.sanitizedText).not.toContain("42 Oak Street");
    expect(res.sanitizedText).not.toContain("Koramangala");
    expect(res.sanitizedText).not.toContain("Bengaluru");
    expect(res.sanitizedText).not.toContain("560034");
    expect(res.sanitizedText).not.toContain("ravi");
    expect(res.sanitizedText).toContain("[REDACTED:ADDRESS_");
    expect(res.sanitizedText).toContain("[REDACTED:PERSON_");
  });

  it("is strictly idempotent across 3 consecutive passes (0 new masks on pass 2 and pass 3)", () => {
    const awsKey = ["AK", "IAIOSFODNN7EXAMPLE"].join("");
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.sig12345";
    const inputs = [
      `my address is 42 Oak Street, Koramangala, Bengaluru 560034 and my name is ravi and my phone number is 9876543210 and my api key is 23224324234kjjjkjl`,
      `I work in Zenith company. Key: ${awsKey} | Bearer ${jwt}`,
    ];
    for (const raw of inputs) {
      const pass1 = scanAndRedactLocal(raw, { protectionLevel: "medium", includeHeuristics: true });
      expect(pass1.mergedSpans.length).toBeGreaterThan(0);

      const pass2 = scanAndRedactLocal(pass1.sanitizedText, { protectionLevel: "medium", includeHeuristics: true });
      expect(pass2.mergedSpans.length).toBe(0);
      expect(pass2.sanitizedText).toBe(pass1.sanitizedText);

      const pass3 = scanAndRedactLocal(pass2.sanitizedText, { protectionLevel: "high", includeHeuristics: true });
      expect(pass3.mergedSpans.length).toBe(0);
      expect(pass3.sanitizedText).toBe(pass1.sanitizedText);
    }
  });

  it("enforces zero false positives on everyday/dev prose and strict sentence boundary preservation", () => {
    const zeroFpCases = [
      "This feature is a work in progress and will go live in production tomorrow. Call me later if it breaks.",
      "My app works at scale using localStorage and contenteditable inside checkout-gateway after v4.8.2 deploy.",
      "Please explain how Docker containers talk to each other on localhost port 8080.",
    ];
    for (const prose of zeroFpCases) {
      for (const level of ["low", "medium"] as const) {
        const res = scanAndRedactLocal(prose, { protectionLevel: level, includeHeuristics: true });
        expect(res.mergedSpans).toEqual([]);
        expect(res.sanitizedText).toBe(prose);
      }
    }

    const addrCase = "my address is 42 Oak Street, Koramangala, Bengaluru 560034. Please fix the login bug after this.";
    const addrRes = scanAndRedactLocal(addrCase, { protectionLevel: "medium", includeHeuristics: true });
    expect(addrRes.sanitizedText).not.toContain("42 Oak Street");
    expect(addrRes.sanitizedText).not.toContain("560034");
    expect(addrRes.sanitizedText).toContain("Please fix the login bug after this.");

    const phoneCase = "my phone number is 9876543210 and my name is ravi. Can you help me write a python script?";
    const phoneRes = scanAndRedactLocal(phoneCase, { protectionLevel: "medium", includeHeuristics: true });
    expect(phoneRes.sanitizedText).not.toContain("9876543210");
    expect(phoneRes.sanitizedText).not.toContain("ravi");
    expect(phoneRes.sanitizedText).toContain("Can you help me write a python script?");
  });

  it("fixes P0 redaction-tag leak for malformed Nano categories and plural 'apis key' cues", async () => {
    const { buildSemanticSpans, mergeAndRedactSpans, normalizeRedactionCategory } = await import(
      "../src/firewall/spanMerger"
    );
    expect(normalizeRedactionCategory("544245453")).toBe("SENSITIVE");
    expect(normalizeRedactionCategory("MY_APIS_KEY_IS")).toBe("SENSITIVE");

    const raw = "my apis key is 544245453";
    const localRes = scanAndRedactLocal(raw, { protectionLevel: "medium", includeHeuristics: true });
    expect(localRes.sanitizedText).toBe("my apis key is [REDACTED:API_KEY_1]");

    const nanoSpans = buildSemanticSpans(raw, [
      { category: "MY_APIS_KEY_IS", phrase: "my apis key is" },
      { category: "544245453", phrase: "544245453" },
    ]);
    const nanoMerged = mergeAndRedactSpans(raw, nanoSpans);
    expect(nanoMerged.sanitizedText).toBe("my apis key is [REDACTED:SENSITIVE_1]");
    expect(nanoMerged.sanitizedText).not.toContain("544245453");
  });
});
