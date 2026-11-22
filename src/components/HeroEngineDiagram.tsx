import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDown,
  ArrowRight,
  Check,
  ExternalLink,
  Lock,
  ShieldCheck,
  Smartphone,
  Terminal,
  Zap,
} from "lucide-react";
import { scanAndRedactLocal } from "../firewall/regexScrubber";
import baselineBench from "../../benchmarks/third-party-baseline.json";
import optimizedBench from "../../benchmarks/third-party-optimized.json";

interface HeroEngineDiagramProps {
  onJumpToWorkbench: () => void;
  onSendToWorkbench?: (rawText: string) => void;
}

const ATTACK_PILLS = [
  {
    id: "aws-jwt",
    label: "AWS + JWT",
    sample:
      "Deploy failed with AWS_ACCESS_KEY_ID=" +
      ["AK", "IAIOSFODNN7EXAMPLE"].join("") +
      " and Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcHMifQ.sig12345",
  },
  {
    id: "api-typo",
    label: "API Typo",
    sample: "my apis key is 544245453 and my phone number is 9876543210. Can you fix this?",
  },
  {
    id: "global-pii",
    label: "Global PII",
    sample:
      "Email alice@acme.org, IP 109.4.61.213, IBAN DE89370400440532013000, address 42 Oak Street, Austin TX 78701.",
  },
  {
    id: "clean-code",
    label: "Clean Code",
    sample:
      "HTTP 502 Bad Gateway on /api/v1/health using localStorage and Docker on localhost port 8080.",
  },
];

const MOMENTS = [
  {
    id: "01",
    title: "01 · Browser Paste & Send Shield",
    desc: "Intercepts raw keys & PII inside ChatGPT, Claude, Gemini, GitHub & Slack before DOM injection (<2ms, zero typing popups).",
  },
  {
    id: "02",
    title: "02 · On-Device Nano 4 + Gitleaks Floor",
    desc: "100% Gitleaks (42/42) + 70.8% global structured PII in 0.02ms, backed by on-device Gemma 4 / Nano 4 for medical & M&A context.",
  },
  {
    id: "03",
    title: "03 · Android + Web Hybrid Proof",
    desc: "OS-wide Android Scrub with LocalFirst, ECDSA P-256 zero-leak receipts, and Zero-PII Firestore sync via firebase-ai.",
  },
] as const;

