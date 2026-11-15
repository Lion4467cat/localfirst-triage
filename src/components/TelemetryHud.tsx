import { Activity, Cloud, Cpu, Plane, Wifi } from "lucide-react";
import type { HybridTelemetry, TriageResult } from "../types/triage";

interface TelemetryHudProps {
  telemetry: HybridTelemetry;
  currentResult: TriageResult | null;
  onToggleOffline: () => void;
}

function formatStage2Label(result: TriageResult | null): string {
  if (!result) return "IDLE";
  switch (result.stage2Source) {
    case "SKIPPED_LOCAL_RUNBOOK":
      return `SKIPPED — 100% Local Runbook ($0)`;
    case "IN_CLOUD":
      return `IN_CLOUD (Gemini Flash · ${result.stage2LatencyMs}ms)`;
    case "PENDING_PRE_CLOUD":
      return `PENDING (3.0s Review Gate)`;
    case "HELD_QUARANTINE":
      return `HELD (Fail-Closed Quarantine)`;
    case "OFFLINE_BLOCKED":
      return `BLOCKED (Offline Mode)`;
    case "CLOUD_DISABLED":
      return `DISABLED (Remote Config)`;
  }
}

export function TelemetryHud({
  telemetry,
  currentResult,
  onToggleOffline,
}: TelemetryHudProps) {
  const localPercent =
    telemetry.totalRuns > 0
      ? Math.round((telemetry.localResolvedCount / telemetry.totalRuns) * 100)
      : 100;

  return (
    <header className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-white">LocalFirst Triage</h1>
          <p className="text-xs text-slate-400">
            Zero-leakage Hybrid AI Incident Copilot · Chrome Gemini Nano 4 + Firebase AI Logic
          </p>
        </div>

        <button
          type="button"
          onClick={onToggleOffline}
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
            telemetry.offlineMode
              ? "border-amber-500/60 bg-amber-500/15 text-amber-200"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          }`}
        >
          {telemetry.offlineMode ? (
            <>
              <Plane className="h-4 w-4" />
              <span>Airplane / Offline Mode: ON</span>
            </>
          ) : (
            <>
              <Wifi className="h-4 w-4" />
              <span>Hybrid Cloud Allowed</span>
            </>
          )}
        </button>
      </div>

      {telemetry.nanoStatus === "MODEL_DOWNLOADING" && (
        <div className="mt-3 rounded-lg border border-cyan-500/40 bg-cyan-950/40 px-3 py-2 text-xs text-cyan-200">
          Chrome Gemini Nano 4 weights are downloading locally — Heuristic Guard + Fail-Closed
          Quarantine active until Nano 4 is ready.
        </div>
      )}

      {telemetry.nanoStatus === "UNAVAILABLE" && (
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          Nano 4 unavailable in this browser — Deterministic Regex + Heuristic Guard active with
          Fail-Closed Quarantine before Cloud Fallback (`{telemetry.activeCloudModel}`).
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Cpu className="h-3.5 w-3.5 text-cyan-400" />
            <span>Stage 1 Firewall</span>
          </div>
          <p className="mt-1 font-mono text-xs font-semibold text-cyan-200">
            {currentResult
              ? `${currentResult.stage1Source} · ${currentResult.stage1LatencyMs}ms`
              : "IDLE"}
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Cloud className="h-3.5 w-3.5 text-indigo-400" />
            <span>Stage 2 Escalation</span>
          </div>
          <p className="mt-1 font-mono text-xs font-semibold text-indigo-200">
            {formatStage2Label(currentResult)}
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Activity className="h-3.5 w-3.5 text-emerald-400" />
            <span>Resolved On-Device</span>
          </div>
          <p className="mt-1 font-mono text-xs font-semibold text-emerald-300">
            {localPercent}% ({telemetry.localResolvedCount}/{telemetry.totalRuns})
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
          <p className="text-[11px] text-slate-400">Cloud Tokens Saved</p>
          <p className="mt-1 font-mono text-xs font-semibold text-indigo-300">
            ~{telemetry.estimatedTokensSaved.toLocaleString()} tokens
          </p>
        </div>
      </div>
    </header>
  );
}
