import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runExtensionNanoScan } from "../extension/sidepanel/firewall-core.js";

const SECRET = ["sk_", "live_", "51HxKq9dPz3rT7wY2nB8mC4v"].join("");
const CLEAN = "Please summarise the deployment runbook for the on-call engineer.";

interface FakeModel {
  availability?: () => Promise<string>;
  params?: () => Promise<{ defaultTopK?: number; maxTopK?: number }>;
  create?: (options?: unknown) => Promise<unknown>;
}

function install(model: FakeModel | undefined) {
  (globalThis as unknown as { LanguageModel?: FakeModel }).LanguageModel = model;
}

const hang = () => new Promise<never>(() => {});

afterEach(() => {
  delete (globalThis as unknown as { LanguageModel?: FakeModel }).LanguageModel;
  vi.useRealTimers();
});

describe("Nano semantic pass", () => {
  it("returns the deterministic result when availability() never answers", async () => {
    vi.useFakeTimers();
    install({ availability: () => hang() });
    const pending = runExtensionNanoScan(`key ${SECRET}`, { timeoutMs: 400 });
    await vi.advanceTimersByTimeAsync(500);
    const result = await pending;
    expect(result.nanoActive).toBe(false);
    expect(result.nanoTimedOut).toBe(true);
    expect(result.mergedSpans.map((s: { category: string }) => s.category)).toContain("API_KEY");
  });

  it("returns the deterministic result when create() never answers", async () => {
    vi.useFakeTimers();
    install({ availability: async () => "available", create: () => hang() });
    const pending = runExtensionNanoScan(`key ${SECRET}`, { timeoutMs: 400 });
    await vi.advanceTimersByTimeAsync(500);
    const result = await pending;
    expect(result.nanoActive).toBe(false);
    expect(result.nanoTimedOut).toBe(true);
    expect(result.sanitizedText).not.toContain(SECRET);
  });

  it("returns the deterministic result and destroys the session when prompt() hangs", async () => {
    vi.useFakeTimers();
    const destroy = vi.fn();
    install({
      availability: async () => "available",
      create: async () => ({ prompt: () => hang(), destroy }),
    });
    const pending = runExtensionNanoScan(`key ${SECRET}`, { timeoutMs: 400 });
    await vi.advanceTimersByTimeAsync(500);
    const result = await pending;
    expect(result.nanoActive).toBe(false);
    expect(result.nanoTimedOut).toBe(true);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("survives a model that rejects mid-session", async () => {
    install({
      availability: async () => "available",
      create: async () => ({ prompt: async () => Promise.reject(new Error("session died")) }),
    });
    const result = await runExtensionNanoScan(`key ${SECRET}`, { timeoutMs: 400 });
    expect(result.nanoActive).toBe(false);
    expect(result.sanitizedText).not.toContain(SECRET);
  });

  it("adopts a semantic finding the deterministic rules cannot see", async () => {
    install({
      availability: async () => "available",
      create: async () => ({
        prompt: async () =>
          '```json\n{"entities":[{"type":"NATURAL_SECRET","value":"hunter2-moonlight"}]}\n```',
        destroy: () => {},
      }),
    });
    const result = await runExtensionNanoScan("the wifi is hunter2-moonlight over there", {
      timeoutMs: 800,
    });
    expect(result.nanoActive).toBe(true);
    expect(result.sanitizedText).not.toContain("hunter2-moonlight");
    expect(result.sanitizedText).toContain("[REDACTED:");
  });

  it("honours the Protection Dial when the model is unavailable", async () => {
    const email = "mail ops@acme-health.org now";
    const low = await runExtensionNanoScan(email, { protectionLevel: "low", timeoutMs: 100 });
    const high = await runExtensionNanoScan(email, { protectionLevel: "high", timeoutMs: 100 });
    expect(low.mergedSpans.map((s: { category: string }) => s.category)).not.toContain("EMAIL");
    expect(high.mergedSpans.map((s: { category: string }) => s.category)).toContain("EMAIL");
  });

  it("ignores a model that hallucinates the whole sentence as an entity", async () => {
    install({
      availability: async () => "available",
      create: async () => ({
        prompt: async () =>
          JSON.stringify({
            entities: [
              { type: "NATURAL_SECRET", value: "the" },
              { type: "NATURAL_SECRET", value: "Summarise the deployment runbook" },
            ],
          }),
        destroy: () => {},
      }),
    });
    const result = await runExtensionNanoScan(CLEAN, { timeoutMs: 800 });
    expect(result.mergedSpans).toEqual([]);
    expect(result.sanitizedText).toBe(CLEAN);
  });
});

describe("content-shield with a broken on-device model", () => {
  const HOST_ID = "localfirst-paste-shield-host";

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    document.body.innerHTML = "";
    document.getElementById(HOST_ID)?.remove();
    await import("../extension/sidepanel/firewall-core.js");
    await import("../extension/content-shield.js");
  });

  afterEach(() => {
    document.getElementById(HOST_ID)?.remove();
    document.body.innerHTML = "";
    delete (globalThis as unknown as { LanguageModel?: FakeModel }).LanguageModel;
    vi.useRealTimers();
  });

  function mount(text: string) {
    document.body.innerHTML = `
      <textarea id="editor"></textarea>
      <button id="send" type="button" aria-label="Send message">Send</button>
    `;
    const editor = document.getElementById("editor") as HTMLTextAreaElement;
    const send = document.getElementById("send") as HTMLButtonElement;
    let clicks = 0;
    send.addEventListener("click", () => {
      clicks += 1;
    });
    editor.focus();
    editor.value = text;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    return { send, clicks: () => clicks };
  }

  it("never stalls the composer when the model hangs on clean text", async () => {
    install({ availability: () => hang() });
    const { send, clicks } = mount(CLEAN);
    send.click();
    expect(clicks()).toBe(0);

    await vi.advanceTimersByTimeAsync(3000);
    expect(clicks()).toBe(1);
    expect(document.getElementById(HOST_ID)?.dataset.lfState).not.toBe("MODAL");
  });

  it("still blocks a deterministic secret while the model hangs", async () => {
    install({ availability: () => hang() });
    const { send, clicks } = mount(`Leaked ${SECRET}`);
    send.click();
    expect(clicks()).toBe(0);
    expect(document.getElementById(HOST_ID)?.dataset.lfState).toBe("MODAL");

    await vi.advanceTimersByTimeAsync(3000);
    expect(clicks()).toBe(0);
  });
});
