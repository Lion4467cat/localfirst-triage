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

    // 2. Run Scenario 1 (P0) -> Quarantine + inline diff badges
    await page.getByRole("button", { name: /Run Hybrid Triage/i }).click();
    await page.waitForSelector("text=QUARANTINED_PENDING_APPROVAL");
    await page.getByRole("button", { name: /Approve & Escalate Sanitized Payload to Cloud/i }).waitFor();
    const bodyText = await page.textContent("body");
    if (!bodyText?.includes("[REGEX_FIREWALL]") || !bodyText?.includes("[HEURISTIC_GUARD]")) {
      throw new Error("Expected [REGEX_FIREWALL] and [HEURISTIC_GUARD] badges after Stage 1");
    }

    // 3. Run Scenario 2 (P3) -> Local Runbook ($0 Cloud)
    await page.getByText(/P3: Expired Local Dev TLS Cert/i).click();
    await page.getByRole("button", { name: /Run Hybrid Triage/i }).click();
    await page.waitForSelector("text=RB_LOCAL_TLS_CERT");

    // 4. Toggle Offline Mode ON & test P0 -> OFFLINE_QUEUED
    await page.getByRole("button", { name: /Hybrid Cloud Allowed/i }).click();
    await page.getByText(/P0: Semantic PHI/i).first().click();
    await page.getByRole("button", { name: /Run Hybrid Triage/i }).click();
    await page.waitForSelector("text=OFFLINE_QUEUED");

    // 5. Open Runbooks & Policy modal, add custom policy term, verify redaction
    await page.getByRole("button", { name: /Runbooks & Policy/i }).click();
    await page.getByRole("button", { name: /Workspace Privacy Policy/i }).click();
    await page.getByPlaceholder(/Project-Apollo/i).fill("OmegaCodename");
    await page.getByRole("button", { name: /Add Term/i }).click();
    await page.getByRole("button", { name: /Close modal/i }).click();

    await page.locator("#ticket-body").fill("P0 issue referencing OmegaCodename in logs.");
    await page.getByRole("button", { name: /Run Hybrid Triage/i }).click();
    await page.getByText(/\[REDACTED:POLICY_TERM_/).first().waitFor();

    // 6. Verify Hybrid Stakeholder Brief (offline LOCAL_FALLBACK), Zero-Leakage Proof & Export tabs
    await page.getByRole("button", { name: /Generate Hybrid Stakeholder Brief/i }).click();
    await page.waitForSelector("text=Source: LOCAL_FALLBACK");

    await page.getByRole("button", { name: /Zero-Leakage Proof/i }).click();
    await page.waitForSelector("text=ZERO-LEAKAGE VERIFIED: 0 /");

    await page.getByRole("button", { name: /Export & Handoff/i }).click();
    await page.waitForSelector("text=Download Audit JSON");

    // 7. Test Chrome Extension #handoff import clears URL hash
    const handoffPayload = Buffer.from(
      JSON.stringify({
        title: "Extension Capture",
        sanitizedText: "Sanitized [REDACTED:AWS_ACCESS_KEY_1] issue",
      }),
    ).toString("base64url");
    await page.goto(`${BASE_URL}#handoff=${handoffPayload}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=Imported sanitized payload from Chrome Extension Side Panel");
    if (new URL(page.url()).hash) {
      throw new Error(`Expected URL hash to be cleared, got ${page.url()}`);
    }

    // 8. Verify XSS immunity (<script> and javascript: payloads render as inert text)
    await page.locator("#ticket-body").fill(
      'P3 cert_has_expired with <script>window.__xss_fired = true;</script> and [click](javascript:alert(1))',
    );
    await page.getByRole("button", { name: /Run Hybrid Triage/i }).click();
    await page.waitForSelector("text=RB_LOCAL_TLS_CERT");
    const xssFired = await page.evaluate(() => Boolean(window.__xss_fired));
    if (xssFired) {
      throw new Error("XSS script payload executed!");
    }

    // 9. Verify zero horizontal layout overflow across 1280x720, 1024x768, and 375x667 viewports
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
        throw new Error(`Horizontal layout overflow detected at viewport ${vp.width}x${vp.height}`);
      }
    }

    if (pageErrors.length > 0) {
      throw new Error(`Uncaught page errors: ${pageErrors.join("; ")}`);
    }
    if (consoleWarnings.length > 0) {
      throw new Error(`@firebase/ai hybrid config warnings: ${consoleWarnings.join("; ")}`);
    }

    console.log("PLAYWRIGHT E2E VERIFICATION PASSED (all 9 flows, 0 page errors, 0 SDK warnings).");
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error("PLAYWRIGHT E2E FAILED:", err);
  process.exit(1);
});
