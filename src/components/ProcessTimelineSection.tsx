import { useEffect, useRef, useState } from "react";
import { onScroll, stagger, svg } from "animejs";
import { ArrowDown, Cpu, Lock, ShieldAlert, ShieldCheck, Smartphone, Sparkles } from "lucide-react";
import { createSafeScope } from "../utils/animeScope";

interface ProcessTimelineSectionProps {
  onJumpToWorkbench: () => void;
}

interface ProcessBeat {
  step: string;
  title: string;
  plainEnglish: string;
  processSpec: string;
  tag: string;
}

const PROCESS_BEATS: ProcessBeat[] = [
  {
    step: "01",
    title: "Raw Incident Enters Locally",
    plainEnglish: "Paste logs or notes—nothing leaves your device.",
    processSpec: "Client-side buffer · 0 bytes transmitted · Lazy Firestore unmounted",
    tag: "10 Raw Secrets Exposed",
  },
  {
    step: "02",
    title: "Deterministic Shield (<2ms)",
    plainEnglish: "Instant rules lock down keys, tokens, phones, and cards.",
    processSpec: "9 Regex Rules + Luhn/IIN + Remote Config Shannon Entropy >= 3.25",
    tag: "Regex missed 5 human secrets",
  },
  {
    step: "03",
    title: "On-Device Gemini Nano 4 (Your GPU)",
    plainEnglish: "Local AI understands human context—catching medical notes, passwords in sentences, and secret deals.",
    processSpec: "InferenceMode.ONLY_ON_DEVICE · Chrome Gemma 4 · Fail-Closed Quarantine",
    tag: "ONLY_ON_DEVICE · Neural Cyan",
  },
  {
    step: "04",
    title: "Verified Airgap (0 / 10 Leaked)",
    plainEnglish: "Only scrubbed placeholders cross to Cloud AI for a fast fix—and sync safely to your phone.",
    processSpec: "verifyZeroLeakage() === 0 · PREFER_IN_CLOUD (gemini-3.5-flash-lite) · Zero-PII Firestore Rules",
    tag: "0 / 10 Leaked · Cross-Platform",
  },
];

