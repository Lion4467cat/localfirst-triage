import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET_ONE = ["sk_", "live_", "51HxKq9dPz3rT7wY2nB8mC4v"].join("");
const SECRET_TWO = ["sk_", "live_", "99AbCdEfGhIjKlMnOpQrStUv"].join("");

const HOST_ID = "localfirst-paste-shield-host";

function hud() {
  const host = document.getElementById(HOST_ID);
  return host?.shadowRoot ?? null;
}

function button(id: string): HTMLButtonElement {
  const root = hud();
  const el = root?.getElementById(id);
  if (!el) throw new Error(`missing HUD button #${id}`);
  return el as HTMLButtonElement;
}

function modalOpen(): boolean {
  return document.getElementById(HOST_ID)?.dataset.lfState === "MODAL";
}

interface Harness {
  editor: HTMLTextAreaElement;
  send: HTMLButtonElement;
  sendClicks: () => number;
}

function mountEditor(initial = ""): Harness {
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
  editor.value = initial;
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  return { editor, send, sendClicks: () => clicks };
}

function type(editor: HTMLTextAreaElement, value: string) {
  editor.value = value;
  editor.dispatchEvent(new Event("input", { bubbles: true }));
}

interface RichHarness {
  editor: HTMLElement;
  send: HTMLButtonElement;
  sendClicks: () => number;
}

function mountContentEditable(initial: string): RichHarness {
  document.body.innerHTML = `
    <div id="editor" contenteditable="true" role="textbox" aria-label="Message"></div>
    <button id="send" type="button" aria-label="Send message">Send</button>
  `;
  const editor = document.getElementById("editor") as HTMLElement;
  const send = document.getElementById("send") as HTMLButtonElement;
  let clicks = 0;
  send.addEventListener("click", () => {
    clicks += 1;
  });
  editor.textContent = initial;
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  return { editor, send, sendClicks: () => clicks };
}

async function loadShield() {
  vi.resetModules();
  document.body.innerHTML = "";
  document.getElementById(HOST_ID)?.remove();
  await import("../extension/sidepanel/firewall-core.js");
  await import("../extension/content-shield.js");
}

