import { describe, it, expect } from "vitest";
import {
  detectContextualHeuristicSpans,
  detectHighEntropySecrets,
  detectPolicyTermSpans,
  detectRegexSpans,
  passesLuhnCheck,
  shannonEntropy,
} from "../src/firewall/regexScrubber";

describe("regexScrubber", () => {
  it("detects Google/OpenAI/GitHub API keys, JWTs, Bearer tokens, emails, and phones", () => {
    const input = [
      "Contact alice.ops@example.com or +1 (415) 555-0199.",
      "Header: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTYifQ.signaturepart",
      "Leaked keys: AIzaSyD-1234567890abcdefghijklmnopqrs and sk-proj-abcdefghijklmnopqrstuvwxyz123456",
      "Token: ghp_1234567890abcdefghijklmnopqrstuvwxyz",
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
    const input = [
      "AWS=AKIAIOSFODNN7EXAMPLE",
      "DB=postgres://svc:mySecret99@db.internal:5432/prod",
      "Stripe=sk_live_51N9x8y7z6w5v4u3t2s1r",
      "Authorization: Bearer opaque_session_token_9876543210abc",
      "SSN: 123-45-6789",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAtest\n-----END RSA PRIVATE KEY-----",
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
    const input = "webhook_secret=whsec_9Kf8Lm2Qp7Zx4Tv1Bn6Yc3Rd8Wx5Hj2M\nlog_level=info";
    const spans = detectHighEntropySecrets(input);
    expect(spans).toHaveLength(1);
    expect(spans[0].detector).toBe("ENTROPY_SCANNER");
    expect(spans[0].matchedText).toBe("whsec_9Kf8Lm2Qp7Zx4Tv1Bn6Yc3Rd8Wx5Hj2M");
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
      "Escaped DB: mongodb+srv:\\/\\/svc:MyMongoPass123@cluster0.example.net\\/admin",
      "-----BEGIN%20PGP%20PRIVATE%20KEY%20BLOCK-----%0AmQINBFtestKeyData%0A-----END%20PGP%20PRIVATE%20KEY%20BLOCK-----",
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
});
