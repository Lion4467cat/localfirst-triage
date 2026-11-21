import { useEffect, useRef, useState } from "react";
import {
  Cloud,
  CloudOff,
  FileCode2,
  Loader2,
  LogOut,
  Monitor,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  UserCheck,
  WifiOff,
} from "lucide-react";
import type { ResolvedTheme, ThemePreference } from "../config/theme";
import type { HybridTelemetry } from "../types/triage";

export type WorkspaceView = "triage" | "history" | "rules" | "runbooks";

interface TelemetryHudProps {
  activeView: WorkspaceView;
  onChangeView: (view: WorkspaceView) => void;
  historyCount: number;
  rulesCount: number;
  runbooksCount: number;
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  onChangeTheme: (pref: ThemePreference) => void;
  telemetry: HybridTelemetry;
  onToggleOffline: () => void;
  onWarmupNano: () => void;
  onOpenTechnicalProof: () => void;
  onSignInAnonymous: () => void;
  onSignInGoogle: () => void;
  onSignOut: () => void;
}

export function TelemetryHud({
  activeView,
  onChangeView,
  historyCount,
  rulesCount,
  runbooksCount,
  themePreference,
  resolvedTheme,
  onChangeTheme,
  telemetry,
  onToggleOffline,
  onWarmupNano,
  onOpenTechnicalProof,
  onSignInAnonymous,
  onSignInGoogle,
  onSignOut,
}: TelemetryHudProps) {
  const [syncOpen, setSyncOpen] = useState(false);
  const popoverContainerRef = useRef<HTMLDivElement>(null);

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
    { id: "system", label: "System", Icon: Monitor },
    { id: "light", label: "Light", Icon: Sun },
    { id: "dark", label: "Dark", Icon: Moon },
  ];

  const navTabs: { id: WorkspaceView; label: string; count?: number }[] = [
    { id: "triage", label: "Triage" },
    { id: "history", label: "History", count: historyCount },
    { id: "rules", label: "Privacy Rules", count: rulesCount },
    { id: "runbooks", label: "Runbooks", count: runbooksCount },
  ];

  const syncLabel = telemetry.offlineMode
    ? "Offline ($0)"
    : telemetry.authUser
      ? telemetry.authUser.isAnonymous
        ? "Sync · Guest"
        : `Sync · ${telemetry.authUser.displayName?.split(" ")[0] || "Account"}`
      : "Cloud Sync";

  const showNanoDownloadBar =
    telemetry.nanoStatus === "DOWNLOADABLE" || telemetry.nanoStatus === "MODEL_DOWNLOADING";

  return (
    <div className="flex flex-col gap-3">
      <header className="lf-card rounded-2xl p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
              style={{
                backgroundColor: "var(--accent-soft-bg)",
                borderColor: "var(--accent-soft-border)",
                color: "var(--accent-text)",
              }}
            >
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1
                  className="truncate text-base font-bold tracking-tight sm:text-lg"
                  style={{ color: "var(--text-primary)" }}
                >
                  LocalFirst Triage
                </h1>
                <span
                  className="hidden rounded-full border px-2 py-0.5 text-[11px] font-semibold sm:inline-flex"
                  style={{
                    backgroundColor: "var(--safe-bg)",
                    borderColor: "var(--safe-border)",
                    color: "var(--safe-text)",
                  }}
                >
                  {telemetry.nanoStatus === "READY"
                    ? "On-Device AI Ready"
                    : "Local Privacy Firewall"}
                </span>
              </div>
              <p
                className="truncate text-xs"
                style={{ color: "var(--text-secondary)" }}
              >
                Mask secrets locally before sending troubleshooting logs to AI
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Color theme"
              title={`Theme: ${themePreference} (${resolvedTheme})`}
              className="inline-flex rounded-xl border p-0.5"
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
                    className="inline-flex min-h-[44px] sm:min-h-[36px] items-center gap-1 rounded-lg px-2.5 text-xs font-medium transition-colors"
                    style={{
                      backgroundColor: active ? "var(--bg-surface)" : "transparent",
                      color: active ? "var(--text-primary)" : "var(--text-secondary)",
                      boxShadow: active ? "var(--shadow-card)" : "none",
                    }}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">{label}</span>
                    <span className="sr-only sm:hidden">{label} theme</span>
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
                className="inline-flex min-h-[44px] sm:min-h-[36px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors"
                style={{
                  backgroundColor: telemetry.offlineMode
                    ? "var(--warn-bg)"
                    : telemetry.authUser
                      ? "var(--safe-bg)"
                      : "var(--bg-subtle)",
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
                ) : telemetry.authUser ? (
                  <Cloud className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <CloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )}
                <span>{syncLabel}</span>
              </button>

              {syncOpen && (
                <div
                  id="cloud-sync-popover"
                  role="region"
                  aria-label="Cloud Sync and Offline Settings"
                  className="fixed inset-x-3 top-24 z-50 rounded-2xl border p-4 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-88"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-strong)",
                    boxShadow: "var(--shadow-popover)",
                  }}
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <h2
                        className="text-sm font-semibold"
                        style={{ color: "var(--text-primary)" }}
                      >
                        Sync &amp; Offline Control
                      </h2>
                      <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                        Cloud sync only stores redacted safe summaries.
                      </p>
                    </div>
                  </div>

                  <div
                    className="mb-3 flex items-center justify-between gap-3 rounded-xl border p-3"
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
                        Disable cloud AI &amp; sync; solve locally only.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={telemetry.offlineMode}
                      aria-label="Toggle Offline Mode ($0 Local)"
                      onClick={onToggleOffline}
                      className="min-h-[36px] shrink-0 rounded-lg border px-3 py-1 text-xs font-semibold"
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
                    className="rounded-xl border p-3"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor: "var(--border-subtle)",
                    }}
                  >
                    {telemetry.authUser ? (
                      <div className="space-y-2.5">
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
                            className="text-[11px]"
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
                              className="min-h-[38px] flex-1 rounded-xl border px-3 py-1.5 text-xs font-semibold"
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
                            className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold"
                            style={{
                              backgroundColor: "var(--mask-bg)",
                              borderColor: "var(--mask-border)",
                              color: "var(--mask-text)",
                            }}
                          >
                            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                            Sign Out
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                          Sync sanitized tickets &amp; privacy rules across web &amp; Android
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={telemetry.cloudSyncStatus === "SIGNING_IN"}
                            onClick={onSignInAnonymous}
                            className="min-h-[38px] flex-1 rounded-xl px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
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
                            className="min-h-[38px] flex-1 rounded-xl border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
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
                      <p className="mt-2 text-[11px]" style={{ color: "var(--mask-text)" }}>
                        {telemetry.cloudSyncError}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onOpenTechnicalProof}
              className="inline-flex min-h-[44px] sm:min-h-[36px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            >
              <FileCode2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden md:inline">Technical Proof</span>
              <span className="md:hidden">Proof</span>
            </button>
          </div>
        </div>

        <nav
          aria-label="Primary sections"
          className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          {navTabs.map((tab) => {
            const active = activeView === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onChangeView(tab.id)}
                className="inline-flex min-h-[44px] sm:min-h-[38px] items-center gap-2 rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition-colors sm:text-sm"
                style={{
                  backgroundColor: active ? "var(--accent-soft-bg)" : "transparent",
                  borderColor: active ? "var(--accent-soft-border)" : "transparent",
                  color: active ? "var(--accent-text)" : "var(--text-secondary)",
                }}
              >
                <span>{tab.label}</span>
                {typeof tab.count === "number" && (
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[11px] font-bold"
                    style={{
                      backgroundColor: active ? "var(--bg-surface)" : "var(--bg-subtle)",
                      color: active ? "var(--accent-text)" : "var(--text-muted)",
                    }}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </header>

      {showNanoDownloadBar && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-2.5"
          style={{
            backgroundColor: "var(--info-bg)",
            borderColor: "var(--info-border)",
          }}
        >
          <div className="flex items-center gap-2">
            {telemetry.nanoStatus === "MODEL_DOWNLOADING" ? (
              <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--info-text)" }} aria-hidden="true" />
            ) : (
              <Sparkles className="h-4 w-4" style={{ color: "var(--info-text)" }} aria-hidden="true" />
            )}
            <span className="text-xs font-medium" style={{ color: "var(--info-text)" }}>
              {telemetry.nanoStatus === "MODEL_DOWNLOADING"
                ? `Preparing On-Device Gemini Nano 4 (${telemetry.downloadProgress ?? 0}%)...`
                : "On-Device Gemini Nano 4 weights can be downloaded for semantic local redaction."}
            </span>
          </div>

          {telemetry.nanoStatus === "DOWNLOADABLE" && (
            <button
              type="button"
              onClick={onWarmupNano}
              className="min-h-[38px] rounded-xl px-3 py-1.5 text-xs font-semibold"
              style={{
                backgroundColor: "var(--accent-primary)",
                color: "var(--accent-on-primary)",
              }}
            >
              Enable On-Device AI
            </button>
          )}
        </div>
      )}
    </div>
  );
}
