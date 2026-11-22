import { useEffect, useRef, useState } from "react";
import { createTimeline, stagger, svg } from "animejs";
import { ArrowDown, ExternalLink, Pause, Play, ShieldCheck } from "lucide-react";
import { createSafeScope } from "../utils/animeScope";
import baselineBench from "../../benchmarks/third-party-baseline.json";
import optimizedBench from "../../benchmarks/third-party-optimized.json";

interface HeroEngineDiagramProps {
  onJumpToWorkbench: () => void;
}

const CHAMBER_TOOLTIPS = [
  {
    id: "regex",
    title: "01 Regex (<0.03ms)",
    desc: "100% Gitleaks (42/42) + Luhn, IBAN mod-97, IPv4/IPv6 & Shannon entropy.",
    sdk: "REGEX_FIREWALL + ENTROPY_SCANNER",
  },
  {
    id: "nano",
    title: "02 Nano 4 GPU",
    desc: "Chrome's on-device Gemma 4 reads human context locally—catching PHI, passwords & deals.",
    sdk: "InferenceMode.ONLY_ON_DEVICE",
  },
  {
    id: "airgap",
    title: "03 Airgap Gate",
    desc: "Programmatic verifyZeroLeakage() + ECDSA P-256 receipt before Cloud Gemini sees a byte.",
    sdk: "verifyZeroLeakage() + ECDSA P-256",
  },
];

