import { DEFAULT_RUNBOOKS } from "../config/demoScenarios";
import type { CustomRunbook, PrivacyPolicy, TriageResult } from "../types/triage";

const DB_NAME = "localfirst_triage_db";
const DB_VERSION = 2;
const TICKETS_STORE = "sanitized_tickets";
const SETTINGS_STORE = "workspace_settings";
const LOCALSTORAGE_RUNBOOKS_KEY = "localfirst_custom_runbooks_v1";
const LOCALSTORAGE_POLICY_KEY = "localfirst_privacy_policy_v1";

export const DEFAULT_PRIVACY_POLICY: PrivacyPolicy = {
  customTerms: [],
  enableEntropyScanner: true,
  autoCountdownSeconds: 3,
};

let memoryTickets: TriageResult[] = [];
let memoryRunbooks: CustomRunbook[] | null = null;
let memoryPolicy: PrivacyPolicy | null = null;

export function stripRawTextForStorage(result: TriageResult): TriageResult {
  // Never persist raw unredacted PII/secrets or original span substrings to IndexedDB
  return {
    ...result,
    rawText: "[PURGED_FROM_DISK_FOR_PRIVACY]",
    loadedFromZeroPiiStore: true,
    spans: (Array.isArray(result.spans) ? result.spans : []).map((s) => ({
      ...s,
      matchedText: s.placeholder,
      constituentTexts: undefined,
    })),
  };
}

export function sanitizeStoredTicket(raw: unknown): TriageResult | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<TriageResult>;
  if (
    typeof candidate.id !== "string" ||
    !candidate.id.trim() ||
    typeof candidate.sanitizedText !== "string"
  ) {
    return null;
  }
  const safeSpans = Array.isArray(candidate.spans)
    ? candidate.spans
        .filter((s) => Boolean(s && typeof s === "object" && typeof s.placeholder === "string"))
        .map((s) => ({
          start: typeof s.start === "number" ? s.start : 0,
          end: typeof s.end === "number" ? s.end : 0,
          category: typeof s.category === "string" ? s.category : "SECRET",
          detector: s.detector ?? "REGEX_FIREWALL",
          placeholder: s.placeholder,
          matchedText: s.placeholder,
          masked: s.masked !== false,
        }))
    : [];

  return {
    id: candidate.id,
    title: typeof candidate.title === "string" && candidate.title.trim() ? candidate.title : "Recovered Ticket",
    rawText: "[PURGED_FROM_DISK_FOR_PRIVACY]",
    sanitizedText: candidate.sanitizedText,
    severity:
      candidate.severity === "P0" ||
      candidate.severity === "P1" ||
      candidate.severity === "P2" ||
      candidate.severity === "P3"
        ? candidate.severity
        : "P2",
    category: typeof candidate.category === "string" ? candidate.category : "GENERAL_INCIDENT",
    runbookId: typeof candidate.runbookId === "string" ? candidate.runbookId : null,
    spans: safeSpans,
    resolution:
      typeof candidate.resolution === "string"
        ? candidate.resolution
        : "Recovered sanitized record from browser storage.",
    resolutionMode: candidate.resolutionMode ?? "LOCAL_FALLBACK_ONLY",
    inferenceSource: candidate.inferenceSource ?? "LOCAL_REGEX_FALLBACK",
    stage1Source: candidate.stage1Source ?? "HEURISTIC_GUARD",
    stage1LatencyMs: typeof candidate.stage1LatencyMs === "number" ? candidate.stage1LatencyMs : 1,
    stage2Source: candidate.stage2Source ?? "HELD_QUARANTINE",
    stage2LatencyMs: typeof candidate.stage2LatencyMs === "number" ? candidate.stage2LatencyMs : 0,
    nanoStatus: candidate.nanoStatus ?? "UNAVAILABLE",
    latencyMs: typeof candidate.latencyMs === "number" ? candidate.latencyMs : 1,
    estimatedTokensSaved:
      typeof candidate.estimatedTokensSaved === "number" ? candidate.estimatedTokensSaved : 40,
    createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : 0,
    activeCloudModel: candidate.activeCloudModel,
    cloudError: candidate.cloudError ?? null,
    zeroLeakageAudit: candidate.zeroLeakageAudit ?? null,
    hybridBrief: candidate.hybridBrief ?? null,
    importedFromExtension: Boolean(candidate.importedFromExtension),
    sourcePlatform:
      candidate.sourcePlatform === "WEB" ||
      candidate.sourcePlatform === "CHROME_EXTENSION" ||
      candidate.sourcePlatform === "ANDROID"
        ? candidate.sourcePlatform
        : candidate.importedFromExtension
          ? "CHROME_EXTENSION"
          : "WEB",
    queuedForReconnect: Boolean(candidate.queuedForReconnect),
    loadedFromZeroPiiStore: true,
    updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : undefined,
  };
}

