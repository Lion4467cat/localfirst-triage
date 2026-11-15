import type { DemoScenario } from "../types/triage";

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "scenario-p0-semantic-leak",
    title: "P0: Semantic Secret + Leaked OAuth Trace",
    subtitle: "Tests [REGEX_FIREWALL] + [NANO_SEMANTIC_FIREWALL] + Fail-Closed Quarantine",
    expectedSeverity: "P0",
    rawText: [
      "URGENT P0 Outage in checkout-gateway after v4.8.2 deploy.",
      "Customer John's daughter (the one admitted to Manipal ICU Floor 3 after Tuesday's seizure) had her billing profile exposed.",
      "Also the on-call engineer pasted: 'admin told me to log in using his dog's name followed by 2026exclamation' in Slack.",
      "Raw trace: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJvcHMifQ.sig12345",
      "Leaked Firebase key: AIzaSyD-1234567890abcdefghijklmnopqrs | Contact: ops-lead@acme-health.org | Phone: +91 99000 54954",
      "Internal codename Project-Chimera acquisition target at $42M valuation is also in the stack trace.",
    ].join("\n"),
  },
  {
    id: "scenario-p3-local-runbook",
    title: "P3: Expired Local Dev TLS Cert (0 Cloud Tokens)",
    subtitle: "Resolved 100% on-device via local runbook — Cloud AI is NEVER called",
    expectedSeverity: "P3",
    rawText: [
      "Support ticket from dev-laptop-14 (alice.dev@internal.corp, +1 415-555-0192):",
      "Local proxy fails with ERR_CERT_DATE_INVALID / CERT_HAS_EXPIRED on localhost:8443.",
      "Project-Chimera sandbox build is blocked locally. No production impact.",
    ].join("\n"),
  },
  {
    id: "scenario-p1-billing-webhook",
    title: "P1: Multi-Service Billing Webhook Deadlock",
    subtitle: "Sanitizes PII/API keys locally, then escalates sanitized RCA to Cloud Gemini",
    expectedSeverity: "P1",
    rawText: [
      "P1 Incident: Stripe webhook processor returning HTTP 429 + 504 timeout on invoice_sync_worker (Deadlock in pg_locks on shard-04).",
      "Retry queue depth crossed 14,000 events. Leaked test key: sk-proj-abcdefghijklmnopqrstuvwxyz123456.",
      "VP of Finance (Priya Nair, who lives near Indiranagar 100ft Road) asked for immediate ETA.",
    ].join("\n"),
  },
];

export interface LocalRunbookMatch {
  runbookId: string;
  category: string;
  severity: "P2" | "P3";
  resolution: string;
}

const RUNBOOKS: Record<string, LocalRunbookMatch> = {
  RB_LOCAL_TLS_CERT: {
    runbookId: "RB_LOCAL_TLS_CERT",
    category: "LOCAL_TLS_CERT",
    severity: "P3",
    resolution:
      "LOCAL RUNBOOK [RB_LOCAL_TLS_CERT]: Regenerate local dev certificate (`mkcert -install && mkcert localhost 127.0.0.1`), restart Vite dev proxy, and clear HSTS cache. Resolved 100% on-device (0 cloud tokens).",
  },
  RB_LOCAL_DEPENDENCY_CONFLICT: {
    runbookId: "RB_LOCAL_DEPENDENCY_CONFLICT",
    category: "LOCAL_DEPENDENCY_CONFLICT",
    severity: "P3",
    resolution:
      "LOCAL RUNBOOK [RB_LOCAL_DEPENDENCY_CONFLICT]: Clear lockfile cache (`rm -rf node_modules && npm ci --legacy-peer-deps`) and verify Node >= 20 LTS. Resolved 100% on-device (0 cloud tokens).",
  },
  RB_LOCAL_CORS_DEV: {
    runbookId: "RB_LOCAL_CORS_DEV",
    category: "LOCAL_CORS_DEV",
    severity: "P2",
    resolution:
      "LOCAL RUNBOOK [RB_LOCAL_CORS_DEV]: Add `http://localhost:5173` to Vite dev proxy / local emulator CORS allowlist. Resolved 100% on-device (0 cloud tokens).",
  },
  RB_OAUTH_CLOCK_SKEW: {
    runbookId: "RB_OAUTH_CLOCK_SKEW",
    category: "OAUTH_CLOCK_SKEW",
    severity: "P2",
    resolution:
      "LOCAL RUNBOOK [RB_OAUTH_CLOCK_SKEW]: Sync system NTP clock (`sudo timedatectl set-ntp true`) and clear stale local OAuth refresh state. Resolved 100% on-device (0 cloud tokens).",
  },
};

export function getRunbookById(runbookId: string | null | undefined): LocalRunbookMatch | null {
  if (!runbookId) return null;
  return RUNBOOKS[runbookId] ?? null;
}

export function matchLocalRunbook(text: string): LocalRunbookMatch | null {
  const lower = text.toLowerCase();
  if (lower.includes("cert_has_expired") || lower.includes("err_cert_date_invalid")) {
    return RUNBOOKS.RB_LOCAL_TLS_CERT;
  }
  if (lower.includes("npm err! eresolve") || lower.includes("peer dependency")) {
    return RUNBOOKS.RB_LOCAL_DEPENDENCY_CONFLICT;
  }
  if (lower.includes("cors") && lower.includes("localhost") && !lower.includes("p0")) {
    return RUNBOOKS.RB_LOCAL_CORS_DEV;
  }
  if (lower.includes("invalid_grant") && lower.includes("clock skew")) {
    return RUNBOOKS.RB_OAUTH_CLOCK_SKEW;
  }
  return null;
}
