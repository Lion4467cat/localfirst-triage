import { CheckCircle2, ShieldCheck, Sparkles, WifiOff } from "lucide-react";
import type { TriageResult } from "../types/triage";

interface PipelineStepperProps {
  currentResult: TriageResult | null;
  isRunning: boolean;
  offlineMode: boolean;
}

export function PipelineStepper({
  currentResult,
  isRunning,
  offlineMode,
}: PipelineStepperProps) {
  const unmaskedCount =
    currentResult?.spans.filter((s) => s.masked === false).length ?? 0;

  const step1Done = Boolean(currentResult);
  const step2Done = Boolean(currentResult) && unmaskedCount === 0;
  const step3Done =
    currentResult?.resolutionMode === "LOCAL_RUNBOOK" ||
    currentResult?.resolutionMode === "CLOUD_ESCALATION" ||
    currentResult?.resolutionMode === "LOCAL_FALLBACK_ONLY";

  const step2Detail = !currentResult
    ? "Detects & hides PII locally"
    : unmaskedCount > 0
      ? `${unmaskedCount} unmasked — review needed`
      : `${currentResult.spans.length} secret(s) hidden on-device`;

  const step3Detail = offlineMode
    ? "$0 Local / Offline Queue"
    : !currentResult
      ? "Safe fix via Runbook or Cloud AI"
      : currentResult.resolutionMode === "LOCAL_RUNBOOK"
        ? "Resolved 100% locally"
        : currentResult.resolutionMode === "CLOUD_ESCALATION"
          ? "Safe cloud remediation ready"
          : currentResult.resolutionMode === "OFFLINE_QUEUED"
            ? "Saved safely in Offline Queue"
            : currentResult.resolutionMode === "QUARANTINED_PENDING_APPROVAL"
              ? "Paused while secret is unmasked"
              : isRunning
                ? "Generating safe solution..."
                : "Ready for approval";

  const steps = [
    {
      num: "1",
      title: "Paste or Pick Example",
      detail: step1Done ? "Incident loaded locally" : "Start with logs or a starter card",
      done: step1Done,
      active: !currentResult && !isRunning,
      warn: false,
      Icon: CheckCircle2,
    },
    {
      num: "2",
      title: "Review Hidden Secrets",
      detail: step2Detail,
      done: step2Done,
      active: isRunning || (Boolean(currentResult) && unmaskedCount > 0),
      warn: Boolean(currentResult) && unmaskedCount > 0,
      Icon: ShieldCheck,
    },
    {
      num: "3",
      title: "Get Safe AI Solution",
      detail: step3Detail,
      done: step3Done,
      active:
        Boolean(currentResult) &&
        unmaskedCount === 0 &&
        !step3Done &&
        currentResult?.resolutionMode !== "OFFLINE_QUEUED",
      warn: false,
      Icon: offlineMode ? WifiOff : Sparkles,
    },
  ];

  return (
    <nav aria-label="Triage progress" className="lf-card rounded-2xl p-3 sm:p-4">
      <ol className="grid gap-2.5 sm:grid-cols-3">
        {steps.map((step) => {
          const Icon = step.Icon;
          let borderColor = "var(--border-subtle)";
          let bgColor = "var(--bg-subtle)";
          let badgeBg = "var(--bg-surface)";
          let badgeText = "var(--text-secondary)";

          if (step.warn) {
            borderColor = "var(--warn-border)";
            bgColor = "var(--warn-bg)";
            badgeBg = "var(--warn-bg)";
            badgeText = "var(--warn-text)";
          } else if (step.done) {
            borderColor = "var(--safe-border)";
            bgColor = "var(--safe-bg)";
            badgeBg = "var(--safe-solid)";
            badgeText = "#ffffff";
          } else if (step.active) {
            borderColor = "var(--accent-soft-border)";
            bgColor = "var(--accent-soft-bg)";
            badgeBg = "var(--accent-primary)";
            badgeText = "#ffffff";
          }

          return (
            <li
              key={step.num}
              className="flex items-start gap-3 rounded-xl border p-3 transition-colors"
              style={{
                borderColor,
                backgroundColor: bgColor,
              }}
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                style={{
                  backgroundColor: badgeBg,
                  color: badgeText,
                }}
              >
                {step.done ? <Icon className="h-4 w-4" aria-hidden="true" /> : step.num}
              </span>
              <div className="min-w-0">
                <p
                  className="text-sm font-semibold leading-tight"
                  style={{ color: "var(--text-primary)" }}
                >
                  {step.title}
                </p>
                <p
                  className="mt-0.5 text-xs leading-snug"
                  style={{ color: step.warn ? "var(--warn-text)" : "var(--text-secondary)" }}
                >
                  {step.detail}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
