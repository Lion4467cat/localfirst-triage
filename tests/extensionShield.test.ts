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

  it("P0-2: re-intercepts Send when the host framework reverts the scrubbed DOM", async () => {
    const { editor, send } = mountEditor(`Leaked ${SECRET_ONE}`);
    send.click();
    expect(modalOpen()).toBe(true);

    button("lf-primary").click();
    // The real Send fires immediately with the scrubbed text.
    vi.advanceTimersByTime(0);
    // Framework restores the pre-scrub DOM right after our write.
    type(editor, `Leaked ${SECRET_ONE}`);
    vi.advanceTimersByTime(2500);
    expect(modalOpen()).toBe(false);

    send.click();
    expect(modalOpen()).toBe(true);
    expect(editor.value).toContain(SECRET_ONE);
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
});
