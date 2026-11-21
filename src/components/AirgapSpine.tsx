import { Lock, Shield, ShieldAlert, ShieldCheck, WifiOff } from "lucide-react";
import type { TriageResult } from "../types/triage";

interface AirgapSpineProps {
  currentResult: TriageResult | null;
  isRunning: boolean;
  offlineMode: boolean;
}

type SpinePhase = "idle" | "scanning" | "offline" | "intercepted" | "verified";

function resolveSpinePhase(
  currentResult: TriageResult | null,
  isRunning: boolean,
  offlineMode: boolean
): SpinePhase {
  if (isRunning) return "scanning";
  if (offlineMode) return "offline";
  if (!currentResult) return "idle";
  if (
    currentResult.resolutionMode === "CLOUD_ESCALATION" ||
    currentResult.resolutionMode === "LOCAL_RUNBOOK"
  ) {
    return "verified";
  }
  return "intercepted";
}

export function AirgapSpine({
  currentResult,
  isRunning,
  offlineMode,
}: AirgapSpineProps) {
  const phase = resolveSpinePhase(currentResult, isRunning, offlineMode);
  const blockedCount =
    currentResult?.spans.filter((s) => s.masked !== false).length ?? 0;
  const unmaskedCount =
    currentResult?.spans.filter((s) => s.masked === false).length ?? 0;

  const badgeColor =
    phase === "offline"
      ? {
          bg: "var(--warn-bg)",
          border: "var(--warn-border)",
          text: "var(--warn-text)",
        }
      : phase === "intercepted"
        ? {
            bg: "var(--mask-bg)",
            border: "var(--mask-border)",
            text: "var(--mask-text)",
          }
        : phase === "verified"
          ? {
              bg: "var(--safe-bg)",
              border: "var(--safe-border)",
              text: "var(--safe-text)",
            }
          : {
              bg: "var(--bg-surface)",
              border: "var(--border-strong)",
              text: "var(--text-secondary)",
            };

  return (
    <aside
      aria-label="Airgap Firewall Status"
      className="hidden lg:flex lg:h-full lg:w-[76px] lg:flex-col lg:items-center lg:justify-between lg:py-3 select-none"
    >
      <span
        className="text-[9px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: "var(--text-muted)" }}
      >
        Airgap
      </span>

      <div className="relative my-2 flex w-full flex-1 flex-col items-center justify-center">
        {/* Vertical Conduit Track */}
        <div
          className="absolute inset-y-2 w-px"
          style={{
            backgroundColor:
              phase === "offline"
                ? "var(--warn-border)"
                : phase === "verified"
                  ? "var(--safe-border)"
                  : phase === "intercepted"
                    ? "var(--mask-border)"
                    : "var(--border-subtle)",
          }}
        />

        {/* Animated Conduit Pulse */}
        {phase !== "offline" && (
          <div
            className="animate-airgap-conduit pointer-events-none absolute h-20 w-[3px] rounded-full blur-[1px]"
            style={{
              backgroundColor:
                phase === "verified"
                  ? "var(--safe-solid)"
                  : phase === "intercepted" || phase === "scanning"
                    ? "var(--mask-solid)"
                    : "var(--text-muted)",
            }}
          />
        )}

        {/* Directional Packets */}
        {phase === "scanning" && (
          <div className="pointer-events-none absolute -left-1 flex items-center">
            <span
              className="animate-airgap-packet h-1.5 w-3 rounded-full"
              style={{ backgroundColor: "var(--mask-solid)" }}
            />
          </div>
        )}

        {phase === "verified" && (
          <div className="pointer-events-none absolute -right-1 flex items-center">
            <span
              className="animate-airgap-packet h-1.5 w-3 rounded-full"
              style={{ backgroundColor: "var(--safe-solid)" }}
            />
          </div>
        )}

        {/* Center Shield Emblem */}
        <div
          className="relative z-10 flex h-10 w-10 items-center justify-center rounded-xl border transition-colors"
          style={{
            backgroundColor: badgeColor.bg,
            borderColor: badgeColor.border,
            color: badgeColor.text,
            boxShadow: "var(--shadow-card)",
          }}
        >
          {phase === "offline" ? (
            <WifiOff className="h-4 w-4" aria-hidden="true" />
          ) : phase === "intercepted" ? (
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
          ) : phase === "verified" ? (
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          ) : phase === "scanning" ? (
            <Shield className="h-4 w-4 animate-pulse" aria-hidden="true" />
          ) : (
            <Lock className="h-4 w-4" aria-hidden="true" />
          )}
        </div>

        {/* Stacked Crimson BLOCKED + Emerald 0 LEAK Badges */}
        {currentResult && phase !== "scanning" && phase !== "offline" ? (
          <div className="relative z-10 mt-2 flex flex-col items-center gap-1">
            <span
              className="rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-tight tabular-nums"
              style={{
                backgroundColor: "var(--mask-bg)",
                borderColor: "var(--mask-border)",
                color: "var(--mask-text)",
              }}
            >
              {blockedCount} BLOCKED
            </span>
            <span
              className="rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-tight tabular-nums"
              style={{
                backgroundColor: unmaskedCount === 0 ? "var(--safe-bg)" : "var(--warn-bg)",
                borderColor: unmaskedCount === 0 ? "var(--safe-border)" : "var(--warn-border)",
                color: unmaskedCount === 0 ? "var(--safe-text)" : "var(--warn-text)",
              }}
            >
              {unmaskedCount === 0 ? "0 LEAK" : `${unmaskedCount} OPEN`}
            </span>
          </div>
        ) : (
          <div
            className="relative z-10 mt-2 rounded-md border px-1.5 py-0.5 text-center font-mono text-[9px] font-bold uppercase tracking-wider tabular-nums"
            style={{
              backgroundColor: badgeColor.bg,
              borderColor: badgeColor.border,
              color: badgeColor.text,
            }}
          >
            {phase === "offline"
              ? "SEALED"
              : phase === "scanning"
                ? "SCANNING"
                : "READY"}
          </div>
        )}
      </div>

      <span
        className="text-center font-mono text-[9px] font-semibold uppercase tracking-wider tabular-nums"
        style={{ color: phase === "offline" ? "var(--warn-text)" : "var(--text-muted)" }}
      >
        {phase === "offline" ? "SEALED $0" : "AIRGAP"}
      </span>
    </aside>
  );
}
