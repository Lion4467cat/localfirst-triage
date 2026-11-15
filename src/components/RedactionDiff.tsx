import { ShieldAlert, ShieldCheck } from "lucide-react";
import type { RedactionSpan } from "../types/triage";

interface RedactionDiffProps {
  rawText: string;
  sanitizedText: string;
  spans: RedactionSpan[];
  loadedFromZeroPiiStore?: boolean;
  onToggleSpan?: (index: number) => void;
}

export function RedactionDiff({
  rawText,
  sanitizedText,
  spans,
  loadedFromZeroPiiStore = false,
  onToggleSpan,
}: RedactionDiffProps) {
  const regexCount = spans.filter(
    (s) => s.detector === "REGEX_FIREWALL" && s.masked !== false,
  ).length;
  const heuristicCount = spans.filter(
    (s) => s.detector === "HEURISTIC_GUARD" && s.masked !== false,
  ).length;
  const nanoCount = spans.filter(
    (s) => s.detector === "NANO_SEMANTIC_FIREWALL" && s.masked !== false,
  ).length;

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-400" />
          <h2 className="text-sm font-semibold tracking-wide text-slate-100 uppercase">
            Visual Redaction Diff Viewer
          </h2>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 font-mono text-amber-300">
            [REGEX_FIREWALL]: {regexCount}
          </span>
          {heuristicCount > 0 && (
            <span className="rounded-full border border-orange-500/40 bg-orange-500/10 px-2.5 py-0.5 font-mono text-orange-300">
              [HEURISTIC_GUARD]: {heuristicCount}
            </span>
          )}
          <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-0.5 font-mono text-cyan-300">
            [NANO_SEMANTIC_FIREWALL]: {nanoCount}
          </span>
        </div>
      </div>

      {loadedFromZeroPiiStore && (
        <div className="mb-3 rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-xs text-slate-300">
          Loaded from zero-PII disk store — raw secrets purged on session close.
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-rose-900/50 bg-slate-950/90 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-rose-400">
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>Raw Local Input (Session-Only Memory)</span>
          </div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-slate-300">
            {rawText || "Select a demo scenario or paste a ticket to inspect."}
          </pre>
        </div>

        <div className="rounded-lg border border-emerald-900/50 bg-slate-950/90 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-emerald-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Sanitized Payload (Safe for Cloud / Storage)</span>
          </div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-emerald-200">
            {sanitizedText || "Run LocalFirst Firewall to generate sanitized payload."}
          </pre>
        </div>
      </div>

      {spans.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium text-slate-400">
            Interactive Redaction Audit ({spans.length} spans —{" "}
            {loadedFromZeroPiiStore
              ? "unmasking disabled for purged disk records"
              : "click any pill to toggle mask/unmask"}
            )
          </p>
          <div className="flex flex-wrap gap-1.5">
            {spans.map((span, idx) => {
              const isMasked = span.masked !== false;
              const style = !isMasked
                ? "border-slate-700 bg-slate-900/50 text-slate-400 line-through"
                : span.detector === "NANO_SEMANTIC_FIREWALL"
                  ? "border-cyan-500/30 bg-cyan-950/40 text-cyan-200"
                  : span.detector === "HEURISTIC_GUARD"
                    ? "border-orange-500/30 bg-orange-950/40 text-orange-200"
                    : "border-amber-500/30 bg-amber-950/40 text-amber-200";
              return (
                <button
                  key={`${span.start}-${span.end}-${idx}`}
                  type="button"
                  disabled={loadedFromZeroPiiStore}
                  onClick={() => onToggleSpan?.(idx)}
                  title={isMasked ? "Click to unmask this token" : "Click to re-mask this token"}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60 ${style}`}
                >
                  <span className="font-semibold">[{span.detector}]</span>
                  <span>{isMasked ? span.placeholder : span.matchedText}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