describe("content-shield live guard", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await loadShield();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.getElementById(HOST_ID)?.remove();
    document.body.innerHTML = "";
  });

  it("P0-2: keeps Send blocked and offers the safe copy when the framework reverts the scrub", async () => {
    const { editor, send, sendClicks } = mountEditor(`Leaked ${SECRET_ONE}`);
    send.click();
    expect(modalOpen()).toBe(true);

    button("lf-primary").click();
    // Framework restores the pre-scrub DOM before the verification window closes.
    type(editor, `Leaked ${SECRET_ONE}`);
    vi.advanceTimersByTime(300);

    expect(sendClicks()).toBe(0);
    expect(editor.value).toContain(SECRET_ONE);
    expect(hud()?.getElementById("lf-copy")).toBeTruthy();

    // The still-raw draft is re-intercepted on the next Send attempt.
    send.click();
    expect(modalOpen()).toBe(true);
  });

  it("P0-7: Scrub & Send releases Send only after the scrubbed text lands", async () => {
    const { editor, send, sendClicks } = mountEditor(`Leaked ${SECRET_ONE}`);
    send.click();
    button("lf-primary").click();

    vi.advanceTimersByTime(50);
    expect(sendClicks()).toBe(0);

    vi.advanceTimersByTime(150);
    expect(sendClicks()).toBe(1);
    expect(editor.value).toContain("[REDACTED:");
  });

  it("P0-8: the safe-copy fallback copies the scrubbed text, never the raw draft", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => void copied.push(value) },
    });

    const { editor, send } = mountEditor(`Leaked ${SECRET_ONE}`);
    send.click();
    button("lf-primary").click();
    type(editor, `Leaked ${SECRET_ONE}`);
    vi.advanceTimersByTime(300);

    const copyBtn = hud()?.getElementById("lf-copy") as HTMLButtonElement | null;
    expect(copyBtn).toBeTruthy();
    copyBtn?.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(copied).toHaveLength(1);
    expect(copied[0]).toContain("[REDACTED:");
    expect(copied[0]).not.toContain(SECRET_ONE);
  });

  it("P0-3: a new secret typed within the mute window is still intercepted", async () => {
    const { editor, send } = mountEditor(`Leaked ${SECRET_ONE}`);
    send.click();
    button("lf-primary").click();

    type(editor, `Now leaking ${SECRET_TWO}`);
    send.click();

    expect(modalOpen()).toBe(true);
    expect(hud()?.getElementById("lf-preview")?.textContent).not.toContain(SECRET_TWO);
  });

  it("P1-4: labels match the product and Scrub actually sends", async () => {
    const { editor, send, sendClicks } = mountEditor(`Leaked ${SECRET_ONE}`);
    send.click();

    expect(button("lf-primary").textContent).toBe("Use Scrub & Send");
    expect(button("lf-bypass").textContent).toBe("Reject & Send Anyway");

    button("lf-primary").click();
    vi.advanceTimersByTime(250);
    expect(sendClicks()).toBe(1);
    expect(editor.value).not.toContain(SECRET_ONE);
    expect(editor.value).toContain("[REDACTED:");
    expect(modalOpen()).toBe(false);
  });

  it("P1-5: Reject & Send Anyway sends raw on a single click", async () => {
    const { editor, send, sendClicks } = mountEditor(`Leaked ${SECRET_ONE}`);
    send.click();

    button("lf-bypass").click();
    vi.advanceTimersByTime(50);
    expect(sendClicks()).toBe(1);
    expect(editor.value).toContain(SECRET_ONE);
    expect(modalOpen()).toBe(false);
  });

  it("P1-6: pasting never opens the modal or prevents the default paste", async () => {
    const { editor } = mountEditor("");
    const ev = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", {
      value: { getData: () => `Leaked ${SECRET_ONE}` },
    });

    editor.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(false);
    expect(document.getElementById(HOST_ID)).toBeNull();
  });

  it("P1-7: an IME composition commit is never treated as Send", async () => {
    const { editor } = mountEditor(`Leaked ${SECRET_ONE}`);

    editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const commit = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    editor.dispatchEvent(commit);

    expect(commit.defaultPrevented).toBe(false);
    expect(modalOpen()).toBe(false);

    editor.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  });

  it("P1-8: a form submit carrying a secret is blocked", async () => {
    document.body.innerHTML = `
      <form id="composer">
        <textarea id="editor"></textarea>
        <button id="send" type="submit">Comment</button>
      </form>
    `;
    const editor = document.getElementById("editor") as HTMLTextAreaElement;
    editor.focus();
    editor.value = `Leaked ${SECRET_ONE}`;
    editor.dispatchEvent(new Event("input", { bubbles: true }));

    const form = document.getElementById("composer") as HTMLFormElement;
    const submit = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(submit);

    expect(submit.defaultPrevented).toBe(true);
    expect(modalOpen()).toBe(true);
  });

  it("P0-9: a contenteditable that ignores the edit pipeline never releases Send", async () => {
    const { editor, send, sendClicks } = mountContentEditable(`Leaked ${SECRET_ONE}`);
    // jsdom has no execCommand, which is exactly the "browser refused the edit" case: a write
    // through textContent would leave the editor's own model holding the raw secret.
    send.click();
    expect(modalOpen()).toBe(true);

    button("lf-primary").click();
    vi.advanceTimersByTime(400);

    expect(sendClicks()).toBe(0);
    expect(hud()?.getElementById("lf-copy")).toBeTruthy();
    // The refused write is rolled back, so the DOM never disagrees with the editor's model.
    expect(editor.textContent).toBe(`Leaked ${SECRET_ONE}`);

    // A second, user-initiated Send is still guarded because the raw text is still there.
    send.click();
    expect(modalOpen()).toBe(true);
    expect(sendClicks()).toBe(0);
  });

  it("P0-10: a contenteditable that accepts the edit releases Send once", async () => {
    const { editor, send, sendClicks } = mountContentEditable(`Leaked ${SECRET_ONE}`);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: (command: string, _showUi?: boolean, value?: string) => {
        if (command !== "insertText") return false;
        editor.textContent = String(value ?? "");
        return true;
      },
    });

    send.click();
    button("lf-primary").click();
    vi.advanceTimersByTime(400);

    expect(sendClicks()).toBe(1);
    expect(editor.textContent).toContain("[REDACTED:");
    expect(editor.textContent).not.toContain(SECRET_ONE);
  });
});
