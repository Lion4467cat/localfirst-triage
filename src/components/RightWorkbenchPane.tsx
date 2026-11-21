import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  Download,
  FileText,
  Loader2,
  Lock,
  Pause,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Unlock,
  WifiOff,
} from "lucide-react";
import { formatCategoryLabel, getSeverityStyle } from "../config/displayLabels";
import type { RuntimeConfigValues } from "../config/firebase";
import type {
  DetectorSource,
  HybridTelemetry,
  TriageResult,
} from "../types/triage";
import { RedactionDiff } from "./RedactionDiff";

export type RightPaneTab = "sanitized" | "solution" | "proof";

interface RightWorkbenchPaneProps {
  currentResult: TriageResult | null;
  rawText: string;
  isRunning: boolean;
  isGeneratingBrief: boolean;
  isRefreshingPolicy: boolean;
  offlineMode: boolean;
  countdownMs: number | null;
  countdownPaused: boolean;
  maskDirtySinceCloud: boolean;
  telemetry: HybridTelemetry;
  runtimeConfig: RuntimeConfigValues;
  autoCloudMode: boolean;
  onToggleAutoCloudMode: () => void;
  onRunLiveDemo: () => void;
  onToggleSpan: (spanIndex: number) => void;
  onAddManualSpan: (start: number, end: number) => void;
  onPauseCountdown: () => void;
  onApproveOrRerunCloud: () => void;
  onGenerateHybridBrief: () => void;
  onRefreshRemoteConfig: () => void;
  onWarmupNano: () => void;
  onRecheckNano: () => void;
}

const CIPHER_GLYPHS = "#x9$k!@&*?%01A-Z";