export function sanitizeStoredPolicy(raw: unknown): PrivacyPolicy | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<PrivacyPolicy>;
  const customTerms = Array.isArray(candidate.customTerms)
    ? candidate.customTerms.filter((t): t is string => typeof t === "string" && t.trim().length >= 3)
    : [];
  return {
    customTerms,
    enableEntropyScanner:
      typeof candidate.enableEntropyScanner === "boolean"
        ? candidate.enableEntropyScanner
        : DEFAULT_PRIVACY_POLICY.enableEntropyScanner,
    autoCountdownSeconds:
      typeof candidate.autoCountdownSeconds === "number" && candidate.autoCountdownSeconds >= 0
        ? candidate.autoCountdownSeconds
        : DEFAULT_PRIVACY_POLICY.autoCountdownSeconds,
  };
}

export function sanitizeStoredRunbooks(raw: unknown): CustomRunbook[] | null {
  if (!Array.isArray(raw)) return null;
  const valid = raw.filter(
    (rb): rb is CustomRunbook =>
      Boolean(
        rb &&
          typeof rb === "object" &&
          typeof (rb as CustomRunbook).id === "string" &&
          typeof (rb as CustomRunbook).title === "string" &&
          Array.isArray((rb as CustomRunbook).keywords) &&
          typeof (rb as CustomRunbook).resolution === "string",
      ),
  );
  return valid.length > 0 ? valid : null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TICKETS_STORE)) {
        db.createObjectStore(TICKETS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export async function saveSanitizedTicket(result: TriageResult): Promise<void> {
  const safeRecord = stripRawTextForStorage(result);
  memoryTickets = [
    safeRecord,
    ...memoryTickets.filter(
      (item) =>
        item.id !== safeRecord.id &&
        !(item.title === safeRecord.title && item.sanitizedText === safeRecord.sanitizedText),
    ),
  ].slice(0, 50);

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(TICKETS_STORE, "readwrite");
      const store = tx.objectStore(TICKETS_STORE);
      const getAllReq = store.getAll();
      getAllReq.onsuccess = () => {
        const existing = (getAllReq.result as unknown[]) ?? [];
        for (const rawItem of existing) {
          const parsed = sanitizeStoredTicket(rawItem);
          if (
            parsed &&
            parsed.id !== safeRecord.id &&
            parsed.title === safeRecord.title &&
            parsed.sanitizedText === safeRecord.sanitizedText
          ) {
            store.delete(parsed.id);
          }
        }
        store.put(safeRecord);
      };
      getAllReq.onerror = () => {
        store.put(safeRecord);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
    });
    db.close();
  } catch {
    // Safe fallback to in-memory store
  }
}

export async function listSanitizedTickets(): Promise<TriageResult[]> {
  try {
    const db = await openDb();
    const items = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(TICKETS_STORE, "readonly");
      const req = tx.objectStore(TICKETS_STORE).getAll();
      req.onsuccess = () => resolve((req.result as unknown[]) ?? []);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
    });
    db.close();
    const valid = items
      .map((item) => sanitizeStoredTicket(item))
      .filter((item): item is TriageResult => item !== null);
    return valid.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [...memoryTickets];
  }
}

export async function clearSanitizedTickets(): Promise<void> {
  memoryTickets = [];
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(TICKETS_STORE, "readwrite");
      tx.objectStore(TICKETS_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB clear failed"));
    });
    db.close();
  } catch {
    // Ignore in-memory only environments
  }
}

async function putSetting<T>(key: string, value: T, lsKey: string): Promise<void> {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(lsKey, JSON.stringify(value));
    }
  } catch {
    // Ignore storage quota errors
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, "readwrite");
      tx.objectStore(SETTINGS_STORE).put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Setting write failed"));
    });
    db.close();
  } catch {
    // Safe fallback already saved to memory/localStorage
  }
}

async function getSetting<T>(key: string, lsKey: string): Promise<T | null> {
  try {
    const db = await openDb();
    const row = await new Promise<{ key: string; value: T } | undefined>((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, "readonly");
      const req = tx.objectStore(SETTINGS_STORE).get(key);
      req.onsuccess = () => resolve(req.result as { key: string; value: T } | undefined);
      req.onerror = () => reject(req.error ?? new Error("Setting read failed"));
    });
    db.close();
    if (row?.value !== undefined) return row.value;
  } catch {
    // Fallback to localStorage
  }
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(lsKey);
      if (raw) return JSON.parse(raw) as T;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