export function HeroEngineDiagram({
  onJumpToWorkbench,
}: HeroEngineDiagramProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<ReturnType<typeof createTimeline> | null>(null);
  const [paused, setPaused] = useState(false);
  const [hoveredChamber, setHoveredChamber] = useState<string | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const scope = createSafeScope(root, (reduced) => {
      if (reduced) return;

      const mainMotion = svg.createMotionPath("#hero-main-track");
      const regexVaultMotion = svg.createMotionPath("#hero-regex-vault-track");
      const nanoVaultMotion = svg.createMotionPath("#hero-nano-vault-track");
      const traces = svg.createDrawable(".hero-trace");

      const tl = createTimeline({
        loop: true,
        defaults: { ease: "inOutQuad" },
      });

      tl.add(traces, {
        draw: ["0 0", "0 1"],
        duration: 700,
        delay: stagger(70),
      })
        .add(
          ".hero-safe-packet",
          {
            ...mainMotion,
            opacity: [0, 1, 1, 0],
            duration: 1800,
          },
          200,
        )
        .add(
          ".hero-threat-regex",
          {
            ...regexVaultMotion,
            opacity: [0, 1, 1, 0],
            duration: 1300,
          },
          260,
        )
        .add(
          ".hero-threat-nano",
          {
            ...nanoVaultMotion,
            opacity: [0, 1, 1, 0],
            duration: 1300,
          },
          620,
        );

      tlRef.current = tl;
    });

    return () => {
      tlRef.current = null;
      scope.revert();
    };
  }, []);

  const togglePlayback = () => {
    const tl = tlRef.current;
    if (!tl) return;
    if (paused) {
      tl.play();
      setPaused(false);
    } else {
      tl.pause();
      setPaused(true);
    }
  };

  const activeTooltip = CHAMBER_TOOLTIPS.find((c) => c.id === hoveredChamber) ?? null;
  const baseMed = baselineBench.webSrcFirewall.medium;
  const optMed = optimizedBench.webSrcFirewall.medium;
  const medLatency = optimizedBench.extensionFirewallCore.medium.latency;

  return (
    <section
      id="story-top"
      ref={rootRef}
      className="lf-hero-glow relative flex flex-col justify-center gap-12 border-b px-4 py-10 lg:px-8 lg:py-14"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      {/* 00 · Oversized Editorial Hero */}
      <div className="mx-auto grid w-full max-w-[1440px] grid-cols-1 items-center gap-10 lg:grid-cols-[46fr_54fr]">
        {/* Left Column: Lando Kinetic Confidence × Two-Do Clarity */}
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
            <span
              className="inline-block rounded-sm px-1.5 py-0.5"
              style={{
                backgroundColor: "var(--accent-primary)",
                color: "var(--accent-on-primary)",
              }}
            >
              ON DEVICE.
            </span>
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

        {/* Right Column: Live Clockwork Airgap Circuit Engine */}
        <div
          className="lf-card relative overflow-hidden rounded-2xl border p-4 sm:p-5"
          style={{ borderColor: "var(--border-strong)" }}
        >
          {/* Instrument Header + Ruler Ticks + Pause/Play */}
          <div
            className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b pb-2.5"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" style={{ color: "var(--safe-text)" }} aria-hidden="true" />
              <span className="font-mono text-xs font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
                CLOCKWORK AIRGAP ENGINE
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span
                className="rounded border px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums"
                style={{
                  backgroundColor: "var(--mask-bg)",
                  borderColor: "var(--mask-border)",
                  color: "var(--mask-text)",
                }}
              >
                3 BLOCKED
              </span>
              <span
                className="rounded border px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums"
                style={{
                  backgroundColor: "var(--safe-bg)",
                  borderColor: "var(--safe-border)",
                  color: "var(--safe-text)",
                }}
              >
                0 LEAKED
              </span>
              <button
                type="button"
                onClick={togglePlayback}
                aria-label={paused ? "Play circuit animation" : "Pause circuit animation"}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] font-medium"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
              >
                {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                <span>{paused ? "Play" : "Pause"}</span>
              </button>
            </div>
          </div>

          <div className="lf-ruler-ticks mb-3 h-1.5 w-full opacity-55" aria-hidden="true" />

          {/* SVG Circuit Diagram (Strict Edge-to-Edge Gap-Only Connectors) */}
          <div className="relative">
            <svg
              viewBox="0 0 640 248"
              className="h-auto w-full"
              role="img"
              aria-label="Architectural Airgap Pipeline showing secrets trapped in Local Vault and safe sanitized output routed to Chrome, Android, and Cloud AI"
            >
              <defs>
                <marker id="lf-arrow-safe" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
                  <path d="M 0 1 L 7 4 L 0 7 z" fill="var(--safe-solid)" />
                </marker>
                <marker id="lf-arrow-neutral" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
                  <path d="M 0 1 L 7 4 L 0 7 z" fill="var(--border-strong)" />
                </marker>
                <marker id="lf-arrow-mask" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
                  <path d="M 0 1 L 7 4 L 0 7 z" fill="var(--mask-solid)" />
                </marker>
              </defs>

              {/* Strict Gap-Only Row 1 Connectors (y=64) */}
              <line className="hero-trace" x1="116" y1="64" x2="150" y2="64" stroke="var(--border-strong)" strokeWidth="1.5" markerEnd="url(#lf-arrow-neutral)" />
              <line className="hero-trace" x1="276" y1="64" x2="310" y2="64" stroke="var(--border-strong)" strokeWidth="1.5" markerEnd="url(#lf-arrow-neutral)" />
              <line className="hero-trace" x1="436" y1="64" x2="470" y2="64" stroke="var(--safe-solid)" strokeWidth="1.5" markerEnd="url(#lf-arrow-safe)" />

              {/* Row 2 Orthogonal Blocked Branch (01 Regex + 02 Nano 4 -> LOCAL VAULT) */}
              <path
                id="hero-regex-vault-track"
                className="hero-trace"
                d="M 214 96 L 214 132 L 294 132 L 294 158"
                fill="none"
                stroke="var(--mask-solid)"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                markerEnd="url(#lf-arrow-mask)"
              />
              <path
                id="hero-nano-vault-track"
                className="hero-trace"
                d="M 374 96 L 374 132 L 294 132 L 294 158"
                fill="none"
                stroke="var(--mask-solid)"
                strokeWidth="1.5"
                strokeDasharray="4 3"
              />

              {/* Row 2 Orthogonal Safe Output Branch (03 Airgap -> SAFE OUTPUT) */}
              <path
                id="hero-main-track"
                className="hero-trace"
                d="M 550 96 L 550 158"
                fill="none"
                stroke="var(--safe-solid)"
                strokeWidth="1.75"
                markerEnd="url(#lf-arrow-safe)"
              />

              {/* Row 1 Node 1: RAW INPUT (x=12..116, y=32..96) */}
              <g>
                <rect x="12" y="32" width="104" height="64" rx="8" fill="var(--bg-subtle)" stroke="var(--border-strong)" strokeWidth="1.25" strokeDasharray="4 3" />
                <text x="64" y="60" textAnchor="middle" fill="var(--text-primary)" fontSize="11" fontWeight="700" fontFamily="var(--font-mono)">RAW INPUT</text>
                <text x="64" y="77" textAnchor="middle" fill="var(--text-muted)" fontSize="9.5" fontFamily="var(--font-mono)">Paste / Log</text>
              </g>

              {/* Row 1 Node 2: 01 REGEX (x=152..276, y=32..96) */}
              <g onMouseEnter={() => setHoveredChamber("regex")} onMouseLeave={() => setHoveredChamber(null)} className="cursor-pointer">
                <rect x="152" y="32" width="124" height="64" rx="8" fill="var(--bg-subtle)" stroke={hoveredChamber === "regex" ? "var(--mask-solid)" : "var(--border-strong)"} strokeWidth={hoveredChamber === "regex" ? "1.75" : "1.25"} />
                <text x="214" y="60" textAnchor="middle" fill="var(--text-primary)" fontSize="11" fontWeight="700" fontFamily="var(--font-mono)">01 REGEX</text>
                <text x="214" y="77" textAnchor="middle" fill="var(--text-muted)" fontSize="9.5" fontFamily="var(--font-mono)">&lt;0.03ms · 42 Rules</text>
              </g>

              {/* Row 1 Node 3: 02 NANO 4 (x=312..436, y=32..96) */}
              <g onMouseEnter={() => setHoveredChamber("nano")} onMouseLeave={() => setHoveredChamber(null)} className="cursor-pointer">
                <rect x="312" y="32" width="124" height="64" rx="8" fill="var(--nano-bg)" stroke={hoveredChamber === "nano" ? "var(--nano-solid)" : "var(--nano-border)"} strokeWidth={hoveredChamber === "nano" ? "2" : "1.25"} />
                <text x="374" y="60" textAnchor="middle" fill="var(--nano-text)" fontSize="11" fontWeight="700" fontFamily="var(--font-mono)">02 NANO 4</text>
                <text x="374" y="77" textAnchor="middle" fill="var(--text-secondary)" fontSize="9.5" fontFamily="var(--font-mono)">On-Device Gemma 4</text>
              </g>

              {/* Row 1 Node 4: 03 AIRGAP GATE (x=472..628, y=32..96) */}
              <g onMouseEnter={() => setHoveredChamber("airgap")} onMouseLeave={() => setHoveredChamber(null)} className="cursor-pointer">
                <rect x="472" y="32" width="156" height="64" rx="8" fill="var(--safe-bg)" stroke={hoveredChamber === "airgap" ? "var(--safe-solid)" : "var(--safe-border)"} strokeWidth={hoveredChamber === "airgap" ? "2" : "1.5"} />
                <text x="550" y="60" textAnchor="middle" fill="var(--safe-text)" fontSize="11" fontWeight="700" fontFamily="var(--font-mono)">03 AIRGAP GATE</text>
                <text x="550" y="77" textAnchor="middle" fill="var(--safe-text)" fontSize="9.5" fontFamily="var(--font-mono)">0 Raw Bytes Egress</text>
              </g>

              {/* Row 2: LOCAL VAULT · TRAPPED (x=152..436, y=160..226) */}
              <g>
                <rect x="152" y="160" width="284" height="66" rx="8" fill="var(--mask-bg)" stroke="var(--mask-border)" strokeWidth="1.5" />
                <text x="294" y="188" textAnchor="middle" fill="var(--mask-text)" fontSize="11" fontWeight="700" fontFamily="var(--font-mono)">LOCAL VAULT · TRAPPED</text>
                <text x="294" y="207" textAnchor="middle" fill="var(--text-secondary)" fontSize="9.5" fontFamily="var(--font-mono)">AWS Keys · JWTs · PHI · PII (Never Leaves Device)</text>
              </g>

              {/* Row 2: SAFE OUTPUT (x=472..628, y=160..226) */}
              <g>
                <rect x="472" y="160" width="156" height="66" rx="8" fill="var(--safe-bg)" stroke="var(--safe-border)" strokeWidth="1.5" />
                <text x="550" y="188" textAnchor="middle" fill="var(--safe-text)" fontSize="11" fontWeight="700" fontFamily="var(--font-mono)">SAFE OUTPUT</text>
                <text x="550" y="207" textAnchor="middle" fill="var(--text-secondary)" fontSize="9.5" fontFamily="var(--font-mono)">Chrome · Android · Cloud AI</text>
              </g>

              {/* Clean 3.5px Signal Pulses Along Connector Wires */}
              <circle className="hero-safe-packet" cx="0" cy="0" r="3.5" fill="var(--safe-solid)" opacity="0" />
              <circle className="hero-threat-regex" cx="0" cy="0" r="3.5" fill="var(--mask-solid)" opacity="0" />
              <circle className="hero-threat-nano" cx="0" cy="0" r="3.5" fill="var(--mask-solid)" opacity="0" />
            </svg>
          </div>

          {/* 1-Line SDK Caption Footer */}
          <div
            className="mt-2 flex min-h-[40px] items-center justify-between gap-2 rounded-lg border px-3 py-1.5 font-mono text-[11px]"
            style={{
              backgroundColor: "var(--bg-subtle)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-secondary)",
            }}
          >
            {activeTooltip ? (
              <>
                <span style={{ color: "var(--text-primary)" }}>
                  <strong>{activeTooltip.title}:</strong> {activeTooltip.desc}
                </span>
                <span className="hidden shrink-0 text-[10px] sm:inline" style={{ color: "var(--nano-text)" }}>
                  {activeTooltip.sdk}
                </span>
              </>
            ) : (
              <span>
                01 Regex: 100% Gitleaks · 02 Nano 4: ONLY_ON_DEVICE · 03 Airgap: verifyZeroLeakage() + ECDSA P-256
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Massive Pit-Wall Telemetry Strip (Data-Driven from third-party-optimized.json) */}
      <div
        className="mx-auto grid w-full max-w-[1440px] grid-cols-2 divide-y border sm:grid-cols-4 sm:divide-x sm:divide-y-0"
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

      {/* 01 · THE AIRGAP | 02 · VERIFIED THIRD-PARTY PROOF | 03 · THREE SURFACES */}
      <div className="mx-auto grid w-full max-w-[1440px] gap-6 lg:grid-cols-3">
        <div className="border-t pt-4" style={{ borderColor: "var(--border-strong)" }}>
          <div className="font-mono text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--safe-text)" }}>
            01 · The Airgap
          </div>
          <div className="mt-3 space-y-2.5 text-xs" style={{ color: "var(--text-secondary)" }}>
            <p><strong style={{ color: "var(--text-primary)" }}>i. Deterministic &lt;1ms Floor:</strong> Regex, Luhn, IBAN mod-97, IPv4/IPv6 &amp; Shannon entropy lock secrets locally.</p>
            <p><strong style={{ color: "var(--text-primary)" }}>ii. On-Device Gemini Nano 4:</strong> Chrome Gemma 4 reads unstructured medical, family &amp; M&amp;A context (<code className="font-mono">ONLY_ON_DEVICE</code>).</p>
            <p><strong style={{ color: "var(--text-primary)" }}>iii. Fail-Closed Cloud Escalation:</strong> <code className="font-mono">verifyZeroLeakage()</code> blocks any unmasked span before Cloud Gemini.</p>
          </div>
        </div>

        <div className="border-t pt-4" style={{ borderColor: "var(--border-strong)" }}>
          <div className="font-mono text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--nano-text)" }}>
            02 · Verified Third-Party Proof
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left font-mono text-[11px] tabular-nums">
              <thead>
                <tr className="border-b" style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}>
                  <th className="py-1 pr-2">Suite</th>
                  <th className="py-1 pr-2">Before</th>
                  <th className="py-1">After</th>
                </tr>
              </thead>
              <tbody style={{ color: "var(--text-primary)" }}>
                <tr className="border-b" style={{ borderColor: "var(--border-subtle)" }}>
                  <td className="py-1.5 pr-2">Gitleaks (42)</td>
                  <td className="py-1.5 pr-2" style={{ color: "var(--text-secondary)" }}>{baseMed.suiteB.recallPct}%</td>
                  <td className="py-1.5 font-bold" style={{ color: "var(--safe-text)" }}>{optMed.suiteB.recallPct}%</td>
                </tr>
                <tr className="border-b" style={{ borderColor: "var(--border-subtle)" }}>
                  <td className="py-1.5 pr-2">ai4privacy A1</td>
                  <td className="py-1.5 pr-2" style={{ color: "var(--text-secondary)" }}>{baseMed.suiteA1.recallPct}%</td>
                  <td className="py-1.5 font-bold" style={{ color: "var(--nano-text)" }}>{optMed.suiteA1.recallPct}% + Nano 4</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-2">Benign FPR</td>
                  <td className="py-1.5 pr-2" style={{ color: "var(--text-secondary)" }}>{baseMed.suiteC.fprPct}%</td>
                  <td className="py-1.5 font-bold" style={{ color: "var(--safe-text)" }}>{optMed.suiteC.fprPct}% (0 idemFail)</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
            Reproduce: <code>node scripts/benchmark-third-party.mjs</code>
          </p>
        </div>

        <div className="border-t pt-4" style={{ borderColor: "var(--border-strong)" }}>
          <div className="font-mono text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--text-primary)" }}>
            03 · Three Surfaces, One Engine
          </div>
          <div className="mt-3 space-y-2.5 text-xs" style={{ color: "var(--text-secondary)" }}>
            <p><strong style={{ color: "var(--text-primary)" }}>Chrome Extension:</strong> Live Paste &amp; Send guardrail on ChatGPT, Claude, Gemini, GitHub &amp; Slack.</p>
            <p><strong style={{ color: "var(--text-primary)" }}>Android App:</strong> OS-wide <code className="font-mono">Scrub with LocalFirst</code> + Share Sheet + Kotlin <code className="font-mono">firebase-ai</code>.</p>
            <p><strong style={{ color: "var(--text-primary)" }}>Web PWA:</strong> Hybrid Workbench, &lt;5ms IndexedDB Dedup, RAM Rehydration &amp; ECDSA Receipts.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
