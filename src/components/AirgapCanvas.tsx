import { useEffect, useRef } from "react";

export type AirgapCanvasPhase = "idle" | "scanning" | "intercepted" | "verified" | "offline";

interface AirgapCanvasProps {
  phase: AirgapCanvasPhase;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  alpha: number;
}

interface ThreatParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  deflected: boolean;
  alpha: number;
}

interface ShockRing {
  x: number;
  y: number;
  r: number;
  alpha: number;
  color: string;
}

export function AirgapCanvas({ phase }: AirgapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef<AirgapCanvasPhase>(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let width = 76;
    let height = 280;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      width = Math.max(64, Math.round(rect.width));
      height = Math.max(180, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    if (ro && canvas.parentElement) ro.observe(canvas.parentElement);

    const motes: Mote[] = Array.from({ length: 16 }, (_, i) => ({
      x: width / 2 + (Math.random() - 0.5) * 14,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (i % 2 === 0 ? -1 : 1) * (0.35 + Math.random() * 0.45),
      r: 1.4 + Math.random() * 1.4,
      color: i % 2 === 0 ? "#38BDF8" : "#00E5A3",
      alpha: 0.45 + Math.random() * 0.45,
    }));

    const threats: ThreatParticle[] = [];
    const safePackets: Mote[] = [];
    const rings: ShockRing[] = [];

    let frameId = 0;
    let frameCount = 0;

    const draw = () => {
      frameCount++;
      const currentPhase = phaseRef.current;
      const midX = width / 2;

      ctx.clearRect(0, 0, width, height);

      // Center vertical airgap glow line
      const lineGrad = ctx.createLinearGradient(0, 8, 0, height - 8);
      if (currentPhase === "offline") {
        lineGrad.addColorStop(0, "rgba(245, 158, 11, 0.2)");
        lineGrad.addColorStop(0.5, "rgba(245, 158, 11, 0.9)");
        lineGrad.addColorStop(1, "rgba(245, 158, 11, 0.2)");
      } else if (currentPhase === "intercepted" || currentPhase === "scanning") {
        lineGrad.addColorStop(0, "rgba(255, 77, 90, 0.15)");
        lineGrad.addColorStop(0.5, "rgba(0, 229, 163, 0.85)");
        lineGrad.addColorStop(1, "rgba(56, 189, 248, 0.2)");
      } else {
        lineGrad.addColorStop(0, "rgba(56, 189, 248, 0.15)");
        lineGrad.addColorStop(0.5, "rgba(0, 229, 163, 0.85)");
        lineGrad.addColorStop(1, "rgba(56, 189, 248, 0.15)");
      }
      ctx.strokeStyle = lineGrad;
      ctx.lineWidth = currentPhase === "offline" ? 2.5 : 1.75;
      ctx.beginPath();
      ctx.moveTo(midX, 8);
      ctx.lineTo(midX, height - 8);
      ctx.stroke();

      // Always-alive Neural Cyan & Electric Mint motes drifting along barrier
      for (const m of motes) {
        if (!reducedMotion && currentPhase !== "offline") {
          m.y += m.vy;
          m.x += m.vx;
          if (m.y < 10) m.y = height - 10;
          if (m.y > height - 10) m.y = 10;
          if (m.x < midX - 10 || m.x > midX + 10) m.vx *= -1;
        }
        ctx.globalAlpha = currentPhase === "offline" ? 0.2 : m.alpha;
        ctx.fillStyle = m.color;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reducedMotion) {
        // Spawn Vermilion threat particles during scanning / intercepted
        if ((currentPhase === "scanning" || currentPhase === "intercepted") && frameCount % 11 === 0) {
          threats.push({
            x: 2,
            y: height * (0.28 + Math.random() * 0.44),
            vx: 2.3 + Math.random() * 1.4,
            vy: (Math.random() - 0.5) * 0.5,
            r: 2.4 + Math.random() * 1.1,
            deflected: false,
            alpha: 1,
          });
        }

        // Spawn clean Mint packets during verified / scanning
        if ((currentPhase === "verified" || currentPhase === "intercepted") && frameCount % 18 === 0) {
          safePackets.push({
            x: midX + 3,
            y: height * (0.35 + Math.random() * 0.3),
            vx: 1.7 + Math.random() * 0.9,
            vy: (Math.random() - 0.5) * 0.3,
            r: 2.2,
            color: "#00E5A3",
            alpha: 0.95,
          });
        }
      }

      // Update & draw Vermilion threat particles colliding & deflecting off barrier
      for (let i = threats.length - 1; i >= 0; i--) {
        const t = threats[i];
        t.x += t.vx;
        t.y += t.vy;
        if (!t.deflected && t.x >= midX - 4) {
          t.deflected = true;
          t.vx = -(1.4 + Math.random() * 1.1);
          t.vy = (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 1.3);
          rings.push({
            x: midX - 2,
            y: t.y,
            r: 2,
            alpha: 0.9,
            color: "#FF4D5A",
          });
        }
        if (t.deflected) {
          t.alpha -= 0.035;
        }
        if (t.alpha <= 0 || t.x < -6) {
          threats.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, t.alpha);
        ctx.fillStyle = "#FF4D5A";
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Update & draw shockwave rings
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.r += 0.95;
        r.alpha -= 0.045;
        if (r.alpha <= 0) {
          rings.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, r.alpha);
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Update & draw Mint verified packets crossing to right pane
      for (let i = safePackets.length - 1; i >= 0; i--) {
        const p = safePackets[i];
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= 0.025;
        if (p.alpha <= 0 || p.x > width + 6) {
          safePackets.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      if (!reducedMotion) {
        frameId = requestAnimationFrame(draw);
      }
    };

    draw();
    return () => {
      cancelAnimationFrame(frameId);
      ro?.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
