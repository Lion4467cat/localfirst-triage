import { useEffect, useState } from "react";
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
  offlineMode: boolean,
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

  // Animated odometer counter (0 -> blockedCount)
  const [displayBlocked, setDisplayBlocked] = useState(blockedCount);
  useEffect(() => {
    if (!currentResult) {
      setDisplayBlocked(0);
      return;
    }
    if (blockedCount <= 0) {
      setDisplayBlocked(0);
      return;
    }
    let frame = 0;
    const steps = Math.min(12, blockedCount);
    const timer = setInterval(() => {
      frame++;
      const nextVal = Math.round((frame / steps) * blockedCount);
      setDisplayBlocked(nextVal);
      if (frame >= steps) {
        clearInterval(timer);
      }
    }, 28);
    return () => clearInterval(timer);
  }, [currentResult?.id, blockedCount]);

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
      className="hidden select-none lg:flex lg:h-full lg:w-[76px] lg:flex-col lg:items-center lg:justify-between lg:py-3"
    >
      <span
        className="text-[9px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: "var(--text-muted)" }}
      >
        Airgap
      </span>

      <div className="relative my-2 flex w-full flex-1 flex-col items-center justify-center">
        {/* 60fps SVG Particle Conduit */}
        <svg
          aria-hidden="true"
          viewBox="0 0 76 260"
          className="pointer-events-none absolute inset-0 h-full w-full"
          preserveAspectRatio="none"
        >
          {/* Vertical Barrier Line */}
          <line
            x1="38"
            y1="8"
            x2="38"
            y2="252"
            stroke={
              phase === "offline"
                ? "var(--warn-border)"
                : phase === "verified"
                  ? "var(--safe-border)"
                  : phase === "intercepted"
                    ? "var(--mask-border)"
                    : "var(--border-subtle)"
            }
            strokeWidth="1.5"
            strokeDasharray={phase === "offline" ? "none" : "4 4"}
          />

          {/* Deflecting Crimson Secret Particles (Scanning / Intercepted) */}
          {(phase === "scanning" || phase === "intercepted") && (
            <g>
              <circle cx="8" cy="112" r="3" fill="var(--mask-solid)" className="animate-airgap-deflect" />
              <circle
                cx="8"
                cy="132"
                r="2.5"
                fill="var(--warn-text)"
                className="animate-airgap-deflect"
                style={{ animationDelay: "0.35s" }}
              />
              <circle
                cx="8"
                cy="150"
                r="3"
                fill="var(--mask-solid)"
                className="animate-airgap-deflect"
                style={{ animationDelay: "0.7s" }}
              />
            </g>
          )}

          {/* Safe Emerald Stream Packets (Verified / Cloud Streaming) */}
          {phase === "verified" && (
            <g>
              <circle cx="48" cy="122" r="3" fill="var(--safe-solid)" className="animate-airgap-packet" />
              <circle
                cx="48"
                cy="138"
                r="2.5"
                fill="var(--safe-solid)"
                className="animate-airgap-packet"
                style={{ animationDelay: "0.45s" }}
              />
            </g>
          )}
        </svg>

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
              {displayBlocked} BLOCKED
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
