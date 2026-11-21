import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Cloud,
  Copy,
  FileText,
  Loader2,
  Pause,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  WifiOff,
} from "lucide-react";
import { getSeverityStyle } from "../config/displayLabels";
import type { TriageResult } from "../types/triage";

interface ResolutionPanelProps {
  currentResult: TriageResult | null;
  isRunning: boolean;
  isGeneratingBrief: boolean;
  offlineMode: boolean;
  countdownMs: number | null;
  countdownPaused: boolean;
  maskDirtySinceCloud: boolean;
  onPauseCountdown: () => void;
  onApproveOrRerunCloud: () => void;
  onGenerateHybridBrief: () => void;
  onOpenTechnicalProof: () => void;
}

function renderInlineCodeAndBold(line: string): ReactNode[] {
  const parts = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code
          key={i}
          className="rounded border px-1.5 py-0.5 font-mono text-[11px]"
          style={{
            backgroundColor: "var(--code-bg)",
            borderColor: "var(--code-border)",
            color: "var(--code-text)",
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return (
        <strong key={i} className="font-semibold" style={{ color: "var(--text-primary)" }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

function SafeMarkdownView({ content }: { content: string }) {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];
  let codeFence: string[] = [];
  let inCode = false;

  const flushCode = (key: number) => {
    if (codeFence.length === 0) return;
    blocks.push(
      <pre
        key={`code-${key}`}
        className="my-2 overflow-x-auto rounded-xl border p-3 font-mono text-xs leading-relaxed"
        style={{
          backgroundColor: "var(--code-bg)",
          borderColor: "var(--code-border)",
          color: "var(--code-text)",
        }}
      >
        {codeFence.join("\n")}
      </pre>
    );
    codeFence = [];
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (inCode) {
        flushCode(idx);
        inCode = false;
      } else {
        inCode = true;
      }
      return;
    }

    if (inCode) {
      codeFence.push(line);
      return;
    }

    if (!trimmed) {
      blocks.push(<div key={`sp-${idx}`} className="h-2" />);
      return;
    }

    if (trimmed.startsWith("### ") || trimmed.startsWith("## ")) {
      const heading = trimmed.replace(/^#{2,3}\s+/, "");
      blocks.push(
        <h4
          key={`h-${idx}`}
          className="mt-2 text-sm font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {renderInlineCodeAndBold(heading)}
        </h4>
      );
      return;
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      blocks.push(
        <div
          key={`li-${idx}`}
          className="flex gap-2 pl-1 text-sm leading-relaxed"
          style={{ color: "var(--text-secondary)" }}
        >
          <span style={{ color: "var(--accent-text)" }}>•</span>
          <span>{renderInlineCodeAndBold(trimmed.slice(2))}</span>
        </div>
      );
      return;
    }

    const numMatch = trimmed.match(/^(\d+\.)\s+(.*)$/);
    if (numMatch) {
      blocks.push(
        <div
          key={`num-${idx}`}
          className="flex gap-2 pl-1 text-sm leading-relaxed"
          style={{ color: "var(--text-secondary)" }}
        >
          <span className="font-semibold" style={{ color: "var(--accent-text)" }}>
            {numMatch[1]}
          </span>
          <span>{renderInlineCodeAndBold(numMatch[2])}</span>
        </div>
      );
      return;
    }

    blocks.push(
      <p
        key={`p-${idx}`}
        className="text-sm leading-relaxed"
        style={{ color: "var(--text-secondary)" }}
      >
        {renderInlineCodeAndBold(line)}
      </p>
    );
  });

  if (inCode) flushCode(lines.length);
  return <div className="space-y-1">{blocks}</div>;
}

export function ResolutionPanel({
  currentResult,
  isRunning,
  isGeneratingBrief,
  offlineMode,
  countdownMs,
  countdownPaused,
  maskDirtySinceCloud,
  onPauseCountdown,
  onApproveOrRerunCloud,
  onGenerateHybridBrief,
  onOpenTechnicalProof,
}: ResolutionPanelProps) {
  const [copiedSolution, setCopiedSolution] = useState(false);
  const [copiedBrief, setCopiedBrief] = useState(false);

  const unmaskedCount =
    currentResult?.spans.filter((s) => s.masked === false).length ?? 0;

  const audit = currentResult?.zeroLeakageAudit ?? null;
  const totalSpans = currentResult?.spans.length ?? 0;
  const leakedCount = audit?.leakedSpansCount ?? unmaskedCount;
  const checkedCount = audit?.checkedSpansCount ?? totalSpans;

  const handleCopy = async (text: string, which: "solution" | "brief") => {
    try {
      await navigator.clipboard.writeText(text);
      if (which === "solution") {
        setCopiedSolution(true);
        setTimeout(() => setCopiedSolution(false), 1800);
      } else {
        setCopiedBrief(true);
        setTimeout(() => setCopiedBrief(false), 1800);
      }
    } catch {
      // Ignore clipboard denials
    }
  };

  let trustBg = "var(--info-bg)";
  let trustBorder = "var(--info-border)";
  let trustText = "var(--info-text)";
  let trustMessage =
    "On-device protection ready · Run Step 1 to generate a redacted diff and AI fix.";

  if (currentResult) {
    if (unmaskedCount > 0) {
      trustBg = "var(--warn-bg)";
      trustBorder = "var(--warn-border)";
      trustText = "var(--warn-text)";
      trustMessage = `Action needed: ${unmaskedCount} secret(s) unmasked · Cloud AI paused until hidden`;
    } else if (offlineMode || currentResult.resolutionMode === "OFFLINE_QUEUED") {
      trustBg = "var(--safe-bg)";
      trustBorder = "var(--safe-border)";
      trustText = "var(--safe-text)";
      trustMessage = `Offline Mode · ${leakedCount} / ${checkedCount} secrets leaked · ${currentResult.stage1LatencyMs}ms on-device`;
    } else if (currentResult.resolutionMode === "LOCAL_RUNBOOK") {
      trustBg = "var(--safe-bg)";
      trustBorder = "var(--safe-border)";
      trustText = "var(--safe-text)";
      trustMessage = `Protected On-Device (${currentResult.stage1Source}) · 0 / ${checkedCount} secrets leaked · Instant Local Fix`;
    } else {
      trustBg = "var(--safe-bg)";
      trustBorder = "var(--safe-border)";
      trustText = "var(--safe-text)";
      trustMessage = `Protected On-Device (${currentResult.stage1Source}) · ${leakedCount} / ${checkedCount} secrets leaked · ${currentResult.latencyMs}ms`;
    }
  }

  const severityStyle = currentResult ? getSeverityStyle(currentResult.severity) : null;

  const getModeBadge = () => {
    if (!currentResult) return null;
    if (currentResult.resolutionMode === "LOCAL_RUNBOOK") {
      return {
        label: "Instant On-Device Fix ($0)",
        bg: "var(--safe-bg)",
        border: "var(--safe-border)",
        text: "var(--safe-text)",
        Icon: ShieldCheck,
      };
    }
    if (currentResult.resolutionMode === "CLOUD_ESCALATION") {
      return {
        label: "Safe Cloud AI Solution",
        bg: "var(--accent-soft-bg)",
        border: "var(--accent-soft-border)",
        text: "var(--accent-text)",
        Icon: Cloud,
      };
    }
    if (currentResult.resolutionMode === "OFFLINE_QUEUED") {
      return {
        label: "Saved for Connection",
        bg: "var(--warn-bg)",
        border: "var(--warn-border)",
        text: "var(--warn-text)",
        Icon: WifiOff,
      };
    }
    if (currentResult.resolutionMode === "QUARANTINED_PENDING_APPROVAL") {
      return {
        label: "Paused for Review",
        bg: "var(--warn-bg)",
        border: "var(--warn-border)",
        text: "var(--warn-text)",
        Icon: ShieldAlert,
      };
    }
    return {
      label: "On-Device Guidance",
      bg: "var(--info-bg)",
      border: "var(--info-border)",
      text: "var(--info-text)",
      Icon: Sparkles,
    };
  };

  const modeBadge = getModeBadge();

  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3"
        style={{
          backgroundColor: trustBg,
          borderColor: trustBorder,
        }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {unmaskedCount > 0 ? (
            <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: trustText }} aria-hidden="true" />
          ) : (
            <ShieldCheck className="h-4 w-4 shrink-0" style={{ color: trustText }} aria-hidden="true" />
          )}
          <p className="text-xs font-semibold sm:text-sm" style={{ color: trustText }}>
            {trustMessage}
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenTechnicalProof}
          className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: trustBorder,
            color: "var(--text-primary)",
          }}
        >
          Inspect Technical Proof
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <section className="lf-card rounded-2xl p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2
              className="text-base font-semibold tracking-tight"
              style={{ color: "var(--text-primary)" }}
            >
              3. Get Safe AI Solution
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
              Remediation steps generated from the masked incident text only.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {currentResult && severityStyle && (
              <span
                className="rounded-lg border px-2.5 py-1 text-xs font-bold"
                style={{
                  backgroundColor: severityStyle.bg,
                  borderColor: severityStyle.border,
                  color: severityStyle.text,
                }}
              >
                {currentResult.severity} · {severityStyle.label}
              </span>
            )}
            {modeBadge && (
              <span
                className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold"
                style={{
                  backgroundColor: modeBadge.bg,
                  borderColor: modeBadge.border,
                  color: modeBadge.text,
                }}
              >
                <modeBadge.Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {modeBadge.label}
              </span>
            )}
          </div>
        </div>

        {!currentResult ? (
          <div
            className="rounded-xl border p-5 text-sm"
            style={{
              backgroundColor: "var(--bg-subtle)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-secondary)",
            }}
          >
            Select a starter example or paste logs in Step 1, then click{" "}
            <strong style={{ color: "var(--text-primary)" }}>Protect &amp; Analyze</strong> to see
            hidden secrets and safe remediation steps here.
          </div>
        ) : (
          <div className="space-y-4">
            {currentResult.resolutionMode === "PRE_CLOUD_COUNTDOWN" && (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5"
                style={{
                  backgroundColor: "var(--accent-soft-bg)",
                  borderColor: "var(--accent-soft-border)",
                }}
              >
                <div>
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {countdownPaused
                      ? "Ready when you are — inspect hidden tags above before sending."
                      : `Sending safe masked summary to Cloud AI in ${Math.max(1, Math.ceil((countdownMs ?? 0) / 1000))}s`}
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    Only [REDACTED] placeholders leave your device.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!countdownPaused && (
                    <button
                      type="button"
                      onClick={onPauseCountdown}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold"
                      style={{
                        backgroundColor: "var(--bg-surface)",
                        borderColor: "var(--border-strong)",
                        color: "var(--text-primary)",
                      }}
                    >
                      <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                      Pause
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isRunning || offlineMode || unmaskedCount > 0}
                    onClick={onApproveOrRerunCloud}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-semibold disabled:opacity-50"
                    style={{
                      backgroundColor: "var(--accent-primary)",
                      color: "var(--accent-on-primary)",
                    }}
                  >
                    <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
                    Send Safe Text Now
                  </button>
                </div>
              </div>
            )}

            {currentResult.resolutionMode === "QUARANTINED_PENDING_APPROVAL" && (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5"
                style={{
                  backgroundColor: "var(--warn-bg)",
                  borderColor: "var(--warn-border)",
                }}
              >
                <div>
                  <p className="text-sm font-semibold" style={{ color: "var(--warn-text)" }}>
                    {unmaskedCount > 0
                      ? `${unmaskedCount} secret(s) are currently unmasked.`
                      : "All secrets are hidden again and ready for Cloud AI."}
                  </p>
                  <p className="text-xs" style={{ color: "var(--warn-text)" }}>
                    {unmaskedCount > 0
                      ? "Re-mask exposed secret chips in Step 2 before escalating."
                      : "Click below to send only the safe masked text."}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isRunning || offlineMode || unmaskedCount > 0}
                  onClick={onApproveOrRerunCloud}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--accent-primary)",
                    color: "var(--accent-on-primary)",
                  }}
                >
                  <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
                  Send Safe Text to AI
                </button>
              </div>
            )}

            {maskDirtySinceCloud &&
              unmaskedCount === 0 &&
              currentResult.resolutionMode === "CLOUD_ESCALATION" && (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
                  style={{
                    backgroundColor: "var(--info-bg)",
                    borderColor: "var(--info-border)",
                  }}
                >
                  <span className="text-xs font-medium" style={{ color: "var(--info-text)" }}>
                    You updated the hidden tags. Refresh the AI solution with the updated safe text?
                  </span>
                  <button
                    type="button"
                    disabled={isRunning || offlineMode}
                    onClick={onApproveOrRerunCloud}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                    style={{
                      backgroundColor: "var(--accent-primary)",
                      color: "var(--accent-on-primary)",
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    Re-run Safe AI
                  </button>
                </div>
              )}

            {currentResult.cloudError && (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5"
                style={{
                  backgroundColor: "var(--mask-bg)",
                  borderColor: "var(--mask-border)",
                  color: "var(--mask-text)",
                }}
              >
                <div className="text-xs">
                  <p className="font-semibold">Cloud AI temporarily unavailable</p>
                  <p className="mt-0.5 opacity-90">{currentResult.cloudError}</p>
                </div>
                <button
                  type="button"
                  disabled={isRunning || offlineMode || unmaskedCount > 0}
                  onClick={onApproveOrRerunCloud}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--mask-border)",
                    color: "var(--text-primary)",
                  }}
                >
                  Retry Safe Cloud AI
                </button>
              </div>
            )}

            {isRunning && currentResult.resolutionMode === "PRE_CLOUD_COUNTDOWN" ? (
              <div
                className="flex items-center gap-2 rounded-xl border p-4 text-sm"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
              >
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Generating remediation steps from redacted text...
              </div>
            ) : (
              <div
                className="rounded-xl border p-4"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  borderColor: "var(--border-subtle)",
                }}
              >
                <SafeMarkdownView content={currentResult.resolution} />
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Tokens saved by local privacy filter: ~{currentResult.estimatedTokensSaved}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopy(currentResult.resolution, "solution")}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold"
                    style={{
                      backgroundColor: "var(--bg-surface)",
                      borderColor: "var(--border-subtle)",
                      color: "var(--text-primary)",
                    }}
                  >
                    {copiedSolution ? (
                      <>
                        <Check className="h-3.5 w-3.5" style={{ color: "var(--safe-text)" }} aria-hidden="true" />
                        Copied Solution
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        Copy Solution
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            <div
              className="rounded-xl border p-4"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-subtle)",
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4" style={{ color: "var(--accent-text)" }} aria-hidden="true" />
                  <div>
                    <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      Leadership &amp; Team Update
                    </h3>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      Generates a clean stakeholder status message from safe facts only.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isGeneratingBrief || unmaskedCount > 0}
                  onClick={onGenerateHybridBrief}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3.5 py-1.5 text-xs font-semibold disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-strong)",
                    color: "var(--text-primary)",
                  }}
                >
                  {isGeneratingBrief ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      Writing Update...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      {currentResult.hybridBrief ? "Refresh Update" : "Draft Leadership Update"}
                    </>
                  )}
                </button>
              </div>

              {currentResult.hybridBrief && (
                <div
                  className="mt-3 rounded-xl border p-3.5"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-subtle)",
                  }}
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span
                      className="rounded-md border px-2 py-0.5 text-[11px] font-semibold"
                      style={{
                        backgroundColor: "var(--safe-bg)",
                        borderColor: "var(--safe-border)",
                        color: "var(--safe-text)",
                      }}
                    >
                      {currentResult.hybridBrief.inferenceSource === "ON_DEVICE"
                        ? "Protected On-Device (Nano 4)"
                        : currentResult.hybridBrief.inferenceSource === "LOCAL_FALLBACK"
                          ? "Generated Locally"
                          : "Safe Cloud AI"}{" "}
                      · {currentResult.hybridBrief.latencyMs}ms
                    </span>

                    <button
                      type="button"
                      onClick={() =>
                        void handleCopy(currentResult.hybridBrief!.stakeholderDraft, "brief")
                      }
                      className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium"
                      style={{
                        backgroundColor: "var(--bg-subtle)",
                        borderColor: "var(--border-subtle)",
                        color: "var(--text-primary)",
                      }}
                    >
                      {copiedBrief ? (
                        <>
                          <Check className="h-3.5 w-3.5" style={{ color: "var(--safe-text)" }} aria-hidden="true" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          Copy Update
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {currentResult.hybridBrief.summary}
                  </p>
                  <pre
                    className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {currentResult.hybridBrief.stakeholderDraft}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
