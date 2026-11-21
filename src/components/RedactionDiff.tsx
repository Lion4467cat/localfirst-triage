import { Fragment, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, EyeOff, Lock, ShieldCheck, Unlock } from "lucide-react";
import { formatCategoryLabel, formatDetectorLabel } from "../config/displayLabels";
import type { RedactionSpan } from "../types/triage";

interface RedactionDiffProps {
  rawText: string;
  sanitizedText: string;
  spans: RedactionSpan[];
  loadedFromZeroPiiStore?: boolean;
  onToggleSpan: (spanIndex: number) => void;
  onAddManualSpan?: (start: number, end: number) => void;
}

export function RedactionDiff({
  rawText,
  sanitizedText,
  spans,
  loadedFromZeroPiiStore = false,
  onToggleSpan,
  onAddManualSpan,
}: RedactionDiffProps) {
  const rawContainerRef = useRef<HTMLDivElement>(null);
  const [selectionRange, setSelectionRange] = useState<{
    start: number;
    end: number;
    text: string;
  } | null>(null);
  const [copiedSafe, setCopiedSafe] = useState(false);

  const sorted = spans
    .map((span, index) => ({ span, index }))
    .sort((a, b) => a.span.start - b.span.start);

  const maskedCount = spans.filter((s) => s.masked !== false).length;
  const unmaskedCount = spans.filter((s) => s.masked === false).length;

  const handleMouseUpOnRaw = () => {
    const container = rawContainerRef.current;
    const sel = window.getSelection();
    if (!container || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setSelectionRange(null);
      return;
    }

    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setSelectionRange(null);
      return;
    }

    const selectedText = sel.toString();
    if (selectedText.trim().length < 3) {
      setSelectionRange(null);
      return;
    }

    const preRange = range.cloneRange();
    preRange.selectNodeContents(container);
    preRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = preRange.toString().length;
    const endOffset = startOffset + selectedText.length;

    if (
      startOffset >= 0 &&
      endOffset <= rawText.length &&
      rawText.slice(startOffset, endOffset) === selectedText
    ) {
      setSelectionRange({ start: startOffset, end: endOffset, text: selectedText });
    } else {
      const idx = rawText.indexOf(selectedText);
      if (idx !== -1) {
        setSelectionRange({
          start: idx,
          end: idx + selectedText.length,
          text: selectedText,
        });
      } else {
        setSelectionRange(null);
      }
    }
  };

  const handleHideSelection = () => {
    if (!selectionRange || !onAddManualSpan) return;
    onAddManualSpan(selectionRange.start, selectionRange.end);
    setSelectionRange(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleCopySafe = async () => {
    if (!sanitizedText) return;
    try {
      await navigator.clipboard.writeText(sanitizedText);
      setCopiedSafe(true);
      setTimeout(() => setCopiedSafe(false), 1800);
    } catch {
      // Clipboard blocked in restricted context
    }
  };

  const renderOriginalWithHighlights = () => {
    if (!rawText) {
      return (
        <span style={{ color: "var(--text-muted)" }}>
          Paste an incident or choose a starter example on the left.
        </span>
      );
    }
    if (sorted.length === 0) {
      return rawText;
    }

    const nodes: React.ReactNode[] = [];
    let cursor = 0;

    for (const { span, index } of sorted) {
      if (span.start < cursor || span.end > rawText.length) continue;
      if (span.start > cursor) {
        nodes.push(
          <Fragment key={`plain-${cursor}`}>{rawText.slice(cursor, span.start)}</Fragment>
        );
      }

      const isMasked = span.masked !== false;
      const categoryLabel = formatCategoryLabel(span.category);

      nodes.push(
        <button
          key={`span-${span.start}-${span.end}`}
          type="button"
          disabled={loadedFromZeroPiiStore}
          aria-pressed={isMasked}
          title={`${categoryLabel} — click or press Enter to ${isMasked ? "unmask" : "hide"}`}
          onClick={() => onToggleSpan(index)}
          className="mx-0.5 inline break-all rounded-md border px-1.5 py-0.5 text-left align-baseline font-mono text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            backgroundColor: isMasked ? "var(--mask-bg)" : "var(--warn-bg)",
            borderColor: isMasked ? "var(--mask-border)" : "var(--warn-border)",
            color: isMasked ? "var(--mask-text)" : "var(--warn-text)",
            textDecoration: isMasked ? "line-through" : "underline",
          }}
        >
          {isMasked ? (
            <Lock className="mr-1 inline h-3 w-3 align-text-bottom" aria-hidden="true" />
          ) : (
            <AlertTriangle className="mr-1 inline h-3 w-3 align-text-bottom" aria-hidden="true" />
          )}
          <span>{rawText.slice(span.start, span.end)}</span>
        </button>
      );
      cursor = span.end;
    }

    if (cursor < rawText.length) {
      nodes.push(<Fragment key={`tail-${cursor}`}>{rawText.slice(cursor)}</Fragment>);
    }

    return nodes;
  };

  const renderSanitizedHighlighted = () => {
    if (!sanitizedText) {
      return (
        <span style={{ color: "var(--text-muted)" }}>
          Run Step 1 to preview the redacted safe version before any cloud AI call.
        </span>
      );
    }

    const parts = sanitizedText.split(/(\[REDACTED:[^\]]+\])/g);
    return parts.map((part, idx) => {
      if (part.startsWith("[REDACTED:") && part.endsWith("]")) {
        const inner = part.slice("[REDACTED:".length, -1).replace(/_\d+$/, "");
        return (
          <span
            key={`red-${idx}`}
            title={part}
            className="mx-0.5 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold"
            style={{
              backgroundColor: "var(--safe-bg)",
              borderColor: "var(--safe-border)",
              color: "var(--safe-text)",
            }}
          >
            <Lock className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
            Hidden: {formatCategoryLabel(inner)}
          </span>
        );
      }
      return <Fragment key={`txt-${idx}`}>{part}</Fragment>;
    });
  };

  return (
    <section className="lf-card rounded-2xl p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            className="text-base font-semibold tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            2. Review Hidden Secrets (On-Device)
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
            Highlight any sensitive word on the left to hide it, or click a secret tag to inspect or toggle.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {selectionRange && (
            <button
              type="button"
              onClick={handleHideSelection}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold"
              style={{
                backgroundColor: "var(--accent-primary)",
                color: "var(--accent-on-primary)",
              }}
            >
              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
              Hide Selected Text
            </button>
          )}

          {sanitizedText && (
            <button
              type="button"
              onClick={() => void handleCopySafe()}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors"
              style={{
                backgroundColor: "var(--bg-subtle)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            >
              {copiedSafe ? (
                <>
                  <Check className="h-3.5 w-3.5" style={{ color: "var(--safe-text)" }} aria-hidden="true" />
                  Copied Safe Text
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  Copy Safe Text
                </>
              )}
            </button>
          )}

          {spans.length > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold"
              style={{
                backgroundColor: unmaskedCount > 0 ? "var(--warn-bg)" : "var(--safe-bg)",
                borderColor: unmaskedCount > 0 ? "var(--warn-border)" : "var(--safe-border)",
                color: unmaskedCount > 0 ? "var(--warn-text)" : "var(--safe-text)",
              }}
            >
              {unmaskedCount > 0 ? (
                <>
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  {unmaskedCount} unmasked — Cloud AI paused
                </>
              ) : (
                <>
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {maskedCount} hidden from AI
                </>
              )}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div
          className="rounded-xl border p-3.5"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span
              className="text-xs font-semibold"
              style={{ color: "var(--text-secondary)" }}
            >
              Original on Your Device
            </span>
            {loadedFromZeroPiiStore && (
              <span
                className="rounded-md border px-2 py-0.5 text-[11px] font-medium"
                style={{
                  backgroundColor: "var(--safe-bg)",
                  borderColor: "var(--safe-border)",
                  color: "var(--safe-text)",
                }}
              >
                Raw text purged from storage
              </span>
            )}
          </div>
          <div
            ref={rawContainerRef}
            onMouseUp={handleMouseUpOnRaw}
            className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed"
            style={{ color: "var(--text-primary)" }}
          >
            {renderOriginalWithHighlights()}
          </div>
        </div>

        <div
          className="rounded-xl border p-3.5"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: sanitizedText && unmaskedCount === 0
              ? "var(--safe-border)"
              : "var(--border-subtle)",
          }}
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span
              className="text-xs font-semibold"
              style={{ color: "var(--text-secondary)" }}
            >
              Safe Version Sent to AI
            </span>
            {sanitizedText && unmaskedCount === 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold"
                style={{
                  backgroundColor: "var(--safe-bg)",
                  borderColor: "var(--safe-border)",
                  color: "var(--safe-text)",
                }}
              >
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                Zero raw secrets
              </span>
            )}
          </div>
          <div
            className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed"
            style={{ color: "var(--text-primary)" }}
          >
            {renderSanitizedHighlighted()}
          </div>
        </div>
      </div>

      {sorted.length > 0 && (
        <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
          <p
            className="mb-2 text-xs font-medium"
            style={{ color: "var(--text-secondary)" }}
          >
            Secret tags found ({sorted.length}) — click or press Enter/Space to toggle hiding:
          </p>
          <div className="flex flex-wrap gap-2">
            {sorted.map(({ span, index }) => {
              const isMasked = span.masked !== false;
              const categoryName = formatCategoryLabel(span.category);
              const detectorName = formatDetectorLabel(span.detector);

              return (
                <button
                  key={`chip-${span.start}-${span.end}-${index}`}
                  type="button"
                  disabled={loadedFromZeroPiiStore}
                  aria-pressed={isMasked}
                  onClick={() => onToggleSpan(index)}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                  style={{
                    backgroundColor: isMasked ? "var(--mask-bg)" : "var(--warn-bg)",
                    borderColor: isMasked ? "var(--mask-border)" : "var(--warn-border)",
                    color: isMasked ? "var(--mask-text)" : "var(--warn-text)",
                  }}
                >
                  {isMasked ? (
                    <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <Unlock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <span className="font-semibold">
                    {isMasked ? `Hidden: ${categoryName}` : `Exposed: ${categoryName}`}
                  </span>
                  <span className="opacity-75">· {detectorName}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
