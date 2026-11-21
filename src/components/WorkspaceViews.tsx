import { useEffect, useRef, useState, type FormEvent } from "react";
import { animate, stagger } from "animejs";
import { BookOpen, Clock, Lock, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { getSeverityStyle } from "../config/displayLabels";
import type { CustomRunbook, PrivacyPolicy, TriageResult } from "../types/triage";
import { createSafeScope } from "../utils/animeScope";

export function HistoryWorkspaceView({
  history,
  onSelectHistory,
  onClearHistory,
}: {
  history: TriageResult[];
  onSelectHistory: (ticket: TriageResult) => void;
  onClearHistory: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = listRef.current;
    if (!root || history.length === 0) return;
    const scope = createSafeScope(root, (reduced) => {
      if (reduced) return;
      animate(".lf-history-card", {
        opacity: [0, 1],
        translateY: [8, 0],
        duration: 280,
        delay: stagger(35),
        ease: "outQuad",
      });
    });
    return () => scope.revert();
  }, [history.length]);

  return (
    <section ref={listRef} className="lf-card rounded-2xl p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            Sanitized Ticket History
          </h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>
            Saved tickets store only masked safe text. Raw secrets are purged from storage.
          </p>
        </div>

        {history.length > 0 && (
          <button
            type="button"
            onClick={onClearHistory}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold"
            style={{
              backgroundColor: "var(--mask-bg)",
              borderColor: "var(--mask-border)",
              color: "var(--mask-text)",
            }}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Clear Saved History
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div
          className="rounded-xl border p-8 text-center"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <Clock className="mx-auto mb-2 h-8 w-8" style={{ color: "var(--text-muted)" }} aria-hidden="true" />
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            No saved incidents yet
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
            Run an analysis in Triage to populate your Zero-PII history.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {history.map((item) => {
            const sev = getSeverityStyle(item.severity);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectHistory(item)}
                className="lf-history-card flex min-h-[44px] flex-col items-start gap-2 rounded-xl border p-4 text-left"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  borderColor: "var(--border-subtle)",
                }}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span
                    className="truncate text-sm font-semibold"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {item.title}
                  </span>
                  <span
                    className="shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-bold"
                    style={{
                      backgroundColor: sev.bg,
                      borderColor: sev.border,
                      color: sev.text,
                    }}
                  >
                    {item.severity} · {sev.label}
                  </span>
                </div>

                <p
                  className="line-clamp-2 font-mono text-xs"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {item.sanitizedText}
                </p>

                <div className="flex flex-wrap items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  <span
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium"
                    style={{
                      backgroundColor: "var(--safe-bg)",
                      borderColor: "var(--safe-border)",
                      color: "var(--safe-text)",
                    }}
                  >
                    <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                    Zero-PII Stored
                  </span>
                  <span>{item.spans.length} secret(s)</span>
                  <span>· {new Date(item.createdAt).toLocaleString()}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function PrivacyRulesWorkspaceView({
  policy,
  onSavePolicy,
}: {
  policy: PrivacyPolicy;
  onSavePolicy: (updated: PrivacyPolicy) => void;
}) {
  const [newTerm, setNewTerm] = useState("");

  const handleAddTerm = (e: FormEvent) => {
    e.preventDefault();
    const cleaned = newTerm.trim();
    if (!cleaned) return;
    if (policy.customTerms.some((t) => t.toLowerCase() === cleaned.toLowerCase())) {
      setNewTerm("");
      return;
    }
    onSavePolicy({
      ...policy,
      customTerms: [...policy.customTerms, cleaned],
    });
    setNewTerm("");
  };

  return (
    <section className="lf-card rounded-2xl p-5">
      <div className="mb-5">
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          Privacy Rules
        </h2>
        <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>
          Control what stays private on your device before any cloud AI call runs.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div
          className="rounded-xl border p-4"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" style={{ color: "var(--safe-text)" }} aria-hidden="true" />
            <div>
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Automatic Random Key Detection
              </h3>
              <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                Uses local Shannon entropy scanning (&gt; 3.8 bits/char) to catch unfamiliar API keys,
                bearer tokens, and webhook secrets automatically.
              </p>

              <label className="mt-3 flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                <input
                  type="checkbox"
                  checked={policy.enableEntropyScanner}
                  onChange={(e) =>
                    onSavePolicy({
                      ...policy,
                      enableEntropyScanner: e.target.checked,
                    })
                  }
                  className="h-4 w-4 accent-indigo-600"
                />
                Enable local high-entropy key scanner
              </label>
            </div>
          </div>
        </div>

        <div
          className="rounded-xl border p-4"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Custom Blocked Terms ({policy.customTerms.length})
          </h3>
          <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
            Add internal codenames, customer accounts, or private hostnames that should always be hidden.
          </p>

          <form onSubmit={handleAddTerm} className="mt-3 flex gap-2">
            <input
              type="text"
              value={newTerm}
              onChange={(e) => setNewTerm(e.target.value)}
              placeholder="e.g., Project-Phoenix"
              aria-label="Custom blocked term"
              className="lf-input min-h-[44px] flex-1 rounded-xl px-3 text-sm"
            />
            <button
              type="submit"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 text-xs font-semibold"
              style={{
                backgroundColor: "var(--accent-primary)",
                color: "var(--accent-on-primary)",
              }}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add Rule
            </button>
          </form>

          <div className="mt-3 flex flex-wrap gap-2">
            {policy.customTerms.length === 0 ? (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                No custom terms added yet.
              </span>
            ) : (
              policy.customTerms.map((term) => (
                <span
                  key={term}
                  className="inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-medium"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-subtle)",
                    color: "var(--text-primary)",
                  }}
                >
                  <code>{term}</code>
                  <button
                    type="button"
                    aria-label={`Remove blocked term ${term}`}
                    onClick={() =>
                      onSavePolicy({
                        ...policy,
                        customTerms: policy.customTerms.filter((t) => t !== term),
                      })
                    }
                    className="rounded p-0.5 hover:opacity-80"
                    style={{ color: "var(--mask-text)" }}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </span>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function RunbooksWorkspaceView({
  runbooks,
  onSaveRunbooks,
}: {
  runbooks: CustomRunbook[];
  onSaveRunbooks: (updated: CustomRunbook[]) => void;
}) {
  const [title, setTitle] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [severity, setSeverity] = useState<"P2" | "P3">("P2");
  const [resolution, setResolution] = useState("");

  const handleAddRunbook = (e: FormEvent) => {
    e.preventDefault();
    const keywords = keywordsText
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    if (!title.trim() || keywords.length === 0 || !resolution.trim()) return;

    const created: CustomRunbook = {
      id: `RB_CUSTOM_${Date.now()}`,
      title: title.trim(),
      category: "CUSTOM_LOCAL_RUNBOOK",
      severity,
      keywords,
      resolution: resolution.trim(),
      builtIn: false,
    };
    onSaveRunbooks([created, ...runbooks]);
    setTitle("");
    setKeywordsText("");
    setResolution("");
  };

  return (
    <section className="lf-card rounded-2xl p-5">
      <div className="mb-5">
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          Offline Fix Runbooks
        </h2>
        <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>
          Known recurring issues match locally for $0 instant answers even without internet access.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <form
          onSubmit={handleAddRunbook}
          className="flex flex-col gap-3 rounded-xl border p-4"
          style={{
            backgroundColor: "var(--bg-subtle)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Add Custom Offline Runbook
          </h3>

          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Runbook title (e.g., Redis Connection Refused)"
            aria-label="Runbook title"
            className="lf-input min-h-[44px] rounded-xl px-3 text-sm"
          />

          <input
            type="text"
            value={keywordsText}
            onChange={(e) => setKeywordsText(e.target.value)}
            placeholder="Trigger keywords (comma-separated)"
            aria-label="Trigger keywords"
            className="lf-input min-h-[44px] rounded-xl px-3 text-sm"
          />

          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value === "P3" ? "P3" : "P2")}
            aria-label="Runbook severity"
            className="lf-input min-h-[44px] rounded-xl px-3 text-sm"
          >
            <option value="P2">P2 · Medium</option>
            <option value="P3">P3 · Low</option>
          </select>

          <textarea
            rows={4}
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="Fix instructions (Markdown supported)..."
            aria-label="Runbook fix steps"
            className="lf-input rounded-xl p-3 font-mono text-xs"
          />

          <button
            type="submit"
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-semibold"
            style={{
              backgroundColor: "var(--accent-primary)",
              color: "var(--accent-on-primary)",
            }}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Save Offline Runbook
          </button>
        </form>

        <div className="space-y-3">
          {runbooks.map((rb) => {
            const sev = getSeverityStyle(rb.severity);
            return (
              <article
                key={rb.id}
                className="rounded-xl border p-4"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  borderColor: "var(--border-subtle)",
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4" style={{ color: "var(--safe-text)" }} aria-hidden="true" />
                    <h4 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {rb.title}
                    </h4>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-md border px-2 py-0.5 text-[11px] font-bold"
                      style={{
                        backgroundColor: sev.bg,
                        borderColor: sev.border,
                        color: sev.text,
                      }}
                    >
                      {rb.severity}
                    </span>
                    <span
                      className="rounded-md border px-2 py-0.5 text-[11px] font-medium"
                      style={{
                        backgroundColor: "var(--bg-surface)",
                        borderColor: "var(--border-subtle)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {rb.builtIn ? "Built-in" : "Custom"}
                    </span>
                    {!rb.builtIn && (
                      <button
                        type="button"
                        aria-label={`Delete runbook ${rb.title}`}
                        onClick={() => onSaveRunbooks(runbooks.filter((r) => r.id !== rb.id))}
                        className="rounded-lg border p-1.5"
                        style={{
                          backgroundColor: "var(--mask-bg)",
                          borderColor: "var(--mask-border)",
                          color: "var(--mask-text)",
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>

                <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                  Keywords: <code className="font-mono">{rb.keywords.join(", ")}</code>
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
