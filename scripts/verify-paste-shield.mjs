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
      const notCanceled = el.dispatchEvent(evt);
      return { notCanceled };
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

    const armed = await page.evaluate(
      () => document.documentElement.dataset.localfirstShield,
    );
    if (armed !== "armed") {
      throw new Error(`Expected dataset.localfirstShield === 'armed', got '${armed}'`);
    }

    // 1. Benign paste -> NOT canceled, NO HUD shown
    const benignRes = await dispatchPaste(page, "#sim-github-issue", "nginx 502 on /healthz");
    if (!benignRes.notCanceled) {
      throw new Error("Expected benign paste NOT to be canceled");
    }
    if ((await page.locator("#localfirst-paste-shield-host").count()) !== 0) {
      throw new Error("Unexpected HUD for benign paste");
    }

    // 2. Secret paste into contenteditable (#sim-ai-chat) -> blocked BEFORE host DOM sees raw secret
    const awsKey = ["AK", "IAIOSFODNN7EXAMPLE"].join("");
    const secretPayload = `Investigate ${awsKey} and Project-Chimera`;
    const ceRes = await dispatchPaste(page, "#sim-ai-chat", secretPayload);
    if (ceRes.notCanceled) {
      throw new Error("Expected secret paste into contenteditable to be intercepted");
    }
    const domBefore = await page.locator("#sim-ai-chat").textContent();
    if (domBefore?.includes(awsKey)) {
      throw new Error("Raw secret leaked into contenteditable DOM before approval!");
    }

    const hudHost = page.locator("#localfirst-paste-shield-host");
    await hudHost.waitFor();
    const headline = await page.evaluate(
      () => document.querySelector("#localfirst-paste-shield-host")?.shadowRoot?.querySelector("#lf-headline")?.textContent || "",
    );
    if (!headline.includes("Blocked")) {
      throw new Error(`Expected HUD headline 'Blocked ...', got '${headline}'`);
    }

    await page.evaluate(() => {
      document.querySelector("#localfirst-paste-shield-host")?.shadowRoot?.querySelector("#lf-paste-safe")?.click();
    });
    await page.waitForTimeout(150);
    const domAfter = await page.locator("#sim-ai-chat").textContent();
    if (!domAfter?.includes("[REDACTED:") || domAfter.includes(awsKey)) {
      throw new Error(`Expected safe redacted text in #sim-ai-chat, got '${domAfter}'`);
    }

    // Wait for toast auto-dismiss
    await page.waitForTimeout(1700);

    // 3. Secret paste into <textarea> (#sim-github-issue) -> same zero-leakage proof
    const taRes = await dispatchPaste(page, "#sim-github-issue", secretPayload);
    if (taRes.notCanceled) {
      throw new Error("Expected secret paste into textarea to be intercepted");
    }
    const taBefore = await page.locator("#sim-github-issue").inputValue();
    if (taBefore.includes(awsKey)) {
      throw new Error("Raw secret leaked into textarea before approval!");
    }
    await page.evaluate(() => {
      document.querySelector("#localfirst-paste-shield-host")?.shadowRoot?.querySelector("#lf-paste-safe")?.click();
    });
    await page.waitForTimeout(150);
    const taAfter = await page.locator("#sim-github-issue").inputValue();
    if (!taAfter.includes("[REDACTED:") || taAfter.includes(awsKey)) {
      throw new Error(`Expected safe redacted text in #sim-github-issue, got '${taAfter}'`);
    }

    // 4. Typing natural-language secrets into nested ChatGPT ProseMirror (<div contenteditable><p>)
    // Verify: pause-only single HUD (hudMountCount === 1), Scrub Draft Now triggers 0 follow-up HUDs over 1500ms
    await page.waitForTimeout(1600);
    await page.evaluate(() => {
      window.__hudMountCount = 0;
      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.id === "localfirst-paste-shield-host") {
              window.__hudMountCount++;
            }
          }
        }
      });
      obs.observe(document.documentElement, { childList: true });
      window.__lfHudObs = obs;
    });

    await page.locator("#sim-prosemirror p").click();
    const nlSample =
      "my phone number is 9876543210 and my name is ravi and i work in Zenith company and my api key is 23224324234kjjjkjl. Can you help me write a python script?";
    await page.keyboard.type(nlSample, { delay: 2 });
    // Wait for 1100ms post-typing pause timer
    await page.waitForTimeout(1350);
    await page.locator("#localfirst-paste-shield-host").waitFor();
    const mountCount1 = await page.evaluate(() => window.__hudMountCount);
    if (mountCount1 !== 1) {
      throw new Error(`Expected EXACTLY 1 HUD mount after typing pause, got ${mountCount1}`);
    }
    const draftHeadline = await page.evaluate(
      () => document.querySelector("#localfirst-paste-shield-host")?.shadowRoot?.querySelector("#lf-headline")?.textContent || "",
    );
    if (!draftHeadline.includes("Detected")) {
      throw new Error(`Expected live typing draft HUD, got '${draftHeadline}'`);
    }
    await page.evaluate(() => {
      document.querySelector("#localfirst-paste-shield-host")?.shadowRoot?.querySelector("#lf-paste-safe")?.click();
    });
    // Ensure 0 follow-up HUD pops over the next 2000ms (ProseMirror 600ms cooldown + strict idempotency)
    await page.waitForTimeout(2000);
    const mountCountAfterScrub = await page.evaluate(() => window.__hudMountCount);
    if (mountCountAfterScrub !== 1) {
      throw new Error(`Expected 0 follow-up HUD pops after Scrub Draft Now over 2000ms, got ${mountCountAfterScrub}`);
    }
    const scrubbedDraft = await page.locator("#sim-prosemirror").textContent();
    if (
      !scrubbedDraft ||
      scrubbedDraft.includes("9876543210") ||
      scrubbedDraft.includes("ravi") ||
      scrubbedDraft.includes("Zenith company") ||
      scrubbedDraft.includes("23224324234kjjjkjl") ||
      !scrubbedDraft.includes("Can you help me write a python script?")
    ) {
      throw new Error(`Expected all 4 secrets scrubbed and trailing prose preserved in nested ProseMirror draft, got '${scrubbedDraft}'`);
    }

    // 4b. Clicking simulated ChatGPT Send button while unscrubbed multi-segment address exists -> intercepts click & pops Send Intercepted HUD
    await page.locator("#sim-prosemirror").evaluate((el) => {
      el.innerHTML = "<p><br></p>";
    });
    await page.evaluate(() => {
      window.__sendHandlerCallCount = 0;
      document.querySelector("#sim-send-btn").addEventListener("click", () => {
        window.__sendHandlerCallCount++;
      });
    });
    await page.locator("#sim-prosemirror p").click();
    const addrSample =
      "my address is 42 Oak Street, Koramangala, Bengaluru 560034 and my name is ravi";
    await page.keyboard.type(addrSample, { delay: 1 });
    // Click Send immediately (before 1100ms typing pause) -> Send-button guard must intercept!
    await page.locator("#sim-send-btn").click();
    const sendCalls = await page.evaluate(() => window.__sendHandlerCallCount);
    if (sendCalls !== 0) {
      throw new Error(`Expected Send button click to be intercepted (0 calls), got ${sendCalls}`);
    }
    await page.locator("#localfirst-paste-shield-host").waitFor();
    const sendHeadline = await page.evaluate(
      () => document.querySelector("#localfirst-paste-shield-host")?.shadowRoot?.querySelector("#lf-headline")?.textContent || "",
    );
    if (!sendHeadline.includes("Send Intercepted")) {
      throw new Error(`Expected 'Send Intercepted' HUD headline, got '${sendHeadline}'`);
    }
    await page.evaluate(() => {
      document.querySelector("#localfirst-paste-shield-host")?.shadowRoot?.querySelector("#lf-paste-safe")?.click();
    });
    await page.waitForTimeout(200);
    const scrubbedAddr = await page.locator("#sim-prosemirror").textContent();
    if (
      !scrubbedAddr ||
      scrubbedAddr.includes("42 Oak Street") ||
      scrubbedAddr.includes("Koramangala") ||
      scrubbedAddr.includes("Bengaluru") ||
      scrubbedAddr.includes("560034") ||
      scrubbedAddr.includes("ravi")
    ) {
      throw new Error(`Expected full multi-segment address & PIN scrubbed, got '${scrubbedAddr}'`);
    }

    // 4c. Anti-Triple-Popup Stress Test:
    // Multi-paragraph ProseMirror (<p>line 1</p><p>line 2</p>) + delayed 800ms async Nano 4 + ProseMirror DOM mutation 200ms after scrub
    await page.waitForTimeout(1600);
    await page.evaluate(() => {
      window.__hudMountCountStress = 0;
      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.id === "localfirst-paste-shield-host") {
              window.__hudMountCountStress++;
            }
          }
        }
      });
      obs.observe(document.documentElement, { childList: true });
      // Mock delayed 800ms Nano 4 LanguageModel
      window.LanguageModel = {
        availability: async () => "available",
        params: async () => ({ defaultTopK: 3, maxTopK: 8 }),
        create: async () => ({
          prompt: async () => {
            await new Promise((r) => setTimeout(r, 800));
            return JSON.stringify({
              entities: [{ type: "NATURAL_SECRET", value: "9876543210" }],
            });
          },
          destroy: () => {},
        }),
      };
      const pm = document.querySelector("#sim-prosemirror");
      pm.innerHTML = "<p>my phone number is 9876543210</p><p>and my api key is 23224324234kjjjkjl</p>";
      pm.focus();
      pm.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });

    await page.waitForTimeout(1350);
    await page.locator("#localfirst-paste-shield-host").waitFor();
    const stressMount1 = await page.evaluate(() => window.__hudMountCountStress);
    if (stressMount1 !== 1) {
      throw new Error(`Stress test expected hudOpenCount === 1, got ${stressMount1}`);
    }

    await page.evaluate(() => {
      document.querySelector("#localfirst-paste-shield-host")?.shadowRoot?.querySelector("#lf-paste-safe")?.click();
      // Simulate ProseMirror async DOM re-formatting mutation 200ms after scrub
      setTimeout(() => {
        const pm = document.querySelector("#sim-prosemirror");
        const txt = pm.textContent || "";
        pm.innerHTML = `<p>${txt}</p>`;
        pm.dispatchEvent(new InputEvent("input", { bubbles: true }));
      }, 200);
    });

    await page.waitForTimeout(2000);
    const stressMountAfter = await page.evaluate(() => window.__hudMountCountStress);
    if (stressMountAfter !== 1) {
      throw new Error(`Stress test expected hudOpenCount to stay 1 after scrub + ProseMirror mutation, got ${stressMountAfter}`);
    }
    const stressText = await page.locator("#sim-prosemirror").textContent();
    if (!stressText || stressText.includes("9876543210") || stressText.includes("23224324234kjjjkjl")) {
      throw new Error(`Stress test expected 0 raw secrets remaining in multi-paragraph ProseMirror, got '${stressText}'`);
    }

    // Clicking Send after scrubbing succeeds with 0 additional HUD pops
    await page.evaluate(() => {
      window.__sendAfterScrubCalls = 0;
      document.querySelector("#sim-send-btn").addEventListener("click", () => {
        window.__sendAfterScrubCalls++;
      });
    });
    await page.locator("#sim-send-btn").click();
    await page.waitForTimeout(150);
    const sendAfterScrubCalls = await page.evaluate(() => window.__sendAfterScrubCalls);
    const stressMountAfterSend = await page.evaluate(() => window.__hudMountCountStress);
    if (sendAfterScrubCalls !== 1 || stressMountAfterSend !== 1) {
      throw new Error(`Expected Send after scrub to succeed (calls=${sendAfterScrubCalls}, mounts=${stressMountAfterSend})`);
    }

    // 5. Verify chrome.storage.local stats in Side Panel & toggle OFF
    let [sw] = context.serviceWorkers();
    if (!sw) {
      sw = await context.waitForEvent("serviceworker");
    }
    const extId = new URL(sw.url()).hostname;
    const spPage = await context.newPage();
    await spPage.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`, { waitUntil: "domcontentloaded" });
    await spPage.waitForTimeout(250);

    const blockedPastes = await spPage.locator("#stat-blocked-pastes").textContent();
    if (Number(blockedPastes) < 2) {
      throw new Error(`Expected >= 2 blocked pastes in Side Panel stats, got ${blockedPastes}`);
    }

    // Toggle Live Paste Protection OFF
    await spPage.locator("#btn-shield-toggle").click();
    await spPage.waitForTimeout(200);

    await page.waitForTimeout(1600);
    const offRes = await dispatchPaste(page, "#sim-github-issue", secretPayload);
    if (!offRes.notCanceled) {
      throw new Error("Expected paste NOT to be intercepted when shieldEnabled is OFF");
    }

    console.log("MV3 PASTE SHIELD E2E PASSED (4/4 scenarios, 0 raw secrets leaked to page DOM).");
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
