import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const EXT_DIR = path.resolve(process.cwd(), "extension");
const SANDBOX_HTML = fs.readFileSync(path.join(EXT_DIR, "sandbox.html"), "utf8");

function startSandboxServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(SANDBOX_HTML);
  });
  return new Promise((resolve) => {
    server.listen(0, "localhost", () => {
      const addr = server.address();
      resolve({ server, url: `http://localhost:${addr.port}/sandbox.html` });
    });
  });
}

async function dispatchPaste(page, selector, text) {
  return page.evaluate(
    ({ sel, txt }) => {
      const el = document.querySelector(sel);
      el.focus();
      const dt = new DataTransfer();
      dt.setData("text/plain", txt);
      const evt = new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      return { notCanceled: el.dispatchEvent(evt) };
    },
    { sel: selector, txt: text },
  );
}

async function main() {
  const { server, url } = await startSandboxServer();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lf-ext-"));
  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: [
        `--disable-extensions-except=${EXT_DIR}`,
        `--load-extension=${EXT_DIR}`,
        "--headless=new",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
      ],
      env: {
        ...process.env,
        HOME: "/tmp/pw-home",
        XDG_CONFIG_HOME: "/tmp/pw-xdg",
        XDG_CACHE_HOME: "/tmp/pw-cache",
      },
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);

    const armed = await page.evaluate(() => document.documentElement.dataset.localfirstShield);
    if (armed !== "armed") {
      throw new Error(`Expected dataset.localfirstShield === 'armed', got '${armed}'`);
    }

    // Install observer counting EVERY transition into MODAL
    await page.evaluate(() => {
      window.__modalOpenCount = 0;
      const attachObs = () => {
        const host = document.querySelector("#localfirst-paste-shield-host");
        if (!host) return false;
        if (host.dataset.lfState === "MODAL") window.__modalOpenCount++;
        const attrObs = new MutationObserver((muts) => {
          for (const m of muts) {
            if (m.attributeName === "data-lf-state" && host.dataset.lfState === "MODAL") {
              window.__modalOpenCount++;
            }
          }
        });
        attrObs.observe(host, { attributes: true, attributeFilter: ["data-lf-state"] });
        return true;
      };
      if (!attachObs()) {
        const docObs = new MutationObserver(() => {
          if (attachObs()) docObs.disconnect();
        });
        docObs.observe(document.documentElement, { childList: true });
      }
    });

    // 1. Benign paste -> NOT canceled, 0 MODAL transitions
    const benignRes = await dispatchPaste(page, "#sim-github-issue", "nginx 502 on /healthz");
    if (!benignRes.notCanceled) throw new Error("Expected benign paste NOT to be canceled");
    const modals0 = await page.evaluate(() => window.__modalOpenCount);
    if (modals0 !== 0) throw new Error(`Expected 0 modal opens for benign paste, got ${modals0}`);

    // 2. Secret paste into contenteditable (#sim-ai-chat) -> blocked, modalOpenCount === 1
    const awsKey = ["AK", "IAIOSFODNN7EXAMPLE"].join("");
    const secretPayload = `Investigate ${awsKey} and Project-Chimera`;
    const ceRes = await dispatchPaste(page, "#sim-ai-chat", secretPayload);
    if (ceRes.notCanceled) throw new Error("Expected secret paste into contenteditable to be intercepted");
    const domBefore = await page.locator("#sim-ai-chat").textContent();
    if (domBefore?.includes(awsKey)) throw new Error("Raw secret leaked into contenteditable DOM!");
    const modals1 = await page.evaluate(() => window.__modalOpenCount);
    if (modals1 !== 1) throw new Error(`Expected modalOpenCount === 1 after paste, got ${modals1}`);

    await page.evaluate(() => {
      document.querySelector("#localfirst-paste-shield-host")?.shadowRoot?.querySelector("#lf-primary")?.click();
    });
    await page.waitForTimeout(150);
    const domAfter = await page.locator("#sim-ai-chat").textContent();
    if (!domAfter?.includes("[REDACTED:") || domAfter.includes(awsKey)) {
      throw new Error(`Expected safe redacted text in #sim-ai-chat, got '${domAfter}'`);
    }

    // 3. Secret paste into <textarea> (#sim-github-issue) -> modalOpenCount increments by 1 (total 2)
    const taRes = await dispatchPaste(page, "#sim-github-issue", secretPayload);
    if (taRes.notCanceled) throw new Error("Expected secret paste into textarea to be intercepted");
    const modals2 = await page.evaluate(() => window.__modalOpenCount);
    if (modals2 !== 2) throw new Error(`Expected modalOpenCount === 2 after textarea paste, got ${modals2}`);
    await page.evaluate(() => {
      document.querySelector("#localfirst-paste-shield-host")?.shadowRoot?.querySelector("#lf-primary")?.click();
    });
    await page.waitForTimeout(150);
    const taAfter = await page.locator("#sim-github-issue").inputValue();
    if (!taAfter.includes("[REDACTED:") || taAfter.includes(awsKey)) {
      throw new Error(`Expected safe redacted text in #sim-github-issue, got '${taAfter}'`);
    }

    // 4. Typing 3 secrets in bursts into nested ProseMirror -> SILENT_PILL only (0 modals!)
    await page.evaluate(() => {
      window.__modalOpenCount = 0;
      window.__sendHandlerCallCount = 0;
      document.querySelector("#sim-send-btn").addEventListener("click", () => {
        window.__sendHandlerCallCount++;
      });
    });
    await page.locator("#sim-prosemirror p").click();
    await page.keyboard.type("my phone number is 9876543210 ", { delay: 2 });
    await page.waitForTimeout(850);
    const pill1 = await page.evaluate(() => ({
      state: document.querySelector("#localfirst-paste-shield-host")?.dataset?.lfState,
      text: document.querySelector("#localfirst-paste-shield-host")?.shadowRoot?.querySelector("#lf-pill-text")?.textContent,
      modals: window.__modalOpenCount,
    }));
    if (pill1.state !== "SILENT_PILL" || pill1.modals !== 0) {
      throw new Error(`Expected SILENT_PILL and 0 modals while typing, got ${JSON.stringify(pill1)}`);
    }

    await page.keyboard.type("and my name is ravi and my api key is 23224324234kjjjkjl", { delay: 2 });
    await page.waitForTimeout(850);
    const pill2 = await page.evaluate(() => ({
      state: document.querySelector("#localfirst-paste-shield-host")?.dataset?.lfState,
      text: document.querySelector("#localfirst-paste-shield-host")?.shadowRoot?.querySelector("#lf-pill-text")?.textContent,
      modals: window.__modalOpenCount,
    }));
    if (pill2.state !== "SILENT_PILL" || !pill2.text?.includes("3 secrets") || pill2.modals !== 0) {
      throw new Error(`Expected updated SILENT_PILL with 3 secrets & 0 modals, got ${JSON.stringify(pill2)}`);
    }

    // 5. Clicking Send button -> opens MODAL EXACTLY ONCE (modalOpenCount === 1), blocks submit
    await page.locator("#sim-send-btn").click();
    const afterSendClick = await page.evaluate(() => ({
      state: document.querySelector("#localfirst-paste-shield-host")?.dataset?.lfState,
      modals: window.__modalOpenCount,
      sendCalls: window.__sendHandlerCallCount,
    }));
    if (afterSendClick.state !== "MODAL" || afterSendClick.modals !== 1 || afterSendClick.sendCalls !== 0) {
      throw new Error(`Expected Send click to open 1 MODAL and block submit, got ${JSON.stringify(afterSendClick)}`);
    }

    // Click Scrub Draft -> hides HUD, leaves 0 raw secrets, stays at modalOpenCount === 1 for 2500ms
    await page.evaluate(() => {
      document.querySelector("#localfirst-paste-shield-host")?.shadowRoot?.querySelector("#lf-primary")?.click();
    });
    await page.waitForTimeout(2500);
    const postScrub = await page.evaluate(() => ({
      state: document.querySelector("#localfirst-paste-shield-host")?.dataset?.lfState,
      modals: window.__modalOpenCount,
      text: document.querySelector("#sim-prosemirror")?.textContent || "",
    }));
    if (
      postScrub.state !== "HIDDEN" ||
      postScrub.modals !== 1 ||
      postScrub.text.includes("9876543210") ||
      postScrub.text.includes("ravi") ||
      postScrub.text.includes("23224324234kjjjkjl")
    ) {
      throw new Error(`Expected clean HIDDEN state with modalOpenCount === 1 after 2500ms, got ${JSON.stringify(postScrub)}`);
    }

    // Clicking Send AFTER scrubbing lets submit go through with 0 modal popups
    await page.locator("#sim-send-btn").click();
    await page.waitForTimeout(100);
    const afterCleanSend = await page.evaluate(() => ({
      modals: window.__modalOpenCount,
      sendCalls: window.__sendHandlerCallCount,
    }));
    if (afterCleanSend.modals !== 1 || afterCleanSend.sendCalls !== 1) {
      throw new Error(`Expected clean Send to succeed with 0 extra modals, got ${JSON.stringify(afterCleanSend)}`);
    }

    // 6. Verify Side Panel stats & toggle OFF
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    const extId = new URL(sw.url()).hostname;
    const spPage = await context.newPage();
    await spPage.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`, { waitUntil: "domcontentloaded" });
    await spPage.waitForTimeout(250);
    const blockedPastes = await spPage.locator("#stat-blocked-pastes").textContent();
    if (Number(blockedPastes) < 2) {
      throw new Error(`Expected >= 2 blocked pastes in Side Panel stats, got ${blockedPastes}`);
    }

    await spPage.locator("#btn-shield-toggle").click();
    await spPage.waitForTimeout(200);
    const offRes = await dispatchPaste(page, "#sim-github-issue", secretPayload);
    if (!offRes.notCanceled) throw new Error("Expected paste NOT to be intercepted when shieldEnabled is OFF");

    console.log("MV3 PASTE SHIELD E2E PASSED (SILENT_PILL while typing, 1 MODAL on paste/send, 0 raw secrets leaked).");
  } finally {
    await context?.close().catch(() => {});
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("MV3 PASTE SHIELD E2E FAILED:", err);
  process.exit(1);
});
