import { useEffect, useRef } from "react";

const INTERACTIVE_SELECTOR =
  'button, a, [role="button"], [role="tab"], input, textarea, [data-interactive]';

export function PointerField() {
  const auraRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    if (
      window.matchMedia("(pointer: coarse)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    let targetX = window.innerWidth * 0.5;
    let targetY = window.innerHeight * 0.3;
    let currentX = targetX;
    let currentY = targetY;
    let currentScale = 1;
    let targetScale = 1;
    let isInteractive = false;
    let isPressed = false;
    let isVisible = false;
    let rafId: number | null = null;

    const updateVisualStyles = () => {
      const ring = ringRef.current;
      if (!ring) return;
      ring.style.opacity = isVisible ? "1" : "0";
      ring.style.borderColor =
        isInteractive || isPressed ? "var(--accent-primary)" : "var(--border-strong)";
    };

    const tick = () => {
      const dx = targetX - currentX;
      const dy = targetY - currentY;
      const ds = targetScale - currentScale;

      currentX += dx * 0.22;
      currentY += dy * 0.22;
      currentScale += ds * 0.28;

      if (auraRef.current) {
        auraRef.current.style.setProperty("--pointer-x", `${currentX.toFixed(1)}px`);
        auraRef.current.style.setProperty("--pointer-y", `${currentY.toFixed(1)}px`);
      }

      if (ringRef.current) {
        ringRef.current.style.transform = `translate3d(${(currentX - 12).toFixed(1)}px, ${(currentY - 12).toFixed(1)}px, 0) scale(${currentScale.toFixed(3)})`;
      }

      if (Math.abs(dx) < 0.2 && Math.abs(dy) < 0.2 && Math.abs(ds) < 0.005) {
        rafId = null;
        return;
      }

      rafId = requestAnimationFrame(tick);
    };

    const scheduleLoop = () => {
      if (rafId === null) {
        rafId = requestAnimationFrame(tick);
      }
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerType === "touch") return;
      targetX = ev.clientX;
      targetY = ev.clientY;
      if (!isVisible) {
        isVisible = true;
        if (auraRef.current) auraRef.current.style.opacity = "1";
      }

      const targetEl = ev.target as Element | null;
      const nextInteractive = Boolean(targetEl?.closest(INTERACTIVE_SELECTOR));
      if (nextInteractive !== isInteractive) {
        isInteractive = nextInteractive;
        targetScale = isPressed ? 0.85 : isInteractive ? 1.45 : 1;
      }
      updateVisualStyles();
      scheduleLoop();
    };

    const onPointerDown = (ev: PointerEvent) => {
      if (ev.pointerType === "touch") return;
      isPressed = true;
      targetScale = 0.85;
      updateVisualStyles();
      scheduleLoop();
    };

    const onPointerUp = () => {
      isPressed = false;
      targetScale = isInteractive ? 1.45 : 1;
      updateVisualStyles();
      scheduleLoop();
    };

    const onPointerLeave = () => {
      isVisible = false;
      if (auraRef.current) auraRef.current.style.opacity = "0";
      updateVisualStyles();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    document.addEventListener("mouseleave", onPointerLeave, { passive: true });

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("mouseleave", onPointerLeave);
    };
  }, []);

  return (
    <div className="cordon-pointer-layer pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
      {/* Soft GPU-composited Grid Spotlight Aura */}
      <div
        ref={auraRef}
        className="cordon-pointer-aura fixed inset-0 opacity-0 transition-opacity duration-300"
      />
      {/* Crisp 24px Hairline Precision Reticle Ring */}
      <div
        ref={ringRef}
        className="fixed left-0 top-0 z-[9999] h-6 w-6 rounded-full border opacity-0 transition-[opacity,border-color] duration-150 will-change-transform"
        style={{
          borderColor: "var(--border-strong)",
        }}
      />
    </div>
  );
}
