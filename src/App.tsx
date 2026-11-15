import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RefreshCw, ShieldAlert, Terminal } from "lucide-react";
import { DEMO_SCENARIOS } from "./config/demoScenarios";
import { checkChromeNanoAvailability } from "./firewall/nanoExtractor";
import { escalateApprovedTicket, runTriagePipeline } from "./firewall/pipeline";
import { applyMaskedSpans } from "./firewall/spanMerger";
import {
  clearSanitizedTickets,
  listSanitizedTickets,
  saveSanitizedTicket,
} from "./storage/ticketStore";
import { RedactionDiff } from "./components/RedactionDiff";
import { TelemetryHud } from "./components/TelemetryHud";
import { TriageInbox } from "./components/TriageInbox";
import type { DemoScenario, HybridTelemetry, TriageResult } from "./types/triage";

export function App() {
  const [title, setTitle] = useState(DEMO_SCENARIOS[0].title);
  const [rawText, setRawText] = useState(DEMO_SCENARIOS[0].rawText);
  const [isRunning, setIsRunning] = useState(false);
  const [maskDirtySinceCloud, setMaskDirtySinceCloud] = useState(false);
  const [countdownMs, setCountdownMs] = useState<number | null>(null);
  const [countdownPaused, setCountdownPaused] = useState(false);
  const [currentResult, setCurrentResult] = useState<TriageResult | null>(null);
  const [history, setHistory] = useState<TriageResult[]>([]);
  const volatileSessionMap = useRef<Map<string, TriageResult>>(new Map());

  const [telemetry, setTelemetry] = useState<HybridTelemetry>({
    nanoStatus: "UNAVAILABLE",
    totalRuns: 0,
    localResolvedCount: 0,
    cloudEscalatedCount: 0,
    estimatedTokensSaved: 0,
    lastLatencyMs: 0,
    offlineMode: false,
    activeCloudModel: "gemini-3.5-flash-lite",
  });

  useEffect(() => {
    void (async () => {
      const avail = await checkChromeNanoAvailability();
      const nanoStatus =
        avail === "readily"
          ? "READY"
          : avail === "after-download"
            ? "MODEL_DOWNLOADING"
            : "UNAVAILABLE";
      const saved = await listSanitizedTickets();
      setHistory(saved);
      setTelemetry((prev) => ({ ...prev, nanoStatus }));
    })();
  }, []);

  const handleApproveOrRerunCloud = useCallback(async () => {
    if (!currentResult || isRunning) return;
    setCountdownMs(null);
    setCountdownPaused(false);
    setIsRunning(true);
    try {
      const escalated = await escalateApprovedTicket(currentResult, currentResult.spans);
      volatileSessionMap.current.set(escalated.id, escalated);
      setCurrentResult(escalated);
      setMaskDirtySinceCloud(false);
      await saveSanitizedTicket(escalated);
      const updatedHistory = await listSanitizedTickets();
      setHistory(updatedHistory);
      setTelemetry((prev) => ({
        ...prev,
        cloudEscalatedCount:
          prev.cloudEscalatedCount + (escalated.resolutionMode === "CLOUD_ESCALATION" ? 1 : 0),
        lastLatencyMs: escalated.latencyMs,
      }));
    } finally {
      setIsRunning(false);
    }
  }, [currentResult, isRunning]);

  // 3.0s cancelable pre-cloud countdown timer when Nano 4 is READY
  useEffect(() => {
    if (
      currentResult?.resolutionMode !== "PRE_CLOUD_COUNTDOWN" ||
      countdownMs === null ||
      countdownPaused
    ) {
      return;
    }
    if (countdownMs <= 0) {
      void handleApproveOrRerunCloud();
      return;
    }
    const timer = setTimeout(() => {
      setCountdownMs((prev) => (prev !== null ? Math.max(0, prev - 250) : null));
    }, 250);
    return () => clearTimeout(timer);
  }, [currentResult?.resolutionMode, countdownMs, countdownPaused, handleApproveOrRerunCloud]);

  const handleSelectScenario = (scenario: DemoScenario) => {
    setTitle(scenario.title);
    setRawText(scenario.rawText);
    setMaskDirtySinceCloud(false);
    setCountdownMs(null);
  };

  const handleRunTriage = async () => {
    if (!rawText.trim() || isRunning) return;
    setIsRunning(true);
    setMaskDirtySinceCloud(false);
    setCountdownMs(null);
    setCountdownPaused(false);
    try {
      const result = await runTriagePipeline({
        title: title.trim() || "Untitled Incident",
        rawText,
        offlineMode: telemetry.offlineMode,
      });

      volatileSessionMap.current.set(result.id, result);
      setCurrentResult(result);
      await saveSanitizedTicket(result);
      const updatedHistory = await listSanitizedTickets();
      setHistory(updatedHistory);

      if (result.resolutionMode === "PRE_CLOUD_COUNTDOWN") {
        setCountdownMs(3000);
      }

      setTelemetry((prev) => ({
        ...prev,
        nanoStatus: result.nanoStatus,
        totalRuns: prev.totalRuns + 1,
        localResolvedCount:
          prev.localResolvedCount + (result.resolutionMode === "LOCAL_RUNBOOK" ? 1 : 0),
        cloudEscalatedCount:
          prev.cloudEscalatedCount + (result.resolutionMode === "CLOUD_ESCALATION" ? 1 : 0),
        estimatedTokensSaved: prev.estimatedTokensSaved + result.estimatedTokensSaved,
        lastLatencyMs: result.latencyMs,
      }));
    } finally {
      setIsRunning(false);
    }
  };

  const handleToggleSpan = (index: number) => {
    if (!currentResult || currentResult.loadedFromZeroPiiStore) return;
    if (currentResult.resolutionMode === "PRE_CLOUD_COUNTDOWN") {
      setCountdownPaused(true);
    }
    const updatedSpans = currentResult.spans.map((s, idx) =>
      idx === index ? { ...s, masked: s.masked === false } : s,
    );
    const updatedSanitized = applyMaskedSpans(currentResult.rawText, updatedSpans);
    const updatedResult: TriageResult = {
      ...currentResult,
      spans: updatedSpans,
      sanitizedText: updatedSanitized,
    };
    volatileSessionMap.current.set(updatedResult.id, updatedResult);
    setCurrentResult(updatedResult);
    if (updatedResult.resolutionMode === "CLOUD_ESCALATION") {
      setMaskDirtySinceCloud(true);
    }
  };

  const handleSelectHistory = (item: TriageResult) => {
    const volatile = volatileSessionMap.current.get(item.id);
    const selected = volatile ?? item;
    setTitle(selected.title);
    if (!selected.loadedFromZeroPiiStore) {
      setRawText(selected.rawText);
    }
    setMaskDirtySinceCloud(false);
    setCountdownMs(null);
    setCurrentResult(selected);
  };

  const handleClearHistory = async () => {
    volatileSessionMap.current.clear();
    await clearSanitizedTickets();
    setHistory([]);
  };

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <TelemetryHud
          telemetry={telemetry}
          currentResult={currentResult}
          onToggleOffline={() =>
            setTelemetry((prev) => ({ ...prev, offlineMode: !prev.offlineMode }))
          }
        />

        <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <TriageInbox
            scenarios={DEMO_SCENARIOS}
            title={title}
            rawText={rawText}
            isRunning={isRunning}
            history={history}
            onTitleChange={setTitle}
            onRawTextChange={setRawText}
            onSelectScenario={handleSelectScenario}
            onRunTriage={handleRunTriage}
            onSelectHistory={handleSelectHistory}
            onClearHistory={handleClearHistory}
          />

          <main className="flex flex-col gap-5">
            <div
              onMouseEnter={() => {
                if (currentResult?.resolutionMode === "PRE_CLOUD_COUNTDOWN") {
                  setCountdownPaused(true);
                }
              }}
            >
              <RedactionDiff
                rawText={currentResult ? currentResult.rawText : rawText}
                sanitizedText={currentResult?.sanitizedText ?? ""}
                spans={currentResult?.spans ?? []}
                loadedFromZeroPiiStore={Boolean(currentResult?.loadedFromZeroPiiStore)}
                onToggleSpan={handleToggleSpan}
              />
            </div>

            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Terminal className="h-5 w-5 text-indigo-400" />
                  <h2 className="text-sm font-semibold tracking-wide text-slate-100 uppercase">
                    Triage Resolution & Routing
                  </h2>
                </div>
                {currentResult && (
                  <div className="flex flex-wrap gap-2 text-xs font-mono">
                    <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-indigo-200">
                      {currentResult.severity} · {currentResult.category}
                    </span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-emerald-300">
                      {currentResult.resolutionMode}
                    </span>
                  </div>
                )}
              </div>

              {currentResult?.resolutionMode === "PRE_CLOUD_COUNTDOWN" && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cyan-500/50 bg-cyan-950/40 p-3">
                  <div className="text-xs text-cyan-200">
                    {countdownPaused
                      ? "Pre-Cloud Review Gate PAUSED — edit redaction pills above, then escalate."
                      : `Auto-escalating sanitized payload to Cloud Gemini in ${((countdownMs ?? 0) / 1000).toFixed(1)}s...`}
                  </div>
                  <div className="flex items-center gap-2">
                    {!countdownPaused && (
                      <button
                        type="button"
                        onClick={() => setCountdownPaused(true)}
                        className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/50 px-2.5 py-1 text-xs font-semibold text-cyan-200 hover:bg-cyan-900/40"
                      >
                        <Pause className="h-3.5 w-3.5" />
                        <span>Pause to Edit Pills</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={isRunning}
                      onClick={() => void handleApproveOrRerunCloud()}
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
                    disabled={isRunning}
                    onClick={() => void handleApproveOrRerunCloud()}
                    className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 disabled:opacity-50"
                  >
                    Approve & Escalate Sanitized Payload to Cloud
                  </button>
                </div>
              )}

              {maskDirtySinceCloud &&
                currentResult?.resolutionMode === "CLOUD_ESCALATION" &&
                !telemetry.offlineMode && (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cyan-500/50 bg-cyan-950/40 p-3">
                    <span className="text-xs text-cyan-200">
                      Masking pills changed since the last Cloud response.
                    </span>
                    <button
                      type="button"
                      disabled={isRunning}
                      onClick={() => void handleApproveOrRerunCloud()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>Re-Run Cloud Analysis with Updated Mask</span>
                    </button>
                  </div>
                )}

              <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3.5 text-sm leading-relaxed text-slate-200 whitespace-pre-wrap">
                {currentResult
                  ? currentResult.resolution
                  : "Click 'Run Hybrid Triage' to run Stage 1 (Regex + Gemini Nano 4 ONLY_ON_DEVICE) and view the sanitized diff and resolution."}
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;
