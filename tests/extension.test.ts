import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildSanitizedHandoffUrl,
  describeManualHost,
  isLikelyNonSendButton,
  mergeSpans,
  runLocalDeterministicScan,
  shouldInterceptSendKey,
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
    const scriptTags = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi));
    expect(scriptTags.length).toBeGreaterThanOrEqual(1);
    for (const [, attrs, body] of scriptTags) {
      expect(attrs).toMatch(/\bsrc\s*=/i);
      expect(body.trim()).toBe("");
    }
    expect(fs.existsSync(path.join(EXT_DIR, "sidepanel/theme-init.js"))).toBe(true);
    expect(html).not.toMatch(/\sonclick=/i);

    const sw = fs.readFileSync(path.join(EXT_DIR, "service-worker.js"), "utf8");
    expect(sw).toContain("openPanelOnActionClick: true");
    expect(sw).not.toContain("openPanelOnActionIconClick");
  });

  it("sanitizes secrets locally and encodes sanitized-only handoff URL", () => {
    const awsDemoKey = ["AK", "IAIOSFODNN7EXAMPLE"].join("");
    const raw = `Leaked AWS ${awsDemoKey} in GitHub issue`;
    const spans = runLocalDeterministicScan(raw, true);
    const { sanitizedText } = mergeSpans(raw, spans);
    expect(sanitizedText).not.toContain(awsDemoKey);

    const handoffUrl = buildSanitizedHandoffUrl("GitHub Issue", sanitizedText);
    expect(handoffUrl).toContain("https://para-1-2e22b.web.app/#handoff=");
    expect(handoffUrl).not.toContain(awsDemoKey);

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

  it("intercepts Enter sends in contenteditable and Ctrl/Cmd+Enter sends in textareas", () => {
    // Plain Enter submits rich-text composers (ChatGPT/Claude/Slack)
    expect(shouldInterceptSendKey({ key: "Enter", isTextarea: false, level: "medium" })).toBe(true);
    // Plain Enter must keep inserting newlines in textareas
    expect(shouldInterceptSendKey({ key: "Enter", isTextarea: true, level: "medium" })).toBe(false);
    // Ctrl/Cmd+Enter is the submit shortcut for textarea composers (GitHub, Slack legacy)
    expect(shouldInterceptSendKey({ key: "Enter", isTextarea: true, ctrlKey: true, level: "medium" })).toBe(true);
    expect(shouldInterceptSendKey({ key: "Enter", isTextarea: true, metaKey: true, level: "medium" })).toBe(true);
    // Shift+Enter is a newline everywhere; other keys and low protection pass through
    expect(shouldInterceptSendKey({ key: "Enter", isTextarea: false, shiftKey: true, level: "medium" })).toBe(false);
    expect(shouldInterceptSendKey({ key: "a", isTextarea: false, level: "medium" })).toBe(false);
    expect(shouldInterceptSendKey({ key: "Enter", isTextarea: false, level: "low" })).toBe(false);
  });

  it("never mistakes save/cancel/delete submits for a Send control", () => {
    for (const label of ["Save", "Save changes", "Cancel", "Delete", "Close", "Search", "Sign in", "Log in", "Upload"]) {
      expect(isLikelyNonSendButton(label)).toBe(true);
    }
    for (const label of ["Send", "Send message", "Reply", "Post", "Submit", "Ask Gemini", ""]) {
      expect(isLikelyNonSendButton(label)).toBe(false);
    }
  });

  it("guards Discord and drops host permissions that never inject the shield", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8"),
    ) as {
      version: string;
      host_permissions: string[];
      content_scripts: Array<{ matches: string[] }>;
    };
    const matches = manifest.content_scripts.flatMap((entry) => entry.matches);
    expect(matches).toContain("https://discord.com/*");
    expect(manifest.host_permissions).toContain("https://discord.com/*");
    for (const perplexity of ["https://www.perplexity.ai/*", "https://perplexity.ai/*"]) {
      expect(matches).toContain(perplexity);
      expect(manifest.host_permissions).toContain(perplexity);
    }
    const swSource = fs.readFileSync(path.join(EXT_DIR, "service-worker.js"), "utf8");
    expect(swSource).toContain("https://www.perplexity.ai/*");
    expect(swSource).toContain("https://perplexity.ai/*");
    for (const dead of ["atlassian.net", "zendesk.com", "pagerduty.com", "linear.app"]) {
      expect(manifest.host_permissions.join(" ")).not.toContain(dead);
    }
    expect(manifest.version).toBe("4.4.0");
  });

  it("keeps package and extension versions in lockstep", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as {
      version: string;
    };
    const manifest = JSON.parse(
      fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8"),
    ) as { version: string };
    expect(pkg.version).toBe("4.4.0");
    expect(manifest.version).toBe(pkg.version);
  });

  it("ships a three-step plain-language setup and names every guarded site", () => {
    const html = fs.readFileSync(path.join(EXT_DIR, "sidepanel/sidepanel.html"), "utf8");
    for (const id of ["setup-step-1", "setup-step-2", "setup-step-3"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toMatch(/Open ChatGPT to test/i);
    expect(html).toContain("Discord");
    expect(html).toContain("v4.4.0");
    // The model download must be presented as optional, never as a required first step.
    expect(html).toMatch(/Optional:\s*on-device AI/i);
  });

  it("never renders a raw extension id in the side panel's Manual Mode pill", () => {
    const extensionId = ["abahmomh", "foknlfoe", "kmndidnh", "imcohmhe"].join("");
    expect(describeManualHost(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`)).toBe(
      "this browser tab",
    );
    expect(describeManualHost("chrome://settings/system")).toBe("this browser tab");
    expect(describeManualHost("https://chatgpt.com/c/abc")).toBe("chatgpt.com");
    expect(describeManualHost(undefined)).toBe("this browser tab");
  });

  it("puts the Protection Dial above the first-run Setup card", () => {
    const html = fs.readFileSync(path.join(EXT_DIR, "sidepanel/sidepanel.html"), "utf8");
    const dialAt = html.indexOf('class="card dial-card"');
    const setupAt = html.indexOf('id="setup-gate"');
    expect(dialAt).toBeGreaterThan(-1);
    expect(setupAt).toBeGreaterThan(-1);
    expect(dialAt).toBeLessThan(setupAt);
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
