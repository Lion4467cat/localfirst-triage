import { useRef, useState } from "react";
import { Check, Copy, Lock, Scissors, ShieldAlert, ShieldCheck } from "lucide-react";
import type { DetectorSource, RedactionSpan } from "../types/triage";

interface RedactionDiffProps {
  rawText: string;
  sanitizedText: string;
  spans: RedactionSpan[];
  loadedFromZeroPiiStore?: boolean;
  onToggleSpan?: (index: number) => void;
  onAddManualSpan?: (start: number, end: number) => void;
}

const DETECTOR_PILL_STYLES: Record<DetectorSource, string> = {
  NANO_SEMANTIC_FIREWALL: "border-cyan-500/40 bg-cyan-950/50 text-cyan-200",
  REGEX_FIREWALL: "border-amber-500/40 bg-amber-950/50 text-amber-200",
  ENTROPY_SCANNER: "border-fuchsia-500/40 bg-fuchsia-950/50 text-fuchsia-200",
  HEURISTIC_GUARD: "border-orange-500/40 bg-orange-950/50 text-orange-200",
  POLICY_TERM: "border-violet-500/40 bg-violet-950/50 text-violet-200",
  MANUAL_MASK: "border-rose-500/40 bg-rose-950/50 text-rose-200",
};

const INLINE_MARK_STYLES: Record<DetectorSource, string> = {
  NANO_SEMANTIC_FIREWALL: "bg-cyan-500/20 text-cyan-200 border-b border-cyan-400/70",
  REGEX_FIREWALL: "bg-amber-500/20 text-amber-200 border-b border-amber-400/70",
  ENTROPY_SCANNER: "bg-fuchsia-500/20 text-fuchsia-200 border-b border-fuchsia-400/70",
  HEURISTIC_GUARD: "bg-orange-500/20 text-orange-200 border-b border-orange-400/70",
  POLICY_TERM: "bg-violet-500/20 text-violet-200 border-b border-violet-400/70",
  MANUAL_MASK: "bg-rose-500/20 text-rose-200 border-b border-rose-400/70",
};

function renderHighlightedRaw(
  rawText: string,
  spans: RedactionSpan[],
  loadedFromZeroPiiStore: boolean,
  onToggleSpan?: (index: number) => void,
) {
  if (!rawText) {
    return "Select a demo scenario, upload a log file, or paste a ticket to inspect.";
  }
  if (loadedFromZeroPiiStore || spans.length === 0) {
    return rawText;
  }

  const ordered = spans
    .map((span, originalIndex) => ({ span, originalIndex }))
    .filter(({ span }) => span.start >= 0 && span.end <= rawText.length && span.start < span.end)
    .sort((a, b) => a.span.start - b.span.start);

  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  for (const { span, originalIndex } of ordered) {
    if (span.start < cursor) continue;
    if (span.start > cursor) {
      nodes.push(rawText.slice(cursor, span.start));
    }
    const isMasked = span.masked !== false;
    nodes.push(
      <button
        key={`raw-span-${span.start}-${span.end}-${originalIndex}`}
        type="button"
        onClick={() => onToggleSpan?.(originalIndex)}
        title={`[${span.detector}] ${span.category} — click to ${isMasked ? "unmask" : "re-mask"}`}
        className={`inline rounded px-1 py-0.5 text-left font-mono transition hover:opacity-80 ${
          isMasked
            ? INLINE_MARK_STYLES[span.detector]
            : "bg-slate-800/70 text-slate-400 line-through"
        }`}
      >
        {rawText.slice(span.start, span.end)}
      </button>,
    );
    cursor = span.end;
  }

  if (cursor < rawText.length) {
    nodes.push(rawText.slice(cursor));
  }
  return nodes;
}

