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

  it("redacts Indian and Western addresses behind an explicit cue, keeping the cue readable", () => {
    const cases: Array<[string, string[]]> = [
      [
        "customer address 143/A, 4th Cross, Indiranagar, Bengaluru 560047",
        ["143/A", "4th Cross", "Indiranagar", "560047"],
      ],
      ["house no 42-B, Sector 21, Gurugram, Haryana 122016", ["42-B", "Sector 21", "122016"]],
      ["plot no. 9, Jubilee Hills, Road No. 36, Hyderabad 500033", ["Jubilee Hills", "500033"]],
      ["shipping to 742 Evergreen Terrace, Springfield 62704", ["Evergreen Terrace", "62704"]],
    ];
    for (const [raw, mustVanish] of cases) {
      const res = scanAndRedactLocal(raw, { protectionLevel: "medium", includeHeuristics: true });
      for (const fragment of mustVanish) expect(res.sanitizedText).not.toContain(fragment);
      expect(res.sanitizedText).toContain("[REDACTED:ADDRESS_");
      expect(res.mergedSpans.some((span) => span.category === "ADDRESS")).toBe(true);
    }
    const cued = scanAndRedactLocal("customer address 143/A, 4th Cross, Indiranagar 560047", {
      protectionLevel: "medium",
      includeHeuristics: true,
    });
    // The cue stays outside the span so the cloud model still knows what was removed.
    expect(cued.sanitizedText.startsWith("customer address ")).toBe(true);
  });

  it("carries a line-continued address into one span without swallowing prose", () => {
    const multiline = "Address: 143/A, 2nd Cross\nIndiranagar, Bengaluru 560038";
    const res = scanAndRedactLocal(multiline, { protectionLevel: "medium", includeHeuristics: true });
    for (const fragment of ["2nd Cross", "Indiranagar", "Bengaluru", "560038"]) {
      expect(res.sanitizedText, fragment).not.toContain(fragment);
    }
    expect(res.sanitizedText.startsWith("Address: [REDACTED:ADDRESS_")).toBe(true);

    // A lower-case prose line is not a continuation.
    const prose = "address 143/A\nthe build failed because the cache was stale";
    const proseRes = scanAndRedactLocal(prose, { protectionLevel: "medium", includeHeuristics: true });
    expect(proseRes.sanitizedText).toContain("the build failed because the cache was stale");

    // Neither is the next labelled field.
    const labelled = "Address: 143/A, 2nd Cross\nPAN: ABCPE1234F";
    const labelledRes = scanAndRedactLocal(labelled, { protectionLevel: "medium", includeHeuristics: true });
    expect(labelledRes.sanitizedText).toContain("PAN:");
    expect(labelledRes.sanitizedText).not.toContain("ABCPE1234F");
  });

  it("redacts standalone addresses only when a door token meets a locality or PIN/ZIP", () => {
    const positives = [
      "143/A, 4th Cross, Indiranagar, Bengaluru 560047",
      "742 Evergreen Terrace, Springfield 62704",
      "B-12, Sector 21, Gurugram",
      "#42, Lane 3, Jubilee Hills, Hyderabad",
      "143/A Viveknagar 560047",
    ];
    for (const raw of positives) {
      const res = scanAndRedactLocal(raw, { protectionLevel: "medium", includeHeuristics: true });
      expect(res.mergedSpans.some((span) => span.category === "ADDRESS"), raw).toBe(true);
    }
    // The city and ZIP after the street word belong to the same span.
    const usZip = scanAndRedactLocal("742 Evergreen Terrace, Springfield 62704", {
      protectionLevel: "medium",
      includeHeuristics: true,
    });
    expect(usZip.sanitizedText).not.toContain("Springfield");
    expect(usZip.sanitizedText).not.toContain("62704");
    const negatives = [
      "version v2.1/A is the release candidate",
      "invoice number INV-2026-0042 is unpaid",
      "HTTP 404 from the upstream",
      "server listening on port 8080",
      "B-12 deficiency is common",
      "Sector 21 has a new policy",
      "address the 3 main issues before launch",
    ];
    for (const raw of negatives) {
      const res = scanAndRedactLocal(raw, { protectionLevel: "medium", includeHeuristics: true });
      expect(res.mergedSpans, raw).toEqual([]);
    }
  });

  it("redacts cards by Luhn plus IIN, and pairs expiry/CVV with a card instead of guessing", () => {
    const bundle = scanAndRedactLocal("card 4532015112830366 exp 09/29 cvv 123", {
      protectionLevel: "medium",
      includeHeuristics: true,
    });
    const categories = bundle.mergedSpans.map((span) => span.category);
    expect(categories).toContain("CREDIT_CARD");
    expect(categories).toContain("CARD_EXPIRY");
    expect(categories).toContain("CVV");

    const rupay = scanAndRedactLocal("rupay card 6521567890123453 charged twice", {
      protectionLevel: "medium",
      includeHeuristics: true,
    });
    expect(rupay.mergedSpans.some((span) => span.category === "CREDIT_CARD")).toBe(true);

    const labelled = scanAndRedactLocal("security code 482 for the charge", {
      protectionLevel: "medium",
      includeHeuristics: true,
    });
    expect(labelled.mergedSpans.some((span) => span.category === "CVV")).toBe(true);

    for (const raw of [
      "order 1234567890123456 shipped",
      "the offer expires 12/25 for all users",
      "we have 250 orders to process",
      "room 402 has a projector",
    ]) {
      const res = scanAndRedactLocal(raw, { protectionLevel: "medium", includeHeuristics: true });
      expect(res.mergedSpans, raw).toEqual([]);
    }
  });

  it("never labels a card mid-typing as a 12-digit government id", () => {
    // Exactly twelve digits is a valid Aadhaar on its own; the trigger policy debounces that case
    // (see SendInterceptionTest). Once a thirteenth digit arrives the shape is unambiguously a
    // card in progress and must not be named GOV_ID.
    for (const partial of ["4111 1111 1111 1", "4111 1111 1111 11", "4111 1111 1111 1111 1"]) {
      const res = scanAndRedactLocal(`card ${partial}`, {
        protectionLevel: "medium",
        includeHeuristics: true,
      });
      expect(
        res.mergedSpans.some((span) => span.category === "GOV_ID"),
        partial,
      ).toBe(false);
    }
    const full = scanAndRedactLocal("card 4111 1111 1111 1111", {
      protectionLevel: "medium",
      includeHeuristics: true,
    });
    expect(full.mergedSpans.map((span) => span.category)).toContain("CREDIT_CARD");
    expect(full.mergedSpans.map((span) => span.category)).not.toContain("GOV_ID");
  });

  it("ends an address body at the next labelled field on a single line", () => {
    const raw =
      "address 143/A, 2nd Cross, Indiranagar, Bengaluru 560038 card 4111 1111 1111 1111 exp 09/29 cvv 123 upi ravi.kumar@oksbi";
    const res = scanAndRedactLocal(raw, { protectionLevel: "medium", includeHeuristics: true });
    expect(res.mergedSpans.map((span) => span.category)).toEqual([
      "ADDRESS",
      "CREDIT_CARD",
      "CARD_EXPIRY",
      "CVV",
      "UPI_ID",
    ]);
    // The address must not swallow the card, which is what a longer body used to do.
    const address = res.mergedSpans.find((span) => span.category === "ADDRESS")!;
    expect(raw.slice(address.start, address.end)).toBe(
      "143/A, 2nd Cross, Indiranagar, Bengaluru 560038",
    );
    expect(res.sanitizedText).toBe(
      "address [REDACTED:ADDRESS_1] card [REDACTED:CREDIT_CARD_1] exp [REDACTED:CARD_EXPIRY_1] cvv [REDACTED:CVV_1] upi [REDACTED:UPI_ID_1]",
    );
  });

  it("keeps a pipe-separated KYC line as distinct fields instead of one address blob", () => {
    const raw =
      "KYC: address 143/A, 2nd Cross, Indiranagar, Bengaluru 560038 | card 4111 1111 1111 1111 exp 09/29 cvv 123 | upi ravi.kumar@oksbi | pan ABCPE1234F | ifsc HDFC0001234";
    const res = scanAndRedactLocal(raw, { protectionLevel: "medium", includeHeuristics: true });
    const categories = res.mergedSpans.map((span) => span.category);
    for (const expected of ["ADDRESS", "CREDIT_CARD", "CARD_EXPIRY", "CVV", "UPI_ID", "PAN_ID", "IFSC"]) {
      expect(categories, expected).toContain(expected);
    }
    for (const secret of ["143/A", "560038", "4111", "09/29", "ravi.kumar@oksbi", "ABCPE1234F", "HDFC0001234"]) {
      expect(res.sanitizedText, secret).not.toContain(secret);
    }
  });

  it("redacts UPI VPAs, PANs and IFSC codes without touching emails or uppercase ids", () => {
    const upi = scanAndRedactLocal("pay ravi.kumar@oksbi or 9876543210@ybl today", {
      protectionLevel: "medium",
      includeHeuristics: true,
    });
    expect(upi.mergedSpans.filter((span) => span.category === "UPI_ID")).toHaveLength(2);
    expect(upi.sanitizedText).not.toContain("ravi.kumar@oksbi");

    const email = scanAndRedactLocal("write to ravi.kumar@oksbi.com instead", {
      protectionLevel: "medium",
      includeHeuristics: true,
    });
    expect(email.mergedSpans.some((span) => span.category === "UPI_ID")).toBe(false);
    expect(email.mergedSpans.some((span) => span.category === "EMAIL")).toBe(true);

    const pan = scanAndRedactLocal("PAN ABCPE1234F submitted for KYC", {
      protectionLevel: "medium",
      includeHeuristics: true,
    });
    expect(pan.mergedSpans.some((span) => span.category === "PAN_ID")).toBe(true);

    const ifsc = scanAndRedactLocal("transfer to HDFC0001234 at the branch", {
      protectionLevel: "medium",
      includeHeuristics: true,
    });
    expect(ifsc.mergedSpans.some((span) => span.category === "IFSC")).toBe(true);

    for (const raw of ["random token QWERTYUIOP and ZXCVBNMASD", "build hash 1234567890"]) {
      const res = scanAndRedactLocal(raw, { protectionLevel: "medium", includeHeuristics: true });
      expect(res.mergedSpans, raw).toEqual([]);
    }
  });

  it("fixes P0 redaction-tag leak for malformed Nano categories and plural 'apis key' cues", async () => {    const { buildSemanticSpans, mergeAndRedactSpans, normalizeRedactionCategory } = await import(
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
