import { useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Cloud,
  Cpu,
  Download,
  Plane,
  RefreshCw,
  Settings,
  Shield,
  Wifi,
} from "lucide-react";
import { getLastNanoDiagnostic } from "../firewall/nanoExtractor";
import type { HybridTelemetry, TriageResult } from "../types/triage";

interface TelemetryHudProps {
  telemetry: HybridTelemetry;
  currentResult: TriageResult | null;
  onToggleOffline: () => void;
  onOpenPolicyModal: () => void;
  onWarmupNano: () => void;
  onRecheckNano: () => void;
}

function formatStage2Label(result: TriageResult | null): string {
  if (!result) return "IDLE";
  switch (result.stage2Source) {
    case "SKIPPED_LOCAL_RUNBOOK":
      return "SKIPPED — 100% Local Runbook ($0)";
    case "IN_CLOUD":
      return `IN_CLOUD (${result.activeCloudModel ?? "Gemini Flash"} · ${result.stage2LatencyMs}ms)`;
    case "ON_DEVICE_FALLBACK":
      return `ON_DEVICE_FALLBACK (Nano 4 · ${result.stage2LatencyMs}ms)`;
    case "PENDING_PRE_CLOUD":
      return "PENDING (Pre-Cloud Review Gate)";
    case "HELD_QUARANTINE":
      return "HELD (Fail-Closed Quarantine)";
    case "OFFLINE_BLOCKED":
      return "BLOCKED (Offline Mode)";
    case "OFFLINE_QUEUED":
      return "QUEUED (Offline Reconnect Queue)";
    case "CLOUD_DISABLED":
      return "DISABLED (Remote Config)";
    case "CLOUD_ERROR":
      return "CLOUD_ERROR (Protected Locally)";
  }
}

function formatAppCheckLabel(provider: HybridTelemetry["appCheckProvider"]): string {
  switch (provider) {
    case "RECAPTCHA_V3":
      return "reCAPTCHA v3";
    case "RECAPTCHA_ENTERPRISE":
      return "reCAPTCHA Enterprise";
    case "UNCONFIGURED":
      return "Local / Unconfigured";
  }
}