function renderHighlightedSanitized(
  rawText: string,
  sanitizedText: string,
  spans: RedactionSpan[],
  loadedFromZeroPiiStore: boolean,
  onToggleSpan?: (index: number) => void,
) {
  if (!sanitizedText) {
    return "Run LocalFirst Firewall to generate verified zero-PII sanitized payload.";
  }
  if (loadedFromZeroPiiStore || spans.length === 0 || !rawText) {
    return sanitizedText;
  }

  const ordered = spans
    .map((span, originalIndex) => ({ span, originalIndex }))
    .filter(({ span }) => span.start >= 0 && span.end <= rawText.length && span.start < span.end)
    .sort((a, b) => a.span.start - b.span.start);

  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  for (const { span, originalIndex } of ordered) {
    if (span.start < cursor) continue;
    if (span.start > cursor) {
      nodes.push(rawText.slice(cursor, span.start));
    }
    const isMasked = span.masked !== false;
    const tokenText = isMasked ? span.placeholder : rawText.slice(span.start, span.end);
    nodes.push(
      <button
        key={`san-span-${span.start}-${span.end}-${originalIndex}`}
        type="button"
        disabled={loadedFromZeroPiiStore}
        onClick={() => onToggleSpan?.(originalIndex)}
        title={isMasked ? `${span.category} (${span.detector}) — click to unmask` : "Unmasked — click to re-mask"}
        className={`inline rounded px-1 py-0.5 text-left font-mono transition hover:opacity-80 ${
          isMasked
            ? INLINE_MARK_STYLES[span.detector]
            : "border border-rose-500/60 bg-rose-950/50 text-rose-200"
        }`}
      >
        {tokenText}
      </button>,
    );
    cursor = span.end;
  }

  if (cursor < rawText.length) {
    nodes.push(rawText.slice(cursor));
  }
  return nodes;
}

