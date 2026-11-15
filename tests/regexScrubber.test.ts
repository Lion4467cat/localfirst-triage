import { describe, it, expect } from "vitest";
import { detectRegexSpans } from "../src/firewall/regexScrubber";

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
});
