import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ChevronDown,
  Cpu,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from "lucide-react";

interface ScrollStoryActProps {
  onJumpToWorkbench: () => void;
}

interface StoryBeat {
  id: string;
  step: string;
  title: string;
  body: string;
  tag: string;
}

const STORY_BEATS: StoryBeat[] = [
  {
    id: "beat-1",
    step: "01",
    title: "The Leak Trap",
    body: "Raw incident logs mix stack traces with AWS keys, patient ICU notes, and M&A secrets.",
    tag: "10 Raw Secrets Exposed",
  },
  {
    id: "beat-2",
    step: "02",
    title: "Layer 1 & 2 — Instant Deterministic Shield (<2ms)",
    body: "Local regex + Shannon entropy (>=3.25) instantly traps API keys, JWTs, emails, and phones—but misses human language.",
    tag: "Regex missed 5 contextual secrets",
  },
  {
    id: "beat-3",
    step: "03",
    title: "Layer 3 — On-Device Gemini Nano 4 (Your GPU)",
    body: "Chrome's built-in Gemma 4 model reads context locally (ONLY_ON_DEVICE), catching 'Manipal ICU Floor 3', 'dog's name + 2026', and '$42M Project-Chimera'.",
    tag: "ONLY_ON_DEVICE · Local GPU",
  },
  {
    id: "beat-4",
    step: "04",
    title: "The Verified Airgap (0 / 10 Leaked)",
    body: "Secrets hit a hard local wall. Only clean [REDACTED] tokens cross to Cloud Gemini (gemini-3.5-flash-lite) and sync zero-PII to Chrome Extension & Android.",
    tag: "0 / 10 Leaked · Cross-Platform",
  },
];

