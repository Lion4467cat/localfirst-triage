import { CheckCircle2, Clock, Cloud, Lock, ShieldCheck } from "lucide-react";
import type { TriageResult } from "../types/triage";

interface PipelineStepperProps {
  currentResult: TriageResult | null;
  isRunning: boolean;
}

export function PipelineStepper({ currentResult, isRunning }: PipelineStepperProps) {
  const step1Done = Boolean(currentResult);
  const step2Done = Boolean(currentResult);
  const step3State = !currentResult
    ? "idle"
    : currentResult.resolutionMode === "LOCAL_RUNBOOK" ||
        currentResult.resolutionMode === "CLOUD_ESCALATION"
      ? "done"
      : currentResult.resolutionMode === "CLOUD_ERROR"
        ? "error"
        : "pending";

  return (
    <nav
      aria-label="Hybrid Triage Pipeline Stages"
      className="grid grid-cols-1 gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3 sm:grid-cols-3"
    >
      <div
        className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs ${
          isRunning
            ? "border-cyan-500/50 bg-cyan-950/30 text-cyan-200"
            : step1Done
              ? "border-emerald-500/40 bg-emerald-950/20 text-emerald-200"
              : "border-slate-800 bg-slate-950/60 text-slate-400"
        }`}
      >
        <ShieldCheck className="h-4 w-4 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold">1. Local Firewall</p>
          <p className="truncate font-mono text-[10px] opacity-80">
            {currentResult
              ? `${currentResult.stage1Source} · ${currentResult.stage1LatencyMs}ms`
              : "ONLY_ON_DEVICE + Regex + Entropy"}
          </p>
        </div>
      </div>

      <div
        className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs ${
          step2Done
            ? "border-emerald-500/40 bg-emerald-950/20 text-emerald-200"
            : "border-slate-800 bg-slate-950/60 text-slate-400"
        }`}
      >
        <Lock className="h-4 w-4 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold">2. Diff &amp; Zero-Leakage Gate</p>
          <p className="truncate font-mono text-[10px] opacity-80">
            {currentResult
              ? `${currentResult.spans.filter((s) => s.masked !== false).length} active mask(s)`
              : "Inline Audit + Manual Selection"}
          </p>
        </div>
      </div>

      <div
        className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs ${
          step3State === "done"
            ? "border-emerald-500/40 bg-emerald-950/20 text-emerald-200"
            : step3State === "error"
              ? "border-rose-500/40 bg-rose-950/30 text-rose-200"
              : step3State === "pending"
                ? "border-amber-500/40 bg-amber-950/30 text-amber-200"
                : "border-slate-800 bg-slate-950/60 text-slate-400"
        }`}
      >
        {step3State === "done" ? (
          <CheckCircle2 className="h-4 w-4 shrink-0" />
        ) : step3State === "pending" ? (
          <Clock className="h-4 w-4 shrink-0" />
        ) : (
          <Cloud className="h-4 w-4 shrink-0" />
        )}
        <div className="min-w-0">
          <p className="font-semibold">3. Hybrid Resolution</p>
          <p className="truncate font-mono text-[10px] opacity-80">
            {currentResult
              ? currentResult.resolutionMode
              : "Local Runbook ($0) / PREFER_IN_CLOUD"}
          </p>
        </div>
      </div>
    </nav>
  );
}
