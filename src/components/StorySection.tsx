import { useEffect, useRef, useState } from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
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
import { BrandLogo } from "./BrandLogo";

interface StorySectionProps {
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
    tag: "Regex missed 5 human secrets",
  },
  {
    id: "beat-3",
    step: "03",
    title: "Layer 3 — On-Device Gemini Nano 4 (Your GPU)",
    body: "Chrome's built-in Gemma 4 model reads context locally (ONLY_ON_DEVICE), catching 'Manipal ICU Floor 3', 'dog's name + 2026', and '$42M Project-Chimera'.",
    tag: "ONLY_ON_DEVICE · Neural Cyan",
  },
  {
    id: "beat-4",
    step: "04",
    title: "The Verified Airgap (0 / 10 Leaked)",
    body: "Secrets hit a hard local wall. Only clean [REDACTED] tokens cross to Cloud Gemini (gemini-3.5-flash-lite) and sync zero-PII to Chrome Extension & Android.",
    tag: "0 / 10 Leaked · Cross-Platform",
  },
];

const CIPHER_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*";

function CipherScrambleChip({
  locked,
  rawPreview,
  lockedLabel,
}: {
  locked: boolean;
  rawPreview: string;
  lockedLabel: string;
}) {
  const [text, setText] = useState(rawPreview);

  useEffect(() => {
    if (!locked) {
      setText(rawPreview);
      return;
    }
    let tick = 0;
    const timer = setInterval(() => {
      tick++;
      if (tick >= 8) {
        setText(lockedLabel);
        clearInterval(timer);
        return;
      }
      const scrambled = Array.from({ length: Math.min(14, rawPreview.length) }, () =>
        CIPHER_CHARS[Math.floor(Math.random() * CIPHER_CHARS.length)],
      ).join("");
      setText(scrambled);
    }, 35);
    return () => clearInterval(timer);
  }, [locked, rawPreview, lockedLabel]);

  return (
    <motion.span
      layout
      transition={{ type: "spring", stiffness: 420, damping: 26 }}
      className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold"
      style={{
        backgroundColor: locked ? "var(--bg-surface)" : "var(--mask-bg)",
        borderColor: locked ? "var(--border-strong)" : "var(--mask-border)",
        color: locked ? "var(--text-primary)" : "var(--mask-text)",
      }}
    >
      {locked && <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />}
      <span>{text}</span>
    </motion.span>
  );
}

