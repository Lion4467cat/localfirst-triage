import { useCallback, useEffect, useRef, useState } from "react";
import { DEMO_SCENARIOS, DEFAULT_RUNBOOKS } from "./config/demoScenarios";
import {
  getAppCheckProviderStatus,
  loadRuntimeConfig,
  warmupOnDeviceModel,
} from "./config/firebase";
import { checkChromeNanoAvailability } from "./firewall/nanoExtractor";
import {
  escalateApprovedTicket,
  generateSanitizedHybridBrief,
  runTriagePipeline,
} from "./firewall/pipeline";
import { detectHighEntropySecrets, detectRegexSpans } from "./firewall/regexScrubber";
import { addManualSpan, applyMaskedSpans, mergeAndRedactSpans } from "./firewall/spanMerger";
import {
  clearSanitizedTickets,
  DEFAULT_PRIVACY_POLICY,
  listSanitizedTickets,
  loadCustomRunbooks,
  loadPrivacyPolicy,
  saveCustomRunbooks,
  savePrivacyPolicy,
  saveSanitizedTicket,
} from "./storage/ticketStore";
import { PipelineStepper } from "./components/PipelineStepper";
import { RedactionDiff } from "./components/RedactionDiff";
import { ResolutionPanel } from "./components/ResolutionPanel";
import { RunbookPolicyModal } from "./components/RunbookPolicyModal";
import { TelemetryHud } from "./components/TelemetryHud";
import { TriageInbox } from "./components/TriageInbox";
import type {
  CustomRunbook,
  DemoScenario,
  HybridTelemetry,
  NanoStatus,
  PrivacyPolicy,
  TriageResult,
} from "./types/triage";

function mapAvailabilityToStatus(avail: string): NanoStatus {
  if (avail === "readily") return "READY";
  if (avail === "downloadable") return "DOWNLOADABLE";
  if (avail === "downloading" || avail === "after-download") return "MODEL_DOWNLOADING";
  return "UNAVAILABLE";
}

const MAX_HANDOFF_ENCODED_CHARS = 65_536;
const MAX_HANDOFF_TEXT_CHARS = 50_000;
const MAX_HANDOFF_TITLE_CHARS = 200;

