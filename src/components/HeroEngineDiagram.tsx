import { useEffect, useRef, useState } from "react";
import { createTimeline, stagger, svg } from "animejs";
import { ArrowDown, ChevronDown, ExternalLink, Pause, Play, ShieldCheck } from "lucide-react";
import { createSafeScope } from "../utils/animeScope";
import baselineBench from "../../benchmarks/third-party-baseline.json";
import optimizedBench from "../../benchmarks/third-party-optimized.json";

interface HeroEngineDiagramProps {
  onJumpToWorkbench: () => void;
  onJumpToProcess: () => void;
}

const CHAMBER_TOOLTIPS = [
  {
    id: "regex",
    title: "01 Regex (<2ms)",
    desc: "Deterministic patterns + Luhn + Shannon entropy trap keys, JWTs, cards, and emails.",
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
    desc: "Programmatic verifyZeroLeakage() blocks any unmasked span before Cloud Gemini sees a byte.",
    sdk: "InferenceMode.PREFER_IN_CLOUD",
  },
];

export function HeroEngineDiagram({
  onJumpToWorkbench,
  onJumpToProcess,
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
        duration: 750,
        delay: stagger(80),
      })
        .add(
          ".hero-safe-packet",
          {
            ...mainMotion,
            opacity: [0, 1, 1, 0],
            duration: 2400,
          },
          200,
        )
        .add(
          ".hero-threat-regex",
          {
            ...regexVaultMotion,
            opacity: [0, 1, 1, 0],
            duration: 1550,
            delay: stagger(1050),
          },
          260,
        )
        .add(
          ".hero-threat-nano",
          {
            ...nanoVaultMotion,
            opacity: [0, 1, 1, 0],
            duration: 1850,
          },
          780,
        )
        .add(
          ".hero-vault-pulse",
          {
            scale: [1, 1.045, 1],
            duration: 420,
          },
          1550,
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

            <button
              type="button"
              onClick={onJumpToProcess}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3.5 text-xs font-medium"
              style={{
                backgroundColor: "transparent",
                borderColor: "var(--border-subtle)",
                color: "var(--text-secondary)",
              }}
            >
              <span>01–03 Architecture</span>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
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

          {/* SVG Circuit Diagram */}
          <div className="relative">
            <svg
              viewBox="0 0 600 245"
              className="h-auto w-full"
              role="img"
              aria-label="Animated Clockwork Airgap Engine showing secrets trapped locally and safe stack trace flowing to Cloud Gemini"
            >
              {/* Main Safe Track (Left -> 01 Regex -> 02 Nano 4 -> 03 Airgap -> Cloud/Extension/Android) */}
              <path
                id="hero-main-track"
                className="hero-trace"
                d="M 24 78 L 515 78"
                fill="none"
                stroke="var(--safe-solid)"
                strokeWidth="2"
                strokeOpacity="0.55"
              />

              {/* Branch Tracks to Extension & Android */}
              <path
                className="hero-trace"
                d="M 445 78 L 472 78 L 472 36 L 515 36"
                fill="none"
                stroke="var(--nano-solid)"
                strokeWidth="1.5"
                strokeOpacity="0.6"
              />
              <path
                className="hero-trace"
                d="M 445 78 L 472 78 L 472 120 L 515 120"
                fill="none"
                stroke="var(--safe-solid)"
                strokeWidth="1.5"
                strokeOpacity="0.6"
              />

              {/* Threat Deflection Track 1: Regex -> Local Vault */}
              <path
                id="hero-regex-vault-track"
                className="hero-trace"
                d="M 24 78 L 127 78 Q 127 118 148 174"
                fill="none"
                stroke="var(--mask-solid)"
                strokeWidth="1.75"
                strokeDasharray="4 4"
                strokeOpacity="0.65"
              />

              {/* Threat Deflection Track 2: Nano 4 -> Local Vault */}
              <path
                id="hero-nano-vault-track"
                className="hero-trace"
                d="M 24 78 L 261 78 Q 261 128 226 174"
                fill="none"
                stroke="var(--nano-solid)"
                strokeWidth="1.75"
                strokeDasharray="4 4"
                strokeOpacity="0.65"
              />

              {/* Chamber 01: Regex (<2ms) */}
              <g
                onMouseEnter={() => setHoveredChamber("regex")}
                onMouseLeave={() => setHoveredChamber(null)}
                className="cursor-pointer"
              >
                <rect
                  x="76"
                  y="46"
                  width="102"
                  height="64"
                  rx="10"
                  fill="var(--bg-subtle)"
                  stroke={hoveredChamber === "regex" ? "var(--mask-solid)" : "var(--border-strong)"}
                  strokeWidth={hoveredChamber === "regex" ? "1.75" : "1.25"}
                />
                <text x="127" y="71" textAnchor="middle" fill="var(--text-primary)" fontSize="11" fontWeight="700" fontFamily="var(--font-mono)">
                  01 Regex
                </text>
                <text x="127" y="90" textAnchor="middle" fill="var(--text-muted)" fontSize="10" fontFamily="var(--font-mono)">
                  &lt;2ms
                </text>
              </g>

              {/* Chamber 02: Nano 4 GPU */}
              <g
                onMouseEnter={() => setHoveredChamber("nano")}
                onMouseLeave={() => setHoveredChamber(null)}
                className="cursor-pointer"
              >
                <rect
                  x="206"
                  y="46"
                  width="110"
                  height="64"
                  rx="10"
                  fill="var(--nano-bg)"
                  stroke={hoveredChamber === "nano" ? "var(--nano-solid)" : "var(--nano-border)"}
                  strokeWidth={hoveredChamber === "nano" ? "2" : "1.5"}
                />
                <text x="261" y="71" textAnchor="middle" fill="var(--nano-text)" fontSize="11" fontWeight="700" fontFamily="var(--font-mono)">
                  02 Nano 4
                </text>
                <text x="261" y="90" textAnchor="middle" fill="var(--text-secondary)" fontSize="10" fontFamily="var(--font-mono)">
                  Local GPU
                </text>
              </g>

              {/* Chamber 03: Airgap Gate */}
              <g
                onMouseEnter={() => setHoveredChamber("airgap")}
                onMouseLeave={() => setHoveredChamber(null)}
                className="cursor-pointer"
              >
                <rect
                  x="342"
                  y="38"
                  width="96"
                  height="80"
                  rx="10"
                  fill="var(--safe-bg)"
                  stroke={hoveredChamber === "airgap" ? "var(--safe-solid)" : "var(--safe-border)"}
                  strokeWidth={hoveredChamber === "airgap" ? "2.25" : "1.75"}
                />
                <text x="390" y="69" textAnchor="middle" fill="var(--safe-text)" fontSize="11" fontWeight="700" fontFamily="var(--font-mono)">
                  03 Airgap
                </text>
                <text x="390" y="88" textAnchor="middle" fill="var(--safe-text)" fontSize="10" fontFamily="var(--font-mono)">
                  0 Leaked
                </text>
              </g>

              {/* Output Nodes */}
              <g>
                <rect x="515" y="20" width="76" height="32" rx="7" fill="var(--bg-subtle)" stroke="var(--nano-border)" />
                <text x="553" y="40" textAnchor="middle" fill="var(--text-primary)" fontSize="10" fontWeight="600" fontFamily="var(--font-mono)">
                  Extension
                </text>

                <rect x="515" y="62" width="76" height="32" rx="7" fill="var(--safe-bg)" stroke="var(--safe-border)" />
                <text x="553" y="82" textAnchor="middle" fill="var(--safe-text)" fontSize="10" fontWeight="700" fontFamily="var(--font-mono)">
                  Cloud AI
                </text>

                <rect x="515" y="104" width="76" height="32" rx="7" fill="var(--bg-subtle)" stroke="var(--safe-border)" />
                <text x="553" y="124" textAnchor="middle" fill="var(--text-primary)" fontSize="10" fontWeight="600" fontFamily="var(--font-mono)">
                  Android
                </text>
              </g>

              {/* Local Vault (Blocked) */}
              <g className="hero-vault-pulse" style={{ transformOrigin: "190px 204px" }}>
                <rect
                  x="90"
                  y="174"
                  width="200"
                  height="56"
                  rx="10"
                  fill="var(--mask-bg)"
                  stroke="var(--mask-border)"
                  strokeWidth="1.5"
                />
                <text x="190" y="197" textAnchor="middle" fill="var(--mask-text)" fontSize="11" fontWeight="700" fontFamily="var(--font-mono)">
                  LOCAL VAULT (BLOCKED)
                </text>
                <text x="190" y="216" textAnchor="middle" fill="var(--text-secondary)" fontSize="10" fontFamily="var(--font-mono)">
                  AWS Key · ICU Note · JWT
                </text>
              </g>

              {/* Animated Data Packets (start opacity 0 so they never stack at origin) */}
              <g className="hero-safe-packet" opacity="0">
                <rect x="-36" y="-11" width="72" height="22" rx="6" fill="var(--safe-solid)" />
                <text x="0" y="3.5" textAnchor="middle" fill="#07090D" fontSize="9.5" fontWeight="700" fontFamily="var(--font-mono)">
                  Stack Trace
                </text>
              </g>

              <g className="hero-threat-regex" opacity="0">
                <rect x="-28" y="-10" width="56" height="20" rx="5" fill="var(--mask-solid)" />
                <text x="0" y="3.5" textAnchor="middle" fill="#FFFFFF" fontSize="9" fontWeight="700" fontFamily="var(--font-mono)">
                  AWS Key
                </text>
              </g>

              <g className="hero-threat-regex" opacity="0">
                <rect x="-22" y="-10" width="44" height="20" rx="5" fill="var(--mask-solid)" />
                <text x="0" y="3.5" textAnchor="middle" fill="#FFFFFF" fontSize="9" fontWeight="700" fontFamily="var(--font-mono)">
                  JWT
                </text>
              </g>

              <g className="hero-threat-nano" opacity="0">
                <rect x="-30" y="-10" width="60" height="20" rx="5" fill="var(--nano-solid)" />
                <text x="0" y="3.5" textAnchor="middle" fill="#07090D" fontSize="9" fontWeight="700" fontFamily="var(--font-mono)">
                  ICU Note
                </text>
              </g>
            </svg>
          </div>

          {/* Hover Tooltip / Process Info Bar */}
          <div
            className="mt-2 flex min-h-[44px] items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs"
            style={{
              backgroundColor: "var(--bg-subtle)",
              borderColor: "var(--border-subtle)",
            }}
          >
            {activeTooltip ? (
              <>
                <span style={{ color: "var(--text-primary)" }}>
                  <strong className="font-mono">{activeTooltip.title}:</strong> {activeTooltip.desc}
                </span>
                <span className="hidden shrink-0 font-mono text-[10px] sm:inline" style={{ color: "var(--nano-text)" }}>
                  {activeTooltip.sdk}
                </span>
              </>
            ) : (
              <>
                <span className="flex flex-wrap items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                  <span>Hover</span>
                  <code className="rounded border px-1.5 py-0.5 font-mono text-[10px]" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}>01 Regex</code>
                  <code className="rounded border px-1.5 py-0.5 font-mono text-[10px]" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)", color: "var(--nano-text)" }}>02 Nano 4</code>
                  <span>or</span>
                  <code className="rounded border px-1.5 py-0.5 font-mono text-[10px]" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)", color: "var(--safe-text)" }}>03 Airgap</code>
                  <span>to inspect SDK roles.</span>
                </span>
                <span className="hidden shrink-0 font-mono text-[10px] sm:inline" style={{ color: "var(--text-muted)" }}>
                  Anime.js v4 Circuit
                </span>
              </>
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
