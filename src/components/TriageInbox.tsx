import { useRef, type ChangeEvent } from "react";
import { FileUp, Loader2, Shield, Sparkles, WifiOff } from "lucide-react";
import { getSeverityStyle, SCENARIO_DISPLAY } from "../config/displayLabels";
import type { DemoScenario, TriageResult } from "../types/triage";

interface TriageInboxProps {
  scenarios: DemoScenario[];
  title: string;
  rawText: string;
  isRunning: boolean;
  offlineMode: boolean;
  queuedTickets: TriageResult[];
  importedFromExtension: boolean;
  onTitleChange: (title: string) => void;
  onRawTextChange: (rawText: string) => void;
  onSelectScenario: (scenario: DemoScenario) => void;
  onRunTriage: () => void;
  onProcessOfflineQueue: () => void;
}

export function TriageInbox({
  scenarios,
  title,
  rawText,
  isRunning,
  offlineMode,
  queuedTickets,
  importedFromExtension,
  onTitleChange,
  onRawTextChange,
  onSelectScenario,
  onRunTriage,
  onProcessOfflineQueue,
}: TriageInboxProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  return (
    <aside className="flex flex-col gap-4">
      <section className="lf-card rounded-2xl p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2
              className="text-base font-semibold tracking-tight"
              style={{ color: "var(--text-primary)" }}
            >
              1. Paste or Pick Example
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
              Secrets are masked on your device before any cloud request.
            </p>
          </div>
          {importedFromExtension && (
            <span
              className="rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
              style={{
                backgroundColor: "var(--accent-soft-bg)",
                borderColor: "var(--accent-soft-border)",
                color: "var(--accent-text)",
              }}
            >
              From Browser Extension
            </span>
          )}
        </div>

        <div className="mb-4">
          <p
            className="mb-2 text-xs font-semibold uppercase tracking-wide"
            style={{ color: "var(--text-muted)" }}
          >
            Starter Examples
          </p>
          <div className="grid gap-2">
            {scenarios.map((scenario) => {
              const display = SCENARIO_DISPLAY[scenario.id];
              const sev = getSeverityStyle(scenario.expectedSeverity);
              const selected = scenario.rawText === rawText;

              return (
                <button
                  key={scenario.id}
                  type="button"
                  onClick={() => onSelectScenario(scenario)}
                  className="flex min-h-[44px] w-full flex-col items-start rounded-xl border p-3 text-left transition-colors"
                  style={{
                    backgroundColor: selected ? "var(--accent-soft-bg)" : "var(--bg-subtle)",
                    borderColor: selected
                      ? "var(--accent-soft-border)"
                      : "var(--border-subtle)",
                  }}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span
                      className="text-sm font-semibold leading-snug"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {display?.title ?? scenario.title}
                    </span>
                    <span
                      className="shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-bold"
                      style={{
                        backgroundColor: sev.bg,
                        borderColor: sev.border,
                        color: sev.text,
                      }}
                    >
                      {scenario.expectedSeverity} · {sev.label}
                    </span>
                  </div>
                  <span
                    className="mt-1 text-xs leading-relaxed"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {display?.subtitle ?? scenario.subtitle}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label
              htmlFor="ticket-title"
              className="mb-1.5 block text-xs font-semibold"
              style={{ color: "var(--text-secondary)" }}
            >
              Incident Title
            </label>
            <input
              id="ticket-title"
              type="text"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="e.g., Checkout service returning 500 errors"
              className="lf-input min-h-[44px] w-full rounded-xl px-3 py-2 text-sm"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label
                htmlFor="ticket-body"
                className="text-xs font-semibold"
                style={{ color: "var(--text-secondary)" }}
              >
                Support Ticket or Error Logs
              </label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
              >
                <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
                Upload .log / .txt
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".log,.txt,.json,text/plain"
                onChange={(e) => void handleUploadLog(e)}
                className="hidden"
              />
            </div>
            <textarea
              id="ticket-body"
              rows={7}
              value={rawText}
              onChange={(e) => onRawTextChange(e.target.value)}
              placeholder="Paste stack traces, support messages, API keys, or customer notes..."
              className="lf-input w-full rounded-xl p-3 font-mono text-xs leading-relaxed"
            />
          </div>

          <button
            type="button"
            disabled={isRunning || !rawText.trim()}
            onClick={onRunTriage}
            className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              backgroundColor: "var(--accent-primary)",
              color: "var(--accent-on-primary)",
            }}
          >
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Checking Secrets On-Device...
              </>
            ) : offlineMode ? (
              <>
                <WifiOff className="h-4 w-4" aria-hidden="true" />
                Protect &amp; Fix Offline
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Protect &amp; Analyze
              </>
            )}
          </button>

          <p
            className="flex items-center justify-center gap-1.5 text-center text-[11px]"
            style={{ color: "var(--text-muted)" }}
          >
            <Shield className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Raw secrets never leave your device without masking.
          </p>
        </div>
      </section>

      {queuedTickets.length > 0 && (
        <section
          className="rounded-2xl border p-4"
          style={{
            backgroundColor: "var(--warn-bg)",
            borderColor: "var(--warn-border)",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold" style={{ color: "var(--warn-text)" }}>
              Waiting for Connection ({queuedTickets.length})
            </h3>
            <button
              type="button"
              disabled={offlineMode || isRunning}
              onClick={onProcessOfflineQueue}
              className="min-h-[36px] rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--warn-border)",
                color: "var(--text-primary)",
              }}
            >
              Send Safe Tickets Now
            </button>
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--warn-text)" }}>
            Sanitized on-device while offline. Zero raw secrets stored.
          </p>
        </section>
      )}
    </aside>
  );
}