export function ProcessTimelineSection({ onJumpToWorkbench }: ProcessTimelineSectionProps) {
  const [activeBeat, setActiveBeat] = useState(0);
  const [scrollPct, setScrollPct] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const scope = createSafeScope(stage, (reduced) => {
      // Clockwork ruler tick stagger on entry
      if (!reduced) {
        onScroll({
          target: stage,
          enter: "top bottom",
          leave: "bottom top",
          sync: 0.25,
          onUpdate: (observer) => {
            const p = Math.min(1, Math.max(0, observer.progress ?? 0));
            setScrollPct(p);
            const idx = Math.min(3, Math.floor(p * 3.99));
            setActiveBeat(idx);
          },
        });
      }

      const traces = svg.createDrawable(".process-trace");
      if (!reduced) {
        onScroll({
          target: stage,
          enter: "top 60%",
          leave: "bottom 40%",
          sync: 0.25,
          onUpdate: () => {
            // Keep drawable trace synced visually via CSS/state
          },
        });
      }
      void traces;
      void stagger;
    });

    return () => {
      scope.revert();
    };
  }, []);

  const laserPercent = Math.min(88, Math.max(4, ((scrollPct - 0.22) / 0.3) * 84));

  return (
    <section
      id="process-stage"
      ref={stageRef}
      className="mx-auto max-w-[1440px] border-b px-4 py-12 lg:min-h-[260vh] lg:px-8"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      {/* Pinned Clockwork Ruler Header */}
      <div
        ref={rulerRef}
        className="mb-8 rounded-xl border p-3 lg:sticky lg:top-14 lg:z-30"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-subtle)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-primary)" }}>
              How the Process Works
            </span>
            <span className="font-mono text-[11px] tabular-nums" style={{ color: "var(--safe-text)" }}>
              {Math.round(scrollPct * 100)}%
            </span>
          </div>

          <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
            {PROCESS_BEATS.map((b, idx) => (
              <button
                key={b.step}
                type="button"
                onClick={() => setActiveBeat(idx)}
                className="rounded px-2 py-0.5 font-semibold transition-colors"
                style={{
                  backgroundColor:
                    activeBeat === idx ? "var(--accent-primary)" : "var(--bg-subtle)",
                  color:
                    activeBeat === idx ? "var(--accent-on-primary)" : "var(--text-secondary)",
                }}
              >
                {b.step}
              </button>
            ))}
          </div>
        </div>

        {/* Ruler Scrubber Track */}
        <div className="relative h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: "var(--bg-subtle)" }}>
          <div className="lf-ruler-ticks absolute inset-0 opacity-65" aria-hidden="true" />
          <div
            className="h-full rounded-full transition-[width] duration-150"
            style={{
              width: `${Math.max(8, ((activeBeat + 1) / 4) * 100)}%`,
              backgroundColor:
                activeBeat === 2
                  ? "var(--nano-solid)"
                  : activeBeat === 3
                    ? "var(--safe-solid)"
                    : "var(--mask-solid)",
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[42fr_58fr] lg:items-start">
        {/* Left Column: 4 Beats with Plain English + Process Spec */}
        <div className="space-y-6 lg:space-y-[30vh] lg:py-8">
          {PROCESS_BEATS.map((beat, idx) => {
            const isActive = activeBeat === idx;
            const isNano = idx === 2;
            const isVerified = idx === 3;
            return (
              <div
                key={beat.step}
                onClick={() => setActiveBeat(idx)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveBeat(idx);
                  }
                }}
                className="lf-card cursor-pointer rounded-2xl p-5 transition-opacity duration-200"
                style={{
                  opacity: isActive ? 1 : 0.45,
                  borderColor: isActive
                    ? isNano
                      ? "var(--nano-border)"
                      : isVerified
                        ? "var(--safe-border)"
                        : "var(--border-strong)"
                    : "var(--border-subtle)",
                }}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span
                    className="font-mono text-xs font-bold tabular-nums"
                    style={{
                      color: isNano
                        ? "var(--nano-text)"
                        : isVerified
                          ? "var(--safe-text)"
                          : "var(--mask-text)",
                    }}
                  >
                    Beat {beat.step}
                  </span>
                  <span
                    className="rounded border px-2 py-0.5 font-mono text-[10px] font-medium"
                    style={{
                      backgroundColor: isNano
                        ? "var(--nano-bg)"
                        : isVerified
                          ? "var(--safe-bg)"
                          : "var(--mask-bg)",
                      borderColor: isNano
                        ? "var(--nano-border)"
                        : isVerified
                          ? "var(--safe-border)"
                          : "var(--mask-border)",
                      color: isNano
                        ? "var(--nano-text)"
                        : isVerified
                          ? "var(--safe-text)"
                          : "var(--mask-text)",
                    }}
                  >
                    {beat.tag}
                  </span>
                </div>

                <h2 className="text-base font-semibold tracking-tight sm:text-lg" style={{ color: "var(--text-primary)" }}>
                  {beat.title}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {beat.plainEnglish}
                </p>

                <div
                  className="mt-3 rounded-lg border px-2.5 py-1.5 font-mono text-[11px]"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    borderColor: "var(--border-subtle)",
                    color: "var(--text-primary)",
                  }}
                >
                  {beat.processSpec}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Column: Sticky Interactive Process Card */}
        <div className="lg:sticky lg:top-[128px]">
          <div className="lf-card relative flex flex-col justify-between overflow-hidden rounded-2xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3" style={{ borderColor: "var(--border-subtle)" }}>
              <span className="font-mono text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                {PROCESS_BEATS[activeBeat].step} · {PROCESS_BEATS[activeBeat].title}
              </span>
              <span
                className="rounded border px-2 py-0.5 font-mono text-[10px] font-semibold"
                style={{
                  backgroundColor:
                    activeBeat === 2
                      ? "var(--nano-bg)"
                      : activeBeat === 3
                        ? "var(--safe-bg)"
                        : "var(--mask-bg)",
                  borderColor:
                    activeBeat === 2
                      ? "var(--nano-border)"
                      : activeBeat === 3
                        ? "var(--safe-border)"
                        : "var(--mask-border)",
                  color:
                    activeBeat === 2
                      ? "var(--nano-text)"
                      : activeBeat === 3
                        ? "var(--safe-text)"
                        : "var(--mask-text)",
                }}
              >
                {PROCESS_BEATS[activeBeat].tag}
              </span>
            </div>

            <div
              className="relative my-4 flex-1 overflow-hidden rounded-xl border p-4 font-mono text-xs leading-relaxed"
              style={{
                backgroundColor: "var(--code-bg)",
                borderColor: "var(--border-subtle)",
              }}
            >
              {/* Beat 2: Scroll-Synced Laser Sweep */}
              {activeBeat === 1 && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 z-10 h-10"
                  style={{
                    top: `${laserPercent}%`,
                    background:
                      "linear-gradient(180deg, transparent 0%, rgba(255,77,90,0.22) 70%, transparent 100%)",
                    borderBottom: "2px solid var(--mask-solid)",
                  }}
                />
              )}

              {/* Beat 3: Neural Cyan Radar */}
              {activeBeat === 2 && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-0 opacity-35"
                  style={{
                    background:
                      "radial-gradient(circle at 50% 45%, var(--nano-bg), transparent 70%)",
                  }}
                />
              )}

              {activeBeat < 3 ? (
                <div className="relative z-10 space-y-3">
                  <p style={{ color: "var(--text-secondary)" }}>
                    URGENT P0 Outage in checkout-gateway after v4.8.2 deploy.
                  </p>

                  <p style={{ color: "var(--text-primary)" }}>
                    Customer John&apos;s{" "}
                    {activeBeat >= 2 ? (
                      <span
                        className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold"
                        style={{
                          backgroundColor: "var(--nano-bg)",
                          borderColor: "var(--nano-border)",
                          color: "var(--nano-text)",
                        }}
                      >
                        <Cpu className="h-3 w-3" aria-hidden="true" />
                        NANO 4 · Manipal ICU Floor 3
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
                          backgroundColor: "var(--nano-bg)",
                          borderColor: "var(--nano-border)",
                          color: "var(--nano-text)",
                        }}
                      >
                        <Cpu className="h-3 w-3" aria-hidden="true" />
                        NANO 4 · dog&apos;s name + 2026
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
                          backgroundColor: "var(--nano-bg)",
                          borderColor: "var(--nano-border)",
                          color: "var(--nano-text)",
                        }}
                      >
                        <Cpu className="h-3 w-3" aria-hidden="true" />
                        NANO 4 · $42M Project-Chimera
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
                <div className="grid h-full grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div
                    className="space-y-2 rounded-xl border p-3.5"
                    style={{
                      backgroundColor: "var(--mask-bg)",
                      borderColor: "var(--mask-border)",
                    }}
                  >
                    <p className="text-[10px] font-bold uppercase" style={{ color: "var(--mask-text)" }}>
                      Blocked Locally
                    </p>
                    <p className="text-xl font-bold tabular-nums" style={{ color: "var(--mask-text)" }}>
                      10 BLOCKED
                    </p>
                    <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                      0 raw PII bytes leave this device.
                    </p>
                  </div>

                  <div className="flex flex-col items-center gap-1.5">
                    <ShieldCheck className="h-7 w-7" style={{ color: "var(--safe-text)" }} aria-hidden="true" />
                    <span className="font-mono text-[10px] font-bold tabular-nums" style={{ color: "var(--safe-text)" }}>
                      0 / 10 LEAKED
                    </span>
                  </div>

                  <div
                    className="space-y-2 rounded-xl border p-3.5"
                    style={{
                      backgroundColor: "var(--safe-bg)",
                      borderColor: "var(--safe-border)",
                    }}
                  >
                    <p className="text-[10px] font-bold uppercase" style={{ color: "var(--safe-text)" }}>
                      Safe Cloud &amp; Sync
                    </p>
                    <div className="space-y-1 text-[11px]" style={{ color: "var(--text-primary)" }}>
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5" style={{ color: "var(--safe-text)" }} aria-hidden="true" />
                        <span>Cloud RCA</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Smartphone className="h-3.5 w-3.5" style={{ color: "var(--safe-text)" }} aria-hidden="true" />
                        <span>Android + Ext</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 3-Layer Detector Status Strip */}
            <div className="mb-3 grid grid-cols-3 gap-2">
              <div
                className="rounded-lg border px-2.5 py-2 font-mono text-[10px]"
                style={{
                  backgroundColor: activeBeat >= 1 ? "var(--mask-bg)" : "var(--bg-subtle)",
                  borderColor: activeBeat >= 1 ? "var(--mask-border)" : "var(--border-subtle)",
                  color: activeBeat >= 1 ? "var(--mask-text)" : "var(--text-muted)",
                }}
              >
                <div className="font-bold">01 · Regex</div>
                <div className="mt-0.5 tabular-nums">{activeBeat >= 1 ? "5 keys locked (<2ms)" : "Standby"}</div>
              </div>
              <div
                className="rounded-lg border px-2.5 py-2 font-mono text-[10px]"
                style={{
                  backgroundColor: activeBeat >= 2 ? "var(--nano-bg)" : "var(--bg-subtle)",
                  borderColor: activeBeat >= 2 ? "var(--nano-border)" : "var(--border-subtle)",
                  color: activeBeat >= 2 ? "var(--nano-text)" : "var(--text-muted)",
                }}
              >
                <div className="font-bold">02 · Nano 4 GPU</div>
                <div className="mt-0.5 tabular-nums">{activeBeat >= 2 ? "5 semantic caught" : "Waiting"}</div>
              </div>
              <div
                className="rounded-lg border px-2.5 py-2 font-mono text-[10px]"
                style={{
                  backgroundColor: activeBeat >= 3 ? "var(--safe-bg)" : "var(--bg-subtle)",
                  borderColor: activeBeat >= 3 ? "var(--safe-border)" : "var(--border-subtle)",
                  color: activeBeat >= 3 ? "var(--safe-text)" : "var(--text-muted)",
                }}
              >
                <div className="font-bold">03 · Airgap Gate</div>
                <div className="mt-0.5 tabular-nums">{activeBeat >= 3 ? "0 / 10 Leaked" : "Sealed"}</div>
              </div>
            </div>

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
                  Regex missed 5 human secrets
                </span>
              ) : (
                <span className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {PROCESS_BEATS[activeBeat].processSpec}
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
                <span>Try Live Workbench</span>
                <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
