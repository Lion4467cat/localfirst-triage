import { useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileText,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";
import {
  exportAuditReportJson,
  exportAuditReportMarkdown,
} from "../storage/ticketStore";
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
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code
          key={i}
          className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[12px] text-cyan-200"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return (
        <strong key={i} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

function SafeMarkdownView({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-slate-200">
      {lines.map((rawLine, idx) => {
        const line = rawLine.trim();
        if (!line) return <div key={idx} className="h-1" />;
        if (line.startsWith("### ")) {
          return (
            <h3 key={idx} className="pt-1 text-sm font-bold text-indigo-300">
              {renderInlineMarkdown(line.slice(4))}
            </h3>
          );
        }
        if (line.startsWith("## ") || line.startsWith("# ")) {
          const clean = line.replace(/^#{1,3}\s+/, "");
          return (
            <h3 key={idx} className="pt-1 text-sm font-bold text-emerald-300">
              {renderInlineMarkdown(clean)}
            </h3>
          );
        }
        if (/^[-*]\s+/.test(line)) {
          return (
            <div key={idx} className="flex gap-2 pl-2">
              <span className="text-indigo-400">•</span>
              <span>{renderInlineMarkdown(line.replace(/^[-*]\s+/, ""))}</span>
            </div>
          );
        }
        if (/^\d+\.\s+/.test(line)) {
          const match = line.match(/^(\d+\.)\s+(.*)$/);
          return (
            <div key={idx} className="flex gap-2 pl-2">
              <span className="font-mono text-xs text-cyan-300">{match?.[1]}</span>
              <span>{renderInlineMarkdown(match?.[2] ?? line)}</span>
            </div>
          );
        }
        return <p key={idx}>{renderInlineMarkdown(line)}</p>;
      })}
    </div>
  );
}

function triggerDownloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
}: ResolutionPanelProps) {
  const [activeTab, setActiveTab] = useState<"resolution" | "proof" | "export">("resolution");
  const [copiedSlack, setCopiedSlack] = useState(false);

  const handleCopySlackBrief = async () => {
    if (!currentResult) return;
    const text = currentResult.hybridBrief?.stakeholderDraft ?? exportAuditReportMarkdown(currentResult);
    try {
      await navigator.clipboard?.writeText(text);
      setCopiedSlack(true);
      setTimeout(() => setCopiedSlack(false), 1800);
    } catch {
      // Ignore headless clipboard restrictions
    }
  };

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-5 w-5 text-indigo-400" />
          <h2 className="text-sm font-semibold tracking-wide text-slate-100 uppercase">
            Triage Resolution &amp; Routing
          </h2>
        </div>

        {currentResult && (
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
            <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-indigo-200">
              {currentResult.severity} · {currentResult.category}
            </span>
            <span className="rounded bg-slate-800 px-2 py-0.5 text-emerald-300">
              {currentResult.resolutionMode}
            </span>
          </div>
        )}
      </div>

      {currentResult && (
        <div className="mb-3 flex flex-wrap gap-1.5 border-b border-slate-800 pb-2">
          {(
            [
              ["resolution", "Resolution & Hybrid Brief"],
              ["proof", "Zero-Leakage Proof"],
              ["export", "Export & Handoff"],
            ] as const
          ).map(([tabKey, label]) => (
            <button
              key={tabKey}
              type="button"
              onClick={() => setActiveTab(tabKey)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === tabKey
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-950/70 text-slate-400 hover:text-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {(!currentResult || activeTab === "resolution") && (
        <>
          {currentResult?.resolutionMode === "PRE_CLOUD_COUNTDOWN" && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cyan-500/50 bg-cyan-950/40 p-3">
              <div className="text-xs text-cyan-200">
                {countdownPaused
                  ? "Pre-Cloud Review Gate PAUSED — edit highlighted spans above, then escalate."
                  : `Auto-escalating sanitized payload to Cloud Gemini in ${((countdownMs ?? 0) / 1000).toFixed(1)}s...`}
              </div>
              <div className="flex items-center gap-2">
                {!countdownPaused && (
                  <button
                    type="button"
                    onClick={onPauseCountdown}
                    className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/50 px-2.5 py-1 text-xs font-semibold text-cyan-200 hover:bg-cyan-900/40"
                  >
                    <Pause className="h-3.5 w-3.5" />
                    <span>Pause to Edit Pills</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={isRunning || offlineMode}
                  onClick={onApproveOrRerunCloud}
                  className="inline-flex items-center gap-1 rounded-lg bg-cyan-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span>Escalate Now</span>
                </button>
              </div>
            </div>
          )}

          {currentResult?.resolutionMode === "QUARANTINED_PENDING_APPROVAL" && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/50 bg-amber-950/40 p-3">
              <div className="flex items-center gap-2 text-xs text-amber-200">
                <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" />
                <span>
                  Fail-Closed Quarantine: Review masked tokens above before sending to Cloud.
                </span>
              </div>
              <button
                type="button"
                disabled={isRunning || offlineMode}
                onClick={onApproveOrRerunCloud}
                className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 disabled:opacity-50"
              >
                {offlineMode
                  ? "Blocked (Offline Mode ON)"
                  : "Approve & Escalate Sanitized Payload to Cloud"}
              </button>
            </div>
          )}

          {currentResult?.resolutionMode === "OFFLINE_QUEUED" && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/50 bg-amber-950/30 p-3 text-xs text-amber-200">
              <span>
                Queued safely in zero-PII Offline Queue. Turn off Airplane Mode to escalate
                sanitized payload.
              </span>
              {!offlineMode && (
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={onApproveOrRerunCloud}
                  className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                >
                  Escalate Queued Ticket Now
                </button>
              )}
            </div>
          )}

          {currentResult?.resolutionMode === "CLOUD_ERROR" && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-500/50 bg-rose-950/40 p-3">
              <div className="flex items-center gap-2 text-xs text-rose-200">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                <span>
                  Cloud escalation failed ({currentResult.cloudError ?? "Error"}). Zero raw PII left
                  your device.
                </span>
              </div>
              <button
                type="button"
                disabled={isRunning || offlineMode}
                onClick={onApproveOrRerunCloud}
                className="inline-flex items-center gap-1 rounded-lg bg-rose-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-rose-400 disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Retry Cloud Escalation</span>
              </button>
            </div>
          )}

          {maskDirtySinceCloud &&
            currentResult?.resolutionMode === "CLOUD_ESCALATION" &&
            !offlineMode && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cyan-500/50 bg-cyan-950/40 p-3">
                <span className="text-xs text-cyan-200">
                  Masking pills changed since the last Cloud response.
                </span>
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={onApproveOrRerunCloud}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Re-Run Cloud Analysis with Updated Mask</span>
                </button>
              </div>
            )}

          <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3.5">
            {currentResult ? (
              <SafeMarkdownView content={currentResult.resolution} />
            ) : (
              <p className="text-sm text-slate-400">
                Click <strong>Run Hybrid Triage</strong> to execute Stage 1 (Regex + Entropy +
                Gemini Nano 4 <code className="font-mono">ONLY_ON_DEVICE</code>) and inspect the
                inline diff and resolution.
              </p>
            )}
          </div>

          {currentResult && (
            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-indigo-200">
                  <Sparkles className="h-4 w-4 text-indigo-400" />
                  <span>Hybrid Executive Brief (InferenceMode.PREFER_ON_DEVICE)</span>
                </div>
                <button
                  type="button"
                  disabled={isGeneratingBrief}
                  onClick={onGenerateHybridBrief}
                  className="rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-3 py-1 text-xs font-semibold text-indigo-200 transition hover:bg-indigo-500/25 disabled:opacity-50"
                >
                  {isGeneratingBrief
                    ? "Generating Brief..."
                    : currentResult.hybridBrief
                      ? "Regenerate Hybrid Brief"
                      : "Generate Hybrid Stakeholder Brief"}
                </button>
              </div>
              {currentResult.hybridBrief && (
                <div className="mt-2.5 space-y-1.5 border-t border-slate-800 pt-2 text-xs text-slate-300">
                  <div className="flex items-center gap-2 font-mono text-[10px] text-emerald-300">
                    <span>Source: {currentResult.hybridBrief.inferenceSource}</span>
                    <span>·</span>
                    <span>{currentResult.hybridBrief.latencyMs}ms</span>
                  </div>
                  <SafeMarkdownView content={currentResult.hybridBrief.stakeholderDraft} />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {currentResult && activeTab === "proof" && (
        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-3 text-emerald-200">
            <span className="inline-flex items-center gap-2 font-semibold">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <span>
                {currentResult.zeroLeakageAudit
                  ? currentResult.zeroLeakageAudit.verified
                    ? `ZERO-LEAKAGE VERIFIED: 0 / ${currentResult.zeroLeakageAudit.checkedSpansCount} active raw secrets present in outbound Cloud prompt`
                    : `ALERT: ${currentResult.zeroLeakageAudit.leakedSpansCount} unmasked secrets blocked before Cloud dispatch`
                  : `LOCAL-ONLY EXECUTION: Stage 2 Cloud was skipped (${currentResult.stage2Source})`}
              </span>
            </span>
            <span className="font-mono text-[11px]">
              Saved ~{currentResult.estimatedTokensSaved} tokens
            </span>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3">
            <p className="mb-1.5 font-semibold text-slate-300">
              Exact Outbound / Sanitized Payload Preview:
            </p>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-emerald-200">
              {currentResult.zeroLeakageAudit?.outboundPromptPreview ?? currentResult.sanitizedText}
            </pre>
          </div>
        </div>
      )}

      {currentResult && activeTab === "export" && (
        <div className="space-y-3 text-xs">
          <p className="text-slate-400">
            All exports pass through <code className="font-mono">stripRawTextForStorage()</code> —
            zero raw PII or unredacted secrets are ever included.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleCopySlackBrief()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-3 py-2 font-semibold text-indigo-200 hover:bg-indigo-500/25"
            >
              {copiedSlack ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span>{copiedSlack ? "Copied Slack/Jira Brief!" : "Copy Slack / Jira Brief"}</span>
            </button>

            <button
              type="button"
              onClick={() =>
                triggerDownloadFile(
                  `${currentResult.id}-audit.json`,
                  exportAuditReportJson(currentResult),
                  "application/json",
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 font-semibold text-emerald-200 hover:bg-emerald-500/25"
            >
              <Download className="h-4 w-4" />
              <span>Download Audit JSON</span>
            </button>

            <button
              type="button"
              onClick={() =>
                triggerDownloadFile(
                  `${currentResult.id}-audit.md`,
                  exportAuditReportMarkdown(currentResult),
                  "text/markdown",
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 font-semibold text-cyan-200 hover:bg-cyan-500/25"
            >
              <FileText className="h-4 w-4" />
              <span>Download Audit Markdown</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