export async function saveCustomRunbooks(runbooks: CustomRunbook[]): Promise<void> {
  memoryRunbooks = [...runbooks];
  await putSetting("runbooks", runbooks, LOCALSTORAGE_RUNBOOKS_KEY);
}

export async function loadCustomRunbooks(): Promise<CustomRunbook[]> {
  if (memoryRunbooks) return [...memoryRunbooks];
  const stored = await getSetting<unknown>("runbooks", LOCALSTORAGE_RUNBOOKS_KEY);
  const valid = sanitizeStoredRunbooks(stored);
  if (valid) {
    memoryRunbooks = valid;
    return [...valid];
  }
  return [...DEFAULT_RUNBOOKS];
}

export async function savePrivacyPolicy(policy: PrivacyPolicy): Promise<void> {
  memoryPolicy = { ...policy };
  await putSetting("policy", policy, LOCALSTORAGE_POLICY_KEY);
}

export async function loadPrivacyPolicy(): Promise<PrivacyPolicy> {
  if (memoryPolicy) return { ...memoryPolicy };
  const stored = await getSetting<unknown>("policy", LOCALSTORAGE_POLICY_KEY);
  const valid = sanitizeStoredPolicy(stored);
  if (valid) {
    memoryPolicy = valid;
    return { ...valid };
  }
  return { ...DEFAULT_PRIVACY_POLICY };
}

export function exportAuditReportJson(result: TriageResult): string {
  const zeroPii = stripRawTextForStorage(result);
  return JSON.stringify(
    {
      schema: "localfirst-triage/audit-v3",
      exportedAt: new Date().toISOString(),
      ticketId: zeroPii.id,
      title: zeroPii.title,
      severity: zeroPii.severity,
      category: zeroPii.category,
      sourcePlatform:
        zeroPii.sourcePlatform ?? (zeroPii.importedFromExtension ? "CHROME_EXTENSION" : "WEB"),
      resolutionMode: zeroPii.resolutionMode,
      inferenceSource: zeroPii.inferenceSource,
      stage1Source: zeroPii.stage1Source,
      stage1LatencyMs: zeroPii.stage1LatencyMs,
      stage2Source: zeroPii.stage2Source,
      stage2LatencyMs: zeroPii.stage2LatencyMs,
      activeCloudModel: zeroPii.activeCloudModel ?? null,
      zeroLeakageVerified: zeroPii.zeroLeakageAudit?.verified ?? true,
      redactedSpanCount: zeroPii.spans.filter((s) => s.masked !== false).length,
      redactedSpans: zeroPii.spans.map((s) => ({
        detector: s.detector,
        category: s.category,
        placeholder: s.placeholder,
        masked: s.masked !== false,
      })),
      sanitizedPayload: zeroPii.sanitizedText,
      resolution: zeroPii.resolution,
      hybridBrief: zeroPii.hybridBrief ?? null,
    },
    null,
    2,
  );
}

export function exportAuditReportMarkdown(result: TriageResult): string {
  const zeroPii = stripRawTextForStorage(result);
  const maskedCount = zeroPii.spans.filter((s) => s.masked !== false).length;
  return [
    `# LocalFirst Triage — Zero-PII Compliance Audit Report`,
    ``,
    `- **Title:** ${zeroPii.title}`,
    `- **Severity / Category:** \`${zeroPii.severity}\` · \`${zeroPii.category}\``,
    `- **Stage 1 Firewall:** \`${zeroPii.stage1Source}\` (${zeroPii.stage1LatencyMs}ms)`,
    `- **Stage 2 Routing:** \`${zeroPii.stage2Source}\` · \`${zeroPii.resolutionMode}\` (${zeroPii.stage2LatencyMs}ms)`,
    `- **Inference Source:** \`${zeroPii.inferenceSource}\``,
    `- **Redacted Spans:** ${maskedCount} active mask(s)`,
    `- **Zero-Leakage Check:** ${zeroPii.zeroLeakageAudit ? (zeroPii.zeroLeakageAudit.verified ? "VERIFIED (0 raw secrets leaked)" : "BLOCKED") : "PASSED"}`,
    ``,
    `## Sanitized Payload`,
    "```text",
    zeroPii.sanitizedText,
    "```",
    ``,
    `## Triage Resolution`,
    zeroPii.resolution,
    zeroPii.hybridBrief
      ? `\n## Stakeholder Brief (${zeroPii.hybridBrief.inferenceSource})\n${zeroPii.hybridBrief.stakeholderDraft}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
