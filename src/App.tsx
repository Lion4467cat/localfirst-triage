import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { DEMO_SCENARIOS, DEFAULT_RUNBOOKS } from "./config/demoScenarios";
import {
  DEFAULT_RUNTIME_CONFIG,
  getAppCheckProviderStatus,
  loadRuntimeConfig,
  warmupOnDeviceModel,
  type RuntimeConfigValues,
} from "./config/firebase";
import { checkChromeNanoAvailability } from "./firewall/nanoExtractor";
import {
  addManualTicketMask,
  escalateApprovedTicket,
  generateSanitizedHybridBrief,
  prepareTicketForEscalation,
  recordCloudEscalationTelemetry,
  recordTriageRunTelemetry,
  runTriagePipeline,
  toggleTicketSpanMask,
} from "./firewall/pipeline";
import { decodeHandoffPayload } from "./firewall/regexScrubber";
import {
  clearWorkspaceTicketsInFirestore,
  signInOrLinkWithGoogle,
  signInWorkspaceAnonymously,
  signOutWorkspace,
  subscribeAuthState,
  subscribeWorkspaceSync,
  syncCustomRunbooksToFirestore,
  syncPolicyToFirestore,
  syncTicketToFirestore,
} from "./storage/cloudSync";
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
import { AirgapSpine } from "./components/AirgapSpine";
import { LivePipelineRail } from "./components/LivePipelineRail";
import { RightWorkbenchPane } from "./components/RightWorkbenchPane";
import { ScrollStoryAct } from "./components/ScrollStoryAct";
import { TelemetryHud, type WorkspaceView } from "./components/TelemetryHud";
import { TriageInbox } from "./components/TriageInbox";
import {
  HistoryWorkspaceView,
  PrivacyRulesWorkspaceView,
  RunbooksWorkspaceView,
} from "./components/WorkspaceViews";
import {
  applyThemePreference,
  getStoredThemePreference,
  resolveTheme,
  subscribeToSystemTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "./config/theme";
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

export function decodeHandoffHash(hash: string): { title?: string; sanitizedText?: string } | null {
  return decodeHandoffPayload(hash);
}

export { prepareTicketForEscalation };

export function App() {
  const [title, setTitle] = useState(DEMO_SCENARIOS[0].title);
  const [rawText, setRawText] = useState(DEMO_SCENARIOS[0].rawText);
  const [importedFromExtension, setImportedFromExtension] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isGeneratingBrief, setIsGeneratingBrief] = useState(false);
  const [isRefreshingPolicy, setIsRefreshingPolicy] = useState(false);
  const [maskDirtySinceCloud, setMaskDirtySinceCloud] = useState(false);
  const [countdownMs, setCountdownMs] = useState<number | null>(null);
  const [countdownPaused, setCountdownPaused] = useState(false);
  const [currentResult, setCurrentResult] = useState<TriageResult | null>(null);
  const [history, setHistory] = useState<TriageResult[]>([]);
  const [runbooks, setRunbooks] = useState<CustomRunbook[]>(DEFAULT_RUNBOOKS);
  const [policy, setPolicy] = useState<PrivacyPolicy>(DEFAULT_PRIVACY_POLICY);
  const [runtimeConfig, setRuntimeConfig] =
    useState<RuntimeConfigValues>(DEFAULT_RUNTIME_CONFIG);
  const [activeView, setActiveView] = useState<WorkspaceView>("triage");
  const [mobilePane, setMobilePane] = useState<"input" | "output">("input");
  const [autoCloudMode, setAutoCloudMode] = useState(false);
  const workbenchRef = useRef<HTMLDivElement>(null);

  const jumpToStory = () => {
    requestAnimationFrame(() => {
      document.getElementById("story-top")?.scrollIntoView({ behavior: "smooth" });
    });
  };

  const jumpToWorkbench = () => {
    requestAnimationFrame(() => {
      workbenchRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  };
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    getStoredThemePreference()
  );
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(getStoredThemePreference())
  );

  useEffect(() => {
    setResolvedTheme(applyThemePreference(themePreference, true));
  }, [themePreference]);

  useEffect(() => {
    if (themePreference !== "system") return;
    return subscribeToSystemTheme(() => {
      setResolvedTheme(applyThemePreference("system", false));
    });
  }, [themePreference]);

  const volatileSessionMap = useRef<Map<string, TriageResult>>(new Map());
  const escalatedTicketIds = useRef<Set<string>>(new Set());
  const inFlightRef = useRef(false);
  const runGenerationRef = useRef(0);
  const policyCreatedAtRef = useRef<number>(Date.now());
  const runbookCreatedAtRef = useRef<Map<string, number>>(new Map());
  const customRunbookIdsRef = useRef<Set<string>>(new Set());

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
    activeCloudModel: DEFAULT_RUNTIME_CONFIG.cloudModel,
    remoteConfigStatus: "DEFAULT_FALLBACK",
    appCheckProvider: getAppCheckProviderStatus(),
    downloadProgress: null,
    queuedOfflineCount: 0,
    entropyThreshold: DEFAULT_RUNTIME_CONFIG.entropyThreshold ?? 3.25,
    enterpriseBlockedTermsCount: DEFAULT_RUNTIME_CONFIG.enterpriseBlockedTerms?.length ?? 0,
    cloudSyncStatus: "DISCONNECTED",
    authUser: null,
    cloudSyncError: null,
  });

  const authUidRef = useRef<string | null>(null);
  authUidRef.current = telemetry.authUser?.uid ?? null;
  const offlineModeRef = useRef(telemetry.offlineMode);
  offlineModeRef.current = telemetry.offlineMode;

  const refreshNanoStatus = useCallback(async () => {
    const avail = await checkChromeNanoAvailability();
    setTelemetry((prev) => ({
      ...prev,
      nanoStatus: mapAvailabilityToStatus(avail),
    }));
  }, []);

  const syncTicketIfSignedIn = useCallback(async (ticket: TriageResult) => {
    const uid = authUidRef.current;
    if (!uid || offlineModeRef.current) return;
    const res = await syncTicketToFirestore(uid, ticket);
    if (!res.ok) {
      setTelemetry((prev) => ({
        ...prev,
        cloudSyncStatus: "ERROR",
        cloudSyncError: res.reason ?? "Firestore write blocked",
      }));
    } else {
      setTelemetry((prev) => ({
        ...prev,
        cloudSyncStatus: "SYNCED",
        cloudSyncError: null,
      }));
    }
  }, []);

  const handleRefreshRemoteConfig = useCallback(async () => {
    setIsRefreshingPolicy(true);
    try {
      const cfg = await loadRuntimeConfig(3500, true);
      setRuntimeConfig(cfg);
      setTelemetry((prev) => ({
        ...prev,
        activeCloudModel: cfg.cloudModel,
        remoteConfigStatus: cfg.source ?? "DEFAULT_FALLBACK",
        entropyThreshold: cfg.entropyThreshold ?? DEFAULT_RUNTIME_CONFIG.entropyThreshold ?? 3.25,
        enterpriseBlockedTermsCount:
          cfg.enterpriseBlockedTerms?.length ??
          DEFAULT_RUNTIME_CONFIG.enterpriseBlockedTerms?.length ??
          0,
      }));
    } finally {
      setIsRefreshingPolicy(false);
    }
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
      setRuntimeConfig(runtimeCfg);
      for (const rb of loadedRunbooks) {
        if (!rb.builtIn) customRunbookIdsRef.current.add(rb.id);
      }

      setTelemetry((prev) => ({
        ...prev,
        nanoStatus: mapAvailabilityToStatus(avail),
        activeCloudModel: runtimeCfg.cloudModel,
        remoteConfigStatus: runtimeCfg.source ?? "DEFAULT_FALLBACK",
        entropyThreshold:
          runtimeCfg.entropyThreshold ?? DEFAULT_RUNTIME_CONFIG.entropyThreshold ?? 3.25,
        enterpriseBlockedTermsCount:
          runtimeCfg.enterpriseBlockedTerms?.length ??
          DEFAULT_RUNTIME_CONFIG.enterpriseBlockedTerms?.length ??
          0,
        appCheckProvider: getAppCheckProviderStatus(),
        queuedOfflineCount: saved.filter((t) => t.queuedForReconnect).length,
      }));
    })();

    const unsubAuth = subscribeAuthState(
      (user) => {
        setTelemetry((prev) => ({
          ...prev,
          authUser: user,
          cloudSyncStatus: !user
            ? "DISCONNECTED"
            : prev.offlineMode
              ? "OFFLINE"
              : "SYNCED",
          cloudSyncError: null,
        }));
      },
      (err) => {
        setTelemetry((prev) => ({
          ...prev,
          cloudSyncStatus: "ERROR",
          cloudSyncError: err,
        }));
      },
    );

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
        unsubAuth();
        window.removeEventListener("hashchange", applyHandoffFromLocation);
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    }

    return () => {
      unsubAuth();
    };
  }, []);

  useEffect(() => {
    const uid = telemetry.authUser?.uid;
    if (!uid) {
      return;
    }
    if (telemetry.offlineMode) {
      setTelemetry((prev) => ({ ...prev, cloudSyncStatus: "OFFLINE" }));
      return;
    }

    const unsubSync = subscribeWorkspaceSync(uid, {
      onTickets: (remoteTickets) => {
        void (async () => {
          for (const rt of remoteTickets) {
            await saveSanitizedTicket(rt);
          }
          const localList = await listSanitizedTickets();
          const mergedMap = new Map<string, TriageResult>();
          for (const lt of localList) {
            mergedMap.set(lt.id, lt);
          }
          for (const rt of remoteTickets) {
            const existing = mergedMap.get(rt.id);
            if (!existing || (rt.updatedAt ?? rt.createdAt) >= (existing.updatedAt ?? existing.createdAt)) {
              mergedMap.set(rt.id, rt);
            }
          }
          const merged = Array.from(mergedMap.values())
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 50);
          setHistory(merged);
          setTelemetry((prev) => ({
            ...prev,
            cloudSyncStatus: "SYNCED",
            cloudSyncError: null,
            queuedOfflineCount: merged.filter((t) => t.queuedForReconnect).length,
          }));
        })();
      },
      onPolicy: (remotePolicy, createdAt) => {
        policyCreatedAtRef.current = createdAt;
        setPolicy(remotePolicy);
        void savePrivacyPolicy(remotePolicy);
      },
      onRunbooks: (remoteCustomRunbooks, createdAtMap) => {
        runbookCreatedAtRef.current = createdAtMap;
        customRunbookIdsRef.current = new Set(remoteCustomRunbooks.map((r) => r.id));
        const customIds = new Set(remoteCustomRunbooks.map((r) => r.id));
        const merged = [
          ...remoteCustomRunbooks,
          ...DEFAULT_RUNBOOKS.filter((r) => !customIds.has(r.id)),
        ];
        setRunbooks(merged);
        void saveCustomRunbooks(merged);
      },
      onError: (message) => {
        setTelemetry((prev) => ({
          ...prev,
          cloudSyncStatus: "ERROR",
          cloudSyncError: message,
        }));
      },
    });

    return () => {
      unsubSync();
    };
  }, [telemetry.authUser?.uid, telemetry.offlineMode]);

  const syncHistoryAndQueueCount = useCallback(async () => {
    const updatedHistory = await listSanitizedTickets();
    setHistory(updatedHistory);
    setTelemetry((prev) => ({
      ...prev,
      queuedOfflineCount: updatedHistory.filter((t) => t.queuedForReconnect).length,
    }));
  }, []);

  const handleSignInAnonymous = async () => {
    if (telemetry.offlineMode) return;
    setTelemetry((prev) => ({ ...prev, cloudSyncStatus: "SIGNING_IN", cloudSyncError: null }));
    const res = await signInWorkspaceAnonymously();
    if (!res.ok) {
      setTelemetry((prev) => ({
        ...prev,
        cloudSyncStatus: "ERROR",
        cloudSyncError: res.error ?? "Anonymous sign-in failed",
      }));
      return;
    }
    if (res.user) {
      for (const item of history.slice(0, 20)) {
        await syncTicketToFirestore(res.user.uid, item);
      }
      setTelemetry((prev) => ({
        ...prev,
        authUser: res.user ?? prev.authUser,
        cloudSyncStatus: "SYNCED",
        cloudSyncError: null,
      }));
    }
  };

  const handleSignInGoogle = async () => {
    if (telemetry.offlineMode) return;
    setTelemetry((prev) => ({ ...prev, cloudSyncStatus: "SIGNING_IN", cloudSyncError: null }));
    const res = await signInOrLinkWithGoogle();
    if (!res.ok) {
      setTelemetry((prev) => ({
        ...prev,
        cloudSyncStatus: prev.authUser ? "SYNCED" : "DISCONNECTED",
        cloudSyncError: res.error ?? "Google sign-in failed",
      }));
      return;
    }
    if (res.user) {
      setTelemetry((prev) => ({
        ...prev,
        authUser: res.user ?? prev.authUser,
        cloudSyncStatus: "SYNCED",
        cloudSyncError: null,
      }));
    }
  };

  const handleSignOut = async () => {
    const res = await signOutWorkspace();
    setTelemetry((prev) => ({
      ...prev,
      authUser: null,
      cloudSyncStatus: "DISCONNECTED",
      cloudSyncError: res.ok ? null : (res.error ?? "Sign out failed"),
    }));
  };

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
      void syncTicketIfSignedIn(escalated);

      setTelemetry((prev) =>
        recordCloudEscalationTelemetry(prev, escalated, escalatedTicketIds.current),
      );
    } finally {
      if (gen === runGenerationRef.current) {
        inFlightRef.current = false;
        setIsRunning(false);
      }
    }
  }, [currentResult, isRunning, telemetry.offlineMode, syncHistoryAndQueueCount, syncTicketIfSignedIn]);

  // Auto-Cloud choreography: brief 700ms beat at Airgap Gate, then escalate automatically
  useEffect(() => {
    if (
      !autoCloudMode ||
      telemetry.offlineMode ||
      isRunning ||
      (currentResult?.resolutionMode !== "QUARANTINED_PENDING_APPROVAL" &&
        currentResult?.resolutionMode !== "PRE_CLOUD_COUNTDOWN")
    ) {
      return;
    }
    const timer = setTimeout(() => {
      void handleApproveOrRerunCloud();
    }, 700);
    return () => clearTimeout(timer);
  }, [
    autoCloudMode,
    telemetry.offlineMode,
    isRunning,
    currentResult?.id,
    currentResult?.resolutionMode,
    handleApproveOrRerunCloud,
  ]);

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
    setCurrentResult(null);
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
        runtimeConfig,
        importedFromExtension,
        sourcePlatform: importedFromExtension ? "CHROME_EXTENSION" : "WEB",
      });
      if (gen !== runGenerationRef.current) return;

      volatileSessionMap.current.set(result.id, result);
      setCurrentResult(result);
      await saveSanitizedTicket(result);
      await syncHistoryAndQueueCount();
      void syncTicketIfSignedIn(result);

      if (result.resolutionMode === "PRE_CLOUD_COUNTDOWN") {
        setCountdownMs((policy.autoCountdownSeconds ?? 3) * 1000);
      }

      setTelemetry((prev) => recordTriageRunTelemetry(prev, result));
    } finally {
      if (gen === runGenerationRef.current) {
        inFlightRef.current = false;
        setIsRunning(false);
      }
    }
  };

  const handleToggleSpan = (index: number) => {
    if (!currentResult) return;
    const { ticket: updatedResult, shouldPauseCountdown, maskDirtySinceCloud: dirty } =
      toggleTicketSpanMask(currentResult, index);
    if (updatedResult === currentResult) return;
    if (shouldPauseCountdown) {
      setCountdownPaused(true);
    }
    volatileSessionMap.current.set(updatedResult.id, updatedResult);
    setCurrentResult(updatedResult);
    if (dirty) {
      setMaskDirtySinceCloud(true);
    }
  };

  const handleAddManualSpan = (start: number, end: number) => {
    if (!currentResult) return;
    const { ticket: updatedResult, shouldPauseCountdown, maskDirtySinceCloud: dirty } =
      addManualTicketMask(currentResult, start, end);
    if (updatedResult === currentResult) return;
    if (shouldPauseCountdown) {
      setCountdownPaused(true);
    }
    volatileSessionMap.current.set(updatedResult.id, updatedResult);
    setCurrentResult(updatedResult);
    if (dirty) {
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
    setImportedFromExtension(
      Boolean(selected.importedFromExtension || selected.sourcePlatform === "CHROME_EXTENSION"),
    );
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
    const idsToDelete = history.map((h) => h.id);
    volatileSessionMap.current.clear();
    escalatedTicketIds.current.clear();
    await clearSanitizedTickets();
    if (authUidRef.current && !offlineModeRef.current && idsToDelete.length > 0) {
      void clearWorkspaceTicketsInFirestore(authUidRef.current, idsToDelete);
    }
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
        void syncTicketIfSignedIn(escalated);
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
  const rulesCount = policy.customTerms.length + (policy.enableEntropyScanner ? 1 : 0);

  const handleSaveRunbooks = (updated: CustomRunbook[]) => {
    setRunbooks(updated);
    void saveCustomRunbooks(updated);
    if (authUidRef.current && !offlineModeRef.current) {
      void syncCustomRunbooksToFirestore(
        authUidRef.current,
        updated,
        customRunbookIdsRef.current,
        runbookCreatedAtRef.current
      );
    }
  };

  const handleSavePolicy = (updated: PrivacyPolicy) => {
    setPolicy(updated);
    void savePrivacyPolicy(updated);
    if (authUidRef.current && !offlineModeRef.current) {
      void syncPolicyToFirestore(
        authUidRef.current,
        updated,
        policyCreatedAtRef.current
      );
    }
  };

  return (
    <MotionConfig reducedMotion="user">
    <div
      className="lf-dot-grid flex min-h-screen flex-col"
      style={{
        backgroundColor: "var(--bg-canvas)",
        color: "var(--text-primary)",
      }}
    >
      <TelemetryHud
        activeView={activeView}
        onChangeView={setActiveView}
        onJumpToStory={jumpToStory}
        onJumpToWorkbench={jumpToWorkbench}
        historyCount={history.length}
        rulesCount={rulesCount}
        runbooksCount={runbooks.length}
        themePreference={themePreference}
        resolvedTheme={resolvedTheme}
        onChangeTheme={setThemePreference}
        telemetry={telemetry}
        onToggleOffline={() => {
          setTelemetry((prev) => {
            const nextOffline = !prev.offlineMode;
            if (nextOffline) {
              runGenerationRef.current += 1;
              inFlightRef.current = false;
              setIsRunning(false);
              setCountdownPaused(true);
            }
            return {
              ...prev,
              offlineMode: nextOffline,
              cloudSyncStatus: prev.authUser
                ? nextOffline
                  ? "OFFLINE"
                  : "SYNCED"
                : "DISCONNECTED",
            };
          });
        }}
        onWarmupNano={() => void handleWarmupNano()}
        onSignInAnonymous={() => void handleSignInAnonymous()}
        onSignInGoogle={() => void handleSignInGoogle()}
        onSignOut={() => void handleSignOut()}
      />

      {activeView === "triage" && (
        <>
          {/* ACT 1: Sticky Scroll-Driven Story */}
          <ScrollStoryAct onJumpToWorkbench={jumpToWorkbench} />

          {/* ACT 2: Live 100dvh Airgap Workbench */}
          <main
            id="workbench-act"
            ref={workbenchRef}
            className="mx-auto flex w-full max-w-[1680px] flex-col gap-3 p-3 scroll-mt-12 lg:h-[calc(100dvh-48px)] lg:min-h-[620px] lg:overflow-hidden lg:p-4"
          >
            <LivePipelineRail
              currentResult={currentResult}
              isRunning={isRunning}
              offlineMode={telemetry.offlineMode}
            />

            {/* Mobile Input / Safe Output Switcher */}
          <div
            role="tablist"
            aria-label="Mobile workbench panes"
            className="grid grid-cols-2 rounded-lg border p-0.5 lg:hidden"
            style={{
              backgroundColor: "var(--bg-subtle)",
              borderColor: "var(--border-subtle)",
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={mobilePane === "input"}
              onClick={() => setMobilePane("input")}
              className="rounded-md py-1.5 text-xs font-medium"
              style={{
                backgroundColor: mobilePane === "input" ? "var(--bg-surface)" : "transparent",
                color: mobilePane === "input" ? "var(--text-primary)" : "var(--text-secondary)",
              }}
            >
              Input
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mobilePane === "output"}
              onClick={() => setMobilePane("output")}
              className="rounded-md py-1.5 text-xs font-medium"
              style={{
                backgroundColor: mobilePane === "output" ? "var(--bg-surface)" : "transparent",
                color: mobilePane === "output" ? "var(--text-primary)" : "var(--text-secondary)",
              }}
            >
              Safe Output
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,44fr)_76px_minmax(0,52fr)] lg:gap-0">
            <div className={`${mobilePane === "input" ? "flex" : "hidden"} min-h-0 flex-col lg:flex`}>
              <TriageInbox
                scenarios={DEMO_SCENARIOS}
                title={title}
                rawText={rawText}
                isRunning={isRunning}
                offlineMode={telemetry.offlineMode}
                queuedTickets={queuedTickets}
                importedFromExtension={importedFromExtension}
                onTitleChange={(nextTitle) => {
                  setTitle(nextTitle);
                  if (currentResult?.resolutionMode === "CLOUD_ESCALATION") {
                    setCurrentResult(null);
                  }
                }}
                onRawTextChange={(nextRaw) => {
                  setRawText(nextRaw);
                  if (currentResult) {
                    setCurrentResult(null);
                    setMaskDirtySinceCloud(false);
                    setCountdownMs(null);
                    setCountdownPaused(false);
                  }
                }}
                onSelectScenario={handleSelectScenario}
                onRunTriage={() => {
                  setMobilePane("output");
                  void handleRunTriage();
                }}
                onProcessOfflineQueue={() => void handleProcessOfflineQueue()}
              />
            </div>

            <AirgapSpine
              currentResult={currentResult}
              isRunning={isRunning}
              offlineMode={telemetry.offlineMode}
            />

            <div
              className={`${mobilePane === "output" ? "flex" : "hidden"} min-h-0 flex-col lg:flex`}
              onMouseEnter={() => {
                if (currentResult?.resolutionMode === "PRE_CLOUD_COUNTDOWN") {
                  setCountdownPaused(true);
                }
              }}
            >
              <RightWorkbenchPane
                currentResult={currentResult}
                rawText={rawText}
                isRunning={isRunning}
                isGeneratingBrief={isGeneratingBrief}
                isRefreshingPolicy={isRefreshingPolicy}
                offlineMode={telemetry.offlineMode}
                countdownMs={countdownMs}
                countdownPaused={countdownPaused}
                maskDirtySinceCloud={maskDirtySinceCloud}
                telemetry={telemetry}
                runtimeConfig={runtimeConfig}
                autoCloudMode={autoCloudMode}
                onToggleAutoCloudMode={() => setAutoCloudMode((v) => !v)}
                onRunLiveDemo={() => {
                  handleSelectScenario(DEMO_SCENARIOS[0]);
                  setMobilePane("output");
                  void handleRunTriage();
                }}
                onToggleSpan={handleToggleSpan}
                onAddManualSpan={handleAddManualSpan}
                onPauseCountdown={() => setCountdownPaused(true)}
                onApproveOrRerunCloud={() => void handleApproveOrRerunCloud()}
                onGenerateHybridBrief={() => void handleGenerateHybridBrief()}
                onRefreshRemoteConfig={() => void handleRefreshRemoteConfig()}
                onWarmupNano={() => void handleWarmupNano()}
                onRecheckNano={() => void refreshNanoStatus()}
              />
            </div>
          </div>
        </main>
        </>
      )}

      <AnimatePresence mode="wait">
        {activeView !== "triage" && (
          <motion.main
            key={activeView}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            className="mx-auto w-full max-w-6xl flex-1 overflow-y-auto p-4 sm:p-6"
          >
            {activeView === "history" && (
              <HistoryWorkspaceView
                history={history}
                onSelectHistory={(ticket) => {
                  handleSelectHistory(ticket);
                  setActiveView("triage");
                  setMobilePane("output");
                }}
                onClearHistory={() => void handleClearHistory()}
              />
            )}

            {activeView === "rules" && (
              <PrivacyRulesWorkspaceView
                policy={policy}
                onSavePolicy={handleSavePolicy}
              />
            )}

            {activeView === "runbooks" && (
              <RunbooksWorkspaceView
                runbooks={runbooks}
                onSaveRunbooks={handleSaveRunbooks}
              />
            )}
          </motion.main>
        )}
      </AnimatePresence>
    </div>
    </MotionConfig>
  );
}

export default App;