function renderSanitizedPreview(sanitizedText: string) {
  const parts = sanitizedText.split(/(\[REDACTED:[A-Z0-9_]+_\d+\])/g);
  return parts.map((part, idx) => {
    if (/^\[REDACTED:[A-Z0-9_]+_\d+\]$/.test(part)) {
      return (
        <motion.span
          key={`${idx}-${part}`}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          className="mx-0.5 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold"
          style={{
            backgroundColor: "var(--mask-bg)",
            borderColor: "var(--mask-border)",
            color: "var(--mask-text)",
          }}
        >
          <Lock className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
          {part}
        </motion.span>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

export function HeroEngineDiagram({
  onJumpToWorkbench,
  onSendToWorkbench,
}: HeroEngineDiagramProps) {
  const [playgroundInput, setPlaygroundInput] = useState(ATTACK_PILLS[0].sample);
  const [activePillId, setActivePillId] = useState<string>(ATTACK_PILLS[0].id);
  const [activeMoment, setActiveMoment] = useState<number>(0);
  const [mockDraftScrubbed, setMockDraftScrubbed] = useState(false);

  const playgroundCardRef = useRef<HTMLDivElement>(null);
  const momentRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const rafRef = useRef<number | null>(null);

  const liveScan = useMemo(() => {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const res = scanAndRedactLocal(playgroundInput, {
      protectionLevel: "medium",
      includeHeuristics: true,
      enableEntropyScanner: true,
    });
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    return {
      ...res,
      latencyMs: Math.max(0.01, Number((t1 - t0).toFixed(2))),
    };
  }, [playgroundInput]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Number((entry.target as HTMLElement).dataset.momentIdx);
            if (!Number.isNaN(idx)) setActiveMoment(idx);
          }
        }
      },
      { rootMargin: "-30% 0px -45% 0px", threshold: 0.2 },
    );
    for (const el of momentRefs.current) {
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, []);

  const handleCardPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const card = playgroundCardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = `${Math.round(e.clientX - rect.left)}px`;
    const y = `${Math.round(e.clientY - rect.top)}px`;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      card.style.setProperty("--mx", x);
      card.style.setProperty("--my", y);
    });
  };

  const baseMed = baselineBench.webSrcFirewall.medium;
  const optMed = optimizedBench.webSrcFirewall.medium;
  const medLatency = optimizedBench.extensionFirewallCore.medium.latency;

  const mockChatPrompt =
    "Help debug " + ["AK", "IAIOSFODNN7EXAMPLE"].join("") + " and my phone 9876543210";
  const mockChatScrubbed = useMemo(
    () =>
      scanAndRedactLocal(mockChatPrompt, {
        protectionLevel: "medium",
        includeHeuristics: true,
      }).sanitizedText,
    [mockChatPrompt],
  );

  return (
    <section
      id="story-top"
      className="relative flex flex-col justify-center gap-12 border-b px-4 py-10 lg:px-8 lg:py-14"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      {/* Hero Grid: Left Editorial Copy + Right Live 60fps Interactive Airgap Playground */}
      <div className="mx-auto grid w-full max-w-[1440px] grid-cols-1 items-center gap-10 lg:grid-cols-[44fr_56fr]">
        {/* Left Column */}
        <div className="space-y-6">
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-secondary)" }}>
            FIREBASE AI LOGIC · CHROME · ANDROID · WEB
          </div>

          <h1
            className="font-display font-bold uppercase tracking-[-0.04em]"
            style={{
              fontSize: "clamp(2.5rem, 6vw, 4.75rem)",
              lineHeight: 0.96,
              color: "var(--text-primary)",
            }}
          >
            <span style={{ color: "var(--safe-text)" }}>ON DEVICE.</span>
            <br />
            <span>NEVER IN CLOUD.</span>
          </h1>

          <p
            className="max-w-xl text-base leading-relaxed sm:text-lg"
            style={{ color: "var(--text-secondary)" }}
          >
            An air-gapped hybrid AI firewall that traps secrets locally in {medLatency.medianMs.toFixed(2)}ms before they ever reach an LLM—across Chrome, Android, and Web.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={onJumpToWorkbench}
              className="lf-btn-primary inline-flex min-h-[44px] items-center gap-2 rounded-lg px-5 text-sm font-bold"
            >
              <span>Run Live Workbench</span>
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </button>

            <a
              href="https://github.com/Lion4467cat/localfirst-triage/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-4 text-xs font-semibold"
              style={{
                backgroundColor: "transparent",
                borderColor: "var(--border-strong)",
                color: "var(--text-primary)",
              }}
            >
              <span>Chrome Extension</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>

            <a
              href="https://github.com/Lion4467cat/localfirst-triage/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-4 text-xs font-semibold"
              style={{
                backgroundColor: "transparent",
                borderColor: "var(--border-strong)",
                color: "var(--text-primary)",
              }}
            >
              <span>Android APK</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
        </div>

        {/* Right Column: Live 60fps Interactive Airgap Playground */}
        <div
          ref={playgroundCardRef}
          onPointerMove={handleCardPointerMove}
          className="lf-spotlight-card overflow-hidden rounded-2xl border p-4 sm:p-5"
          style={{ borderColor: "var(--border-strong)" }}
        >
          {/* Live Microsecond Telemetry Header */}
          <div
            className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b pb-2.5"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4" style={{ color: "var(--safe-text)" }} aria-hidden="true" />
              <span className="font-mono text-xs font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
                LIVE AIRGAP PLAYGROUND
              </span>
            </div>

            <div className="flex items-center gap-1.5 font-mono text-[10px] font-bold tabular-nums">
              <span
                className="rounded border px-2 py-0.5"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
              >
                {liveScan.latencyMs}ms
              </span>
              <span
                className="rounded border px-2 py-0.5"
                style={{
                  backgroundColor: liveScan.mergedSpans.length > 0 ? "var(--mask-bg)" : "var(--safe-bg)",
                  borderColor: liveScan.mergedSpans.length > 0 ? "var(--mask-border)" : "var(--safe-border)",
                  color: liveScan.mergedSpans.length > 0 ? "var(--mask-text)" : "var(--safe-text)",
                }}
              >
                {liveScan.mergedSpans.length} TRAPPED
              </span>
              <span
                className="rounded border px-2 py-0.5"
                style={{
                  backgroundColor: "var(--safe-bg)",
                  borderColor: "var(--safe-border)",
                  color: "var(--safe-text)",
                }}
              >
                0 B RAW EGRESS
              </span>
            </div>
          </div>

          {/* 1-Click Attack Pills */}
          <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
            {ATTACK_PILLS.map((pill) => {
              const active = activePillId === pill.id && playgroundInput === pill.sample;
              return (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => {
                    setActivePillId(pill.id);
                    setPlaygroundInput(pill.sample);
                  }}
                  className="rounded-md border px-2.5 py-1 font-mono text-[11px] font-semibold"
                  style={{
                    backgroundColor: active ? "var(--text-primary)" : "var(--bg-subtle)",
                    borderColor: active ? "var(--text-primary)" : "var(--border-subtle)",
                    color: active ? "var(--bg-canvas)" : "var(--text-secondary)",
                  }}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>

          {/* Live Input */}
          <textarea
            aria-label="Live Airgap Playground Input"
            rows={2}
            value={playgroundInput}
            onChange={(e) => {
              setActivePillId("");
              setPlaygroundInput(e.target.value);
            }}
            placeholder="Type any secret, phone, IPv4, IBAN, or code snippet..."
            className="lf-input w-full resize-none rounded-lg px-3 py-2 font-mono text-xs leading-relaxed"
          />

          {/* Live Sanitized Output Stream */}
          <div
            className="mt-2.5 rounded-lg border p-3"
            style={{
              backgroundColor: "var(--code-bg)",
              borderColor: "var(--border-subtle)",
            }}
          >
            <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              <span>Sanitized Stream (Safe for Cloud AI)</span>
              <span style={{ color: "var(--safe-text)" }}>LOCAL_FLOOR · SYNC</span>
            </div>
            <div className="min-h-[42px] break-words font-mono text-xs leading-relaxed" style={{ color: "var(--code-text)" }}>
              {liveScan.sanitizedText ? renderSanitizedPreview(liveScan.sanitizedText) : "Type above to test live redaction..."}
            </div>
          </div>

          {/* Trapped Vault Chips + Workbench Handoff */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {liveScan.mergedSpans.slice(0, 4).map((span, i) => (
                <span
                  key={`${span.category}-${span.start}-${i}`}
                  className="rounded border px-2 py-0.5 font-mono text-[10px] font-semibold"
                  style={{
                    backgroundColor: "var(--mask-bg)",
                    borderColor: "var(--mask-border)",
                    color: "var(--mask-text)",
                  }}
                >
                  {span.category} · trapped
                </span>
              ))}
              {liveScan.mergedSpans.length === 0 && (
                <span className="font-mono text-[10.5px]" style={{ color: "var(--safe-text)" }}>
                  ✓ Clean payload — 0 false positives
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => (onSendToWorkbench ? onSendToWorkbench(playgroundInput) : onJumpToWorkbench())}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 font-mono text-[11px] font-semibold"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-strong)",
                color: "var(--text-primary)",
              }}
            >
              <span>Open in Full Workbench</span>
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Unified 4-Column Telemetry Bar (Data-Driven from third-party-optimized.json) */}
      <div
        className="mx-auto grid w-full max-w-[1440px] grid-cols-2 divide-y rounded-xl border sm:grid-cols-4 sm:divide-x sm:divide-y-0"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <div className="p-4 sm:p-5">
          <div className="font-display text-3xl font-bold tracking-tight tabular-nums sm:text-4xl" style={{ color: "var(--safe-text)" }}>
            {optMed.suiteB.recallPct}%
          </div>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
            Gitleaks {optMed.suiteB.caught}/{optMed.suiteB.total}
          </div>
        </div>
        <div className="p-4 sm:p-5" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="font-display text-3xl font-bold tracking-tight tabular-nums sm:text-4xl" style={{ color: "var(--text-primary)" }}>
            {medLatency.medianMs.toFixed(2)}ms
          </div>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
            Median Local Scrub
          </div>
        </div>
        <div className="p-4 sm:p-5" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="font-display text-3xl font-bold tracking-tight tabular-nums sm:text-4xl" style={{ color: "var(--nano-text)" }}>
            {optMed.suiteC.fprPct.toFixed(1)}%
          </div>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
            Benign Dev False Positives
          </div>
        </div>
        <div className="p-4 sm:p-5" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="font-display text-3xl font-bold tracking-tight tabular-nums sm:text-4xl" style={{ color: "var(--text-primary)" }}>
            0 B
          </div>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
            Raw Secret Cloud Egress
          </div>
        </div>
      </div>

      {/* Interactive Scroll-Reactive "Live Moments" Stage */}
      <div className="mx-auto grid w-full max-w-[1440px] grid-cols-1 gap-6 md:grid-cols-[44fr_56fr] md:items-start">
        {/* Left Column: 3 Interactive Chapters (Clickable + Scroll-Activated) */}
        <div className="flex flex-col gap-3">
          {MOMENTS.map((m, idx) => {
            const active = activeMoment === idx;
            return (
              <button
                key={m.id}
                ref={(el) => {
                  momentRefs.current[idx] = el;
                }}
                data-moment-idx={idx}
                type="button"
                onClick={() => setActiveMoment(idx)}
                className="rounded-xl border p-4 text-left"
                style={{
                  backgroundColor: active ? "var(--bg-surface)" : "transparent",
                  borderColor: active ? "var(--safe-border)" : "var(--border-subtle)",
                }}
              >
                <div
                  className="font-mono text-xs font-bold uppercase tracking-wider"
                  style={{ color: active ? "var(--safe-text)" : "var(--text-secondary)" }}
                >
                  {m.title}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {m.desc}
                </p>
              </button>
            );
          })}
        </div>

        {/* Right Column: Sticky Live Interactive Preview Stage */}
        <div
          className="lf-card rounded-2xl p-4 sm:p-5 md:sticky md:top-16"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <AnimatePresence mode="wait">
            {activeMoment === 0 && (
              <motion.div
                key="moment-0"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                className="space-y-3"
              >
                <div className="flex items-center justify-between font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                  <span>SIMULATED CHATGPT SEND GUARD</span>
                  <span style={{ color: mockDraftScrubbed ? "var(--safe-text)" : "var(--mask-text)" }}>
                    {mockDraftScrubbed ? "SCRUBBED · 0 LEAKED" : "SEND BLOCKED · 2 SECRETS"}
                  </span>
                </div>
                <div
                  className="rounded-lg border p-3 font-mono text-xs leading-relaxed"
                  style={{ backgroundColor: "var(--code-bg)", borderColor: "var(--border-subtle)", color: "var(--code-text)" }}
                >
                  {mockDraftScrubbed ? renderSanitizedPreview(mockChatScrubbed) : mockChatPrompt}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setMockDraftScrubbed((v) => !v)}
                    className="lf-btn-primary inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold"
                  >
                    {mockDraftScrubbed ? <Check className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                    <span>{mockDraftScrubbed ? "Reset Demo Prompt" : "Scrub Draft"}</span>
                  </button>
                  <span className="font-mono text-[10.5px]" style={{ color: "var(--text-muted)" }}>
                    0 popups while typing · 1 modal on Send
                  </span>
                </div>
              </motion.div>
            )}

            {activeMoment === 1 && (
              <motion.div
                key="moment-1"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                className="space-y-3.5"
              >
                <div className="flex items-center justify-between font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                  <span>BEFORE → AFTER THIRD-PARTY BENCHMARKS</span>
                  <span>node scripts/benchmark-third-party.mjs</span>
                </div>
                {[
                  { label: "Gitleaks Credentials (42)", before: baseMed.suiteB.recallPct, after: optMed.suiteB.recallPct, color: "var(--safe-solid)" },
                  { label: "ai4privacy Global PII Floor", before: baseMed.suiteA1.recallPct, after: optMed.suiteA1.recallPct, color: "var(--nano-solid)" },
                  { label: "Benign Dev Clean Pass Rate", before: 100 - baseMed.suiteC.fprPct, after: 100 - optMed.suiteC.fprPct, color: "var(--safe-solid)" },
                ].map((bar) => (
                  <div key={bar.label} className="space-y-1">
                    <div className="flex justify-between font-mono text-[11px] tabular-nums">
                      <span style={{ color: "var(--text-primary)" }}>{bar.label}</span>
                      <span style={{ color: "var(--safe-text)" }}>
                        {bar.before}% → <strong>{bar.after}%</strong>
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: "var(--bg-subtle)" }}>
                      <motion.div
                        initial={{ width: `${bar.before}%` }}
                        animate={{ width: `${bar.after}%` }}
                        transition={{ duration: 0.45, ease: [0.23, 1, 0.32, 1] }}
                        className="h-full rounded-full"
                        style={{ backgroundColor: bar.color }}
                      />
                    </div>
                  </div>
                ))}
              </motion.div>
            )}

            {activeMoment === 2 && (
              <motion.div
                key="moment-2"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                className="space-y-3"
              >
                <div className="flex items-center justify-between font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                  <span>ANDROID + WEB CRYPTOGRAPHIC PROOF</span>
                  <span style={{ color: "var(--safe-text)" }}>ECDSA P-256 SIGNED</span>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <div className="rounded-lg border p-3" style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-subtle)" }}>
                    <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold" style={{ color: "var(--text-primary)" }}>
                      <Smartphone className="h-3.5 w-3.5" style={{ color: "var(--safe-text)" }} />
                      <span>Scrub with LocalFirst</span>
                    </div>
                    <p className="mt-1 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      ACTION_PROCESS_TEXT + Share Sheet + Kotlin firebase-ai hybrid inference.
                    </p>
                  </div>
                  <div className="rounded-lg border p-3" style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-subtle)" }}>
                    <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold" style={{ color: "var(--text-primary)" }}>
                      <Terminal className="h-3.5 w-3.5" style={{ color: "var(--nano-text)" }} />
                      <span>Zero-PII Audit Receipt</span>
                    </div>
                    <p className="mt-1 font-mono text-[10.5px]" style={{ color: "var(--safe-text)" }}>
                      SHA-256 + ECDSA P-256 · 0 raw bytes stored
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