function ScrambleChipLabel({ label, ticketId }: { label: string; ticketId: string }) {
  const [text, setText] = useState(label);

  useEffect(() => {
    let step = 0;
    const totalSteps = 10; // ~350ms total
    const timer = setInterval(() => {
      step++;
      if (step >= totalSteps) {
        setText(label);
        clearInterval(timer);
        return;
      }
      const scrambled = label
        .split("")
        .map((ch, idx) =>
          ch === " "
            ? " "
            : idx < Math.floor((step / totalSteps) * label.length)
              ? ch
              : CIPHER_GLYPHS[Math.floor(Math.random() * CIPHER_GLYPHS.length)],
        )
        .join("");
      setText(scrambled);
    }, 35);
    return () => clearInterval(timer);
  }, [label, ticketId]);

  return <span>{text}</span>;
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

function renderInlineCodeAndBold(line: string): ReactNode[] {
  const parts = line.split(/(\[REDACTED:[A-Z0-9_]+\]|`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (/^\[REDACTED:[A-Z0-9_]+\]$/.test(part)) {
      return (
        <span
          key={i}
          className="mx-0.5 inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold"
          style={{
            backgroundColor: "var(--safe-bg)",
            borderColor: "var(--safe-border)",
            color: "var(--safe-text)",
          }}
        >
          {part}
        </span>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code
          key={i}
          className="rounded border px-1 py-0.5 font-mono text-[11px]"
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
  const firstNonEmpty = lines.find((l) => l.trim().length > 0)?.trim() ?? "";
  const needsRootCauseHeader =
    firstNonEmpty.length > 0 &&
    !firstNonEmpty.startsWith("#") &&
    !/^(ROOT CAUSE|IMMEDIATE MITIGATION|VERIFICATION)/i.test(firstNonEmpty);

  const blocks: ReactNode[] = [];
  if (needsRootCauseHeader) {
    blocks.push(
      <h4
        key="auto-root-cause"
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--text-primary)" }}
      >
        Root Cause
      </h4>
    );
  }
  let codeFence: string[] = [];
  let inCode = false;

  const flushCode = (key: number) => {
    if (codeFence.length === 0) return;
    blocks.push(
      <pre
        key={`code-${key}`}
        className="my-2 overflow-x-auto rounded-lg border p-2.5 font-mono text-[11px] leading-relaxed"
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
      blocks.push(<div key={`sp-${idx}`} className="h-1.5" />);
      return;
    }

    if (trimmed.startsWith("### ") || trimmed.startsWith("## ")) {
      const heading = trimmed.replace(/^#{2,3}\s+/, "");
      blocks.push(
        <h4
          key={`h-${idx}`}
          className="mt-2.5 text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-primary)" }}
        >
          {renderInlineCodeAndBold(heading)}
        </h4>
      );
      return;
    }

    const checklistMatch = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (checklistMatch) {
      const checked = checklistMatch[1].toLowerCase() === "x";
      blocks.push(
        <div
          key={`chk-${idx}`}
          className="flex items-start gap-2 pl-1 text-xs leading-relaxed"
          style={{ color: "var(--text-secondary)" }}
        >
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border"
            style={{
              backgroundColor: checked ? "var(--safe-bg)" : "var(--bg-subtle)",
              borderColor: checked ? "var(--safe-border)" : "var(--border-strong)",
              color: checked ? "var(--safe-text)" : "transparent",
            }}
          >
            {checked ? <Check className="h-2.5 w-2.5" /> : null}
          </span>
          <span>{renderInlineCodeAndBold(checklistMatch[2])}</span>
        </div>
      );
      return;
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      blocks.push(
        <div
          key={`li-${idx}`}
          className="flex gap-2 pl-1 text-xs leading-relaxed"
          style={{ color: "var(--text-secondary)" }}
        >
          <span style={{ color: "var(--text-muted)" }}>•</span>
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
          className="flex gap-2 pl-1 text-xs leading-relaxed"
          style={{ color: "var(--text-secondary)" }}
        >
          <span className="font-mono font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
            {numMatch[1]}
          </span>
          <span>{renderInlineCodeAndBold(numMatch[2])}</span>
        </div>
      );
      return;
    }

    blocks.push(
      <p key={`p-${idx}`} className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        {renderInlineCodeAndBold(trimmed)}
      </p>
    );
  });

  if (inCode) {
    flushCode(lines.length + 1);
  }

  return <div className="space-y-1">{blocks}</div>;
}

export function RightWorkbenchPane({
  currentResult,
  rawText,
  isRunning,
  isGeneratingBrief,
  isRefreshingPolicy,
  offlineMode,
  countdownMs,
  countdownPaused,
  maskDirtySinceCloud,
  telemetry,
  runtimeConfig,
  autoCloudMode,
  onToggleAutoCloudMode,
  onRunLiveDemo,
  onToggleSpan,
  onAddManualSpan,
  onPauseCountdown,
  onApproveOrRerunCloud,
  onGenerateHybridBrief,
  onRefreshRemoteConfig,
  onWarmupNano,
  onRecheckNano,
}: RightWorkbenchPaneProps) {
  const [activeTab, setActiveTab] = useState<RightPaneTab>("sanitized");
  const [copiedSlack, setCopiedSlack] = useState(false);
  const [copiedRca, setCopiedRca] = useState(false);

  // Auto-focus AI Solution when Cloud RCA streams or Local Runbook resolves
  useEffect(() => {
    if (!currentResult) {
      setActiveTab("sanitized");
      return;
    }
    if (
      currentResult.resolutionMode === "CLOUD_ESCALATION" ||
      currentResult.resolutionMode === "LOCAL_RUNBOOK" ||
      currentResult.resolutionMode === "CLOUD_ERROR"
    ) {
      setActiveTab("solution");
    } else {
      setActiveTab("sanitized");
    }
  }, [currentResult?.id, currentResult?.resolutionMode]);

  const maskedCount =
    currentResult?.spans.filter((s) => s.masked !== false).length ?? 0;
  const unmaskedCount =
    currentResult?.spans.filter((s) => s.masked === false).length ?? 0;

  const [rolledBlocked, setRolledBlocked] = useState(maskedCount);
  useEffect(() => {
    if (!currentResult || maskedCount <= 0) {
      setRolledBlocked(0);
      return;
    }
    let frame = 0;
    const steps = Math.min(12, maskedCount);
    const timer = setInterval(() => {
      frame++;
      setRolledBlocked(Math.round((frame / steps) * maskedCount));
      if (frame >= steps) clearInterval(timer);
    }, 28);
    return () => clearInterval(timer);
  }, [currentResult?.id, maskedCount]);

  const detectorCounts = new Map<DetectorSource, number>();
  for (const key of DETECTOR_KEYS) detectorCounts.set(key, 0);
  if (currentResult) {
    for (const span of currentResult.spans) {
      detectorCounts.set(span.detector, (detectorCounts.get(span.detector) ?? 0) + 1);
    }
  }

  const audit = currentResult?.zeroLeakageAudit ?? null;
  const zeroLeaksVerified = currentResult
    ? audit
      ? audit.verified && unmaskedCount === 0
      : unmaskedCount === 0
    : true;

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
    const summary = [
      `*${currentResult.title}* (${currentResult.severity})`,
      `• Privacy: ${maskedCount} secret(s) masked on-device · 0 leaked`,
      currentResult.hybridBrief?.summary
        ? `• Brief: ${currentResult.hybridBrief.summary}`
        : `• Status: ${currentResult.resolutionMode}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(summary);
      setCopiedSlack(true);
      setTimeout(() => setCopiedSlack(false), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  const nanoCount = detectorCounts.get("NANO_SEMANTIC_FIREWALL") ?? 0;
  const heuristicCount =
    (detectorCounts.get("HEURISTIC_GUARD") ?? 0) +
    (detectorCounts.get("POLICY_TERM") ?? 0) +
    (detectorCounts.get("MANUAL_MASK") ?? 0);
  const regexCount =
    (detectorCounts.get("REGEX_FIREWALL") ?? 0) +
    (detectorCounts.get("ENTROPY_SCANNER") ?? 0);

  const stage2ProofLabel = !currentResult
    ? ""
    : currentResult.resolutionMode === "LOCAL_RUNBOOK"
      ? `On-Device ($0 · ${currentResult.stage1LatencyMs}ms)`
      : currentResult.resolutionMode === "CLOUD_ESCALATION"
        ? `${currentResult.activeCloudModel ?? runtimeConfig.cloudModel} (${currentResult.stage2LatencyMs}ms)`
        : currentResult.resolutionMode === "OFFLINE_QUEUED"
          ? "Offline Sealed ($0)"
          : "Held on-device";

  const handleCopyRca = async () => {
    if (!currentResult?.resolution) return;
    try {
      await navigator.clipboard.writeText(currentResult.resolution);
      setCopiedRca(true);
      setTimeout(() => setCopiedRca(false), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  const canEscalate =
    Boolean(currentResult) &&
    !isRunning &&
    !offlineMode &&
    unmaskedCount === 0 &&
    !currentResult?.loadedFromZeroPiiStore &&
    (currentResult?.resolutionMode === "QUARANTINED_PENDING_APPROVAL" ||
      currentResult?.resolutionMode === "PRE_CLOUD_COUNTDOWN" ||
      currentResult?.resolutionMode === "CLOUD_ERROR" ||
      maskDirtySinceCloud);

  const sev = currentResult ? getSeverityStyle(currentResult.severity) : null;

  return (
    <section
      aria-label="Safe Output and AI Solution"
      className="lf-card flex min-h-0 flex-col overflow-hidden rounded-xl"
    >
      {/* Top Pane Header with Sliding Segmented Switcher */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 border-b px-3.5 py-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{
              backgroundColor: currentResult
                ? zeroLeaksVerified
                  ? "var(--safe-solid)"
                  : "var(--mask-solid)"
                : "var(--text-muted)",
            }}
            aria-hidden="true"
          />
          <span
            className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: "var(--text-primary)" }}
          >
            Safe Output &amp; AI Solution
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="Output views"
            className="inline-flex rounded-lg border p-0.5"
            style={{
              backgroundColor: "var(--bg-subtle)",
              borderColor: "var(--border-subtle)",
            }}
          >
            {(
              [
                { id: "sanitized", label: "Sanitized" },
                { id: "solution", label: "AI Solution" },
                { id: "proof", label: "Proof & SDK" },
              ] as const
            ).map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.id)}
                  className="relative rounded-md px-2.5 py-1 text-[11px] font-medium"
                  style={{
                    color: active ? "var(--text-primary)" : "var(--text-secondary)",
                  }}
                >
                  {active && (
                    <motion.span
                      layoutId="right-pane-tab"
                      transition={{ type: "spring", duration: 0.35, bounce: 0.15 }}
                      className="absolute inset-0 rounded-md"
                      style={{
                        backgroundColor: "var(--bg-surface)",
                        boxShadow: "var(--shadow-card)",
                      }}
                    />
                  )}
                  <span className="relative z-10">{tab.label}</span>
                </button>
              );
            })}
          </div>

          {currentResult && (
            <button
              type="button"
              disabled={isGeneratingBrief || unmaskedCount > 0}
              onClick={() => {
                onGenerateHybridBrief();
                setActiveTab("solution");
              }}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-45"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            >
              {isGeneratingBrief ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="h-3 w-3" aria-hidden="true" />
              )}
              Executive Brief
            </button>
          )}
        </div>
      </div>

      {/* Razor-Thin 1-Line Hybrid Proof Strip (visible above Sanitized & AI Solution) */}
      {currentResult && activeTab !== "proof" && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 border-b px-3.5 py-1.5 font-mono text-[10px] tabular-nums"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--border-subtle)",
            color: "var(--text-secondary)",
          }}
        >
          <span>
            <strong style={{ color: "var(--mask-text)" }}>{maskedCount} Blocked</strong>{" "}
            ({nanoCount} Nano 4 · {heuristicCount} Heuristic · {regexCount} Regex) ·{" "}
            <strong style={{ color: unmaskedCount === 0 ? "var(--safe-text)" : "var(--warn-text)" }}>
              {unmaskedCount === 0 ? "0 Leaked" : `${unmaskedCount} Unmasked`}
            </strong>
          </span>
          <span style={{ color: "var(--text-muted)" }}>
            Stage 2: {stage2ProofLabel}
          </span>
        </div>
      )}

      {/* Main Scrollable Pane Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        {/* Idle Visual Preview (No Empty Void) */}
        {!currentResult && !isRunning && activeTab !== "proof" && (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-5 py-6 text-center">
            <div className="w-full max-w-md space-y-3">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <div
                  className="rounded-lg border p-2.5 text-left"
                  style={{
                    backgroundColor: "var(--mask-bg)",
                    borderColor: "var(--mask-border)",
                  }}
                >
                  <p className="font-mono text-[10px] font-semibold uppercase" style={{ color: "var(--mask-text)" }}>
                    Raw Secret
                  </p>
                  <p className="mt-1 truncate font-mono text-[11px]" style={{ color: "var(--text-primary)" }}>
                    AKIA••••••••••••
                  </p>
                </div>

                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg border"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    borderColor: "var(--border-strong)",
                    color: "var(--text-primary)",
                  }}
                >
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                </div>

                <div
                  className="rounded-lg border p-2.5 text-left"
                  style={{
                    backgroundColor: "var(--safe-bg)",
                    borderColor: "var(--safe-border)",
                  }}
                >
                  <p className="font-mono text-[10px] font-semibold uppercase" style={{ color: "var(--safe-text)" }}>
                    Safe AI Answer
                  </p>
                  <p className="mt-1 truncate font-mono text-[11px]" style={{ color: "var(--text-primary)" }}>
                    [REDACTED:AWS_1]
                  </p>
                </div>
              </div>

              <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                Secrets and health details are masked locally before anything crosses the airgap.
              </p>

              <button
                type="button"
                onClick={onRunLiveDemo}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-4 text-xs font-semibold"
                style={{
                  backgroundColor: "var(--accent-primary)",
                  color: "var(--accent-on-primary)",
                }}
              >
                <span>Run Live P0 Demo</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {isRunning && !currentResult && (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-2 text-center">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--text-primary)" }} aria-hidden="true" />
            <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
              Running Stage 1 Privacy Firewall on-device...
            </p>
          </div>
        )}

        {/* TAB 1: SANITIZED */}
        {currentResult && activeTab === "sanitized" && (
          <div className="space-y-3">
            {/* Stripe-style 4-metric tabular-nums trust strip */}
            <div
              className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border sm:grid-cols-4"
              style={{
                backgroundColor: "var(--border-subtle)",
                borderColor: "var(--border-subtle)",
              }}
            >
              <div className="p-2.5" style={{ backgroundColor: "var(--bg-surface)" }}>
                <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Blocked
                </p>
                <p className="mt-0.5 font-mono text-sm font-bold tabular-nums" style={{ color: "var(--mask-text)" }}>
                  {rolledBlocked} Blocked
                </p>
              </div>
              <div className="p-2.5" style={{ backgroundColor: "var(--bg-surface)" }}>
                <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Leakage
                </p>
                <p
                  className="mt-0.5 font-mono text-sm font-bold tabular-nums"
                  style={{ color: unmaskedCount === 0 ? "var(--safe-text)" : "var(--warn-text)" }}
                >
                  {unmaskedCount === 0 ? "0 Leaked" : `${unmaskedCount} Unmasked`}
                </p>
              </div>
              <div className="p-2.5" style={{ backgroundColor: "var(--bg-surface)" }}>
                <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Stage 1
                </p>
                <p className="mt-0.5 truncate font-mono text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                  {currentResult.stage1Source === "ON_DEVICE (Nano 4)" ? "Nano 4" : "On-Device"}
                </p>
              </div>
              <div className="p-2.5" style={{ backgroundColor: "var(--bg-surface)" }}>
                <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Latency
                </p>
                <p className="mt-0.5 font-mono text-sm font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                  {currentResult.stage1LatencyMs}ms
                </p>
              </div>
            </div>

            {/* Status & Severity Strip */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {sev && (
                  <span
                    className="rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold"
                    style={{
                      backgroundColor: sev.bg,
                      borderColor: sev.border,
                      color: sev.text,
                    }}
                  >
                    {currentResult.severity}
                  </span>
                )}
                <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                  {currentResult.resolutionMode === "QUARANTINED_PENDING_APPROVAL"
                    ? "Paused for Review"
                    : currentResult.resolutionMode === "PRE_CLOUD_COUNTDOWN"
                      ? "Ready for Safe AI"
                      : currentResult.resolutionMode === "LOCAL_RUNBOOK"
                        ? "Instant On-Device Fix ($0)"
                        : currentResult.resolutionMode === "OFFLINE_QUEUED"
                          ? "Queued Offline ($0)"
                          : "Sanitized & Verified"}
                </span>
              </div>
              <span className="font-mono text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                ~{currentResult.estimatedTokensSaved} tokens saved
              </span>
            </div>

            {/* Clean Scannable Redaction Lock-Chips (Staggered Spring Reveal) */}
            {currentResult.spans.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {currentResult.spans.map((span, idx) => {
                  const isMasked = span.masked !== false;
                  const isNano = span.detector === "NANO_SEMANTIC_FIREWALL";
                  return (
                    <motion.button
                      key={`${currentResult.id}-${span.start}-${span.end}-${idx}`}
                      type="button"
                      disabled={Boolean(currentResult.loadedFromZeroPiiStore)}
                      aria-pressed={isMasked}
                      onClick={() => onToggleSpan(idx)}
                      initial={{ opacity: 0, y: 4, scale: 0.94 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.96 }}
                      transition={{
                        type: "spring",
                        stiffness: 420,
                        damping: 26,
                        delay: Math.min(idx, 12) * 0.035,
                      }}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium disabled:opacity-55"
                      style={{
                        backgroundColor: !isMasked
                          ? "var(--warn-bg)"
                          : isNano
                            ? "var(--nano-bg)"
                            : "var(--mask-bg)",
                        borderColor: !isMasked
                          ? "var(--warn-border)"
                          : isNano
                            ? "var(--nano-border)"
                            : "var(--mask-border)",
                        color: !isMasked
                          ? "var(--warn-text)"
                          : isNano
                            ? "var(--nano-text)"
                            : "var(--mask-text)",
                      }}
                    >
                      {isMasked ? (
                        <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                      ) : (
                        <Unlock className="h-2.5 w-2.5" aria-hidden="true" />
                      )}
                      <ScrambleChipLabel
                        label={formatCategoryLabel(span.category)}
                        ticketId={currentResult.id}
                      />
                    </motion.button>
                  );
                })}
              </div>
            )}

            {/* Interactive Redaction Diff */}
            <RedactionDiff
              rawText={currentResult ? currentResult.rawText : rawText}
              sanitizedText={currentResult.sanitizedText}
              spans={currentResult.spans}
              loadedFromZeroPiiStore={Boolean(currentResult.loadedFromZeroPiiStore)}
              onToggleSpan={onToggleSpan}
              onAddManualSpan={onAddManualSpan}
            />
          </div>
        )}

        {/* TAB 2: AI SOLUTION */}
        {currentResult && activeTab === "solution" && (
          <div className="space-y-3">
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
              style={{
                backgroundColor:
                  currentResult.resolutionMode === "CLOUD_ERROR"
                    ? "var(--warn-bg)"
                    : "var(--safe-bg)",
                borderColor:
                  currentResult.resolutionMode === "CLOUD_ERROR"
                    ? "var(--warn-border)"
                    : "var(--safe-border)",
              }}
            >
              <div className="flex items-center gap-2">
                {currentResult.resolutionMode === "CLOUD_ERROR" ? (
                  <AlertTriangle className="h-4 w-4" style={{ color: "var(--warn-text)" }} aria-hidden="true" />
                ) : (
                  <ShieldCheck className="h-4 w-4" style={{ color: "var(--safe-text)" }} aria-hidden="true" />
                )}
                <span
                  className="text-xs font-semibold"
                  style={{
                    color:
                      currentResult.resolutionMode === "CLOUD_ERROR"
                        ? "var(--warn-text)"
                        : "var(--safe-text)",
                  }}
                >
                  {currentResult.resolutionMode === "LOCAL_RUNBOOK"
                    ? `Instant On-Device Fix ($0) · ${currentResult.runbookId ?? "Runbook"}`
                    : currentResult.resolutionMode === "CLOUD_ESCALATION"
                      ? `Safe Cloud Analysis · ${currentResult.activeCloudModel ?? "Gemini"}`
                      : currentResult.resolutionMode === "CLOUD_ERROR"
                        ? "Local Deterministic Fallback"
                        : "On-Device Firewall Hold"}
                </span>
              </div>
              <span className="font-mono text-[11px] tabular-nums" style={{ color: "var(--text-secondary)" }}>
                {currentResult.latencyMs}ms
              </span>
            </div>

            {currentResult.hybridBrief && (
              <div
                className="rounded-lg border p-3"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  borderColor: "var(--border-subtle)",
                }}
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                    Executive Brief ({currentResult.hybridBrief.inferenceSource})
                  </span>
                  <span className="font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
                    PREFER_ON_DEVICE · {currentResult.hybridBrief.latencyMs}ms
                  </span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {currentResult.hybridBrief.stakeholderDraft || currentResult.hybridBrief.summary}
                </p>
              </div>
            )}

            <div
              className="rounded-lg border p-3.5"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-subtle)",
              }}
            >
              <SafeMarkdownView content={currentResult.resolution} />
            </div>
          </div>
        )}

        {/* TAB 3: PROOF & SDK */}
        {activeTab === "proof" && (
          <div className="space-y-3">
            {/* Zero-Leakage Verified Banner */}
            <div
              className="flex items-start gap-2.5 rounded-lg border p-3"
              style={{
                backgroundColor: zeroLeaksVerified ? "var(--safe-bg)" : "var(--mask-bg)",
                borderColor: zeroLeaksVerified ? "var(--safe-border)" : "var(--mask-border)",
              }}
            >
              {zeroLeaksVerified ? (
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--safe-text)" }} aria-hidden="true" />
              ) : (
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--mask-text)" }} aria-hidden="true" />
              )}
              <div className="min-w-0">
                <p
                  className="font-mono text-xs font-bold"
                  style={{ color: zeroLeaksVerified ? "var(--safe-text)" : "var(--mask-text)" }}
                >
                  {currentResult
                    ? zeroLeaksVerified
                      ? `ZERO-LEAKAGE VERIFIED: 0 / ${maskedCount} raw secrets leaked`
                      : `BLOCKED: ${unmaskedCount} unmasked secret(s) detected`
                    : "ZERO-LEAKAGE ENGINE ARMED: 0 bytes sent"}
                </p>
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  Outbound cloud payloads are verified verbatim before leaving the device.
                </p>
              </div>
            </div>

            {/* All 3 InferenceMode Badges & Latencies */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="lf-subtle-box rounded-lg p-2.5">
                <p className="font-mono text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>
                  ONLY_ON_DEVICE
                </p>
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  Stage 1 · {currentResult ? `${currentResult.stage1LatencyMs}ms` : telemetry.nanoStatus}
                </p>
              </div>
              <div className="lf-subtle-box rounded-lg p-2.5">
                <p className="font-mono text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>
                  PREFER_IN_CLOUD
                </p>
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  Stage 2 · {currentResult ? `${currentResult.stage2LatencyMs}ms` : runtimeConfig.cloudModel}
                </p>
              </div>
              <div className="lf-subtle-box rounded-lg p-2.5">
                <p className="font-mono text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>
                  PREFER_ON_DEVICE
                </p>
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  Brief · {currentResult?.hybridBrief ? `${currentResult.hybridBrief.latencyMs}ms` : "On demand"}
                </p>
              </div>
            </div>

            {/* Detector Breakdown */}
            <div className="lf-subtle-box rounded-lg p-3">
              <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Detector Breakdown
              </p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {DETECTOR_KEYS.map((key) => (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded border px-2 py-1 font-mono text-[10px]"
                    style={{
                      backgroundColor: "var(--bg-surface)",
                      borderColor: "var(--border-subtle)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <span className="truncate">{key}</span>
                    <span className="ml-1 font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                      {detectorCounts.get(key) ?? 0}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Verbatim [REDACTED:...] Outbound Payload */}
            {currentResult && (
              <div className="lf-subtle-box rounded-lg p-3">
                <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Verbatim Outbound Payload
                </p>
                <pre
                  className="max-h-36 overflow-auto rounded border p-2.5 font-mono text-[11px] leading-relaxed"
                  style={{
                    backgroundColor: "var(--code-bg)",
                    borderColor: "var(--code-border)",
                    color: "var(--code-text)",
                  }}
                >
                  {currentResult.sanitizedText}
                </pre>
              </div>
            )}

            {/* Remote Config & Nano 4 Controls */}
            <div className="lf-subtle-box flex flex-wrap items-center justify-between gap-2 rounded-lg p-3">
              <div className="space-y-0.5 text-[11px]">
                <p className="font-mono font-semibold" style={{ color: "var(--text-primary)" }}>
                  Remote Config: {telemetry.remoteConfigStatus}
                </p>
                <p style={{ color: "var(--text-secondary)" }}>
                  Model: {runtimeConfig.cloudModel} · App Check: {telemetry.appCheckProvider}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={isRefreshingPolicy}
                  onClick={onRefreshRemoteConfig}
                  className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-subtle)",
                    color: "var(--text-primary)",
                  }}
                >
                  <RefreshCw className={`h-3 w-3 ${isRefreshingPolicy ? "animate-spin" : ""}`} aria-hidden="true" />
                  Refresh Policy
                </button>
                <button
                  type="button"
                  onClick={onRecheckNano}
                  className="rounded-md border px-2.5 py-1 text-[11px] font-medium"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-subtle)",
                    color: "var(--text-primary)",
                  }}
                >
                  Recheck Nano 4
                </button>
                {telemetry.nanoStatus === "DOWNLOADABLE" && (
                  <button
                    type="button"
                    onClick={onWarmupNano}
                    className="rounded-md px-2.5 py-1 text-[11px] font-semibold"
                    style={{
                      backgroundColor: "var(--accent-primary)",
                      color: "var(--accent-on-primary)",
                    }}
                  >
                    Download Nano 4
                  </button>
                )}
              </div>
            </div>

            {/* Exports */}
            {currentResult && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    downloadBlobFile(`${currentResult.id}-audit.json`, buildSafeAuditJson(), "application/json")
                  }
                  className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-subtle)",
                    color: "var(--text-primary)",
                  }}
                >
                  <Download className="h-3 w-3" aria-hidden="true" />
                  Export Audit JSON
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadBlobFile(`${currentResult.id}-report.md`, buildSafeMarkdownReport(), "text/markdown")
                  }
                  className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-subtle)",
                    color: "var(--text-primary)",
                  }}
                >
                  <FileText className="h-3 w-3" aria-hidden="true" />
                  Export Markdown
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopySlack()}
                  className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-subtle)",
                    color: "var(--text-primary)",
                  }}
                >
                  {copiedSlack ? (
                    <Check className="h-3 w-3" style={{ color: "var(--safe-text)" }} aria-hidden="true" />
                  ) : (
                    <Copy className="h-3 w-3" aria-hidden="true" />
                  )}
                  {copiedSlack ? "Copied" : "Copy Slack"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Docked Bottom Action Bar (when result exists) */}
      {currentResult && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 border-t px-3.5 py-2.5"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--border-subtle)",
          }}
        >
          {currentResult.resolutionMode === "LOCAL_RUNBOOK" ? (
            <div className="flex w-full items-center justify-between gap-2">
              <span className="text-xs font-semibold" style={{ color: "var(--safe-text)" }}>
                $0 Local Runbook Resolved ({currentResult.runbookId})
              </span>
              <button
                type="button"
                onClick={() => setActiveTab("solution")}
                className="rounded-md border px-2.5 py-1 text-xs font-medium"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--safe-border)",
                  color: "var(--safe-text)",
                }}
              >
                View Solution
              </button>
            </div>
          ) : offlineMode ? (
            <div className="flex w-full items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--warn-text)" }}>
                <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
                Airgap Sealed · $0 Local Mode
              </span>
              <button
                type="button"
                disabled
                className="rounded-lg px-3 py-1.5 text-xs font-semibold opacity-45"
                style={{
                  backgroundColor: "var(--accent-primary)",
                  color: "var(--accent-on-primary)",
                }}
              >
                Approve &amp; Get Safe AI Solution →
              </button>
            </div>
          ) : currentResult.resolutionMode === "CLOUD_ESCALATION" && !maskDirtySinceCloud ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--safe-text)" }}>
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Cloud analysis complete ({currentResult.stage2LatencyMs}ms)
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleCopyRca()}
                  className="inline-flex min-h-[32px] items-center gap-1 rounded-md border px-2.5 text-xs font-medium"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-subtle)",
                    color: "var(--text-primary)",
                  }}
                >
                  {copiedRca ? (
                    <Check className="h-3 w-3" style={{ color: "var(--safe-text)" }} aria-hidden="true" />
                  ) : (
                    <Copy className="h-3 w-3" aria-hidden="true" />
                  )}
                  {copiedRca ? "Copied RCA" : "Copy Safe RCA"}
                </button>
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => {
                    onApproveOrRerunCloud();
                    setActiveTab("solution");
                  }}
                  className="inline-flex min-h-[32px] items-center gap-1 rounded-md border px-2.5 text-xs font-medium disabled:opacity-45"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-subtle)",
                    color: "var(--text-primary)",
                  }}
                >
                  <RefreshCw className="h-3 w-3" aria-hidden="true" />
                  Re-run Cloud
                </button>
                <button
                  type="button"
                  disabled={isGeneratingBrief}
                  onClick={() => {
                    onGenerateHybridBrief();
                    setActiveTab("solution");
                  }}
                  className="inline-flex min-h-[32px] items-center gap-1 rounded-md px-2.5 text-xs font-semibold disabled:opacity-45"
                  style={{
                    backgroundColor: "var(--accent-primary)",
                    color: "var(--accent-on-primary)",
                  }}
                >
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  Draft Executive Brief
                </button>
              </div>
            </div>
          ) : (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              {currentResult.resolutionMode === "PRE_CLOUD_COUNTDOWN" && countdownMs !== null ? (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {countdownPaused
                      ? "Auto-send paused"
                      : `Sending in ${Math.ceil(countdownMs / 1000)}s...`}
                  </span>
                  {!countdownPaused && (
                    <button
                      type="button"
                      onClick={onPauseCountdown}
                      className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium"
                      style={{
                        backgroundColor: "var(--bg-surface)",
                        borderColor: "var(--border-subtle)",
                        color: "var(--text-primary)",
                      }}
                    >
                      <Pause className="h-3 w-3" aria-hidden="true" />
                      Pause
                    </button>
                  )}
                </div>
              ) : (
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {unmaskedCount > 0
                    ? `Mask ${unmaskedCount} unmasked span(s) to unlock cloud`
                    : currentResult.resolutionMode === "CLOUD_ESCALATION"
                      ? "Cloud analysis complete"
                      : "Only [REDACTED:...] tokens leave your device"}
                </span>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoCloudMode}
                  aria-label="Toggle Auto-Cloud mode"
                  onClick={onToggleAutoCloudMode}
                  className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: autoCloudMode ? "var(--safe-bg)" : "var(--bg-surface)",
                    borderColor: autoCloudMode ? "var(--safe-border)" : "var(--border-subtle)",
                    color: autoCloudMode ? "var(--safe-text)" : "var(--text-secondary)",
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: autoCloudMode ? "var(--safe-solid)" : "var(--text-muted)" }}
                  />
                  {autoCloudMode ? "Auto-Cloud" : "Pause at Airgap"}
                </button>

                <button
                  type="button"
                  disabled={!canEscalate}
                  onClick={() => {
                    onApproveOrRerunCloud();
                    setActiveTab("solution");
                  }}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
                  style={{
                    backgroundColor: "var(--accent-primary)",
                    color: "var(--accent-on-primary)",
                  }}
                >
                  <span>
                    {currentResult.resolutionMode === "CLOUD_ERROR"
                      ? "Retry Safe AI Solution"
                      : "Approve & Get Safe AI Solution →"}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
