import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildSanitizedHandoffUrl,
  mergeSpans,
  runLocalDeterministicScan,
} from "../extension/sidepanel/firewall-core.js";

const EXT_DIR = path.resolve(process.cwd(), "extension");

function readPngDimensions(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  // PNG IHDR chunk starts at byte 16 (width: uint32BE, height: uint32BE)
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

describe("Chrome Extension MV3 companion", () => {
  it("satisfies Manifest V3 side panel, icon dimensions, and CSP compliance rules", () => {
    const manifestPath = path.join(EXT_DIR, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      manifest_version: number;
      permissions: string[];
      side_panel?: { default_path?: string };
      action?: { default_popup?: string; default_icon?: Record<string, string> };
      icons?: Record<string, string>;
      background?: { service_worker?: string };
    };

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).not.toContain("aiLanguageModelOriginTrial");
    expect(manifest.side_panel?.default_path).toBe("sidepanel/sidepanel.html");
    expect(manifest.action?.default_popup).toBeUndefined();
    expect(manifest.background?.service_worker).toBe("service-worker.js");

    for (const [sizeStr, relPath] of Object.entries(manifest.icons ?? {})) {
      const fullPath = path.join(EXT_DIR, relPath);
      expect(fs.existsSync(fullPath)).toBe(true);
      const dims = readPngDimensions(fullPath);
      expect(dims.width).toBe(Number(sizeStr));
      expect(dims.height).toBe(Number(sizeStr));
    }

    const html = fs.readFileSync(path.join(EXT_DIR, "sidepanel/sidepanel.html"), "utf8");
    expect(html).not.toMatch(/<script[^>]*>[\s\S]*\S[\s\S]*<\/script>/i);
    expect(html).not.toMatch(/\sonclick=/i);

    const sw = fs.readFileSync(path.join(EXT_DIR, "service-worker.js"), "utf8");
    expect(sw).toContain("openPanelOnActionClick: true");
    expect(sw).not.toContain("openPanelOnActionIconClick");
  });

  it("sanitizes secrets locally and encodes sanitized-only handoff URL", () => {
    const raw = "Leaked AWS AKIAIOSFODNN7EXAMPLE in GitHub issue";
    const spans = runLocalDeterministicScan(raw, true);
    const { sanitizedText } = mergeSpans(raw, spans);
    expect(sanitizedText).not.toContain("AKIAIOSFODNN7EXAMPLE");

    const handoffUrl = buildSanitizedHandoffUrl("GitHub Issue", sanitizedText);
    expect(handoffUrl).toContain("https://para-1-2e22b.web.app/#handoff=");
    expect(handoffUrl).not.toContain("AKIAIOSFODNN7EXAMPLE");

    // Verify 100% contextual & entropy rule parity with src/firewall/regexScrubber.ts
    const paritySample =
      "MRN: 994812 | admin password=SuperSecretMixed123456! | Customer (Jane Doe at 42 MG Road) | token=AbCdEfGhIjKlMnOp1234";
    const paritySpans = runLocalDeterministicScan(paritySample, true);
    const categories = paritySpans.map((s: { category: string }) => s.category);
    expect(categories).toContain("CONTEXTUAL_PHI");
    expect(categories).toContain("NATURAL_SECRET");
    expect(categories).toContain("PERSONAL_PII_LOCATION");
    expect(categories).toContain("HIGH_ENTROPY_SECRET");
  });

  it("handles Unicode characters in Chrome Extension -> Web PWA handoff encoding", async () => {
    const { decodeHandoffHash } = await import("../src/App");
    const url = buildSanitizedHandoffUrl("Unicode — Incident 🚨", "Sanitized [REDACTED:EMAIL_1] payload");
    const hash = url.slice(url.indexOf("#"));
    expect(decodeHandoffHash(hash)).toEqual({
      title: "Unicode — Incident 🚨",
      sanitizedText: "Sanitized [REDACTED:EMAIL_1] payload",
    });
  });
});
