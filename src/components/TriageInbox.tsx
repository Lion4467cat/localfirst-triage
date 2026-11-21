import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { animate } from "animejs";
import { FileUp, Loader2, ShieldCheck, Trash2, WifiOff } from "lucide-react";
import type { DemoScenario, ProtectionLevel, TriageResult } from "../types/triage";
import { createSafeScope } from "../utils/animeScope";

interface TriageInboxProps {
  scenarios: DemoScenario[];
  title: string;
  rawText: string;
  isRunning: boolean;
  offlineMode: boolean;
  protectionLevel: ProtectionLevel;
  queuedTickets: TriageResult[];
  importedFromExtension: boolean;
  onTitleChange: (title: string) => void;
  onRawTextChange: (rawText: string) => void;
  onProtectionLevelChange: (level: ProtectionLevel) => void;
  onSelectScenario: (scenario: DemoScenario) => void;
  onRunTriage: () => void;
  onProcessOfflineQueue: () => void;
}

const PRESET_LABELS: Record<string, string> = {
  "scenario-p0-semantic-leak": "P0 Outage + PHI",
  "scenario-p3-local-runbook": "Build / TLS Fix",
  "scenario-p1-billing-webhook": "P1 Billing Leak",
  "scenario-p2-offline-oauth": "Offline $0",
};