export function ScrollStoryAct({ onJumpToWorkbench }: ScrollStoryActProps) {
  const [activeBeat, setActiveBeat] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const beatRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    let rafId = 0;
    const updateProgress = () => {
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const pct = docHeight > 0 ? Math.min(1, Math.max(0, window.scrollY / docHeight)) : 0;
      setScrollProgress(pct);

      // Compute active beat from stage scroll position for smooth scrubbing
      const stage = stageRef.current;
      if (stage) {
        const rect = stage.getBoundingClientRect();
        const total = Math.max(1, stage.offsetHeight - window.innerHeight * 0.7);
        const passed = Math.max(0, -rect.top + window.innerHeight * 0.25);
        const ratio = Math.min(0.999, Math.max(0, passed / total));
        const idx = Math.min(3, Math.floor(ratio * 4));
        setActiveBeat(idx);
      }
    };

    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updateProgress);
    };

    updateProgress();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const scrollToStage = () => {
    stageRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div id="story-top" className="relative">
      {/* Razor-thin top scroll-progress bar (CSS scroll-timeline + JS fallback) */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[2px]"
        style={{ backgroundColor: "transparent" }}
      >
        <div
          className="lf-scroll-progress-bar h-full w-full"
          style={{
            backgroundColor: "var(--safe-solid)",
            transform: `scaleX(${scrollProgress})`,
          }}
        />
      </div>

      {/* Above-the-Fold Hero (~92dvh) */}
      <section className="relative flex min-h-[calc(100dvh-48px)] flex-col items-center justify-center overflow-hidden border-b px-4 py-12 text-center" style={{ borderColor: "var(--border-subtle)" }}>
        {/* Subtle Architectural Ambient Airgap Line */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 opacity-40"
          style={{ backgroundColor: "var(--border-subtle)" }}
        />
        <div
          aria-hidden="true"
          className="animate-airgap-conduit pointer-events-none absolute left-1/2 top-6 h-24 w-[2px] -translate-x-1/2 rounded-full opacity-30"
          style={{ backgroundColor: "var(--safe-solid)" }}
        />

        <div className="relative z-10 mx-auto max-w-3xl space-y-6">
          <div
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[11px] font-medium"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-secondary)",
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--safe-solid)" }} />
            <span>ON-DEVICE GEMINI NANO 4 + FIREBASE AI LOGIC</span>
          </div>

          <h1
            className="text-4xl font-bold tracking-tight sm:text-6xl"
            style={{ color: "var(--text-primary)" }}
          >
            Stop pasting secrets into Cloud AI.
          </h1>

          <p
            className="mx-auto max-w-2xl text-base leading-relaxed sm:text-lg"
            style={{ color: "var(--text-secondary)" }}
          >
            Gemini Nano 4 scrubs keys, medical info, and private context on your GPU before a single byte hits the cloud.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={onJumpToWorkbench}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg px-5 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{
                backgroundColor: "var(--accent-primary)",
                color: "var(--accent-on-primary)",
              }}
            >
              <span>Launch Live Workbench</span>
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={scrollToStage}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-strong)",
                color: "var(--text-primary)",
              }}
            >
              <span>Scroll to See How It Works</span>
              <ChevronDown className="h-4 w-4 animate-bounce" aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      {/* Pinned Sticky Scroll Stage */}
      <section
        id="story-stage"
        ref={stageRef}
        className="mx-auto max-w-[1440px] border-b px-4 py-12 lg:min-h-[300vh] lg:px-8"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[40fr_60fr] lg:items-start">
          {/* Left Column: 4 Spaced Narrative Beats */}
          <div className="space-y-6 lg:space-y-[42vh] lg:py-16">
            {STORY_BEATS.map((beat, idx) => {
              const isActive = activeBeat === idx;
              return (
                <div
                  key={beat.id}
                  ref={(el) => {
                    beatRefs.current[idx] = el;
                  }}
                  onClick={() => setActiveBeat(idx)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActiveBeat(idx);
                    }
                  }}
                  className="lf-card cursor-pointer rounded-xl p-5 transition-opacity duration-300"
                  style={{
                    opacity: isActive ? 1 : 0.48,
                    borderColor: isActive ? "var(--border-strong)" : "var(--border-subtle)",
                  }}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span
                      className="font-mono text-xs font-bold tabular-nums"
                      style={{ color: isActive ? "var(--safe-text)" : "var(--text-muted)" }}
                    >
                      {beat.step}
                    </span>
                    <span
                      className="rounded border px-2 py-0.5 font-mono text-[10px] font-medium"
                      style={{
                        backgroundColor:
                          idx === 0 || idx === 1
                            ? "var(--mask-bg)"
                            : "var(--safe-bg)",
                        borderColor:
                          idx === 0 || idx === 1
                            ? "var(--mask-border)"
                            : "var(--safe-border)",
                        color:
                          idx === 0 || idx === 1
                            ? "var(--mask-text)"
                            : "var(--safe-text)",
                      }}
                    >
                      {beat.tag}
                    </span>
                  </div>
                  <h2
                    className="text-base font-semibold tracking-tight sm:text-lg"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {beat.title}
                  </h2>
                  <p
                    className="mt-1.5 text-sm leading-relaxed"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {beat.body}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Right Column: Sticky Interactive Visual Card */}
          <div className="lg:sticky lg:top-[72px] lg:h-[calc(100dvh-104px)]">
            <div className="lf-card relative flex h-full min-h-[420px] flex-col justify-between overflow-hidden rounded-2xl p-5">
              {/* Top Card Status Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3" style={{ borderColor: "var(--border-subtle)" }}>
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor:
                        activeBeat >= 2 ? "var(--safe-solid)" : "var(--mask-solid)",
                    }}
                  />
                  <span className="font-mono text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-primary)" }}>
                    {activeBeat === 0 && "Beat 01 · Raw Incident Log"}
                    {activeBeat === 1 && "Beat 02 · Laser Regex + Entropy Sweep"}
                    {activeBeat === 2 && "Beat 03 · Gemini Nano 4 Neural Sweep"}
                    {activeBeat === 3 && "Beat 04 · Verified Airgap (0 / 10 Leaked)"}
                  </span>
                </div>

                {/* Quick Beat Selector Pills for Direct Inspection */}
                <div className="flex items-center gap-1">
                  {[0, 1, 2, 3].map((idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setActiveBeat(idx)}
                      className="rounded px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums transition-colors"
                      style={{
                        backgroundColor:
                          activeBeat === idx ? "var(--accent-primary)" : "var(--bg-subtle)",
                        color:
                          activeBeat === idx ? "var(--accent-on-primary)" : "var(--text-secondary)",
                      }}
                    >
                      0{idx + 1}
                    </button>
                  ))}
                </div>
              </div>

              {/* Morphing Visual Body */}
              <div className="relative my-4 flex-1 overflow-hidden rounded-xl border p-4 font-mono text-xs leading-relaxed" style={{ backgroundColor: "var(--code-bg)", borderColor: "var(--border-subtle)" }}>
                {/* Beat 2: Laser Scanline */}
                {activeBeat === 1 && (
                  <div
                    aria-hidden="true"
                    className="animate-airgap-sweep pointer-events-none absolute inset-x-0 top-0 z-10 h-10"
                    style={{
                      background:
                        "linear-gradient(180deg, transparent 0%, rgba(239,68,68,0.22) 50%, transparent 100%)",
                      borderBottom: "2px solid var(--mask-solid)",
                    }}
                  />
                )}

                {/* Beat 3: Neural Wave */}
                {activeBeat === 2 && (
                  <div
                    aria-hidden="true"
                    className="animate-neural-wave pointer-events-none absolute inset-x-0 top-0 z-10 h-24"
                    style={{
                      background:
                        "linear-gradient(180deg, transparent 0%, rgba(16,185,129,0.22) 50%, transparent 100%)",
                      borderBottom: "2px solid var(--safe-solid)",
                    }}
                  />
                )}

                {activeBeat < 3 ? (
                  <div className="space-y-3">
                    <p style={{ color: "var(--text-secondary)" }}>
                      URGENT P0 Outage in checkout-gateway after v4.8.2 deploy.
                    </p>

                    <p style={{ color: "var(--text-primary)" }}>
                      Customer John&apos;s{" "}
                      {activeBeat >= 2 ? (
                        <span
                          className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold"
                          style={{
                            backgroundColor: "var(--safe-bg)",
                            borderColor: "var(--safe-border)",
                            color: "var(--safe-text)",
                          }}
                        >
                          <Cpu className="h-3 w-3" aria-hidden="true" />
                          NANO 4 LOCKED · Medical Info
                        </span>
                      ) : (
                        <span
                          className="rounded border px-1.5 py-0.5 text-[11px] font-semibold"
                          style={{
                            backgroundColor: "var(--mask-bg)",
                            borderColor: "var(--mask-border)",
                            color: "var(--mask-text)",
                          }}
                        >
                          daughter admitted to Manipal ICU Floor 3
                        </span>
                      )}{" "}
                      had billing profile exposed.
                    </p>

                    <p style={{ color: "var(--text-primary)" }}>
                      On-call pasted:{" "}
                      {activeBeat >= 2 ? (
                        <span
                          className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold"
                          style={{
                            backgroundColor: "var(--safe-bg)",
                            borderColor: "var(--safe-border)",
                            color: "var(--safe-text)",
                          }}
                        >
                          <Cpu className="h-3 w-3" aria-hidden="true" />
                          NANO 4 LOCKED · Password Hint
                        </span>
                      ) : (
                        <span
                          className="rounded border px-1.5 py-0.5 text-[11px] font-semibold"
                          style={{
                            backgroundColor: "var(--mask-bg)",
                            borderColor: "var(--mask-border)",
                            color: "var(--mask-text)",
                          }}
                        >
                          log in using dog&apos;s name + 2026
                        </span>
                      )}
                    </p>

                    <p style={{ color: "var(--text-primary)" }}>
                      Firebase Key:{" "}
                      {activeBeat >= 1 ? (
                        <span
                          className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold"
                          style={{
                            backgroundColor: "var(--bg-surface)",
                            borderColor: "var(--border-strong)",
                            color: "var(--text-primary)",
                          }}
                        >
                          <Lock className="h-3 w-3" aria-hidden="true" />
                          [REDACTED:API_KEY_1]
                        </span>
                      ) : (
                        <span
                          className="rounded border px-1.5 py-0.5 text-[11px] font-semibold"
                          style={{
                            backgroundColor: "var(--mask-bg)",
                            borderColor: "var(--mask-border)",
                            color: "var(--mask-text)",
                          }}
                        >
                          AIzaSyD-1234567890...
                        </span>
                      )}{" "}
                      | Phone:{" "}
                      {activeBeat >= 1 ? (
                        <span
                          className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold"
                          style={{
                            backgroundColor: "var(--bg-surface)",
                            borderColor: "var(--border-strong)",
                            color: "var(--text-primary)",
                          }}
                        >
                          <Lock className="h-3 w-3" aria-hidden="true" />
                          [REDACTED:PHONE_1]
                        </span>
                      ) : (
                        <span
                          className="rounded border px-1.5 py-0.5 text-[11px] font-semibold"
                          style={{
                            backgroundColor: "var(--mask-bg)",
                            borderColor: "var(--mask-border)",
                            color: "var(--mask-text)",
                          }}
                        >
                          +91 99000 54954
                        </span>
                      )}
                    </p>

                    <p style={{ color: "var(--text-primary)" }}>
                      M&amp;A Context:{" "}
                      {activeBeat >= 2 ? (
                        <span
                          className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold"
                          style={{
                            backgroundColor: "var(--safe-bg)",
                            borderColor: "var(--safe-border)",
                            color: "var(--safe-text)",
                          }}
                        >
                          <Cpu className="h-3 w-3" aria-hidden="true" />
                          NANO 4 LOCKED · $42M Project-Chimera
                        </span>
                      ) : (
                        <span
                          className="rounded border px-1.5 py-0.5 text-[11px] font-semibold"
                          style={{
                            backgroundColor: "var(--mask-bg)",
                            borderColor: "var(--mask-border)",
                            color: "var(--mask-text)",
                          }}
                        >
                          $42M Project-Chimera acquisition target
                        </span>
                      )}
                    </p>
                  </div>
                ) : (
                  /* Beat 4: Split Airgap Shield View */
                  <div className="grid h-full grid-cols-[1fr_auto_1fr] items-center gap-3">
                    <div className="space-y-2 rounded-lg border p-3" style={{ backgroundColor: "var(--mask-bg)", borderColor: "var(--mask-border)" }}>
                      <p className="text-[10px] font-bold uppercase" style={{ color: "var(--mask-text)" }}>
                        Deflected Locally
                      </p>
                      <p className="text-lg font-bold tabular-nums" style={{ color: "var(--mask-text)" }}>
                        10 BLOCKED
                      </p>
                      <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                        Raw keys, PHI &amp; M&amp;A never leave GPU/RAM.
                      </p>
                    </div>

                    <div className="flex flex-col items-center gap-1.5">
                      <div
                        className="flex h-11 w-11 items-center justify-center rounded-xl border"
                        style={{
                          backgroundColor: "var(--safe-bg)",
                          borderColor: "var(--safe-border)",
                          color: "var(--safe-text)",
                        }}
                      >
                        <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <span className="text-[10px] font-bold tabular-nums" style={{ color: "var(--safe-text)" }}>
                        0 / 10 LEAKED
                      </span>
                    </div>

                    <div className="space-y-2 rounded-lg border p-3" style={{ backgroundColor: "var(--safe-bg)", borderColor: "var(--safe-border)" }}>
                      <p className="text-[10px] font-bold uppercase" style={{ color: "var(--safe-text)" }}>
                        Safe Cloud &amp; Sync
                      </p>
                      <div className="space-y-1 text-[11px]" style={{ color: "var(--text-primary)" }}>
                        <div className="flex items-center gap-1.5">
                          <Sparkles className="h-3 w-3" style={{ color: "var(--safe-text)" }} aria-hidden="true" />
                          <span>Cloud RCA (Gemini)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Smartphone className="h-3 w-3" style={{ color: "var(--safe-text)" }} aria-hidden="true" />
                          <span>Android + Extension</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom Callout Strip */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                {activeBeat === 1 ? (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] font-semibold"
                    style={{
                      backgroundColor: "var(--mask-bg)",
                      borderColor: "var(--mask-border)",
                      color: "var(--mask-text)",
                    }}
                  >
                    <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                    Regex missed 5 contextual secrets
                  </span>
                ) : activeBeat === 2 ? (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] font-semibold"
                    style={{
                      backgroundColor: "var(--safe-bg)",
                      borderColor: "var(--safe-border)",
                      color: "var(--safe-text)",
                    }}
                  >
                    <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
                    Gemini Nano 4 · ONLY_ON_DEVICE
                  </span>
                ) : (
                  <span className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                    3-Layer Privacy Firewall · Zero-PII Architecture
                  </span>
                )}

                <button
                  type="button"
                  onClick={onJumpToWorkbench}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold"
                  style={{
                    backgroundColor: "var(--accent-primary)",
                    color: "var(--accent-on-primary)",
                  }}
                >
                  <span>Try It Live Below</span>
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
