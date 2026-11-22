import { describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => unknown;

const SECRET = ["sk_", "live_", "51HxKq9dPz3rT7wY2nB8mC4v"].join("");

async function loadServiceWorker() {
  vi.resetModules();
  const handlers: Record<string, Handler> = {};
  const storageSet = vi.fn(async () => undefined);

  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      onInstalled: { addListener: (fn: Handler) => (handlers.installed = fn) },
      onMessage: { addListener: (fn: Handler) => (handlers.message = fn) },
    },
    contextMenus: {
      removeAll: vi.fn(async () => undefined),
      create: vi.fn(),
      onClicked: { addListener: (fn: Handler) => (handlers.clicked = fn) },
    },
    sidePanel: {
      setPanelBehavior: vi.fn(async () => undefined),
      open: vi.fn(async () => undefined),
    },
    tabs: { query: vi.fn(async () => []) },
    scripting: { executeScript: vi.fn(async () => []) },
    storage: { session: { set: storageSet, get: vi.fn(async () => ({})) } },
    action: {
      setBadgeBackgroundColor: vi.fn(async () => undefined),
      setBadgeText: vi.fn(async () => undefined),
    },
  };

  await import("../extension/service-worker.js");
  return { handlers, storageSet };
}

describe("service worker selection capture", () => {
  it("keeps raw selection text in memory only and serves it once", async () => {
    const { handlers, storageSet } = await loadServiceWorker();
    const selected = `incident note with ${SECRET}`;

    await handlers.clicked(
      { menuItemId: "localfirst-triage-selection", selectionText: selected },
      { id: 7, url: "https://example.com/issue/1", title: "Example issue", windowId: 3 },
    );

    // Zero-PII invariant: nothing raw may reach chrome.storage.*.
    expect(storageSet).not.toHaveBeenCalled();

    const first: { value?: { capture?: { rawText?: string } } } = {};
    handlers.message({ type: "GET_CAPTURE" }, {}, (response: typeof first.value) => {
      first.value = response;
    });
    expect(first.value?.capture?.rawText).toBe(selected);

    const second: { value?: { capture?: { rawText?: string } } } = {};
    handlers.message({ type: "GET_CAPTURE" }, {}, (response: typeof second.value) => {
      second.value = response;
    });
    expect(second.value?.capture ?? null).toBeNull();
  });
});
