import { CheckCircle2, Cloud, Cpu, Loader2, ShieldAlert, ShieldCheck, WifiOff } from "lucide-react";
import type { TriageResult } from "../types/triage";

interface LivePipelineRailProps {
  currentResult: TriageResult | null;
  isRunning: boolean;
  offlineMode: boolean;
}

export function LivePipelineRail({
  currentResult,
  isRunning,
  offlineMode,
}: LivePipelineRailProps) {
  const blockedCount =
    currentResult?.spans.filter((s) => s.masked !== false).length ?? 0;

  const stage1Active = isRunning && !currentResult;
  const stage1Done = Boolean(currentResult);

  const stage2Active = Boolean(isRunning && currentResult);

  const stage3Done = Boolean(
    currentResult &&
      (currentResult.resolutionMode === "CLOUD_ESCALATION" ||
        currentResult.resolutionMode === "LOCAL_RUNBOOK"),
  );

  const liveStatusText = stage1Active
    ? "Scanning locally on your device (Regex + Entropy + Nano 4)..."
    : stage2Active
      ? "Streaming safe fix from Cloud Gemini..."
      : !currentResult
        ? "Ready — paste a log or pick a starter preset to run Stage 1."
        : currentResult.resolutionMode === "LOCAL_RUNBOOK"
          ? `Blocked ${blockedCount} secrets · Resolved locally ($0 cloud)`
          : currentResult.resolutionMode === "CLOUD_ESCALATION"
            ? `Blocked ${blockedCount} secrets · 0 leaked · Safe Cloud RCA complete`
            : currentResult.resolutionMode === "OFFLINE_QUEUED"
              ? `Blocked ${blockedCount} secrets · Airgap sealed ($0 local)`
              : `Blocked ${blockedCount} secrets · 0 leaked · Ready for safe cloud approval`;

  return (
    <div
      aria-label="Live Hybrid Pipeline Rail"
      className="lf-card flex flex-wrap items-center justify-between gap-2 rounded-xl px-3.5 py-2"
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium">
        {/* Node 1 */}
        <div
          className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1"
          style={{
            backgroundColor: stage1Done || stage1Active ? "var(--safe-bg)" : "var(--bg-subtle)",
            borderColor: stage1Done || stage1Active ? "var(--safe-border)" : "var(--border-subtle)",
            color: stage1Done || stage1Active ? "var(--safe-text)" : "var(--text-secondary)",
          }}
        >
          {stage1Active ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : (
            <Cpu className="h-3 w-3" aria-hidden="true" />
          )}
          <span>1. Local Firewall (Regex + Nano 4)</span>
        </div>

        {/* Connector 1 -> 2 */}
        <div
          className="relative hidden h-0.5 w-8 overflow-hidden rounded-full sm:block"
          style={{ backgroundColor: "var(--border-subtle)" }}
          aria-hidden="true"
        >
          {(stage1Active || stage1Done) && (
            <div
              className={stage1Active ? "animate-pipeline-beam h-full w-1/2 rounded-full" : "h-full w-full"}
              style={{ backgroundColor: "var(--safe-solid)" }}
            />
          )}
        </div>

        {/* Node 2 */}
        <div
          className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 tabular-nums"
          style={{
            backgroundColor: offlineMode
              ? "var(--warn-bg)"
              : stage1Done
                ? "var(--safe-bg)"
                : "var(--bg-subtle)",
            borderColor: offlineMode
              ? "var(--warn-border)"
              : stage1Done
                ? "var(--safe-border)"
                : "var(--border-subtle)",
            color: offlineMode
              ? "var(--warn-text)"
              : stage1Done
                ? "var(--safe-text)"
                : "var(--text-secondary)",
          }}
        >
          {offlineMode ? (
            <WifiOff className="h-3 w-3" aria-hidden="true" />
          ) : stage1Done ? (
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ShieldAlert className="h-3 w-3" aria-hidden="true" />
          )}
          <span>2. Airgap Gate ({stage1Done ? `${blockedCount} Blocked · 0 Leaked` : "0 Leaked"})</span>
        </div>

        {/* Connector 2 -> 3 */}
        <div
          className="relative hidden h-0.5 w-8 overflow-hidden rounded-full sm:block"
          style={{ backgroundColor: "var(--border-subtle)" }}
          aria-hidden="true"
        >
          {(stage2Active || stage3Done) && (
            <div
              className={stage2Active ? "animate-pipeline-beam h-full w-1/2 rounded-full" : "h-full w-full"}
              style={{ backgroundColor: "var(--safe-solid)" }}
            />
          )}
        </div>

        {/* Node 3 */}
        <div
          className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1"
          style={{
            backgroundColor: stage3Done || stage2Active ? "var(--safe-bg)" : "var(--bg-subtle)",
            borderColor: stage3Done || stage2Active ? "var(--safe-border)" : "var(--border-subtle)",
            color: stage3Done || stage2Active ? "var(--safe-text)" : "var(--text-secondary)",
          }}
        >
          {stage2Active ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : stage3Done ? (
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
          ) : (
            <Cloud className="h-3 w-3" aria-hidden="true" />
          )}
          <span>
            3. {currentResult?.resolutionMode === "LOCAL_RUNBOOK" ? "$0 Local Runbook" : "Safe Cloud RCA"}
          </span>
        </div>
      </div>

      <span className="font-mono text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
        {liveStatusText}
      </span>
    </div>
  );
}