export function TriageInbox({
  scenarios,
  title,
  rawText,
  isRunning,
  offlineMode,
  protectionLevel,
  queuedTickets,
  importedFromExtension,
  onTitleChange,
  onRawTextChange,
  onProtectionLevelChange,
  onSelectScenario,
  onRunTriage,
  onProcessOfflineQueue,
}: TriageInboxProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorWrapRef = useRef<HTMLDivElement>(null);
  const [laserActive, setLaserActive] = useState(false);

  useEffect(() => {
    if (!isRunning && !laserActive) return;
    const wrap = editorWrapRef.current;
    if (!wrap) return;

    const scope = createSafeScope(wrap, (reduced) => {
      if (reduced) return;
      animate(".inbox-laser-beam", {
        top: ["-48px", "100%"],
        opacity: [0.95, 1, 0.85],
        duration: 900,
        ease: "outCubic",
      });
    });

    return () => scope.revert();
  }, [isRunning, laserActive]);

  useEffect(() => {
    if (isRunning) {
      setLaserActive(true);
      const t = setTimeout(() => setLaserActive(false), 950);
      return () => clearTimeout(t);
    }
  }, [isRunning]);

  const handleUploadLog = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      onTitleChange(file.name.replace(/\.[^.]+$/, ""));
      onRawTextChange(content.slice(0, 12_000));
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (!isRunning && rawText.trim()) {
        onRunTriage();
      }
    }
  };

  return (
    <section
      aria-label="On-Device Input"
      className="lf-card flex min-h-0 flex-col overflow-hidden rounded-xl"
    >
      {/* Top Header Strip */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 border-b px-3.5 py-2.5"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: "var(--mask-solid)" }}
            aria-hidden="true"
          />
          <span
            className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: "var(--text-primary)" }}
          >
            Your Device · Never Leaves
          </span>
          {importedFromExtension && (
            <span
              className="rounded border px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: "var(--safe-bg)",
                borderColor: "var(--safe-border)",
                color: "var(--safe-text)",
              }}
            >
              From Browser Extension
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* 3-Level Protection Selector */}
          <div
            role="group"
            aria-label="Protection level"
            className="inline-flex rounded-md border p-0.5"
            style={{
              backgroundColor: "var(--bg-subtle)",
              borderColor: "var(--border-subtle)",
            }}
          >
            {(
              [
                {
                  id: "low" as const,
                  label: "Low",
                  tip: "Low (Secrets Only): API keys, AWS, JWT, PEM, DB URI, Gov IDs & cards",
                },
                {
                  id: "medium" as const,
                  label: "Medium",
                  tip: "Medium (Balanced): Secrets + phones, emails, names, employers & Nano 4 PHI",
                },
                {
                  id: "high" as const,
                  label: "High",
                  tip: "High (Strict Zero-Trust): Medium + addresses, M&A, tight entropy & lower lockdown threshold",
                },
              ]
            ).map((opt) => {
              const active = protectionLevel === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  title={opt.tip}
                  aria-pressed={active}
                  onClick={() => onProtectionLevelChange(opt.id)}
                  className="rounded px-2 py-0.5 font-mono text-[10px] font-semibold transition-colors"
                  style={{
                    backgroundColor: active
                      ? opt.id === "high"
                        ? "var(--mask-bg)"
                        : opt.id === "medium"
                          ? "var(--safe-bg)"
                          : "var(--bg-surface)"
                      : "transparent",
                    color: active
                      ? opt.id === "high"
                        ? "var(--mask-text)"
                        : opt.id === "medium"
                          ? "var(--safe-text)"
                          : "var(--text-primary)"
                      : "var(--text-muted)",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors"
            style={{
              backgroundColor: "var(--bg-subtle)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-secondary)",
            }}
          >
            <FileUp className="h-3 w-3" aria-hidden="true" />
            Upload
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".log,.txt,.json,text/plain"
          onChange={(e) => void handleUploadLog(e)}
          className="hidden"
        />
      </div>

      {/* 4 Compact 1-Click Preset Pills */}
      <div
        className="flex flex-wrap items-center gap-1.5 border-b px-3.5 py-2"
        style={{
          backgroundColor: "var(--bg-subtle)",
          borderColor: "var(--border-subtle)",
        }}
      >
        {scenarios.map((scenario) => {
          const selected = scenario.rawText === rawText;
          const shortLabel = PRESET_LABELS[scenario.id] ?? scenario.expectedSeverity;
          return (
            <button
              key={scenario.id}
              type="button"
              title={scenario.title}
              onClick={() => onSelectScenario(scenario)}
              className="rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors"
              style={{
                backgroundColor: selected ? "var(--accent-primary)" : "var(--bg-surface)",
                borderColor: selected ? "var(--accent-primary)" : "var(--border-subtle)",
                color: selected ? "var(--accent-on-primary)" : "var(--text-secondary)",
              }}
            >
              {shortLabel}
            </button>
          );
        })}
      </div>

      {/* Title + Full-Height Editor Surface */}
      <div className="relative flex min-h-0 flex-1 flex-col p-3.5 gap-2.5">
        <input
          id="ticket-title"
          aria-label="Incident Title"
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Incident title..."
          className="lf-input w-full rounded-lg px-2.5 py-1.5 text-xs font-medium"
        />

        <div
          ref={editorWrapRef}
          className="relative flex min-h-[220px] flex-1 flex-col overflow-hidden rounded-lg border"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          {(isRunning || laserActive) && (
            <div
              aria-hidden="true"
              className="inbox-laser-beam pointer-events-none absolute inset-x-0 top-[-48px] z-10 h-[51px]"
              style={{
                background:
                  "linear-gradient(180deg, transparent 0%, rgba(56,189,248,0.16) 72%, rgba(0,229,163,0.42) 100%)",
                borderBottom: "3px solid var(--signal-mint, #00E5A3)",
                boxShadow: "0 0 14px var(--signal-mint, #00E5A3)",
              }}
            />
          )}
          <textarea
            id="ticket-body"
            aria-label="Support Ticket or Error Logs"
            value={rawText}
            onChange={(e) => onRawTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Paste stack traces, support messages, API keys, or customer notes..."
            className="h-full min-h-[220px] w-full flex-1 resize-none bg-transparent p-3 font-mono text-xs leading-relaxed focus:outline-none"
            style={{ color: "var(--text-primary)" }}
          />
        </div>

        {queuedTickets.length > 0 && (
          <div
            className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5"
            style={{
              backgroundColor: "var(--warn-bg)",
              borderColor: "var(--warn-border)",
            }}
          >
            <span className="text-[11px] font-medium tabular-nums" style={{ color: "var(--warn-text)" }}>
              {queuedTickets.length} queued offline (0 raw PII)
            </span>
            <button
              type="button"
              disabled={offlineMode || isRunning}
              onClick={onProcessOfflineQueue}
              className="rounded border px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--warn-border)",
                color: "var(--text-primary)",
              }}
            >
              Send Now
            </button>
          </div>
        )}
      </div>

      {/* Docked Bottom Action Bar */}
      <div
        className="flex items-center justify-between gap-2 border-t px-3.5 py-2.5"
        style={{
          backgroundColor: "var(--bg-subtle)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <button
          type="button"
          disabled={!rawText && !title}
          onClick={() => {
            onTitleChange("");
            onRawTextChange("");
          }}
          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition-colors disabled:opacity-40"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderColor: "var(--border-subtle)",
            color: "var(--text-secondary)",
          }}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          Clear
        </button>

        <button
          type="button"
          disabled={isRunning || !rawText.trim()}
          onClick={() => {
            setLaserActive(true);
            setTimeout(() => setLaserActive(false), 950);
            onRunTriage();
          }}
          className="inline-flex min-h-[36px] flex-1 items-center justify-center gap-2 rounded-lg px-4 text-xs font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
          style={{
            backgroundColor: "var(--accent-primary)",
            color: "var(--accent-on-primary)",
          }}
        >
          {isRunning ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              <span>Scrubbing On-Device...</span>
            </>
          ) : offlineMode ? (
            <>
              <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Scrub &amp; Fix Offline</span>
            </>
          ) : (
            <>
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Scrub &amp; Analyze</span>
              <kbd
                className="hidden rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium sm:inline-block"
                style={{
                  borderColor: "rgba(128,128,128,0.35)",
                  opacity: 0.85,
                }}
              >
                ⌘↵
              </kbd>
            </>
          )}
        </button>
      </div>
    </section>
  );
}
