import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildSanitizedHandoffUrl } from "../extension/sidepanel/firewall-core.js";

const EXT_DIR = path.resolve(process.cwd(), "extension");
const SW_SOURCE = fs.readFileSync(path.join(EXT_DIR, "service-worker.js"), "utf8");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8")) as {
  content_scripts: Array<{ matches: string[] }>;
};

type Listener = (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => unknown;

interface Harness {
  clickSelection: (selectionText: string) => Promise<void>;
  ask: (message: { type: string }) => Promise<unknown>;
  badgeText: () => string;
  panelsOpened: () => number;
  messagesOut: () => Array<{ type: string }>;
}

/**
 * Boots `extension/service-worker.js` in an isolated scope with a fake `chrome`.
 * The fake deliberately exposes no `storage` API, so any attempt to persist the
 * capture would throw instead of silently passing.
 */
function bootServiceWorker(): Harness {
  const installed: Array<() => Promise<void>> = [];
  const menuClicks: Array<(info: unknown, tab: unknown) => Promise<void>> = [];
  const messageListeners: Listener[] = [];
  let badge = "";
  const opened: unknown[] = [];
  const outbound: Array<{ type: string }> = [];

  const chrome = {
    runtime: {
      onInstalled: { addListener: (fn: () => Promise<void>) => installed.push(fn) },
      onMessage: { addListener: (fn: Listener) => messageListeners.push(fn) },
      sendMessage: async (message: { type: string }) => {
        outbound.push(message);
      },
      getManifest: () => MANIFEST,
    },
    contextMenus: {
      removeAll: async () => {},
      create: () => {},
      onClicked: { addListener: (fn: (info: unknown, tab: unknown) => Promise<void>) => menuClicks.push(fn) },
    },
    sidePanel: {
      setPanelBehavior: async () => {},
      open: async (opts: unknown) => {
        opened.push(opts);
      },
    },
    action: {
      setBadgeBackgroundColor: async () => {},
      setBadgeText: async ({ text }: { text: string }) => {
        badge = text;
      },
    },
    tabs: { query: async () => [] },
    scripting: { executeScript: async () => {} },
  };

  // `service-worker.js` is a classic script, so evaluate it with an explicit
  // `chrome` binding to get a fresh copy of its module-level state per call.
  new Function("chrome", SW_SOURCE)(chrome);

  const ask = (message: { type: string }) =>
    new Promise<unknown>((resolve) => {
      const listener = messageListeners[0];
      if (!listener) throw new Error("service worker registered no onMessage listener");
      let answered = false;
      const sendResponse = (response: unknown) => {
        answered = true;
        resolve(response);
      };
      const keepAlive = listener(message, {}, sendResponse);
      if (answered) return;
      if (keepAlive !== true) resolve(undefined);
    });

  return {
    clickSelection: async (selectionText: string) => {
      const handler = menuClicks[0];
      if (!handler) throw new Error("service worker registered no contextMenus listener");
      await handler(
        { menuItemId: "localfirst-triage-selection", selectionText },
        { id: 7, windowId: 3, url: "https://github.com/acme/app/issues/12", title: "Leaked key" },
      );
    },
    ask,
    badgeText: () => badge,
    panelsOpened: () => opened.length,
    messagesOut: () => outbound,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("side panel capture bridge", () => {
  it("serves a context-menu capture exactly once, then reports nothing pending", async () => {
    const sw = bootServiceWorker();
    const secret = ["AK", "IAIOSFODNN7EXAMPLE"].join("");

    await sw.clickSelection(`Deploy failed with ${secret}`);
    expect(sw.badgeText()).toBe("1");
    expect(sw.panelsOpened()).toBe(1);
    expect(sw.messagesOut().map((m) => m.type)).toContain("CAPTURE_READY");

    const first = (await sw.ask({ type: "GET_CAPTURE" })) as {
      capture: { rawText: string; title: string } | null;
    };
    expect(first.capture?.rawText).toContain(secret);
    expect(first.capture?.title).toContain("github.com");

    const second = (await sw.ask({ type: "GET_CAPTURE" })) as { capture: unknown };
    expect(second.capture).toBeNull();

    const third = (await sw.ask({ type: "GET_CAPTURE" })) as { capture: unknown };
    expect(third.capture).toBeNull();
  });

  it("clears the pending badge once the panel has consumed the capture", async () => {
    const sw = bootServiceWorker();
    await sw.clickSelection("token=abc123");
    expect(sw.badgeText()).toBe("1");
    await sw.ask({ type: "CLEAR_BADGE" });
    expect(sw.badgeText()).toBe("");
  });

  it("drops a stale capture instead of replaying it minutes later", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-23T10:00:00Z"));
    const sw = bootServiceWorker();
    await sw.clickSelection("stale selection");

    vi.setSystemTime(new Date("2026-11-23T10:30:00Z"));
    const res = (await sw.ask({ type: "GET_CAPTURE" })) as { capture: unknown };
    expect(res.capture).toBeNull();
  });

  it("keeps a fresh capture available across a service-worker restart only in memory", async () => {
    const first = bootServiceWorker();
    await first.clickSelection("restart me");
    // A reload/restart spawns a brand-new worker with empty module state.
    const second = bootServiceWorker();
    const res = (await second.ask({ type: "GET_CAPTURE" })) as { capture: unknown };
    expect(res.capture).toBeNull();
    expect(second.badgeText()).toBe("");
  });

  it("never touches a persistence API anywhere in the service worker", () => {
    const code = SW_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const api of [
      "chrome.storage",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "chrome.cookies",
      "fetch(",
      "XMLHttpRequest",
    ]) {
      expect(code).not.toContain(api);
    }
  });
});

describe("sanitized handoff URL", () => {
  it("re-scrubs at the boundary so a raw string can never reach the web app", () => {
    const secret = ["gh", "p_", "16C7A1b2D3e4F5g6H7i8J9k0L1m2N3o4P5q6"].join("");
    const url = buildSanitizedHandoffUrl("GitHub issue", `push failed using ${secret}`);
    expect(url).not.toContain(secret);
    const encoded = url.split("#handoff=")[1];
    const json = Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    expect(json).toContain("[REDACTED:");
    expect(json).not.toContain(secret);
  });

  it("keeps an already-sanitized payload byte-identical", () => {
    const url = buildSanitizedHandoffUrl("Incident", "Only [REDACTED:API_KEY_1] left");
    const encoded = url.split("#handoff=")[1];
    const json = Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    expect(JSON.parse(json)).toEqual({
      title: "Incident",
      sanitizedText: "Only [REDACTED:API_KEY_1] left",
    });
  });

  it("caps the title and body so a huge selection cannot build an unusable URL", () => {
    const url = buildSanitizedHandoffUrl("t".repeat(900), "x".repeat(80_000));
    const encoded = url.split("#handoff=")[1];
    const json = Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const parsed = JSON.parse(json) as { title: string; sanitizedText: string };
    expect(parsed.title.length).toBe(200);
    expect(parsed.sanitizedText.length).toBe(50_000);
  });

  it("refuses a non-http(s) base URL instead of building a script URL", () => {
    const url = buildSanitizedHandoffUrl("Incident", "safe text", "javascript:alert(1)");
    expect(url.startsWith("https://para-1-2e22b.web.app/#handoff=")).toBe(true);
  });
});