export function RedactionDiff({
  rawText,
  sanitizedText,
  spans,
  loadedFromZeroPiiStore = false,
  onToggleSpan,
  onAddManualSpan,
}: RedactionDiffProps) {
  const [copied, setCopied] = useState(false);
  const [manualFeedback, setManualFeedback] = useState<string | null>(null);
  const rawPreRef = useRef<HTMLPreElement | null>(null);

  const activeCount = (detector: DetectorSource) =>
    spans.filter((s) => s.detector === detector && s.masked !== false).length;

  const regexCount = activeCount("REGEX_FIREWALL");
  const entropyCount = activeCount("ENTROPY_SCANNER");
  const heuristicCount = activeCount("HEURISTIC_GUARD");
  const nanoCount = activeCount("NANO_SEMANTIC_FIREWALL");
  const policyCount = activeCount("POLICY_TERM");
  const manualCount = activeCount("MANUAL_MASK");

  const handleCopySanitized = async () => {
    if (!sanitizedText) return;
    try {
      await navigator.clipboard?.writeText(sanitizedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked in headless/test environment
    }
  };

  const handleMaskSelection = () => {
    if (!onAddManualSpan || loadedFromZeroPiiStore || !rawText) return;
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    const selectedText = selection?.toString() ?? "";
    if (!selectedText || selectedText.trim().length < 2) {
      setManualFeedback("Highlight text inside the Raw Local Input pane first, then click Mask Selection.");
      setTimeout(() => setManualFeedback(null), 3000);
      return;
    }

    let startIdx = -1;
    if (
      selection &&
      selection.rangeCount > 0 &&
      rawPreRef.current &&
      rawPreRef.current.contains(selection.anchorNode)
    ) {
      try {
        const range = selection.getRangeAt(0);
        const prefixRange = document.createRange();
        prefixRange.selectNodeContents(rawPreRef.current);
        prefixRange.setEnd(range.startContainer, range.startOffset);
        const domOffset = prefixRange.toString().length;
        if (rawText.slice(domOffset, domOffset + selectedText.length) === selectedText) {
          startIdx = domOffset;
        }
      } catch {
        // Fallback to indexOf below
      }
    }

    if (startIdx === -1) {
      startIdx = rawText.indexOf(selectedText);
    }
    if (startIdx === -1) {
      setManualFeedback("Could not locate selected snippet inside raw input.");
      setTimeout(() => setManualFeedback(null), 3000);
      return;
    }
    onAddManualSpan(startIdx, startIdx + selectedText.length);
    selection?.removeAllRanges();
    setManualFeedback(`Masked "${selectedText.slice(0, 32)}" with [MANUAL_MASK].`);
    setTimeout(() => setManualFeedback(null), 2500);
  };

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-400" />
          <h2 className="text-sm font-semibold tracking-wide text-slate-100 uppercase">
            Inline Redaction Diff Viewer
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 font-mono text-amber-300">
            [REGEX_FIREWALL]: {regexCount}
          </span>
          {entropyCount > 0 && (
            <span className="rounded-full border border-fuchsia-500/40 bg-fuchsia-500/10 px-2.5 py-0.5 font-mono text-fuchsia-300">
              [ENTROPY_SCANNER]: {entropyCount}
            </span>
          )}
          {heuristicCount > 0 && (
            <span className="rounded-full border border-orange-500/40 bg-orange-500/10 px-2.5 py-0.5 font-mono text-orange-300">
              [HEURISTIC_GUARD]: {heuristicCount}
            </span>
          )}
          {policyCount > 0 && (
            <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-2.5 py-0.5 font-mono text-violet-300">
              [POLICY_TERM]: {policyCount}
            </span>
          )}
          {manualCount > 0 && (
            <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-0.5 font-mono text-rose-300">
              [MANUAL_MASK]: {manualCount}
            </span>
          )}
          <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-0.5 font-mono text-cyan-300">
            [NANO_SEMANTIC_FIREWALL]: {nanoCount}
          </span>
        </div>
      </div>

      {loadedFromZeroPiiStore && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-xs text-slate-300">
          <Lock className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          <span>Loaded from zero-PII IndexedDB store — raw secrets purged on session close.</span>
        </div>
      )}

      {manualFeedback && (
        <div className="mb-3 rounded-lg border border-cyan-500/40 bg-cyan-950/40 px-3 py-1.5 text-xs text-cyan-200">
          {manualFeedback}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-rose-900/50 bg-slate-950/90 p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-xs font-medium text-rose-400">
            <span className="inline-flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5" />
              <span>Raw Local Input (Session Memory Only)</span>
            </span>
            {!loadedFromZeroPiiStore && onAddManualSpan && sanitizedText && (
              <button
                type="button"
                onClick={handleMaskSelection}
                className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-950/50 px-2 py-0.5 text-[11px] text-rose-200 transition hover:bg-rose-900/50"
              >
                <Scissors className="h-3 w-3" />
                <span>Mask Selection</span>
              </button>
            )}
          </div>
          <pre
            ref={rawPreRef}
            className="max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-slate-300"
          >
            {renderHighlightedRaw(rawText, spans, loadedFromZeroPiiStore, onToggleSpan)}
          </pre>
        </div>

        <div className="rounded-lg border border-emerald-900/50 bg-slate-950/90 p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-xs font-medium text-emerald-400">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Sanitized Payload (Safe for Cloud / Storage)</span>
            </span>
            {sanitizedText && (
              <button
                type="button"
                onClick={() => void handleCopySanitized()}
                className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-950/50 px-2 py-0.5 text-[11px] text-emerald-200 transition hover:bg-emerald-900/50"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                <span>{copied ? "Copied!" : "Copy Sanitized"}</span>
              </button>
            )}
          </div>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-emerald-200">
            {renderHighlightedSanitized(
              rawText,
              sanitizedText,
              spans,
              loadedFromZeroPiiStore,
              onToggleSpan,
            )}
          </pre>
        </div>
      </div>

      {spans.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium text-slate-400">
            Interactive Redaction Audit ({spans.length} spans —{" "}
            {loadedFromZeroPiiStore
              ? "unmasking disabled for purged disk records"
              : "click any highlighted span or pill to toggle mask/unmask"}
            )
          </p>
          <div className="flex flex-wrap gap-1.5">
            {spans.map((span, idx) => {
              const isMasked = span.masked !== false;
              const style = !isMasked
                ? "border-slate-700 bg-slate-900/50 text-slate-400 line-through"
                : DETECTOR_PILL_STYLES[span.detector];
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
                  <span className="max-w-xs truncate">
                    {isMasked ? span.placeholder : span.matchedText}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
