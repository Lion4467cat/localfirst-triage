import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Lock, Shield, ShieldAlert, ShieldCheck, WifiOff } from "lucide-react";
import type { TriageResult } from "../types/triage";
import { AirgapCanvas, type AirgapCanvasPhase } from "./AirgapCanvas";

interface AirgapSpineProps {
  currentResult: TriageResult | null;
  isRunning: boolean;
  offlineMode: boolean;
}

function resolveSpinePhase(
  currentResult: TriageResult | null,
  isRunning: boolean,
  offlineMode: boolean,
): AirgapCanvasPhase {
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

  const [displayBlocked, setDisplayBlocked] = useState(blockedCount);
  useEffect(() => {
    if (!currentResult || blockedCount <= 0) {
      setDisplayBlocked(0);
      return;
    }
    let frame = 0;
    const steps = Math.min(14, blockedCount);
    const timer = setInterval(() => {
      frame++;
      setDisplayBlocked(Math.round((frame / steps) * blockedCount));
      if (frame >= steps) clearInterval(timer);
    }, 26);
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
        className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: "var(--text-muted)" }}
      >
        Airgap
      </span>

      <div className="relative my-2 flex w-full flex-1 flex-col items-center justify-center overflow-hidden">
        <AirgapCanvas phase={phase} />

        {/* Center Shield Emblem */}
        <motion.div
          animate={
            phase === "offline"
              ? { scale: [1, 0.96, 1] }
              : phase === "intercepted"
                ? { scale: [1, 1.08, 1] }
                : undefined
          }
          transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
          className="relative z-10 flex h-10 w-10 items-center justify-center rounded-xl border"
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
        </motion.div>

        {/* Stacked Signal Vermilion BLOCKED + Electric Mint 0 LEAK Badges */}
        {currentResult && phase !== "scanning" && phase !== "offline" ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 26 }}
            className="relative z-10 mt-2 flex flex-col items-center gap-1"
          >
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
          </motion.div>
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
