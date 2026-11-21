import { chromium } from "playwright-core";
import { spawn } from "node:child_process";

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}/`;

function startPreviewServer() {
  const proc = spawn("npx", ["vite", "preview", "--port", String(PORT), "--host", "127.0.0.1"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("vite preview startup timeout")), 10000);
    proc.stdout.on("data", (buf) => {
      const text = buf.toString();
      if (text.includes(String(PORT)) || text.includes("Local:")) {
        clearTimeout(timer);
        resolve(proc);
      }
    });
    proc.stderr.on("data", (buf) => {
      const text = buf.toString();
      if (text.includes("Error:")) {
        clearTimeout(timer);
        reject(new Error(text));
      }
    });
  });
}

async function main() {
  const server = await startPreviewServer();
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    env: {
      ...process.env,
      HOME: "/tmp/pw-home",
      XDG_CONFIG_HOME: "/tmp/pw-xdg",
      XDG_CACHE_HOME: "/tmp/pw-cache",
    },
  });

  const pageErrors = [];
  const consoleWarnings = [];

  try {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    });
    const page = await context.newPage();

    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("When a hybrid inference mode is specified")) {
        consoleWarnings.push(text);
      }
    });

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("h1");
    const heading = await page.textContent("h1");
    if (!heading?.includes("LocalFirst Triage")) {
      throw new Error(`Unexpected H1: ${heading}`);
    }

    // 0. Verify System / Dark / Light theme switcher + Cloud Sync popover
    await page.getByRole("button", { name: /^Dark/i }).click();
    if ((await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) !== "dark") {
      throw new Error("Expected Dark theme to set data-theme=dark");
    }
    await page.getByRole("button", { name: /^Light/i }).click();
    if ((await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) !== "light") {
      throw new Error("Expected Light theme to set data-theme=light");
    }

    await page.getByRole("button", { name: /Cloud Sync/i }).click();
    await page.waitForSelector("#cloud-sync-popover");
    await page.getByRole("button", { name: /Sync as Guest/i }).waitFor();
    await page.getByRole("button", { name: /Sign In with Google/i }).waitFor();
    await page.keyboard.press("Escape");

    // 1. Verify PWA manifest & icons return 200 OK
    for (const assetPath of ["manifest.json", "icons/icon-192.png", "icons/icon-512.png"]) {
      const status = await page.evaluate(async (p) => {
        const res = await fetch(`/${p}`);
        return res.status;
      }, assetPath);
      if (status !== 200) {
        throw new Error(`PWA asset /${assetPath} returned HTTP ${status}`);
      }
    }

    // 2. Run Scenario 1 (Hospital Checkout Alert) -> Review Hidden Secrets + Technical Proof drawer
    await page.getByRole("button", { name: /Protect & Analyze/i }).click();
    await page.waitForSelector("text=Review Hidden Secrets");
    await page.waitForSelector("text=Confidential Deal Info");
    await page.getByRole("button", { name: /Send Safe Text to AI/i }).waitFor();

    await page.getByRole("button", { name: /Inspect Technical Proof/i }).click();
    await page.waitForSelector("text=ZERO-LEAKAGE VERIFIED:");
    const drawerText = await page.textContent("dialog[open]");
    if (!drawerText?.includes("[REGEX_FIREWALL]") || !drawerText?.includes("[HEURISTIC_GUARD]")) {
      throw new Error("Expected [REGEX_FIREWALL] and [HEURISTIC_GUARD] in Technical Proof drawer");
    }
    await page.getByRole("button", { name: /Refresh Policy/i }).click();
    await page.waitForSelector("text=Export Audit JSON");
    await page.getByRole("button", { name: /Close Technical Proof drawer/i }).click();

    // 3. Run Scenario 2 (Expired Local Certificate) -> Local Runbook ($0 Cloud)
    await page.getByText(/Expired Local Certificate/i).click();
    await page.getByRole("button", { name: /Protect & Analyze/i }).click();
    await page.waitForSelector("text=RB_LOCAL_TLS_CERT");

    // 4. Toggle Offline Mode ON via Cloud Sync popover & test P0 -> Saved for Connection
    await page.getByRole("button", { name: /Cloud Sync/i }).click();
    await page.getByRole("switch", { name: /Toggle Offline Mode/i }).click();
    await page.keyboard.press("Escape");

    await page.getByText(/Hospital Checkout Alert/i).first().click();
    await page.getByRole("button", { name: /Protect & Fix Offline/i }).click();
    await page.waitForSelector("text=Saved for Connection");

    // 5. Switch to Privacy Rules tab, add custom blocked term, verify redaction
    await page.getByRole("button", { name: /Privacy Rules/i }).click();
    await page.getByLabel("Custom blocked term").fill("OmegaCodename");
    await page.getByRole("button", { name: /Add Rule/i }).click();
    await page.getByRole("button", { name: /^Triage$/i }).click();

    await page.locator("#ticket-body").fill("P0 issue referencing OmegaCodename in logs.");
    await page.getByRole("button", { name: /Protect & Fix Offline/i }).click();
    await page.waitForSelector("text=Hidden: Company Rule");

    // 6. Verify Leadership & Team Update (offline Generated Locally)
    await page.getByRole("button", { name: /Draft Leadership Update/i }).click();
    await page.waitForSelector("text=Generated Locally");

    // 7. Test Chrome Extension #handoff import clears URL hash and populates History
    const handoffPayload = Buffer.from(
      JSON.stringify({
        title: "Extension Capture",
        sanitizedText: "Sanitized [REDACTED:AWS_ACCESS_KEY_1] issue",
      }),
    ).toString("base64url");
    await page.goto(`${BASE_URL}#handoff=${handoffPayload}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=From Browser Extension");
    if (new URL(page.url()).hash) {
      throw new Error(`Expected URL hash to be cleared, got ${page.url()}`);
    }
    await page.getByRole("button", { name: /Protect & (Analyze|Fix Offline)/i }).click();
    await page.getByRole("button", { name: /History/i }).click();
    await page.waitForSelector("text=Extension Capture");
    await page.getByRole("button", { name: /^Triage$/i }).click();

    // 8. Verify XSS immunity (<script> and javascript: payloads render as inert text)
    await page.locator("#ticket-body").fill(
      'P3 cert_has_expired with <script>window.__xss_fired = true;</script> and [click](javascript:alert(1))',
    );
    await page.getByRole("button", { name: /Protect & (Analyze|Fix Offline)/i }).click();
    await page.waitForSelector("text=RB_LOCAL_TLS_CERT");
    const xssFired = await page.evaluate(() => Boolean(window.__xss_fired));
    if (xssFired) {
      throw new Error("XSS script payload executed!");
    }

    // 9. Verify zero horizontal layout overflow across 1280x720, 1024x768, and 375x667 in BOTH Light and Dark themes
    for (const theme of ["Light", "Dark"]) {
      const themeBtn = page.getByRole("button", { name: new RegExp(`^${theme}`, "i") }).first();
      await themeBtn.click();
      for (const vp of [
        { width: 1280, height: 720 },
        { width: 1024, height: 768 },
        { width: 375, height: 667 },
      ]) {
        await page.setViewportSize(vp);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        );
        if (overflow) {
          throw new Error(
            `Horizontal layout overflow detected at ${theme} theme viewport ${vp.width}x${vp.height}`,
          );
        }
      }
      await page.setViewportSize({ width: 1280, height: 720 });
    }

    if (pageErrors.length > 0) {
      throw new Error(`Uncaught page errors: ${pageErrors.join("; ")}`);
    }
    if (consoleWarnings.length > 0) {
      throw new Error(`@firebase/ai hybrid config warnings: ${consoleWarnings.join("; ")}`);
    }

    console.log("PLAYWRIGHT E2E VERIFICATION PASSED (all 9 flows, Light+Dark, 0 page errors, 0 SDK warnings).");
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error("PLAYWRIGHT E2E FAILED:", err);
  process.exit(1);
});
