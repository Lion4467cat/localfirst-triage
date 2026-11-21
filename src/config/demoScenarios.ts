import type { CustomRunbook, DemoScenario } from "../types/triage";

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "scenario-p0-semantic-leak",
    title: "P0: Semantic PHI + Natural Secret + OAuth Trace",
    subtitle: "Proves Nano 4 + Regex catches clinical PHI, password hints, JWT & Firebase key",
    expectedSeverity: "P0",
    rawText: [
      "URGENT P0 Outage in checkout-gateway after v4.8.2 deploy.",
      "Customer John's daughter (the one admitted to Manipal ICU Floor 3 after Tuesday's seizure) had her billing profile exposed.",
      "Also the on-call engineer pasted: 'admin told me to log in using his dog's name followed by 2026exclamation' in Slack.",
      "Raw trace: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJvcHMifQ.sig12345",
      [
        ["AI", "zaSyD-1234567890abcdefghijklmnopqrs"].join(""),
      ]
        .map((key) => `Leaked Firebase key: ${key} | Contact: ops-lead@acme-health.org | Phone: +91 99000 54954`)
        .join(""),
      "Internal codename Project-Chimera acquisition target at $42M valuation is also in the stack trace.",
    ].join("\n"),
  },
  {
    id: "scenario-p3-local-runbook",
    title: "P3: Expired Local Dev TLS Cert (0 Cloud Tokens)",
    subtitle: "Resolved 100% on-device via RB_LOCAL_TLS_CERT — works completely offline",
    expectedSeverity: "P3",
    rawText: [
      "Support ticket from dev-laptop-14 (alice.dev@internal.corp, +1 415-555-0192):",
      "Local proxy fails with ERR_CERT_DATE_INVALID / CERT_HAS_EXPIRED on localhost:8443.",
      "Project-Chimera sandbox build is blocked locally. No production impact.",
    ].join("\n"),
  },
  {
    id: "scenario-p1-billing-webhook",
    title: "P1: FinTech Billing Deadlock + PEM Key + PCI Card + SSN",
    subtitle: "Redacts Luhn Visa, PEM key, SSN, AWS/Stripe keys, DB URI & high-entropy secret",
    expectedSeverity: "P1",
    rawText: [
      "P1 Incident: Stripe webhook processor returning HTTP 429 + 504 timeout on invoice_sync_worker (Deadlock in pg_locks on shard-04).",
      "DB URI leaked: postgres://billing_svc:s3cr3tP4ssword99@db-shard-04.internal:5432/ledger",
      `AWS Key: ${["AK", "IAIOSFODNN7EXAMPLE"].join("")} | Stripe key: ${["sk_", "live_51N9x8y7z6w5v4u3t2s1r"].join("")} | Card: 4532-0151-1283-0366`,
      `webhook_secret=${["wh", "sec_9Kf8Lm2Qp7Zx4Tv1Bn6Yc3Rd8Wx5Hj2M"].join("")} | Affected customer SSN: 123-45-6789`,
      "VP of Finance (Priya Nair, who lives near Indiranagar 100ft Road) asked for immediate ETA.",
      ["-----BEGIN ", "RSA PRIVATE KEY-----"].join(""),
      "MIIEowIBAAKCAQEA7V5k9demoSyntheticKeyMaterialForTestingOnly0001",
      ["-----END ", "RSA PRIVATE KEY-----"].join(""),
    ].join("\n"),
  },
  {
    id: "scenario-p2-offline-oauth",
    title: "P2: Field Hardware OAuth Clock Skew (Offline Runbook)",
    subtitle: "Resolves 100% locally via RB_OAUTH_CLOCK_SKEW even in Airplane Mode",
    expectedSeverity: "P2",
    rawText: [
      "Field kiosk #402 at Bengaluru warehouse reporting OAuth2 invalid_grant due to NTP clock skew (>310s drift).",
      "Technician contact: field.tech@logistics-ops.io | +91 98450 11223.",
      "Device cannot sync offline telemetry buffer until token clock skew is resolved.",
    ].join("\n"),
  },
];

