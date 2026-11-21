import { useState } from "react";
import { BookOpen, Plus, Shield, Trash2, X } from "lucide-react";
import type { CustomRunbook, PrivacyPolicy } from "../types/triage";

interface RunbookPolicyModalProps {
  open: boolean;
  runbooks: CustomRunbook[];
  policy: PrivacyPolicy;
  onClose: () => void;
  onSaveRunbooks: (updated: CustomRunbook[]) => void;
  onSavePolicy: (updated: PrivacyPolicy) => void;
}

export function RunbookPolicyModal({
  open,
  runbooks,
  policy,
  onClose,
  onSaveRunbooks,
  onSavePolicy,
}: RunbookPolicyModalProps) {
  const [tab, setTab] = useState<"runbooks" | "policy">("runbooks");
  const [newTerm, setNewTerm] = useState("");
  const [rbId, setRbId] = useState("RB_CUSTOM_VPN_DNS");
  const [rbTitle, setRbTitle] = useState("");
  const [rbSeverity, setRbSeverity] = useState<"P2" | "P3">("P3");
  const [rbKeywords, setRbKeywords] = useState("");
  const [rbResolution, setRbResolution] = useState("");

  if (!open) return null;

  const handleAddTerm = () => {
    const clean = newTerm.trim();
    if (clean.length < 3 || policy.customTerms.includes(clean)) return;
    onSavePolicy({ ...policy, customTerms: [...policy.customTerms, clean] });
    setNewTerm("");
  };

  const handleAddRunbook = () => {
    const id = rbId.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    const keywords = rbKeywords
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    if (!id || !rbTitle.trim() || keywords.length === 0 || !rbResolution.trim()) return;
    const created: CustomRunbook = {
      id,
      title: rbTitle.trim(),
      category: id.replace(/^RB_/, ""),
      severity: rbSeverity,
      keywords,
      resolution: rbResolution.trim(),
      builtIn: false,
    };
    onSaveRunbooks([created, ...runbooks.filter((r) => r.id !== id)]);
    setRbId(`RB_CUSTOM_${Date.now().toString().slice(-4)}`);
    setRbTitle("");
    setRbKeywords("");
    setRbResolution("");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Runbooks & Workspace Privacy Policy"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-indigo-400" />
            <h2 className="text-base font-bold text-white">
              Local Runbooks &amp; Workspace Privacy Policy
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => setTab("runbooks")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
              tab === "runbooks" ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300"
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span>On-Device Runbooks ({runbooks.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("policy")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
              tab === "policy" ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300"
            }`}
          >
            <Shield className="h-3.5 w-3.5" />
            <span>Workspace Privacy Policy ({policy.customTerms.length} terms)</span>
          </button>
        </div>

        {tab === "runbooks" && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2.5">
              <p className="text-xs font-semibold text-indigo-300">
                Add Custom Local P2/P3 Runbook (0 Cloud Tokens · Injected into Nano 4 Prompt)
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <input
                  type="text"
                  value={rbId}
                  onChange={(e) => setRbId(e.target.value)}
                  placeholder="RB_CUSTOM_ID"
                  className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-100"
                />
                <input
                  type="text"
                  value={rbTitle}
                  onChange={(e) => setRbTitle(e.target.value)}
                  placeholder="Title (e.g. Local VPN DNS)"
                  className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
                />
                <select
                  value={rbSeverity}
                  onChange={(e) => setRbSeverity(e.target.value as "P2" | "P3")}
                  className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
                >
                  <option value="P3">P3 (Low / Local)</option>
                  <option value="P2">P2 (Medium / Local)</option>
                </select>
              </div>
              <input
                type="text"
                value={rbKeywords}
                onChange={(e) => setRbKeywords(e.target.value)}
                placeholder="Comma-separated trigger keywords (e.g. split-dns, vpn_timeout)"
                className="w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
              />
              <textarea
                rows={3}
                value={rbResolution}
                onChange={(e) => setRbResolution(e.target.value)}
                placeholder="Markdown fix steps executed locally without Cloud calls..."
                className="w-full rounded border border-slate-700 bg-slate-900 p-2.5 text-xs text-slate-100"
              />
              <button
                type="button"
                onClick={handleAddRunbook}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Save Local Runbook</span>
              </button>
            </div>

            <div className="space-y-2 max-h-60 overflow-auto">
              {runbooks.map((rb) => (
                <div
                  key={rb.id}
                  className="flex items-start justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-emerald-300">{rb.id}</span>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300">
                        {rb.severity}
                      </span>
                      <span className="font-medium text-slate-200">{rb.title}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      Keywords: {rb.keywords.join(", ")}
                    </p>
                  </div>
                  {!rb.builtIn && (
                    <button
                      type="button"
                      onClick={() => onSaveRunbooks(runbooks.filter((item) => item.id !== rb.id))}
                      aria-label={`Delete ${rb.id}`}
                      className="text-slate-400 hover:text-rose-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "policy" && (
          <div className="space-y-4 text-xs">
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-3">
              <label className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-200">Shannon Entropy Secret Scanner</p>
                  <p className="text-[11px] text-slate-400">
                    Detects high-entropy credential/webhook values in key=value assignments locally.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={policy.enableEntropyScanner}
                  onChange={(e) =>
                    onSavePolicy({ ...policy, enableEntropyScanner: e.target.checked })
                  }
                  className="h-4 w-4 accent-indigo-500"
                />
              </label>

              <div className="border-t border-slate-800 pt-3">
                <p className="mb-1.5 font-semibold text-slate-200">
                  Custom Confidential Terms (<code className="font-mono">[POLICY_TERM]</code>)
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTerm}
                    onChange={(e) => setNewTerm(e.target.value)}
                    placeholder="e.g. Project-Apollo or AcmeCustomer"
                    className="flex-1 rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={handleAddTerm}
                    className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-500"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Term</span>
                  </button>
                </div>
              </div>

              {policy.customTerms.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {policy.customTerms.map((term) => (
                    <span
                      key={term}
                      className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-950/40 px-2.5 py-1 font-mono text-[11px] text-violet-200"
                    >
                      <span>{term}</span>
                      <button
                        type="button"
                        onClick={() =>
                          onSavePolicy({
                            ...policy,
                            customTerms: policy.customTerms.filter((t) => t !== term),
                          })
                        }
                        aria-label={`Remove ${term}`}
                        className="text-violet-300 hover:text-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
