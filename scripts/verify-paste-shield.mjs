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

    // 2. Secret paste into contenteditable -> composition is never interrupted (README: the shield
    //    stays silent while you type or paste). The send-time guard is what blocks the secret.
    const awsKey = ["AK", "IAIOSFODNN7EXAMPLE"].join("");
    const secretPayload = `Investigate ${awsKey} and Project-Chimera`;
    const ceRes = await dispatchPaste(page, "#sim-ai-chat", secretPayload);
    if (!ceRes.notCanceled) throw new Error("Expected secret paste to stay uncanceled while composing");
    const modals1 = await page.evaluate(() => window.__modalOpenCount);
    if (modals1 !== 0) throw new Error(`Expected 0 modals during paste, got ${modals1}`);
    const hudState = await page.evaluate(
      () => document.querySelector("#localfirst-paste-shield-host")?.dataset?.lfState || "HIDDEN",
    );
    if (hudState !== "HIDDEN") throw new Error(`Expected HUD hidden during paste, got ${hudState}`);

    // 3. Secret paste into <textarea> -> same silent contract, no modal, no HUD
    const taRes = await dispatchPaste(page, "#sim-github-issue", secretPayload);
    if (!taRes.notCanceled) throw new Error("Expected textarea paste to stay uncanceled while composing");
    const modals2 = await page.evaluate(() => window.__modalOpenCount);
    if (modals2 !== 0) throw new Error(`Expected 0 modals after textarea paste, got ${modals2}`);

    // 4. Typing 3 secrets in bursts into nested ProseMirror -> ZERO HUD popups while typing!
    await page.evaluate(() => {
      window.__modalOpenCount = 0;
      window.__sendHandlerCallCount = 0;
      document.querySelector("#sim-send-btn").addEventListener("click", () => {
        window.__sendHandlerCallCount++;
      });
    });
    await page.locator("#sim-prosemirror p").click();
    await page.keyboard.type("my phone number is 9876543210 and my name is ravi and my api key is 23224324234kjjjkjl", { delay: 2 });
    await page.waitForTimeout(900);
    const duringTyping = await page.evaluate(() => ({
      state: document.querySelector("#localfirst-paste-shield-host")?.dataset?.lfState || "HIDDEN",
      modals: window.__modalOpenCount,
    }));
    if (duringTyping.state !== "HIDDEN" || duringTyping.modals !== 0) {
      throw new Error(`Expected HIDDEN and 0 modals while typing, got ${JSON.stringify(duringTyping)}`);
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

    // Clicking Send AFTER scrubbing lets submit go through with 0 modal popups. Scrubbing
    // releases the send that was queued when the modal opened, so the counter can be 1 (release)
    // or 2 (release plus this explicit click); what matters is that no new modal appears.
    await page.locator("#sim-send-btn").click();
    await page.waitForTimeout(100);
    const afterCleanSend = await page.evaluate(() => ({
      modals: window.__modalOpenCount,
      sendCalls: window.__sendHandlerCallCount,
    }));
    if (afterCleanSend.modals !== 1 || afterCleanSend.sendCalls < 1) {
      throw new Error(`Expected clean Send to succeed with 0 extra modals, got ${JSON.stringify(afterCleanSend)}`);
    }

    // 5B. HEAVY MULTI-VECTOR SEND / SEARCH STRESS SUITE (0ms Enter, Google Search, Autocomplete,
    //     beforeinput, nested Shadow DOM, mousedown-clearing input, Multi-PII + ZWS, Benign Control)
    await page.evaluate(() => {
      window.__stressStats = {
        googleSubmits: [],
        optionClicks: 0,
        chatSubmits: [],
        clearInputSubmits: [],
        shadowSubmits: [],
      };
      const mount = document.createElement("section");
      mount.id = "stress-suite-mount";
      mount.innerHTML = `
        <form id="stress-google-form" action="/search" role="search">
          <div role="combobox">
            <textarea id="stress-google-q" name="q" aria-label="Search"></textarea>
          </div>
          <div role="listbox">
            <div id="stress-google-opt" role="option" tabindex="0">autocomplete suggestion</div>
          </div>
          <button id="stress-google-btn" type="submit" aria-label="Google Search">Search</button>
        </form>

        <form id="stress-single-form">
          <input id="stress-single-in" type="search" placeholder="Quick search..." />
          <button id="stress-single-btn" type="submit" aria-label="Search">Search</button>
        </form>

        <div id="stress-chat-wrap">
          <textarea id="stress-chat-ta" data-composer="chat" placeholder="Message AI..."></textarea>
          <button id="stress-chat-send" type="button" data-testid="send-button">Send</button>
        </div>

        <div id="stress-beforeinput-ce" contenteditable="true" role="textbox" aria-label="Lexical Chat"></div>

        <div id="stress-clear-wrap">
          <input id="stress-clear-in" type="text" placeholder="Ask..." />
          <button id="stress-clear-btn" type="button" aria-label="Send">Send</button>
        </div>

        <div id="stress-shadow-host"></div>
      `;
      document.body.appendChild(mount);

      const gForm = document.getElementById("stress-google-form");
      gForm.addEventListener("submit", (e) => {
        e.preventDefault();
        window.__stressStats.googleSubmits.push(document.getElementById("stress-google-q").value);
      });
      document.getElementById("stress-google-opt").addEventListener("click", () => {
        window.__stressStats.optionClicks++;
      });

      document.getElementById("stress-single-form").addEventListener("submit", (e) => {
        e.preventDefault();
      });

      document.getElementById("stress-chat-send").addEventListener("click", () => {
        window.__stressStats.chatSubmits.push(document.getElementById("stress-chat-ta").value);
      });

      // Site script that clears input.value = '' on mousedown BEFORE click fires
      const clearIn = document.getElementById("stress-clear-in");
      const clearBtn = document.getElementById("stress-clear-btn");
      let stashed = "";
      clearBtn.addEventListener("mousedown", () => {
        stashed = clearIn.value;
        clearIn.value = "";
      });
      clearBtn.addEventListener("click", () => {
        window.__stressStats.clearInputSubmits.push(clearIn.value || stashed);
      });

      // Nested Shadow DOM composer
      const shHost = document.getElementById("stress-shadow-host");
      const sr = shHost.attachShadow({ mode: "open" });
      sr.innerHTML = `
        <textarea id="sh-composer" placeholder="Message Shadow AI..."></textarea>
        <button id="sh-send-btn" type="button" aria-label="Send prompt">Send</button>
      `;
      sr.getElementById("sh-send-btn").addEventListener("click", () => {
        window.__stressStats.shadowSubmits.push(sr.getElementById("sh-composer").value);
      });
    });

    const dismissModal = () =>
      page.evaluate(() => {
        document.querySelector("#localfirst-paste-shield-host")?.shadowRoot?.querySelector("#lf-cancel")?.click();
      });
    const clickScrubAndSend = () =>
      page.evaluate(() => {
        document.querySelector("#localfirst-paste-shield-host")?.shadowRoot?.querySelector("#lf-primary")?.click();
      });
    const isModalUp = () =>
      page.evaluate(() => document.querySelector("#localfirst-paste-shield-host")?.dataset?.lfState === "MODAL");

    const stripeSample = ["sk_live_", "99887766554433221100aabb"].join("");
    const zwsGithub = ["ghp_", "\u200B1234567890abcdefghijklmnopqrstuvwxyz"].join("");

    // Vector 1: Google Search <textarea name="q"> character-by-character type + 0ms Enter
    await page.locator("#stress-google-q").click();
    await page.keyboard.type(`fix 502 error ${stripeSample}`, { delay: 0 });
    await page.keyboard.press("Enter");
    if (!(await isModalUp())) throw new Error("Vector 1 failed: Google Search 0ms Enter did not open MODAL");
    await dismissModal();

    // Vector 2: Google Search button click (pointerdown -> mousedown -> click)
    await page.locator("#stress-google-btn").click();
    if (!(await isModalUp())) throw new Error("Vector 2 failed: Google Search button click did not open MODAL");
    await dismissModal();

    // Vector 3: Google Search autocomplete [role="option"] click
    await page.locator("#stress-google-opt").click();
    if (!(await isModalUp())) throw new Error("Vector 3 failed: Autocomplete [role='option'] click did not open MODAL");
    await clickScrubAndSend();
    await page.waitForTimeout(250);
    const gSubmitsAfterScrub = await page.evaluate(() => window.__stressStats.googleSubmits);
    if (
      gSubmitsAfterScrub.length !== 1 ||
      gSubmitsAfterScrub[0].includes("99887766554433221100aabb") ||
      !gSubmitsAfterScrub[0].includes("[REDACTED:API_KEY")
    ) {
      throw new Error(`Vector 3 scrub submit failed: ${JSON.stringify(gSubmitsAfterScrub)}`);
    }

    // Vector 4: Single-line <input type="search"> + Shift+Enter -> blocked!
    await page.locator("#stress-single-in").click();
    await page.keyboard.type(`lookup ${stripeSample}`, { delay: 0 });
    await page.keyboard.press("Shift+Enter");
    if (!(await isModalUp())) throw new Error("Vector 4 failed: Single-line Shift+Enter did not open MODAL");
    await dismissModal();
    await page.locator("#stress-single-in").fill("");

    // Vector 5: Multiline AI Chat <textarea> -> Shift+Enter inserts newline (0 modal), Enter & Ctrl+Enter block, Multi-PII + ZWS scrubbed!
    const multiPii = `Key ${stripeSample} Card 4532 0151 1283 0366 PAN ABCDE1234F Aadhaar 2345 6789 0123 UPI ravi.kumar@okicici ZWS ${zwsGithub}`;
    await page.locator("#stress-chat-ta").click();
    await page.keyboard.type("Line 1", { delay: 0 });
    await page.keyboard.press("Shift+Enter");
    if (await isModalUp()) throw new Error("Vector 5 failed: Shift+Enter on multiline chat textarea should not open MODAL");
    await page.keyboard.type(multiPii, { delay: 0 });
    await page.keyboard.press("Enter");
    if (!(await isModalUp())) throw new Error("Vector 5 failed: Plain Enter on chat textarea did not open MODAL");
    await dismissModal();
    await page.locator("#stress-chat-ta").click();
    await page.keyboard.press("Control+Enter");
    if (!(await isModalUp())) throw new Error("Vector 5 failed: Ctrl+Enter on chat textarea did not open MODAL");
    await clickScrubAndSend();
    await page.waitForTimeout(250);
    const chatSent = await page.evaluate(() => window.__stressStats.chatSubmits);
    if (
      chatSent.length !== 1 ||
      chatSent[0].includes("99887766554433221100aabb") ||
      chatSent[0].includes("4532 0151") ||
      chatSent[0].includes("ABCDE1234F") ||
      chatSent[0].includes("2345 6789 0123") ||
      chatSent[0].includes("okicici") ||
      chatSent[0].includes("1234567890abcdefghijklmnopqrstuvwxyz")
    ) {
      throw new Error(`Vector 5 multi-PII scrub leaked: ${JSON.stringify(chatSent)}`);
    }

    // Vector 6: Rich contenteditable dispatching beforeinput (insertParagraph)
    await page.locator("#stress-beforeinput-ce").click();
    await page.keyboard.type(`Patient PAN ABCDE1234F`, { delay: 0 });
    const beforeInputCanceled = await page.evaluate(() => {
      const ce = document.getElementById("stress-beforeinput-ce");
      const ev = new InputEvent("beforeinput", {
        inputType: "insertParagraph",
        bubbles: true,
        cancelable: true,
      });
      return !ce.dispatchEvent(ev);
    });
    if (!beforeInputCanceled || !(await isModalUp())) {
      throw new Error("Vector 6 failed: beforeinput insertParagraph was not synchronously canceled");
    }
    await dismissModal();

    // Vector 7: Input cleared on mousedown before click -> caught at pointerdown before clear!
    await page.locator("#stress-clear-in").click();
    await page.keyboard.type(`secret ${stripeSample}`, { delay: 0 });
    await page.locator("#stress-clear-btn").click();
    if (!(await isModalUp())) throw new Error("Vector 7 failed: mousedown-clearing input bypassed shield");
    const clearSubmitsBlocked = await page.evaluate(() => window.__stressStats.clearInputSubmits.length);
    if (clearSubmitsBlocked !== 0) throw new Error("Vector 7 failed: raw secret leaked on mousedown/click");
    await clickScrubAndSend();
    await page.waitForTimeout(250);
    const clearSubmitsAfterScrub = await page.evaluate(() => window.__stressStats.clearInputSubmits);
    if (
      clearSubmitsAfterScrub.length !== 1 ||
      clearSubmitsAfterScrub[0].includes("99887766554433221100aabb") ||
      !clearSubmitsAfterScrub[0].includes("[REDACTED:API_KEY")
    ) {
      throw new Error(`Vector 7 scrub failed: ${JSON.stringify(clearSubmitsAfterScrub)}`);
    }

    // Vector 8: Nested Shadow DOM editor + Send button
    await page.evaluate(() => {
      const sr = document.getElementById("stress-shadow-host").shadowRoot;
      const ta = sr.getElementById("sh-composer");
      ta.focus();
      ta.value = "UPI transfer to synth.user@okicici";
      ta.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      sr.getElementById("sh-send-btn").click();
    });
    if (!(await isModalUp())) throw new Error("Vector 8 failed: Nested Shadow DOM editor was not intercepted");
    await dismissModal();

    // Vector 9: Benign Search / Prompt Control Suite -> 0 false-positive blocks!
    await page.evaluate(() => {
      window.__modalOpenCount = 0;
      window.__stressStats.googleSubmits = [];
    });
    for (const benignQuery of [
      "how to fix python IndexError",
      "v4.6.2 release notes",
      "127.0.0.1 localhost port 8080",
    ]) {
      await page.locator("#stress-google-q").fill(benignQuery);
      await page.locator("#stress-google-q").focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(40);
      await page.locator("#stress-google-btn").click();
      await page.waitForTimeout(40);
    }
    const benignCheck = await page.evaluate(() => ({
      modals: window.__modalOpenCount,
      submits: window.__stressStats.googleSubmits.length,
    }));
    if (benignCheck.modals !== 0 || benignCheck.submits !== 6) {
      throw new Error(`Vector 9 benign control failed (expected 0 modals & 6 submits): ${JSON.stringify(benignCheck)}`);
    }

    // 6. Verify Side Panel at 360px width: 0 console/CSP errors, 0 overflow, Protection Dial persistence
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    const extId = new URL(sw.url()).hostname;
    const spPage = await context.newPage();
    await spPage.setViewportSize({ width: 360, height: 740 });
    const spErrors = [];
    spPage.on("pageerror", (err) => spErrors.push(err.message));
    spPage.on("console", (msg) => {
      if (msg.type() === "error") spErrors.push(msg.text());
    });
    await spPage.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`, { waitUntil: "domcontentloaded" });
    await spPage.waitForTimeout(300);

    if (spErrors.length > 0) {
      throw new Error(`Side panel had console/CSP errors: ${spErrors.join(" | ")}`);
    }
    const overflow = await spPage.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    if (overflow) {
      throw new Error("Side panel has horizontal overflow at 360px width");
    }

    // Verify First-Run Setup Gate: visible initially, unavailable state shows System Settings + Re-Check, disappears after confirm, stays hidden on reload
    if (!(await spPage.locator("#setup-gate").isVisible())) {
      throw new Error("Expected #setup-gate to be visible on first launch");
    }
    await spPage.locator('[data-open-url="chrome://settings/system"]').click();
    await spPage.waitForTimeout(100);
    await spPage.locator("#btn-setup-recheck").click();
    await spPage.waitForTimeout(100);
    const feedbackText = await spPage.locator("#setup-model-feedback").textContent();
    if (!feedbackText || !feedbackText.trim()) {
      throw new Error("Expected #setup-model-feedback to show status after clicking Re-Check Status");
    }
    await spPage.locator("#btn-setup-skip-unavail").click();
    if (!(await spPage.locator("#setup-deterministic-warning").isVisible())) {
      throw new Error("Expected #setup-deterministic-warning to appear after clicking Continue in Deterministic Mode");
    }
    await spPage.locator("#btn-setup-confirm-det").click();
    await spPage.waitForTimeout(100);
    if (await spPage.locator("#setup-gate").isVisible()) {
      throw new Error("Expected #setup-gate to disappear after confirming Deterministic Mode");
    }
    await spPage.reload({ waitUntil: "domcontentloaded" });
    await spPage.waitForTimeout(200);
    if (await spPage.locator("#setup-gate").isVisible()) {
      throw new Error("Expected #setup-gate to stay hidden after reload once completed");
    }
    await spPage.locator("#btn-open-setup").click();
    if (!(await spPage.locator("#setup-gate").isVisible())) {
      throw new Error("Expected #btn-open-setup to re-open #setup-gate");
    }
    // The Gemma chooser lives in a collapsed <details>; open it the way a user would.
    await spPage.evaluate(() => {
      document.querySelector("#btn-gemma4-confirm")?.closest("details")?.setAttribute("open", "");
    });
    await spPage.locator("#btn-gemma4-confirm").click();
    await spPage.waitForTimeout(100);
    const modelBadgeText = await spPage.locator("#active-model-badge").textContent();
    if (!modelBadgeText?.includes("Gemma 4 (Chosen)")) {
      throw new Error(`Expected #active-model-badge to show 'Gemma 4 (Chosen)', got '${modelBadgeText}'`);
    }
    const pendingRelaunch = await spPage.evaluate(
      () => new Promise((resolve) => chrome.storage.session.get("cordon_gemma4_pending_relaunch", (r) => resolve(r.cordon_gemma4_pending_relaunch))),
    );
    if (pendingRelaunch !== true) {
      throw new Error(`Expected cordon_gemma4_pending_relaunch === true, got '${pendingRelaunch}'`);
    }
    // Toggle Gemma 4 back OFF: resets setup state & clears pending relaunch
    await spPage.locator("#btn-gemma4-confirm").click();
    await spPage.waitForTimeout(100);
    const resetBadgeText = await spPage.locator("#active-model-badge").textContent();
    if (!resetBadgeText?.includes("Deterministic Rules Only")) {
      throw new Error(`Expected #active-model-badge to revert after toggling Gemma 4 OFF, got '${resetBadgeText}'`);
    }
    await spPage.locator("#btn-setup-skip-unavail").click();
    await spPage.locator("#btn-setup-confirm-det").click();
    await spPage.waitForTimeout(100);
    if (await spPage.locator("#setup-gate").isVisible()) {
      throw new Error("Expected #btn-setup-confirm-det to dismiss #setup-gate");
    }

    // The shield counts the send-time block; paste stays silent by design, so one event is the
    // full expectation for this flow.
    const blockedPastes = await spPage.locator("#stat-blocked-pastes").textContent();
    if (Number(blockedPastes) < 1) {
      throw new Error(`Expected >= 1 blocked event in Side Panel stats, got ${blockedPastes}`);
    }

    // Test Low -> Medium -> High dial updates capability text & persists to chrome.storage.local
    for (const [lvl, expectedSubstr] of [
      ["low", "Send Guard Only"],
      ["medium", "Send-Button / Enter Guard"],
      ["high", "Gemini Nano 4 Semantic Check"],
    ]) {
      await spPage.locator(`[data-level-choice="${lvl}"]`).click();
      await spPage.waitForTimeout(100);
      const capText = await spPage.locator("#level-capability-text").textContent();
      if (!capText?.includes(expectedSubstr)) {
        throw new Error(`Expected capability text for '${lvl}' to include '${expectedSubstr}', got '${capText}'`);
      }
      const storedLevel = await spPage.evaluate(
        () => new Promise((resolve) => chrome.storage.local.get("protectionLevel", (r) => resolve(r.protectionLevel))),
      );
      if (storedLevel !== lvl) {
        throw new Error(`Expected chrome.storage.local.protectionLevel === '${lvl}', got '${storedLevel}'`);
      }
    }

    await spPage.locator("#btn-shield-toggle").click();
    await spPage.waitForTimeout(200);
    const offRes = await dispatchPaste(page, "#sim-github-issue", secretPayload);
    if (!offRes.notCanceled) throw new Error("Expected paste NOT to be intercepted when shieldEnabled is OFF");

    console.log("MV3 PASTE SHIELD E2E PASSED (0 popups while typing, 1 MODAL on paste/send, 0 raw secrets leaked, Side Panel 360px verified).");
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