function stripUnsafeControlChars(input: string): string {
  // Strip ASCII control chars except \t (0x09), \n (0x0A), and \r (0x0D)
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export function decodeHandoffHash(hash: string): { title?: string; sanitizedText?: string } | null {
  if (!hash || !hash.includes("handoff=")) return null;
  try {
    const encoded = hash.split("handoff=")[1]?.split("&")[0] ?? "";
    if (
      !encoded ||
      encoded.length > MAX_HANDOFF_ENCODED_CHARS ||
      !/^[A-Za-z0-9\-_]+=*$/.test(encoded)
    ) {
      return null;
    }
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = JSON.parse(json) as { title?: unknown; sanitizedText?: unknown };
    if (typeof parsed.sanitizedText === "string" && parsed.sanitizedText.trim()) {
      const cleanBody = stripUnsafeControlChars(parsed.sanitizedText).slice(
        0,
        MAX_HANDOFF_TEXT_CHARS,
      );
      if (!cleanBody.trim()) return null;
      // Defensive re-scrub: ensure tampered #handoff= links cannot smuggle raw deterministic secrets
      const rescrubSpans = [
        ...detectRegexSpans(cleanBody),
        ...detectHighEntropySecrets(cleanBody),
      ];
      const { sanitizedText } = mergeAndRedactSpans(cleanBody, rescrubSpans);
      const rawTitle =
        typeof parsed.title === "string" && parsed.title.trim()
          ? stripUnsafeControlChars(parsed.title.trim()).slice(0, MAX_HANDOFF_TITLE_CHARS)
          : "Chrome Extension Capture";
      return {
        title: rawTitle || "Chrome Extension Capture",
        sanitizedText,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function prepareTicketForEscalation(ticket: TriageResult): TriageResult {
  return ticket.loadedFromZeroPiiStore
    ? { ...ticket, rawText: ticket.sanitizedText, spans: [] }
    : ticket;
}

export function App() {
  const [title, setTitle] = useState(DEMO_SCENARIOS[0].title);
  const [rawText, setRawText] = useState(DEMO_SCENARIOS[0].rawText);
  const [importedFromExtension, setImportedFromExtension] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isGeneratingBrief, setIsGeneratingBrief] = useState(false);
  const [maskDirtySinceCloud, setMaskDirtySinceCloud] = useState(false);
  const [countdownMs, setCountdownMs] = useState<number | null>(null);
  const [countdownPaused, setCountdownPaused] = useState(false);
  const [currentResult, setCurrentResult] = useState<TriageResult | null>(null);
  const [history, setHistory] = useState<TriageResult[]>([]);
  const [runbooks, setRunbooks] = useState<CustomRunbook[]>(DEFAULT_RUNBOOKS);
  const [policy, setPolicy] = useState<PrivacyPolicy>(DEFAULT_PRIVACY_POLICY);
  const [policyModalOpen, setPolicyModalOpen] = useState(false);

  const volatileSessionMap = useRef<Map<string, TriageResult>>(new Map());
  const escalatedTicketIds = useRef<Set<string>>(new Set());
  const inFlightRef = useRef(false);
  const runGenerationRef = useRef(0);

  const initialOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

  const [telemetry, setTelemetry] = useState<HybridTelemetry>({
    nanoStatus: "UNAVAILABLE",
    totalRuns: 0,
    localResolvedCount: 0,
    cloudEscalatedCount: 0,
    estimatedTokensSaved: 0,
    lastLatencyMs: 0,
    offlineMode: !initialOnline,
    browserOnline: initialOnline,
    activeCloudModel: "gemini-3.5-flash-lite",
    remoteConfigStatus: "DEFAULT_FALLBACK",
    appCheckProvider: getAppCheckProviderStatus(),
    downloadProgress: null,
    queuedOfflineCount: 0,
  });

  const refreshNanoStatus = useCallback(async () => {
    const avail = await checkChromeNanoAvailability();
    setTelemetry((prev) => ({
      ...prev,
      nanoStatus: mapAvailabilityToStatus(avail),
    }));
  }, []);

  useEffect(() => {
    void (async () => {
      const [avail, saved, loadedRunbooks, loadedPolicy, runtimeCfg] = await Promise.all([
        checkChromeNanoAvailability(),
        listSanitizedTickets(),
        loadCustomRunbooks(),
        loadPrivacyPolicy(),
        loadRuntimeConfig(),
      ]);

      setHistory(saved);
      setRunbooks(loadedRunbooks);
      setPolicy(loadedPolicy);

      setTelemetry((prev) => ({
        ...prev,
        nanoStatus: mapAvailabilityToStatus(avail),
        activeCloudModel: runtimeCfg.cloudModel,
        remoteConfigStatus: runtimeCfg.source ?? "DEFAULT_FALLBACK",
        appCheckProvider: getAppCheckProviderStatus(),
        queuedOfflineCount: saved.filter((t) => t.queuedForReconnect).length,
      }));
    })();

    if (typeof window !== "undefined") {
      const applyHandoffFromLocation = () => {
        const handoff = decodeHandoffHash(window.location.hash);
        if (handoff?.sanitizedText) {
          setTitle(handoff.title ?? "Chrome Extension Capture");
          setRawText(handoff.sanitizedText);
          setImportedFromExtension(true);
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        }
      };
      applyHandoffFromLocation();

      const handleOnline = () =>
        setTelemetry((prev) => ({ ...prev, browserOnline: true }));
      const handleOffline = () =>
        setTelemetry((prev) => ({ ...prev, browserOnline: false, offlineMode: true }));

      window.addEventListener("hashchange", applyHandoffFromLocation);
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
      return () => {
        window.removeEventListener("hashchange", applyHandoffFromLocation);
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    }
  }, []);

  const syncHistoryAndQueueCount = useCallback(async () => {
    const updatedHistory = await listSanitizedTickets();
    setHistory(updatedHistory);
    setTelemetry((prev) => ({
      ...prev,
      queuedOfflineCount: updatedHistory.filter((t) => t.queuedForReconnect).length,
    }));
  }, []);

  const handleApproveOrRerunCloud = useCallback(async () => {
    if (!currentResult || isRunning || inFlightRef.current) return;
    inFlightRef.current = true;
    const gen = ++runGenerationRef.current;
    const targetTicketId = currentResult.id;
    setCountdownMs(null);
    setCountdownPaused(false);
    setIsRunning(true);
    try {
      const safeTicket = prepareTicketForEscalation(currentResult);
      const escalated = await escalateApprovedTicket(safeTicket, safeTicket.spans, {
        offlineMode: telemetry.offlineMode,
        onStreamChunk: (partial) => {
          if (gen !== runGenerationRef.current) return;
          setCurrentResult((prev) =>
            prev && prev.id === targetTicketId ? { ...prev, resolution: partial } : prev,
          );
        },
      });
      if (gen !== runGenerationRef.current) return;
      volatileSessionMap.current.set(escalated.id, escalated);
      setCurrentResult(escalated);
      setMaskDirtySinceCloud(false);
      await saveSanitizedTicket(escalated);
      await syncHistoryAndQueueCount();

      const didSucceedCloud =
        escalated.resolutionMode === "CLOUD_ESCALATION" &&
        !escalatedTicketIds.current.has(escalated.id);
      if (didSucceedCloud) {
        escalatedTicketIds.current.add(escalated.id);
      }

      setTelemetry((prev) => ({
        ...prev,
        cloudEscalatedCount: prev.cloudEscalatedCount + (didSucceedCloud ? 1 : 0),
        lastLatencyMs: escalated.latencyMs,
        activeCloudModel: escalated.activeCloudModel ?? prev.activeCloudModel,
      }));
    } finally {
      if (gen === runGenerationRef.current) {
        inFlightRef.current = false;
        setIsRunning(false);
      }
    }
  }, [currentResult, isRunning, telemetry.offlineMode, syncHistoryAndQueueCount]);

  // 3.0s cancelable pre-cloud countdown timer when Nano 4 is READY
  useEffect(() => {
    if (
      currentResult?.resolutionMode !== "PRE_CLOUD_COUNTDOWN" ||
      countdownMs === null ||
      countdownPaused ||
      telemetry.offlineMode
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
  }, [
    currentResult?.resolutionMode,
    countdownMs,
    countdownPaused,
    telemetry.offlineMode,
    handleApproveOrRerunCloud,
  ]);

  const handleSelectScenario = (scenario: DemoScenario) => {
    runGenerationRef.current += 1;
    inFlightRef.current = false;
    setIsRunning(false);
    setTitle(scenario.title);
    setRawText(scenario.rawText);
    setImportedFromExtension(false);
    setMaskDirtySinceCloud(false);
    setCountdownMs(null);
    setCountdownPaused(false);
  };

  const handleRunTriage = async () => {
    if (!rawText.trim() || isRunning || inFlightRef.current) return;
    inFlightRef.current = true;
    const gen = ++runGenerationRef.current;
    setIsRunning(true);
    setMaskDirtySinceCloud(false);
    setCountdownMs(null);
    setCountdownPaused(false);
    try {
      const result = await runTriagePipeline({
        title: title.trim() || "Untitled Incident",
        rawText,
        offlineMode: telemetry.offlineMode,
        customRunbooks: runbooks,
        policy,
        importedFromExtension,
      });
      if (gen !== runGenerationRef.current) return;

      volatileSessionMap.current.set(result.id, result);
      setCurrentResult(result);
      await saveSanitizedTicket(result);
      await syncHistoryAndQueueCount();

      if (result.resolutionMode === "PRE_CLOUD_COUNTDOWN") {
        setCountdownMs((policy.autoCountdownSeconds ?? 3) * 1000);
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
      if (gen === runGenerationRef.current) {
        inFlightRef.current = false;
        setIsRunning(false);
      }
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

  const handleAddManualSpan = (start: number, end: number) => {
    if (!currentResult || currentResult.loadedFromZeroPiiStore) return;
    if (currentResult.resolutionMode === "PRE_CLOUD_COUNTDOWN") {
      setCountdownPaused(true);
    }
    const { sanitizedText, mergedSpans } = addManualSpan(
      currentResult.rawText,
      currentResult.spans,
      start,
      end,
    );
    const updatedResult: TriageResult = {
      ...currentResult,
      spans: mergedSpans,
      sanitizedText,
    };
    volatileSessionMap.current.set(updatedResult.id, updatedResult);
    setCurrentResult(updatedResult);
    if (updatedResult.resolutionMode === "CLOUD_ESCALATION") {
      setMaskDirtySinceCloud(true);
    }
  };

  const handleSelectHistory = (item: TriageResult) => {
    runGenerationRef.current += 1;
    inFlightRef.current = false;
    setIsRunning(false);
    const volatile = volatileSessionMap.current.get(item.id);
    const selected = volatile ?? item;
    setTitle(selected.title);
    // Security fix: never leave previous ticket's unredacted rawText sitting in the editor when opening a purged disk record
    setRawText(selected.loadedFromZeroPiiStore ? selected.sanitizedText : selected.rawText);
    setImportedFromExtension(Boolean(selected.importedFromExtension));
    setMaskDirtySinceCloud(false);
    setCountdownMs(null);
    setCountdownPaused(false);
    setCurrentResult(selected);
  };

  const handleClearHistory = async () => {
    runGenerationRef.current += 1;
    inFlightRef.current = false;
    setIsRunning(false);
    setCountdownMs(null);
    setCountdownPaused(false);
    volatileSessionMap.current.clear();
    escalatedTicketIds.current.clear();
    await clearSanitizedTickets();
    setHistory([]);
    setTelemetry((prev) => ({ ...prev, queuedOfflineCount: 0 }));
  };

  const handleWarmupNano = async () => {
    setTelemetry((prev) => ({
      ...prev,
      nanoStatus: "MODEL_DOWNLOADING",
      downloadProgress: 5,
    }));
    const res = await warmupOnDeviceModel((pct) => {
      setTelemetry((prev) => ({
        ...prev,
        nanoStatus: pct >= 100 ? "READY" : "MODEL_DOWNLOADING",
        downloadProgress: pct,
      }));
    });
    if (res.ok) {
      await refreshNanoStatus();
    } else {
      setTelemetry((prev) => ({ ...prev, downloadProgress: null }));
      await refreshNanoStatus();
    }
  };

  const handleGenerateHybridBrief = async () => {
    if (!currentResult || isGeneratingBrief) return;
    const targetId = currentResult.id;
    setIsGeneratingBrief(true);
    try {
      const brief = await generateSanitizedHybridBrief(currentResult, {
        offlineMode: telemetry.offlineMode,
      });
      setCurrentResult((prev) => {
        if (!prev || prev.id !== targetId) return prev;
        const updated = { ...prev, hybridBrief: brief };
        volatileSessionMap.current.set(updated.id, updated);
        void saveSanitizedTicket(updated);
        return updated;
      });
    } finally {
      setIsGeneratingBrief(false);
    }
  };

  const handleProcessOfflineQueue = async () => {
    if (telemetry.offlineMode || isRunning || inFlightRef.current) return;
    const queued = history.filter((t) => t.queuedForReconnect);
    if (queued.length === 0) return;

    inFlightRef.current = true;
    const gen = ++runGenerationRef.current;
    setIsRunning(true);
    try {
      for (const item of queued) {
        if (gen !== runGenerationRef.current) break;
        const sourceTicket = volatileSessionMap.current.get(item.id) ?? item;
        const safeTicket = prepareTicketForEscalation(sourceTicket);
        const escalated = await escalateApprovedTicket(safeTicket, safeTicket.spans, {
          offlineMode: false,
        });
        if (gen !== runGenerationRef.current) break;
        volatileSessionMap.current.set(escalated.id, escalated);
        await saveSanitizedTicket(escalated);
        if (escalated.resolutionMode === "CLOUD_ESCALATION") {
          setCurrentResult(escalated);
        }
      }
      if (gen === runGenerationRef.current) {
        await syncHistoryAndQueueCount();
      }
    } finally {
      if (gen === runGenerationRef.current) {
        inFlightRef.current = false;
        setIsRunning(false);
      }
    }
  };

  const queuedTickets = history.filter((t) => t.queuedForReconnect);

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <TelemetryHud
          telemetry={telemetry}
          currentResult={currentResult}
          onToggleOffline={() => {
            setTelemetry((prev) => {
              const nextOffline = !prev.offlineMode;
              if (nextOffline) {
                runGenerationRef.current += 1;
                inFlightRef.current = false;
                setIsRunning(false);
                setCountdownPaused(true);
              }
              return { ...prev, offlineMode: nextOffline };
            });
          }}
          onOpenPolicyModal={() => setPolicyModalOpen(true)}
          onWarmupNano={() => void handleWarmupNano()}
          onRecheckNano={() => void refreshNanoStatus()}
        />

        <PipelineStepper currentResult={currentResult} isRunning={isRunning} />

        <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <TriageInbox
            scenarios={DEMO_SCENARIOS}
            title={title}
            rawText={rawText}
            isRunning={isRunning}
            offlineMode={telemetry.offlineMode}
            history={history}
            queuedTickets={queuedTickets}
            importedFromExtension={importedFromExtension}
            onTitleChange={setTitle}
            onRawTextChange={setRawText}
            onSelectScenario={handleSelectScenario}
            onRunTriage={() => void handleRunTriage()}
            onSelectHistory={handleSelectHistory}
            onClearHistory={() => void handleClearHistory()}
            onProcessOfflineQueue={() => void handleProcessOfflineQueue()}
          />

          <main className="flex min-w-0 flex-col gap-5">
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
                onAddManualSpan={handleAddManualSpan}
              />
            </div>

            <ResolutionPanel
              currentResult={currentResult}
              isRunning={isRunning}
              isGeneratingBrief={isGeneratingBrief}
              offlineMode={telemetry.offlineMode}
              countdownMs={countdownMs}
              countdownPaused={countdownPaused}
              maskDirtySinceCloud={maskDirtySinceCloud}
              onPauseCountdown={() => setCountdownPaused(true)}
              onApproveOrRerunCloud={() => void handleApproveOrRerunCloud()}
              onGenerateHybridBrief={() => void handleGenerateHybridBrief()}
            />
          </main>
        </div>
      </div>

      <RunbookPolicyModal
        open={policyModalOpen}
        runbooks={runbooks}
        policy={policy}
        onClose={() => setPolicyModalOpen(false)}
        onSaveRunbooks={(updated) => {
          setRunbooks(updated);
          void saveCustomRunbooks(updated);
        }}
        onSavePolicy={(updated) => {
          setPolicy(updated);
          void savePrivacyPolicy(updated);
        }}
      />
    </div>
  );
}

export default App;
