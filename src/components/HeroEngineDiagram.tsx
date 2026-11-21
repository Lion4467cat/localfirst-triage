import { useEffect, useRef, useState } from "react";
import { createTimeline, stagger, svg } from "animejs";
import { ArrowDown, ChevronDown, Pause, Play, ShieldCheck } from "lucide-react";
import { createSafeScope } from "../utils/animeScope";

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

  return (
    <section
      id="story-top"
      ref={rootRef}
      className="lf-hero-glow relative flex min-h-[calc(100dvh-48px)] items-center border-b px-4 py-10 lg:px-8"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      <div className="mx-auto grid w-full max-w-[1440px] grid-cols-1 items-center gap-10 lg:grid-cols-[44fr_56fr]">
        {/* Left Column: Crisp Copy & CTAs */}
        <div className="space-y-6">
          <div
            className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1 font-mono text-[11px] font-medium"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-secondary)",
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: "var(--safe-solid)" }}
            />
            <span>Zero-Leakage Security Instrument · Web · Extension · Android</span>
          </div>

          <h1
            className="text-4xl font-bold tracking-[-0.03em] sm:text-5xl lg:text-[3.35rem] lg:leading-[1.08]"
            style={{ color: "var(--text-primary)" }}
          >
            Keep secrets on your device. Send only safe context to AI.
          </h1>

          <p
            className="max-w-xl text-base leading-relaxed sm:text-lg"
            style={{ color: "var(--text-secondary)" }}
          >
            Local regex and on-device Gemini Nano 4 scrub keys, patient notes, and private deals before a single byte crosses the airgap to Cloud Gemini.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={onJumpToWorkbench}
              className="lf-btn-primary inline-flex min-h-[44px] items-center gap-2 rounded-xl px-5 text-sm font-semibold"
            >
              <span>Open Live Workbench</span>
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={onJumpToProcess}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-4 text-sm font-medium"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-strong)",
                color: "var(--text-primary)",
              }}
            >
              <span>Inspect How It Works</span>
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
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
    </section>
  );
}
