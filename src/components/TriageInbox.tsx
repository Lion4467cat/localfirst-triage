import { Play, Sparkles, Trash2 } from "lucide-react";
import type { DemoScenario, TriageResult } from "../types/triage";

interface TriageInboxProps {
  scenarios: DemoScenario[];
  title: string;
  rawText: string;
  isRunning: boolean;
  history: TriageResult[];
  onTitleChange: (value: string) => void;
  onRawTextChange: (value: string) => void;
  onSelectScenario: (scenario: DemoScenario) => void;
  onRunTriage: () => void;
  onSelectHistory: (item: TriageResult) => void;
  onClearHistory: () => void;
}

export function TriageInbox({
  scenarios,
  title,
  rawText,
  isRunning,
  history,
  onTitleChange,
  onRawTextChange,
  onSelectScenario,
  onRunTriage,
  onSelectHistory,
  onClearHistory,
}: TriageInboxProps) {
  return (
    <aside className="flex flex-col gap-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-indigo-400" />
          <h2 className="text-sm font-semibold tracking-wide text-slate-100 uppercase">
            1-Click Demo Scenarios
          </h2>
        </div>
        <div className="flex flex-col gap-2">
          {scenarios.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              onClick={() => onSelectScenario(scenario)}
              className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-left transition hover:border-indigo-500/60 hover:bg-slate-900"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-100">{scenario.title}</span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300">
                  {scenario.expectedSeverity}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">{scenario.subtitle}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <label className="mb-1.5 block text-xs font-medium text-slate-300" htmlFor="ticket-title">
          Incident Title
        </label>
        <input
          id="ticket-title"
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="e.g. Checkout P0 OAuth Leak"
          className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
        />

        <label className="mb-1.5 block text-xs font-medium text-slate-300" htmlFor="ticket-body">
          Raw Support / SRE Payload
        </label>
        <textarea
          id="ticket-body"
          rows={7}
          value={rawText}
          onChange={(e) => onRawTextChange(e.target.value)}
          placeholder="Paste logs, stack traces, or customer messages containing PII/secrets..."
          className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
        />

        <button
          type="button"
          disabled={isRunning || !rawText.trim()}
          onClick={onRunTriage}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="h-4 w-4" />
          <span>{isRunning ? "Running Local Privacy Firewall..." : "Run Hybrid Triage"}</span>
        </button>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold tracking-wide text-slate-300 uppercase">
            Sanitized Local History (IndexedDB)
          </h3>
          {history.length > 0 && (
            <button
              type="button"
              onClick={onClearHistory}
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-rose-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="text-xs text-slate-500">No sanitized tickets stored yet.</p>
        ) : (
          <div className="flex max-h-44 flex-col gap-1.5 overflow-auto">
            {history.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectHistory(item)}
                className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2 text-left text-xs hover:border-slate-600"
              >
                <span className="truncate font-medium text-slate-200">{item.title}</span>
                <span className="ml-2 shrink-0 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                  {item.severity} · {item.inferenceSource}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
