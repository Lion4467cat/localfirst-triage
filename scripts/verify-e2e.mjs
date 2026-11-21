import { chromium } from "playwright-core";
import { spawn } from "node:child_process";

const PORT = Number(process.env.E2E_PORT || 4173);
const BASE_URL = `http://127.0.0.1:${PORT}/`;

function startPreviewServer() {
  const proc = spawn(
    "npx",
    ["vite", "preview", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("vite preview startup timeout")), 10000);
    proc.stdout.on("data", (buf) => {
      const text = buf.toString();
      if (text.includes("Local:")) {
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
    await page.waitForSelector("text=Keep secrets on your device. Send only safe context to AI.");

    // 0. Verify live Anime.js v4 Hero SVG animation across two frames 350ms apart
    const frameA = await page.evaluate(() => {
      const pkt = document.querySelector(".hero-safe-packet");
      return pkt ? getComputedStyle(pkt).transform : "";
    });
    await page.waitForTimeout(350);
    const frameB = await page.evaluate(() => {
      const pkt = document.querySelector(".hero-safe-packet");
      return pkt ? getComputedStyle(pkt).transform : "";
    });
    if (!frameA || frameA === frameB) {
      throw new Error(`Expected HeroEngineDiagram SVG packet transform to animate (A=${frameA}, B=${frameB})`);
    }

    // Verify System / Dark / Light theme switcher + Act 1 Hero -> Open Live Workbench jump
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole("button", { name: /^Dark/i }).click();
    if ((await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) !== "dark") {
      throw new Error("Expected Dark theme to set data-theme=dark");
    }
    await page.getByRole("button", { name: /^Light/i }).click();
    if ((await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) !== "light") {
      throw new Error("Expected Light theme to set data-theme=light");
    }

    await page.getByRole("button", { name: /Open Live Workbench/i }).click();
    await page.waitForTimeout(350);
    const workbenchVisible = await page.locator("#workbench-act").isVisible();
    if (!workbenchVisible) {
      throw new Error("Expected #workbench-act to be visible after clicking Open Live Workbench");
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

    // 2. Run Scenario 1 via Ctrl+Enter / Cmd+Enter -> Paused for Review + Approve & Get Safe AI Solution + Proof & SDK tab
    await page.locator("#ticket-body").focus();
    await page.keyboard.press("Control+Enter");
    await page.waitForSelector("text=Paused for Review");
    const approveBtn = page.getByRole("button", { name: /Approve & Get Safe AI Solution/i });
    await approveBtn.waitFor();
    if (await approveBtn.isDisabled()) {
      throw new Error("Expected Approve & Get Safe AI Solution button to be enabled after Stage 1");
    }
    await approveBtn.click();
    await page.waitForSelector("text=AI Solution");

    await page.getByRole("tab", { name: /Proof & SDK/i }).click();
    await page.waitForSelector("text=ZERO-LEAKAGE VERIFIED:");
    await page.getByRole("button", { name: /Refresh Policy/i }).click();
    await page.waitForSelector("text=Export Audit JSON");

    // 3. Run Scenario 2 (Build / TLS Fix) -> Local Runbook ($0 Cloud)
    await page.getByText(/Build \/ TLS Fix/i).click();
    await page.getByRole("button", { name: /Scrub & Analyze/i }).click();
    await page.waitForSelector("text=RB_LOCAL_TLS_CERT");

    // 4. Toggle Offline Mode ON via Cloud Sync popover & test P0 Outage + PHI -> Queued Offline ($0)
    await page.getByRole("button", { name: /Cloud Sync/i }).click();
    await page.getByRole("switch", { name: /Toggle Offline Mode/i }).click();
    await page.keyboard.press("Escape");

    await page.getByText(/P0 Outage \+ PHI/i).first().click();
    await page.getByRole("button", { name: /Scrub & Fix Offline/i }).click();
    await page.waitForSelector("text=Queued Offline ($0)");

    // 5. Switch to Rules tab, add custom blocked term, verify redaction
    await page.getByRole("button", { name: /^Rules/i }).click();
    await page.getByLabel("Custom blocked term").fill("OmegaCodename");
    await page.getByRole("button", { name: /Add Rule/i }).click();
    await page.getByRole("button", { name: /^Workbench$/i }).click();

    await page.locator("#ticket-body").fill("P0 issue referencing OmegaCodename in logs.");
    await page.getByRole("button", { name: /Scrub & Fix Offline/i }).click();
    await page.waitForSelector("text=Company Rule");

    // 6. Verify Executive Brief (offline LOCAL_FALLBACK)
    await page.getByRole("button", { name: /Executive Brief/i }).click();
    await page.waitForSelector("text=Executive Brief (LOCAL_FALLBACK)");

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
    await page.getByRole("button", { name: /Scrub & (Analyze|Fix Offline)/i }).click();
    await page.getByRole("button", { name: /^History/i }).click();
    await page.waitForSelector("text=Extension Capture");
    await page.getByRole("button", { name: /^Workbench$/i }).click();

    // 8. Verify XSS immunity (<script> and javascript: payloads render as inert text)
    await page.locator("#ticket-body").fill(
      'P3 cert_has_expired with <script>window.__xss_fired = true;</script> and [click](javascript:alert(1))',
    );
    await page.getByRole("button", { name: /Scrub & (Analyze|Fix Offline)/i }).click();
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