export function TelemetryHud({
  telemetry,
  currentResult,
  onToggleOffline,
  onOpenPolicyModal,
  onWarmupNano,
  onRecheckNano,
}: TelemetryHudProps) {
  const [showNanoGuide, setShowNanoGuide] = useState(false);

  const localPercentLabel =
    telemetry.totalRuns > 0
      ? `${Math.round((telemetry.localResolvedCount / telemetry.totalRuns) * 100)}% (${telemetry.localResolvedCount}/${telemetry.totalRuns})`
      : "— (0 runs)";

  return (
    <header className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight text-white">LocalFirst Triage</h1>
            <span className="rounded-full border border-indigo-500/40 bg-indigo-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-indigo-300">
              v3.0 · #BuildHybridAI
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${
                telemetry.browserOnline
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-rose-500/40 bg-rose-500/15 text-rose-300"
              }`}
            >
              Network: {telemetry.browserOnline ? "ONLINE" : "OFFLINE"}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            Zero-leakage Hybrid AI Incident Copilot · Chrome Gemini Nano 4 + Firebase AI Logic
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenPolicyModal}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-indigo-500/60 hover:text-white"
          >
            <Settings className="h-3.5 w-3.5 text-indigo-400" />
            <span>Runbooks & Policy</span>
          </button>

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
      </div>

      {telemetry.nanoStatus === "READY" && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
          <span>
            Chrome Gemini Nano 4 is <strong>READY</strong> — Stage 1 Semantic Privacy Firewall and
            Hybrid Brief run on-device via <code className="font-mono">InferenceMode.ONLY_ON_DEVICE</code>.
          </span>
        </div>
      )}

      {(telemetry.nanoStatus === "DOWNLOADABLE" || telemetry.nanoStatus === "MODEL_DOWNLOADING") && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cyan-500/40 bg-cyan-950/40 px-3 py-2 text-xs text-cyan-200">
          <div className="flex-1">
            <p>
              Chrome Gemini Nano 4 is{" "}
              <strong>
                {telemetry.nanoStatus === "MODEL_DOWNLOADING" ? "DOWNLOADING" : "DOWNLOADABLE"}
              </strong>{" "}
              — Heuristic Guard + Fail-Closed Quarantine protect all tickets until weights finish
              initializing.
            </p>
            {telemetry.downloadProgress !== null && (
              <div className="mt-1.5 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-cyan-400 transition-all"
                  style={{ width: `${telemetry.downloadProgress}%` }}
                />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onWarmupNano}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-cyan-400"
          >
            <Download className="h-3.5 w-3.5" />
            <span>
              {telemetry.downloadProgress !== null
                ? `Downloading (${telemetry.downloadProgress}%)`
                : "Download & Warm Up Nano 4"}
            </span>
          </button>
        </div>
      )}

      {telemetry.nanoStatus === "UNAVAILABLE" && (
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {typeof navigator !== "undefined" && /Firefox|Safari/i.test(navigator.userAgent) && !/Chrome|Chromium|Edg/i.test(navigator.userAgent)
                ? "Non-Chrome browser detected (Built-in Gemini Nano 4 is a Chrome Desktop API) — "
                : "Nano 4 unavailable in this browser — "}
              Deterministic Regex + Shannon Entropy + Heuristic Guard active with Fail-Closed
              Quarantine before Cloud Escalation (
              <code className="font-mono">{telemetry.activeCloudModel}</code>).
              {getLastNanoDiagnostic() && (
                <span className="ml-2 inline-block rounded border border-amber-400/40 bg-amber-900/50 px-1.5 py-0.5 font-mono text-[10px] text-amber-100">
                  {getLastNanoDiagnostic()}
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onRecheckNano}
                className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-950/50 px-2 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-900/50"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Re-check Nano 4</span>
              </button>
              <button
                type="button"
                onClick={() => setShowNanoGuide((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-950/50 px-2 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-900/50"
              >
                <span>Enable Nano 4 Guide</span>
                {showNanoGuide ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </button>
            </div>
          </div>

          {showNanoGuide && (
            <div className="mt-2 border-t border-amber-500/30 pt-2 text-[11px] leading-relaxed text-amber-100">
              <p className="font-semibold">
                How to enable Chrome Built-in Gemini Nano 4 (per #BuildHybridAI FAQ):
              </p>
              <ol className="mt-1 list-inside list-decimal space-y-0.5 text-amber-200/90">
                <li>
                  Open <code className="font-mono">chrome://flags</code> in Chrome Desktop and search
                  for <strong>&quot;Gemma 4 for Built-in AI&quot;</strong> (also check{" "}
                  <code className="font-mono">#prompt-api-for-gemini-nano</code> and{" "}
                  <code className="font-mono">#optimization-guide-on-device-model</code>).
                </li>
                <li>Set the flag(s) to Enabled and relaunch Chrome.</li>
                <li>
                  Inspect model readiness at{" "}
                  <code className="font-mono">chrome://on-device-internals</code>, then click{" "}
                  <strong>Re-check Nano 4</strong> above.
                </li>
              </ol>
            </div>
          )}
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
              : `Nano: ${telemetry.nanoStatus}`}
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Cloud className="h-3.5 w-3.5 text-indigo-400" />
            <span>Stage 2 Routing</span>
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
            {localPercentLabel}
            {telemetry.queuedOfflineCount > 0 && ` · ${telemetry.queuedOfflineCount} queued`}
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Shield className="h-3.5 w-3.5 text-indigo-400" />
            <span>Tokens Saved & Security</span>
          </div>
          <p className="mt-1 font-mono text-xs font-semibold text-indigo-300">
            ~{telemetry.estimatedTokensSaved.toLocaleString()} tok ·{" "}
            {formatAppCheckLabel(telemetry.appCheckProvider)}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-slate-500">
            Model: {telemetry.activeCloudModel} ({telemetry.remoteConfigStatus})
          </p>
        </div>
      </div>
    </header>
  );
}
