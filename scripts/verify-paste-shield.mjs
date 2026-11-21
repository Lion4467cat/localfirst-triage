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

    // 4. Typing natural-language secrets into contenteditable -> debounced Live Typed-Secret Guard + Scrub Draft Now
    await page.waitForTimeout(1600);
    await page.locator("#sim-ai-chat").evaluate((el) => {
      el.textContent = "";
      el.focus();
    });
    const nlSample =
      "my phone number is 9876543210 and my name is ravi and i work in Zenith company , and my api key is 23224324234kjjjkjl";
    await page.locator("#sim-ai-chat").type(nlSample, { delay: 2 });
    await page.waitForTimeout(600);
    await page.locator("#localfirst-paste-shield-host").waitFor();
    const draftHeadline = await page.evaluate(
      () => document.querySelector("#localfirst-paste-shield-host")?.shadowRoot?.querySelector("#lf-headline")?.textContent || "",
    );
    if (!draftHeadline.includes("Detected")) {
      throw new Error(`Expected live typing draft HUD, got '${draftHeadline}'`);
    }
    await page.evaluate(() => {
      document.querySelector("#localfirst-paste-shield-host")?.shadowRoot?.querySelector("#lf-paste-safe")?.click();
    });
    await page.waitForTimeout(200);
    const scrubbedDraft = await page.locator("#sim-ai-chat").textContent();
    if (
      !scrubbedDraft ||
      scrubbedDraft.includes("9876543210") ||
      scrubbedDraft.includes("ravi") ||
      scrubbedDraft.includes("Zenith company") ||
      scrubbedDraft.includes("23224324234kjjjkjl")
    ) {
      throw new Error(`Expected all 4 natural-language secrets scrubbed from draft, got '${scrubbedDraft}'`);
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
