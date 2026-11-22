import { useEffect, useRef } from "react";

const EDGE_GLOW_SELECTOR =
  '.lf-card, .lf-spotlight-card, .lf-btn-primary, button, a, [data-interactive]';

export function PointerField() {
  const auraRef = useRef<HTMLDivElement>(null);
  const crosshairXRef = useRef<HTMLDivElement>(null);
  const crosshairYRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    if (
      !window.matchMedia("(pointer: fine)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    let targetX = window.innerWidth * 0.5;
    let targetY = window.innerHeight * 0.3;
    let currentX = targetX;
    let currentY = targetY;
    let isVisible = false;
    let rafId: number | null = null;
    let hoveredEdgeEl: HTMLElement | null = null;

    const setVisibility = (visible: boolean) => {
      const opacity = visible ? "1" : "0";
      if (auraRef.current) auraRef.current.style.opacity = opacity;
      if (crosshairXRef.current) crosshairXRef.current.style.opacity = opacity;
      if (crosshairYRef.current) crosshairYRef.current.style.opacity = opacity;
    };

    const tick = () => {
      const dx = targetX - currentX;
      const dy = targetY - currentY;

      currentX += dx * 0.28;
      currentY += dy * 0.28;

      if (auraRef.current) {
        auraRef.current.style.setProperty("--px", `${currentX.toFixed(1)}px`);
        auraRef.current.style.setProperty("--py", `${currentY.toFixed(1)}px`);
      }

      if (crosshairXRef.current) {
        crosshairXRef.current.style.transform = `translate3d(0, ${currentY.toFixed(1)}px, 0)`;
      }

      if (crosshairYRef.current) {
        crosshairYRef.current.style.transform = `translate3d(${currentX.toFixed(1)}px, 0, 0)`;
      }

      if (hoveredEdgeEl) {
        const rect = hoveredEdgeEl.getBoundingClientRect();
        hoveredEdgeEl.style.setProperty("--local-x", `${(targetX - rect.left).toFixed(1)}px`);
        hoveredEdgeEl.style.setProperty("--local-y", `${(targetY - rect.top).toFixed(1)}px`);
      }

      if (Math.abs(dx) < 0.2 && Math.abs(dy) < 0.2) {
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
        setVisibility(true);
      }

      const targetEl = ev.target as Element | null;
      const nextEdgeEl = (targetEl?.closest(EDGE_GLOW_SELECTOR) as HTMLElement | null) ?? null;
      if (hoveredEdgeEl && hoveredEdgeEl !== nextEdgeEl) {
        hoveredEdgeEl.removeAttribute("data-edge-active");
      }
      hoveredEdgeEl = nextEdgeEl;
      if (hoveredEdgeEl) {
        hoveredEdgeEl.setAttribute("data-edge-active", "true");
      }

      scheduleLoop();
    };

    const onPointerLeave = () => {
      isVisible = false;
      setVisibility(false);
      if (hoveredEdgeEl) {
        hoveredEdgeEl.removeAttribute("data-edge-active");
        hoveredEdgeEl = null;
      }
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("mouseleave", onPointerLeave, { passive: true });

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (hoveredEdgeEl) hoveredEdgeEl.removeAttribute("data-edge-active");
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("mouseleave", onPointerLeave);
    };
  }, []);

  return (
    <div
      className="cordon-pointer-layer pointer-events-none fixed inset-0 z-10 overflow-hidden"
      aria-hidden="true"
    >
      {/* Localized Grid Illumination Aura */}
      <div
        ref={auraRef}
        className="cordon-pointer-aura fixed inset-0 opacity-0 transition-opacity duration-300"
      />
      {/* Horizontal Airgap Scanline */}
      <div
        ref={crosshairXRef}
        className="cordon-crosshair-x fixed left-0 top-0 h-px w-full opacity-0 transition-opacity duration-200 will-change-transform"
      />
      {/* Vertical Airgap Scanline */}
      <div
        ref={crosshairYRef}
        className="cordon-crosshair-y fixed left-0 top-0 h-full w-px opacity-0 transition-opacity duration-200 will-change-transform"
      />
    </div>
  );
}