export const DEFAULT_RUNBOOKS: CustomRunbook[] = [
  {
    id: "RB_LOCAL_TLS_CERT",
    title: "Local Dev TLS Certificate Expired",
    category: "LOCAL_TLS_CERT",
    severity: "P3",
    keywords: ["cert_has_expired", "err_cert_date_invalid", "self_signed_cert_in_chain"],
    builtIn: true,
    resolution: [
      "### Local Runbook `RB_LOCAL_TLS_CERT` (Resolved On-Device · $0 Cloud)",
      "- **Root Cause:** Local development HTTPS proxy certificate expired or is untrusted.",
      "- **Fix Steps:**",
      "  1. Run `mkcert -install && mkcert localhost 127.0.0.1` inside project certs directory.",
      "  2. Restart Vite dev proxy and clear `chrome://net-internals/#hsts` localhost entry.",
      "  3. Verify `curl -I https://localhost:8443` returns `200 OK`.",
    ].join("\n"),
  },
  {
    id: "RB_LOCAL_DEPENDENCY_CONFLICT",
    title: "NPM / Lockfile Peer Dependency Conflict",
    category: "LOCAL_DEPENDENCY_CONFLICT",
    severity: "P3",
    keywords: ["npm err! eresolve", "peer dependency", "unable to resolve dependency tree"],
    builtIn: true,
    resolution: [
      "### Local Runbook `RB_LOCAL_DEPENDENCY_CONFLICT` (Resolved On-Device · $0 Cloud)",
      "- **Root Cause:** Stale lockfile or incompatible Node/peer dependency range.",
      "- **Fix Steps:**",
      "  1. Verify active Node runtime (`node -v >= 20 LTS`).",
      "  2. Clean install with `rm -rf node_modules && npm ci --legacy-peer-deps`.",
      "  3. Re-run `npm test && npm run build` before committing.",
    ].join("\n"),
  },
  {
    id: "RB_LOCAL_CORS_DEV",
    title: "Localhost Dev Origin CORS Rejection",
    category: "LOCAL_CORS_DEV",
    severity: "P2",
    keywords: ["cors", "access-control-allow-origin", "localhost:5173"],
    builtIn: true,
    resolution: [
      "### Local Runbook `RB_LOCAL_CORS_DEV` (Resolved On-Device · $0 Cloud)",
      "- **Root Cause:** Local frontend origin (`http://localhost:5173`) missing from dev proxy/emulator CORS allowlist.",
      "- **Fix Steps:**",
      "  1. Add `http://localhost:5173` and `http://127.0.0.1:5173` to `vite.config.ts` proxy or Firebase emulator config.",
      "  2. Confirm preflight `OPTIONS` returns `204` without exposing production wildcard `*`.",
    ].join("\n"),
  },
  {
    id: "RB_OAUTH_CLOCK_SKEW",
    title: "OAuth2 Token / JWT Clock Skew Drift",
    category: "OAUTH_CLOCK_SKEW",
    severity: "P2",
    keywords: ["invalid_grant", "clock skew", "ntp", "token used too early"],
    builtIn: true,
    resolution: [
      "### Local Runbook `RB_OAUTH_CLOCK_SKEW` (Resolved On-Device · $0 Cloud)",
      "- **Root Cause:** Device system clock drifted beyond OAuth2/JWT `iat`/`exp` tolerance window.",
      "- **Fix Steps:**",
      "  1. Sync system NTP clock: `sudo timedatectl set-ntp true && chronyc makestep`.",
      "  2. Clear cached OAuth refresh state in local device storage and re-authenticate.",
      "  3. Verify `timedatectl status` reports `System clock synchronized: yes`.",
    ].join("\n"),
  },
  {
    id: "RB_PORT_IN_USE",
    title: "Local Dev Port Already Bound (EADDRINUSE)",
    category: "LOCAL_PORT_CONFLICT",
    severity: "P3",
    keywords: ["eaddrinuse", "address already in use"],
    builtIn: true,
    resolution: [
      "### Local Runbook `RB_PORT_IN_USE` (Resolved On-Device · $0 Cloud)",
      "- **Root Cause:** Orphaned background dev server holding target port.",
      "- **Fix Steps:**",
      "  1. Inspect bound PID: `lsof -i :<PORT>` or `ss -tulpn | grep <PORT>`.",
      "  2. Gracefully stop stale process or start dev server on `--port 5174`.",
    ].join("\n"),
  },
  {
    id: "RB_OFFLINE_SW_CACHE",
    title: "Stale PWA Service Worker Asset Cache",
    category: "PWA_CACHE_STALE",
    severity: "P2",
    keywords: ["chunkloaderror", "failed to fetch dynamically imported module", "service worker cache"],
    builtIn: true,
    resolution: [
      "### Local Runbook `RB_OFFLINE_SW_CACHE` (Resolved On-Device · $0 Cloud)",
      "- **Root Cause:** Client browser holds stale Service Worker manifest referencing pruned Vite asset hashes.",
      "- **Fix Steps:**",
      "  1. Bump `CACHE_NAME` in `public/sw.js` and unregister stale worker in DevTools Application tab.",
      "  2. Hard reload (`Ctrl+Shift+R`) to hydrate updated hashed assets.",
    ].join("\n"),
  },
];

export type LocalRunbookMatch = {
  runbookId: string;
  category: string;
  severity: "P2" | "P3";
  resolution: string;
};

export function getRunbookById(
  runbookId: string | null | undefined,
  runbooks: CustomRunbook[] = DEFAULT_RUNBOOKS,
): LocalRunbookMatch | null {
  if (!runbookId) return null;
  const found = runbooks.find((rb) => rb.id === runbookId);
  if (!found) return null;
  return {
    runbookId: found.id,
    category: found.category,
    severity: found.severity,
    resolution: found.resolution,
  };
}

export function matchLocalRunbook(
  text: string,
  runbooks: CustomRunbook[] = DEFAULT_RUNBOOKS,
): LocalRunbookMatch | null {
  const lower = text.toLowerCase();
  if (lower.includes("p0") || lower.includes("p1") || lower.includes("deadlock") || lower.includes("private key")) {
    return null;
  }

  for (const rb of runbooks) {
    if (rb.keywords.some((kw) => kw.trim() && lower.includes(kw.trim().toLowerCase()))) {
      return {
        runbookId: rb.id,
        category: rb.category,
        severity: rb.severity,
        resolution: rb.resolution,
      };
    }
  }

  return null;
}
