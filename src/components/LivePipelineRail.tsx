import { useEffect, useRef } from "react";
import { animate, stagger } from "animejs";
import { CheckCircle2, Cloud, Cpu, Loader2, ShieldAlert, ShieldCheck, WifiOff } from "lucide-react";
import type { TriageResult } from "../types/triage";
import { createSafeScope } from "../utils/animeScope";

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
  const rootRef = useRef<HTMLDivElement>(null);
  const blockedCount =
    currentResult?.spans.filter((s) => s.masked !== false).length ?? 0;

  const stage1Active = isRunning && !currentResult;
  const stage1Done = Boolean(currentResult);
  const nanoUsed = currentResult?.stage1Source === "ON_DEVICE (Nano 4)";
  const stage2Active = Boolean(isRunning && currentResult);
  const stage3Done = Boolean(
    currentResult &&
      (currentResult.resolutionMode === "CLOUD_ESCALATION" ||
        currentResult.resolutionMode === "LOCAL_RUNBOOK"),
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const scope = createSafeScope(root, (reduced) => {
      if (reduced) return;
      animate(".clockwork-step", {
        opacity: [0.6, 1],
        translateY: [2, 0],
        duration: 280,
        delay: stagger(45),
        ease: "outQuad",
      });
    });

    return () => scope.revert();
  }, [currentResult?.id, isRunning]);

  const liveStatusText = stage1Active
    ? "Scanning locally on your device..."
    : stage2Active
      ? "Streaming safe fix from Cloud Gemini..."
      : !currentResult
        ? "Ready — paste a log or pick a preset"
        : currentResult.resolutionMode === "LOCAL_RUNBOOK"
          ? `${blockedCount} secrets kept local · Solved on-device ($0)`
          : currentResult.resolutionMode === "CLOUD_ESCALATION"
            ? `${blockedCount} secrets kept local · 0 leaked · Safe Cloud RCA`
            : currentResult.resolutionMode === "OFFLINE_QUEUED"
              ? `${blockedCount} secrets kept local · Airgap sealed ($0)`
              : `${blockedCount} secrets kept on your device · Safe to get AI help`;

  return (
    <div
      ref={rootRef}
      aria-label="Clockwork Execution Track"
      className="lf-card flex flex-col gap-1.5 rounded-xl px-3.5 py-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium tabular-nums">
          {/* 01 Local Rules */}
          <div
            className="clockwork-step inline-flex items-center gap-1.5 rounded-md border px-2 py-1"
            style={{
              backgroundColor: stage1Done || stage1Active ? "var(--safe-bg)" : "var(--bg-subtle)",
              borderColor: stage1Done || stage1Active ? "var(--safe-border)" : "var(--border-subtle)",
              color: stage1Done || stage1Active ? "var(--safe-text)" : "var(--text-secondary)",
            }}
          >
            {stage1Active ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            )}
            <span>01 Local Rules</span>
            {currentResult && (
              <span className="font-mono text-[10px] opacity-80">
                {currentResult.stage1LatencyMs}ms
              </span>
            )}
          </div>

          <span className="hidden text-xs sm:inline" style={{ color: "var(--text-muted)" }}>
            ─
          </span>

          {/* 02 Nano 4 GPU */}
          <div
            className="clockwork-step inline-flex items-center gap-1.5 rounded-md border px-2 py-1"
            style={{
              backgroundColor: nanoUsed ? "var(--nano-bg)" : "var(--bg-subtle)",
              borderColor: nanoUsed ? "var(--nano-border)" : "var(--border-subtle)",
              color: nanoUsed ? "var(--nano-text)" : "var(--text-secondary)",
            }}
          >
            <Cpu className="h-3 w-3" aria-hidden="true" />
            <span>02 Nano 4 GPU</span>
          </div>

          <span className="hidden text-xs sm:inline" style={{ color: "var(--text-muted)" }}>
            ─
          </span>

          {/* 03 Airgap Gate */}
          <div
            className="clockwork-step inline-flex items-center gap-1.5 rounded-md border px-2 py-1"
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
            <span>03 Airgap Gate ({stage1Done ? `${blockedCount} Blocked · 0 Leaked` : "0 Leaked"})</span>
          </div>

          <span className="hidden text-xs sm:inline" style={{ color: "var(--text-muted)" }}>
            ─
          </span>

          {/* 04 Safe AI */}
          <div
            className="clockwork-step inline-flex items-center gap-1.5 rounded-md border px-2 py-1"
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
            <span>04 {currentResult?.resolutionMode === "LOCAL_RUNBOOK" ? "$0 Local" : "Safe AI"}</span>
            {currentResult && currentResult.stage2LatencyMs > 0 && (
              <span className="font-mono text-[10px] opacity-80">
                {currentResult.stage2LatencyMs}ms
              </span>
            )}
          </div>
        </div>

        <span className="font-mono text-[11px] tabular-nums" style={{ color: "var(--text-secondary)" }}>
          {liveStatusText}
        </span>
      </div>

      <div className="lf-ruler-ticks h-1 w-full opacity-45" aria-hidden="true" />
    </div>
  );
}
