import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type { RuntimeConfigValues } from "../config/firebase";
import type { DetectorSource, HybridTelemetry, TriageResult } from "../types/triage";

interface TechnicalProofDrawerProps {
  open: boolean;
  telemetry: HybridTelemetry;
  currentResult: TriageResult | null;
  runtimeConfig: RuntimeConfigValues;
  isRefreshingPolicy: boolean;
  onClose: () => void;
  onRefreshRemoteConfig: () => void;
  onWarmupNano: () => void;
  onRecheckNano: () => void;
}

const DETECTOR_KEYS: DetectorSource[] = [
  "NANO_SEMANTIC_FIREWALL",
  "REGEX_FIREWALL",
  "ENTROPY_SCANNER",
  "HEURISTIC_GUARD",
  "POLICY_TERM",
  "MANUAL_MASK",
];

function downloadBlobFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function TechnicalProofDrawer({
  open,
  telemetry,
  currentResult,
  runtimeConfig,
  isRefreshingPolicy,
  onClose,
  onRefreshRemoteConfig,
  onWarmupNano,
  onRecheckNano,
}: TechnicalProofDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [copiedSlack, setCopiedSlack] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        if (typeof dialog.showModal === "function") {
          dialog.showModal();
        } else {
          dialog.setAttribute("open", "true");
        }
      }
    } else if (dialog.open) {
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
    }
  }, [open]);

  const detectorCounts = new Map<DetectorSource, number>();
  for (const key of DETECTOR_KEYS) detectorCounts.set(key, 0);
  if (currentResult) {
    for (const span of currentResult.spans) {
      detectorCounts.set(span.detector, (detectorCounts.get(span.detector) ?? 0) + 1);
    }
  }

  const audit = currentResult?.zeroLeakageAudit ?? null;
  const unmaskedCount =
    currentResult?.spans.filter((s) => s.masked === false).length ?? 0;

  const buildSafeAuditJson = () => {
    if (!currentResult) return "";
    return JSON.stringify(
      {
        id: currentResult.id,
        title: currentResult.title,
        severity: currentResult.severity,
        category: currentResult.category,
        inferenceModes: {
          stage1Firewall: "ONLY_ON_DEVICE",
          stage2Escalation: "PREFER_IN_CLOUD",
          hybridBrief: "PREFER_ON_DEVICE",
        },
        stage1Source: currentResult.stage1Source,
        stage1LatencyMs: currentResult.stage1LatencyMs,
        stage2Source: currentResult.stage2Source,
        stage2LatencyMs: currentResult.stage2LatencyMs,
        sanitizedText: currentResult.sanitizedText,
        spansMetadata: currentResult.spans.map((s) => ({
          start: s.start,
          end: s.end,
          category: s.category,
          detector: s.detector,
          placeholder: s.placeholder,
          masked: s.masked !== false,
        })),
        zeroLeakageAudit: currentResult.zeroLeakageAudit ?? null,
        resolution: currentResult.resolution,
        hybridBrief: currentResult.hybridBrief ?? null,
      },
      null,
      2
    );
  };

  const buildSafeMarkdownReport = () => {
    if (!currentResult) return "";
    return [
      `# LocalFirst Triage — Zero-PII Audit Report`,
      ``,
      `- **Ticket:** ${currentResult.title}`,
      `- **Severity / Category:** ${currentResult.severity} / ${currentResult.category}`,
      `- **Stage 1 (ONLY_ON_DEVICE):** ${currentResult.stage1Source} (${currentResult.stage1LatencyMs}ms)`,
      `- **Stage 2 (PREFER_IN_CLOUD):** ${currentResult.stage2Source} (${currentResult.stage2LatencyMs}ms)`,
      `- **Secrets Audited:** ${audit ? `${audit.checkedSpansCount - audit.leakedSpansCount} / ${audit.checkedSpansCount} stripped` : `${currentResult.spans.length} spans`}`,
      ``,
      `## Outbound Sanitized Text`,
      `\`\`\`text`,
      currentResult.sanitizedText,
      `\`\`\``,
      ``,
      `## Remediation Solution`,
      currentResult.resolution,
    ].join("\n");
  };

  const handleCopySlack = async () => {
    if (!currentResult) return;
    const text =
      currentResult.hybridBrief?.stakeholderDraft ??
      `*[${currentResult.severity}] ${currentResult.title}*\nStatus: ${currentResult.resolutionMode} | Masked ${currentResult.spans.length} secrets locally.\n\n${currentResult.sanitizedText}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSlack(true);
      setTimeout(() => setCopiedSlack(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  if (!open) {
    return (
      <dialog
        ref={dialogRef}
        aria-labelledby="technical-proof-title"
        className="hidden"
      />
    );
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="technical-proof-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          onClose();
        }
      }}
      className="m-auto w-[min(94vw,56rem)] max-h-[88vh] overflow-y-auto rounded-2xl border p-0"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderColor: "var(--border-strong)",
        boxShadow: "var(--shadow-popover)",
      }}
    >
      <div
        className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b px-5 py-4"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <div>
          <h2
            id="technical-proof-title"
            className="text-base font-bold sm:text-lg"
            style={{ color: "var(--text-primary)" }}
          >
            Technical Proof &amp; SDK Details
          </h2>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Verifiable hybrid inference routing, outbound payload audit, and Firebase SDK telemetry
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close Technical Proof drawer"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--border-subtle)",
            color: "var(--text-primary)",
          }}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-5 p-5">
        <section
          className="rounded-2xl border p-4"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {unmaskedCount > 0 ? (
                <ShieldAlert className="h-4 w-4" style={{ color: "var(--warn-text)" }} aria-hidden="true" />
              ) : (
                <ShieldCheck className="h-4 w-4" style={{ color: "var(--safe-text)" }} aria-hidden="true" />
              )}
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Zero-Leakage Outbound Proof
              </h3>
            </div>

            {currentResult && (
              <span
                className="rounded-lg border px-2.5 py-1 text-xs font-bold"
                style={{
                  backgroundColor: unmaskedCount > 0 ? "var(--warn-bg)" : "var(--safe-bg)",
                  borderColor: unmaskedCount > 0 ? "var(--warn-border)" : "var(--safe-border)",
                  color: unmaskedCount > 0 ? "var(--warn-text)" : "var(--safe-text)",
                }}
              >
                {unmaskedCount > 0
                  ? `BLOCKED: ${unmaskedCount} unmasked secret(s)`
                  : `ZERO-LEAKAGE VERIFIED: ${audit ? `${audit.checkedSpansCount - audit.leakedSpansCount} / ${audit.checkedSpansCount}` : currentResult.spans.length} Stripped`}
              </span>
            )}
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            {DETECTOR_KEYS.map((detector) => {
              const count = detectorCounts.get(detector) ?? 0;
              return (
                <span
                  key={detector}
                  className="rounded-lg border px-2.5 py-1 font-mono text-[11px]"
                  style={{
                    backgroundColor: count > 0 ? "var(--info-bg)" : "var(--bg-surface)",
                    borderColor: count > 0 ? "var(--info-border)" : "var(--border-subtle)",
                    color: count > 0 ? "var(--info-text)" : "var(--text-muted)",
                  }}
                >
                  [{detector}]: {count}
                </span>
              );
            })}
          </div>

          <p className="mb-1.5 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Exact outbound payload verified before <code>PREFER_IN_CLOUD</code> escalation:
          </p>
          <pre
            className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl border p-3 font-mono text-xs"
            style={{
              backgroundColor: "var(--code-bg)",
              borderColor: "var(--code-border)",
              color: "var(--code-text)",
            }}
          >
            {audit?.outboundPromptPreview ??
              currentResult?.sanitizedText ??
              "Run Step 1 on any incident to generate the verbatim [REDACTED:...] audit proof."}
          </pre>
        </section>

        <section
          className="rounded-2xl border p-4"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Firebase AI Logic (<code className="font-mono text-xs">firebase/ai</code>) Hybrid Routing
            </h3>
            <span
              className="rounded-lg border px-2.5 py-1 font-mono text-[11px] font-semibold"
              style={{
                backgroundColor: "var(--accent-soft-bg)",
                borderColor: "var(--accent-soft-border)",
                color: "var(--accent-text)",
              }}
            >
              Cloud Model: {currentResult?.activeCloudModel ?? telemetry.activeCloudModel}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div
              className="rounded-xl border p-3"
              style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}
            >
              <p className="font-mono text-[11px] font-semibold" style={{ color: "var(--info-text)" }}>
                InferenceMode.ONLY_ON_DEVICE
              </p>
              <p className="mt-1 text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                {currentResult?.stage1Source ?? `Nano 4: ${telemetry.nanoStatus}`}
              </p>
              <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                Stage 1 Latency: {currentResult ? `${currentResult.stage1LatencyMs}ms` : "—"}
              </p>
            </div>

            <div
              className="rounded-xl border p-3"
              style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}
            >
              <p className="font-mono text-[11px] font-semibold" style={{ color: "var(--accent-text)" }}>
                InferenceMode.PREFER_IN_CLOUD
              </p>
              <p className="mt-1 text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                {currentResult?.stage2Source ?? (telemetry.offlineMode ? "OFFLINE_BLOCKED" : "IDLE")}
              </p>
              <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                Stage 2 Latency: {currentResult ? `${currentResult.stage2LatencyMs}ms` : "—"}
              </p>
            </div>

            <div
              className="rounded-xl border p-3"
              style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}
            >
              <p className="font-mono text-[11px] font-semibold" style={{ color: "var(--safe-text)" }}>
                InferenceMode.PREFER_ON_DEVICE
              </p>
              <p className="mt-1 text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                {currentResult?.hybridBrief?.inferenceSource ?? "READY"}
              </p>
              <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                Est. Tokens Saved: {telemetry.estimatedTokensSaved} · Runs: {telemetry.totalRuns}
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Gemini Nano 4 status:{" "}
              <strong style={{ color: "var(--text-primary)" }}>{telemetry.nanoStatus}</strong>
              {telemetry.downloadProgress !== null ? ` (${telemetry.downloadProgress}%)` : ""}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onRecheckNano}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-strong)",
                  color: "var(--text-primary)",
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Recheck Nano 4
              </button>
              <button
                type="button"
                onClick={onWarmupNano}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold"
                style={{
                  backgroundColor: "var(--accent-primary)",
                  color: "var(--accent-on-primary)",
                }}
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Warm Up / Download Nano 4
              </button>
            </div>
          </div>

          <details className="mt-3 text-xs" style={{ color: "var(--text-secondary)" }}>
            <summary className="font-semibold">
              Chrome On-Device AI Flag Checklist (Desktop Chrome 138+)
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-[11px]">
              <li>chrome://flags/#optimization-guide-on-device-model → Enabled BypassPerfRequirement</li>
              <li>chrome://flags/#prompt-api-for-gemini-nano-multimodal-input → Enabled</li>
              <li>chrome://on-device-internals → Verify Gemma / Nano component Ready</li>
            </ul>
          </details>
        </section>

        <section
          className="rounded-2xl border p-4"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Firebase Remote Config &amp; App Check
              </h3>
              <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                Remote Config: <strong>{telemetry.remoteConfigStatus}</strong> · App Check:{" "}
                <strong>{telemetry.appCheckProvider}</strong> · Entropy Threshold:{" "}
                <code>{runtimeConfig.entropyThreshold ?? telemetry.entropyThreshold ?? 3.25}</code>
              </p>
            </div>

            <button
              type="button"
              disabled={isRefreshingPolicy}
              onClick={onRefreshRemoteConfig}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-strong)",
                color: "var(--text-primary)",
              }}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRefreshingPolicy ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              Refresh Policy
            </button>
          </div>
        </section>

        <section className="flex flex-wrap items-center justify-between gap-2 border-t pt-4" style={{ borderColor: "var(--border-subtle)" }}>
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Zero-PII Audit Exports (safe redacted payloads only)
          </span>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!currentResult}
              onClick={() => void handleCopySlack()}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold disabled:opacity-45"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            >
              {copiedSlack ? (
                <>
                  <Check className="h-3.5 w-3.5" style={{ color: "var(--safe-text)" }} aria-hidden="true" />
                  Copied Slack Summary
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  Copy Slack Update
                </>
              )}
            </button>

            <button
              type="button"
              disabled={!currentResult}
              onClick={() => {
                if (!currentResult) return;
                downloadBlobFile(
                  `${currentResult.id}-zero-pii-audit.json`,
                  buildSafeAuditJson(),
                  "application/json"
                );
              }}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold disabled:opacity-45"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Export Audit JSON
            </button>

            <button
              type="button"
              disabled={!currentResult}
              onClick={() => {
                if (!currentResult) return;
                downloadBlobFile(
                  `${currentResult.id}-zero-pii-report.md`,
                  buildSafeMarkdownReport(),
                  "text/markdown"
                );
              }}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold disabled:opacity-45"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Export Markdown
            </button>
          </div>
        </section>
      </div>
    </dialog>
  );
}