export function StorySection({ onJumpToWorkbench }: StorySectionProps) {
  const [activeBeat, setActiveBeat] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll();
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 240,
    damping: 32,
    restDelta: 0.001,
  });

  // Clean 260vh sticky scroll stage
  const { scrollYProgress: stageProgress } = useScroll({
    target: stageRef,
    offset: ["start start", "end end"],
  });
  const laserY = useTransform(stageProgress, [0.25, 0.5], ["0%", "88%"]);

  useEffect(() => {
    return stageProgress.on("change", (val) => {
      if (val < 0.25) setActiveBeat(0);
      else if (val < 0.5) setActiveBeat(1);
      else if (val < 0.75) setActiveBeat(2);
      else setActiveBeat(3);
    });
  }, [stageProgress]);

  const pointerX = useMotionValue(50);
  const pointerY = useMotionValue(42);
  const smoothX = useSpring(pointerX, { stiffness: 120, damping: 24 });
  const smoothY = useSpring(pointerY, { stiffness: 120, damping: 24 });
  const spotlightBg = useMotionTemplate`radial-gradient(520px circle at ${smoothX}% ${smoothY}%, var(--nano-bg), transparent 70%)`;

  const scrollToStage = () => {
    stageRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div id="story-top" className="relative">
      {/* Razor-thin top scroll-progress bar */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[2px]"
      >
        <motion.div
          className="h-full w-full origin-left"
          style={{
            scaleX: smoothProgress,
            backgroundColor: "var(--safe-solid)",
          }}
        />
      </div>

      {/* Above-the-Fold Hero */}
      <section
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          pointerX.set(((e.clientX - rect.left) / rect.width) * 100);
          pointerY.set(((e.clientY - rect.top) / rect.height) * 100);
        }}
        className="relative flex min-h-[calc(100dvh-48px)] flex-col items-center justify-center overflow-hidden border-b px-4 py-12 text-center"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: spotlightBg }}
        />

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.23, 1, 0.32, 1] }}
          className="relative z-10 mx-auto max-w-3xl space-y-6"
        >
          <div className="flex flex-col items-center gap-3">
            <BrandLogo size={44} />
            <div
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[11px] font-medium"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-secondary)",
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: "var(--nano-solid)" }}
              />
              <span>On-Device Gemini Nano 4 + Firebase AI Logic</span>
            </div>
          </div>

          <h1
            className="text-4xl font-bold tracking-[-0.03em] sm:text-6xl"
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
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={onJumpToWorkbench}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl px-5 text-sm font-semibold"
              style={{
                backgroundColor: "var(--accent-primary)",
                color: "var(--accent-on-primary)",
              }}
            >
              <span>Launch Live Workbench</span>
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </motion.button>

            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={scrollToStage}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-4 text-sm font-medium"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-strong)",
                color: "var(--text-primary)",
              }}
            >
              <span>Scroll to See How It Works</span>
              <ChevronDown className="h-4 w-4 animate-bounce" aria-hidden="true" />
            </motion.button>
          </div>
        </motion.div>
      </section>

      {/* 260vh Sticky Scroll Stage */}
      <section
        id="story-stage"
        ref={stageRef}
        className="mx-auto max-w-[1440px] border-b px-4 py-12 lg:min-h-[260vh] lg:px-8"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[40fr_60fr] lg:items-start">
          {/* Left Column: 4 Spaced Narrative Beats */}
          <div className="space-y-6 lg:space-y-[34vh] lg:py-12">
            {STORY_BEATS.map((beat, idx) => {
              const isActive = activeBeat === idx;
              const isNano = idx === 2;
              const isVerified = idx === 3;
              return (
                <motion.div
                  key={beat.id}
                  onClick={() => setActiveBeat(idx)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActiveBeat(idx);
                    }
                  }}
                  animate={{ opacity: isActive ? 1 : 0.44 }}
                  transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                  className="lf-card cursor-pointer rounded-2xl p-5"
                  style={{
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
                      {beat.step}
                    </span>
                    <span
                      className="rounded-md border px-2 py-0.5 font-mono text-[10px] font-medium"
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
                </motion.div>
              );
            })}
          </div>

          {/* Right Column: Sticky Interactive Visual Card */}
          <div className="lg:sticky lg:top-[80px] lg:h-[calc(100dvh-112px)]">
            <div className="lf-card relative flex h-full min-h-[430px] flex-col justify-between overflow-hidden rounded-2xl p-5">
              {/* Top Card Status Bar */}
              <div
                className="flex flex-wrap items-center justify-between gap-2 border-b pb-3"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor:
                        activeBeat === 2
                          ? "var(--nano-solid)"
                          : activeBeat === 3
                            ? "var(--safe-solid)"
                            : "var(--mask-solid)",
                    }}
                  />
                  <span
                    className="font-mono text-xs font-semibold tracking-tight"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {activeBeat === 0 && "0.00–0.25 · Raw P0 Incident Log"}
                    {activeBeat === 1 && "0.25–0.50 · Laser Regex + Entropy Sweep"}
                    {activeBeat === 2 && "0.50–0.75 · Gemini Nano 4 Neural Sweep"}
                    {activeBeat === 3 && "0.75–1.00 · Verified Airgap (0 / 10 Leaked)"}
                  </span>
                </div>

                {/* Quick Beat Selector Pills */}
                <div className="flex items-center gap-1">
                  {[0, 1, 2, 3].map((idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setActiveBeat(idx)}
                      className="rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums"
                      style={{
                        backgroundColor:
                          activeBeat === idx ? "var(--accent-primary)" : "var(--bg-subtle)",
                        color:
                          activeBeat === idx
                            ? "var(--accent-on-primary)"
                            : "var(--text-secondary)",
                      }}
                    >
                      0{idx + 1}
                    </button>
                  ))}
                </div>
              </div>

              {/* Morphing Visual Body */}
              <div
                className="relative my-4 flex-1 overflow-hidden rounded-xl border p-4 font-mono text-xs leading-relaxed"
                style={{
                  backgroundColor: "var(--code-bg)",
                  borderColor: "var(--border-subtle)",
                }}
              >
                {/* 0.25–0.50: Scroll-Linked Horizontal Laser Bar (y driven by useTransform) */}
                {activeBeat === 1 && (
                  <motion.div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 z-10 h-12"
                    style={{
                      top: laserY,
                      background:
                        "linear-gradient(180deg, transparent 0%, rgba(0,229,163,0.18) 80%, rgba(56,189,248,0.4) 100%)",
                      borderBottom: "3px solid var(--safe-solid)",
                      boxShadow: "0 2px 12px var(--safe-solid)",
                    }}
                  />
                )}

                {/* 0.50–0.75: Neural Cyan Sweep */}
                {activeBeat === 2 && (
                  <motion.div
                    aria-hidden="true"
                    initial={{ y: "-20%", opacity: 0.7 }}
                    animate={{ y: "110%", opacity: [0.35, 0.8, 0.1] }}
                    transition={{ duration: 2.0, repeat: Infinity, ease: "easeInOut" }}
                    className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24"
                    style={{
                      background:
                        "linear-gradient(180deg, transparent 0%, var(--nano-bg) 80%, transparent 100%)",
                      borderBottom: "2px solid var(--nano-solid)",
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
                        <motion.span
                          initial={{ scale: 0.9, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ type: "spring", stiffness: 420, damping: 26 }}
                          className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold"
                          style={{
                            backgroundColor: "var(--nano-bg)",
                            borderColor: "var(--nano-border)",
                            color: "var(--nano-text)",
                          }}
                        >
                          <Cpu className="h-3 w-3" aria-hidden="true" />
                          NANO 4 LOCKED · Manipal ICU Floor 3
                        </motion.span>
                      ) : (
                        <span
                          className="rounded-md border px-1.5 py-0.5 text-[11px] font-semibold"
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
                        <motion.span
                          initial={{ scale: 0.9, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ type: "spring", stiffness: 420, damping: 26, delay: 0.08 }}
                          className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold"
                          style={{
                            backgroundColor: "var(--nano-bg)",
                            borderColor: "var(--nano-border)",
                            color: "var(--nano-text)",
                          }}
                        >
                          <Cpu className="h-3 w-3" aria-hidden="true" />
                          NANO 4 LOCKED · dog&apos;s name + 2026
                        </motion.span>
                      ) : (
                        <span
                          className="rounded-md border px-1.5 py-0.5 text-[11px] font-semibold"
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
                      <CipherScrambleChip
                        locked={activeBeat >= 1}
                        rawPreview="AIzaSyD-1234567890..."
                        lockedLabel="[REDACTED:API_KEY_1]"
                      />{" "}
                      | Phone:{" "}
                      <CipherScrambleChip
                        locked={activeBeat >= 1}
                        rawPreview="+91 99000 54954"
                        lockedLabel="[REDACTED:PHONE_1]"
                      />
                    </p>

                    <p style={{ color: "var(--text-primary)" }}>
                      M&amp;A Context:{" "}
                      {activeBeat >= 2 ? (
                        <motion.span
                          initial={{ scale: 0.9, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ type: "spring", stiffness: 420, damping: 26, delay: 0.16 }}
                          className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold"
                          style={{
                            backgroundColor: "var(--nano-bg)",
                            borderColor: "var(--nano-border)",
                            color: "var(--nano-text)",
                          }}
                        >
                          <Cpu className="h-3 w-3" aria-hidden="true" />
                          NANO 4 LOCKED · $42M Project-Chimera
                        </motion.span>
                      ) : (
                        <span
                          className="rounded-md border px-1.5 py-0.5 text-[11px] font-semibold"
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
                  /* 0.75–1.00: Split Across Glowing Mint Airgap Wall */
                  <motion.div
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: "spring", stiffness: 360, damping: 26 }}
                    className="grid h-full grid-cols-[1fr_auto_1fr] items-center gap-3"
                  >
                    <div
                      className="space-y-2 rounded-xl border p-3.5"
                      style={{
                        backgroundColor: "var(--mask-bg)",
                        borderColor: "var(--mask-border)",
                      }}
                    >
                      <p className="text-[10px] font-bold uppercase" style={{ color: "var(--mask-text)" }}>
                        Bounced Left
                      </p>
                      <p className="text-xl font-bold tabular-nums" style={{ color: "var(--mask-text)" }}>
                        10 BLOCKED
                      </p>
                      <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                        Raw keys, PHI &amp; M&amp;A trapped in local RAM/GPU.
                      </p>
                    </div>

                    <div className="flex flex-col items-center gap-2">
                      <BrandLogo size={36} />
                      <span
                        className="rounded-md border px-2 py-0.5 text-[10px] font-bold tabular-nums"
                        style={{
                          backgroundColor: "var(--safe-bg)",
                          borderColor: "var(--safe-border)",
                          color: "var(--safe-text)",
                        }}
                      >
                        0 LEAKED
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
                        Streamed Right
                      </p>
                      <div className="space-y-1.5 text-[11px]" style={{ color: "var(--text-primary)" }}>
                        <div className="flex items-center gap-1.5">
                          <Sparkles className="h-3.5 w-3.5" style={{ color: "var(--safe-text)" }} aria-hidden="true" />
                          <span>Cloud Gemini</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <ShieldCheck className="h-3.5 w-3.5" style={{ color: "var(--nano-text)" }} aria-hidden="true" />
                          <span>Chrome Extension</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Smartphone className="h-3.5 w-3.5" style={{ color: "var(--safe-text)" }} aria-hidden="true" />
                          <span>Android Sync</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
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
                    Regex missed 5 human secrets
                  </span>
                ) : activeBeat === 2 ? (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] font-semibold"
                    style={{
                      backgroundColor: "var(--nano-bg)",
                      borderColor: "var(--nano-border)",
                      color: "var(--nano-text)",
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

                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={onJumpToWorkbench}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold"
                  style={{
                    backgroundColor: "var(--accent-primary)",
                    color: "var(--accent-on-primary)",
                  }}
                >
                  <span>Jump to Live Workbench</span>
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                </motion.button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
