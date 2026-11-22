import { useCallback, useEffect, useRef, useState } from "react";
import { playHoverTick } from "../utils/soundFx";
import { BrandLogo } from "./BrandLogo";

const TARGET = "CORDON";
const CIPHER_GLYPHS = "AX9#K2M7Z4Q1";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function CordonWordmark() {
  const [displayChars, setDisplayChars] = useState<string[]>(() => TARGET.split(""));
  const [hovered, setHovered] = useState(false);
  const [mountPulse, setMountPulse] = useState(true);
  const rafRef = useRef<number | null>(null);

  const runCipherResolve = useCallback((durationMs: number) => {
    if (prefersReducedMotion()) {
      setDisplayChars(TARGET.split(""));
      return;
    }

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / durationMs);

      const next = TARGET.split("").map((char, idx) => {
        const settleThreshold = (idx + 1) / TARGET.length;
        if (progress >= settleThreshold) {
          return char;
        }
        const glyphIdx = Math.floor((now / 28 + idx * 5) % CIPHER_GLYPHS.length);
        return CIPHER_GLYPHS[glyphIdx];
      });

      setDisplayChars(next);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplayChars(TARGET.split(""));
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    runCipherResolve(320);
    const pulseTimer = window.setTimeout(() => setMountPulse(false), 450);
    return () => {
      window.clearTimeout(pulseTimer);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [runCipherResolve]);

  const handleEnter = () => {
    setHovered(true);
    playHoverTick();
    runCipherResolve(220);
  };

  const handleLeave = () => {
    setHovered(false);
  };

  return (
    <div
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
      tabIndex={0}
      aria-label="Cordon"
      className="group relative inline-flex cursor-default items-center gap-2 rounded-md px-1 py-0.5 outline-none focus-visible:ring-1"
      style={{ color: "var(--text-primary)" }}
    >
      <BrandLogo
        size={24}
        className={`transition-transform duration-200 ${
          hovered || mountPulse ? "scale-105" : "scale-100"
        }`}
        beamGlow={hovered || mountPulse}
      />

      <span className="inline-flex items-center font-display text-lg font-extrabold tracking-[-0.03em] uppercase sm:text-[20px]">
        <span
          aria-hidden="true"
          className="mr-0.5 inline-block font-mono text-xs font-bold transition-all duration-200"
          style={{
            color: "var(--safe-text)",
            opacity: hovered ? 0.95 : 0,
            transform: hovered ? "translateX(-3px)" : "translateX(2px)",
          }}
        >
          [
        </span>
        <span className="inline-flex min-w-[4.4em] justify-between" aria-hidden="true">
          {displayChars.map((ch, idx) => (
            <span
              key={idx}
              className="inline-block text-center transition-colors duration-150"
              style={{
                width: "0.72em",
                color: ch !== TARGET[idx] ? "var(--safe-text)" : "var(--text-primary)",
              }}
            >
              {ch}
            </span>
          ))}
        </span>
        <span
          aria-hidden="true"
          className="ml-0.5 inline-block font-mono text-xs font-bold transition-all duration-200"
          style={{
            color: "var(--safe-text)",
            opacity: hovered ? 0.95 : 0,
            transform: hovered ? "translateX(3px)" : "translateX(-2px)",
          }}
        >
          ]
        </span>
      </span>
    </div>
  );
}
