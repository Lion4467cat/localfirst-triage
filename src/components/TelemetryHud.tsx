import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  Cloud,
  Loader2,
  LogOut,
  Monitor,
  Moon,
  Sparkles,
  Sun,
  UserCheck,
  Volume2,
  VolumeX,
  WifiOff,
} from "lucide-react";
import type { ResolvedTheme, ThemePreference } from "../config/theme";
import type { HybridTelemetry } from "../types/triage";
import { isSfxEnabled, playClick, setSfxEnabled } from "../utils/soundFx";
import { CordonWordmark } from "./CordonWordmark";

export type WorkspaceView = "triage" | "history" | "rules" | "runbooks";

interface TelemetryHudProps {
  activeView: WorkspaceView;
  onChangeView: (view: WorkspaceView) => void;
  onJumpToStory?: () => void;
  onJumpToWorkbench?: () => void;
  historyCount: number;
  rulesCount: number;
  runbooksCount: number;
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  onChangeTheme: (pref: ThemePreference) => void;
  telemetry: HybridTelemetry;
  onToggleOffline: () => void;
  onWarmupNano: () => void;
  onOpenTechnicalProof?: () => void;
  onSignInAnonymous: () => void;
  onSignInGoogle: () => void;
  onSignOut: () => void;
}

export function TelemetryHud({
  activeView,
  onChangeView,
  onJumpToStory,
  onJumpToWorkbench,
  historyCount,
  rulesCount,
  runbooksCount,
  themePreference,
  resolvedTheme,
  onChangeTheme,
  telemetry,
  onToggleOffline,
  onWarmupNano,
  onSignInAnonymous,
  onSignInGoogle,
  onSignOut,
}: TelemetryHudProps) {
  const [syncOpen, setSyncOpen] = useState(false);
  const [sfxEnabled, setSfxState] = useState<boolean>(() => isSfxEnabled());
  const popoverContainerRef = useRef<HTMLDivElement>(null);

  const handleToggleSfx = () => {
    const next = !sfxEnabled;
    setSfxEnabled(next);
    setSfxState(next);
    if (next) {
      playClick();
    }
  };

  useEffect(() => {
    if (!syncOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSyncOpen(false);
      }
    };

    const handlePointerDown = (e: MouseEvent) => {
      if (
        popoverContainerRef.current &&
        !popoverContainerRef.current.contains(e.target as Node)
      ) {
        setSyncOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [syncOpen]);

  const themeOptions: { id: ThemePreference; label: string; Icon: typeof Monitor }[] = [
    { id: "light", label: "Light", Icon: Sun },
    { id: "dark", label: "Dark", Icon: Moon },
    { id: "system", label: "System", Icon: Monitor },
  ];

  const navTabs: { id: WorkspaceView; label: string; count?: number }[] = [
    { id: "triage", label: "Workbench" },
    { id: "history", label: "History", count: historyCount },
    { id: "rules", label: "Rules", count: rulesCount },
    { id: "runbooks", label: "Runbooks", count: runbooksCount },
  ];

  const syncLabel = telemetry.offlineMode
    ? "Offline ($0)"
    : telemetry.authUser
      ? telemetry.authUser.isAnonymous
        ? "Sync · Guest"
        : `Sync · ${telemetry.authUser.displayName?.split(" ")[0] || "Account"}`
      : "Cloud Sync";

  const nanoReady = telemetry.nanoStatus === "READY";

  return (
    <header
      className="lf-glass-header sticky top-0 z-40 border-b px-3 lg:h-12 lg:px-5"
      style={{
        borderColor: "var(--border-subtle)",
      }}
    >
      <div className="mx-auto flex min-h-12 max-w-[1680px] flex-wrap items-center justify-between gap-2 py-1.5 lg:h-12 lg:flex-nowrap lg:py-0">
        {/* Left: Kinetic Cordon Airgap Wordmark + Word-First Hardware Status */}
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex items-baseline gap-2">
            <CordonWordmark />
            <span
              className="hidden font-mono text-[10.5px] font-medium uppercase tracking-wider sm:inline"
              style={{ color: "var(--text-muted)" }}
            >
              V4.2 · HYBRID AIRGAP
            </span>
          </div>

          <span
            className="hidden h-3.5 w-px sm:inline-block"
            style={{ backgroundColor: "var(--border-subtle)" }}
            aria-hidden="true"
          />

          <div
            className="hidden items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider sm:inline-flex"
            style={{
              backgroundColor: nanoReady ? "var(--nano-bg)" : "var(--safe-bg)",
              borderColor: nanoReady ? "var(--nano-border)" : "var(--safe-border)",
              color: nanoReady ? "var(--nano-text)" : "var(--safe-text)",
            }}
          >
            <span>{nanoReady ? "ON-DEVICE READY" : "DETERMINISTIC FLOOR"}</span>
          </div>

          {telemetry.nanoStatus === "DOWNLOADABLE" && (
            <button
              type="button"
              onClick={onWarmupNano}
              className="hidden items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors md:inline-flex"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-strong)",
                color: "var(--text-primary)",
              }}
            >
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              Enable Nano 4
            </button>
          )}

          {telemetry.nanoStatus === "MODEL_DOWNLOADING" && (
            <span
              className="hidden items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] tabular-nums md:inline-flex"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-secondary)",
              }}
            >
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Nano {telemetry.downloadProgress ?? 0}%
            </span>
          )}
        </div>

        {/* Center: Compact Segmented Nav */}
        <nav
          aria-label="Primary sections"
          className="order-3 flex w-full items-center justify-between gap-0.5 rounded-lg border p-0.5 sm:w-auto lg:order-2"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <button
            type="button"
            onClick={() => {
              onChangeView("triage");
              onJumpToStory?.();
            }}
            className="inline-flex min-h-[30px] flex-1 items-center justify-center rounded-md px-1.5 text-[11px] font-medium transition-colors sm:flex-initial sm:px-2.5 sm:text-xs"
            style={{
              backgroundColor: "transparent",
              color: "var(--text-secondary)",
            }}
          >
            Story
          </button>
          {navTabs.map((tab) => {
            const active = activeView === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  onChangeView(tab.id);
                  if (tab.id === "triage") {
                    onJumpToWorkbench?.();
                  }
                }}
                className="relative inline-flex min-h-[30px] flex-1 items-center justify-center gap-1 rounded-md px-1.5 text-[11px] font-medium sm:flex-initial sm:gap-1.5 sm:px-2.5 sm:text-xs"
                style={{
                  color: active ? "var(--text-primary)" : "var(--text-secondary)",
                }}
              >
                {active && (
                  <motion.span
                    layoutId="nav-pill"
                    transition={{ type: "spring", stiffness: 420, damping: 28 }}
                    className="absolute inset-0 rounded-md"
                    style={{
                      backgroundColor: "var(--bg-surface)",
                      boxShadow: "var(--shadow-card)",
                    }}
                  />
                )}
                <span className="relative z-10">{tab.label}</span>
                {typeof tab.count === "number" && tab.count > 0 && (
                  <span
                    className="relative z-10 rounded px-1 font-mono text-[10px] font-semibold tabular-nums"
                    style={{
                      backgroundColor: active ? "var(--bg-subtle)" : "transparent",
                      color: "var(--text-muted)",
                    }}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Right: Sound Toggle + Theme Switcher + Cloud Sync Popover */}
        <div className="order-2 flex items-center gap-2 lg:order-3">
          <button
            type="button"
            aria-label="Toggle UI sound effects"
            aria-pressed={sfxEnabled}
            title={sfxEnabled ? "UI sound effects: On" : "UI sound effects: Off"}
            onClick={handleToggleSfx}
            className="inline-flex min-h-[30px] items-center justify-center rounded-lg border px-2 text-xs transition-colors"
            style={{
              backgroundColor: sfxEnabled ? "var(--safe-bg)" : "var(--bg-subtle)",
              borderColor: sfxEnabled ? "var(--safe-border)" : "var(--border-subtle)",
              color: sfxEnabled ? "var(--safe-text)" : "var(--text-muted)",
            }}
          >
            {sfxEnabled ? (
              <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>

          <div
            role="group"
            aria-label="Color theme"
            title={`Theme: ${themePreference} (${resolvedTheme})`}
            className="inline-flex rounded-lg border p-0.5"
            style={{
              backgroundColor: "var(--bg-subtle)",
              borderColor: "var(--border-subtle)",
            }}
          >
            {themeOptions.map(({ id, label, Icon }) => {
              const active = themePreference === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChangeTheme(id)}
                  className="inline-flex min-h-[28px] items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors"
                  style={{
                    backgroundColor: active ? "var(--bg-surface)" : "transparent",
                    color: active ? "var(--text-primary)" : "var(--text-secondary)",
                    boxShadow: active ? "var(--shadow-card)" : "none",
                  }}
                >
                  <Icon className="h-3 w-3" aria-hidden="true" />
                  <span className="hidden xl:inline">{label}</span>
                  <span className="sr-only xl:hidden">{label}</span>
                </button>
              );
            })}
          </div>

          <div ref={popoverContainerRef} className="relative">
            <button
              type="button"
              aria-expanded={syncOpen}
              aria-controls="cloud-sync-popover"
              onClick={() => setSyncOpen((v) => !v)}
              className="inline-flex min-h-[30px] items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors"
              style={{
                backgroundColor: telemetry.offlineMode
                  ? "var(--warn-bg)"
                  : telemetry.authUser
                    ? "var(--safe-bg)"
                    : "var(--bg-surface)",
                borderColor: telemetry.offlineMode
                  ? "var(--warn-border)"
                  : telemetry.authUser
                    ? "var(--safe-border)"
                    : "var(--border-subtle)",
                color: telemetry.offlineMode
                  ? "var(--warn-text)"
                  : telemetry.authUser
                    ? "var(--safe-text)"
                    : "var(--text-primary)",
              }}
            >
              {telemetry.offlineMode ? (
                <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <Cloud className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>{syncLabel}</span>
            </button>

            <AnimatePresence>
              {syncOpen && (
                <motion.div
                  id="cloud-sync-popover"
                  role="region"
                  aria-label="Cloud Sync and Offline Settings"
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: -4 }}
                  transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                  style={{
                    transformOrigin: "top right",
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-strong)",
                    boxShadow: "var(--shadow-popover)",
                  }}
                  className="fixed inset-x-3 top-14 z-50 rounded-xl border p-4 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80"
                >
                <div className="mb-3">
                  <h2
                    className="text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "var(--text-primary)" }}
                  >
                    Sync &amp; Offline Control
                  </h2>
                  <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                    Cloud sync stores only redacted safe summaries.
                  </p>
                </div>

                <div
                  className="mb-3 flex items-center justify-between gap-3 rounded-lg border p-2.5"
                  style={{
                    backgroundColor: telemetry.offlineMode
                      ? "var(--warn-bg)"
                      : "var(--bg-subtle)",
                    borderColor: telemetry.offlineMode
                      ? "var(--warn-border)"
                      : "var(--border-subtle)",
                  }}
                >
                  <div className="min-w-0">
                    <p
                      className="text-xs font-semibold"
                      style={{
                        color: telemetry.offlineMode
                          ? "var(--warn-text)"
                          : "var(--text-primary)",
                      }}
                    >
                      Offline Mode ($0 Local)
                    </p>
                    <p
                      className="text-[11px]"
                      style={{
                        color: telemetry.offlineMode
                          ? "var(--warn-text)"
                          : "var(--text-secondary)",
                      }}
                    >
                      Seal airgap; solve locally only.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={telemetry.offlineMode}
                    aria-label="Toggle Offline Mode ($0 Local)"
                    onClick={onToggleOffline}
                    className="min-h-[30px] shrink-0 rounded-md border px-2.5 text-xs font-semibold"
                    style={{
                      backgroundColor: telemetry.offlineMode
                        ? "var(--bg-surface)"
                        : "var(--accent-primary)",
                      borderColor: telemetry.offlineMode
                        ? "var(--warn-border)"
                        : "var(--accent-primary)",
                      color: telemetry.offlineMode
                        ? "var(--text-primary)"
                        : "var(--accent-on-primary)",
                    }}
                  >
                    {telemetry.offlineMode ? "On" : "Off"}
                  </button>
                </div>

                <div
                  className="rounded-lg border p-2.5"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    borderColor: "var(--border-subtle)",
                  }}
                >
                  {telemetry.authUser ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="inline-flex items-center gap-1.5 text-xs font-semibold"
                          style={{ color: "var(--safe-text)" }}
                        >
                          <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          {telemetry.authUser.isAnonymous
                            ? "Guest Sync Active"
                            : telemetry.authUser.email ||
                              telemetry.authUser.displayName ||
                              "Google Account Synced"}
                        </span>
                        <span
                          className="font-mono text-[10px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {telemetry.cloudSyncStatus ?? "SYNCED"}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {telemetry.authUser.isAnonymous && (
                          <button
                            type="button"
                            onClick={onSignInGoogle}
                            className="min-h-[32px] flex-1 rounded-md border px-2.5 text-xs font-semibold"
                            style={{
                              backgroundColor: "var(--bg-surface)",
                              borderColor: "var(--border-strong)",
                              color: "var(--text-primary)",
                            }}
                          >
                            Link Google Account
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={onSignOut}
                          className="inline-flex min-h-[32px] items-center justify-center gap-1 rounded-md border px-2.5 text-xs font-semibold"
                          style={{
                            backgroundColor: "var(--mask-bg)",
                            borderColor: "var(--mask-border)",
                            color: "var(--mask-text)",
                          }}
                        >
                          <LogOut className="h-3 w-3" aria-hidden="true" />
                          Sign Out
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>
                        Sync sanitized tickets &amp; rules across Web &amp; Android
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={telemetry.cloudSyncStatus === "SIGNING_IN"}
                          onClick={onSignInAnonymous}
                          className="min-h-[32px] flex-1 rounded-md px-2.5 text-xs font-semibold disabled:opacity-50"
                          style={{
                            backgroundColor: "var(--accent-primary)",
                            color: "var(--accent-on-primary)",
                          }}
                        >
                          Sync as Guest
                        </button>
                        <button
                          type="button"
                          disabled={telemetry.cloudSyncStatus === "SIGNING_IN"}
                          onClick={onSignInGoogle}
                          className="min-h-[32px] flex-1 rounded-md border px-2.5 text-xs font-semibold disabled:opacity-50"
                          style={{
                            backgroundColor: "var(--bg-surface)",
                            borderColor: "var(--border-strong)",
                            color: "var(--text-primary)",
                          }}
                        >
                          Sign In with Google
                        </button>
                      </div>
                    </div>
                  )}

                  {telemetry.cloudSyncError && (
                    <div
                      role="alert"
                      className="mt-2 flex items-start gap-1.5 rounded-md border p-2 text-[11px] leading-snug"
                      style={{
                        backgroundColor: "var(--mask-bg)",
                        borderColor: "var(--mask-border)",
                        color: "var(--mask-text)",
                      }}
                    >
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>{telemetry.cloudSyncError}</span>
                    </div>
                  )}
                </div>
              </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </header>
  );
}
