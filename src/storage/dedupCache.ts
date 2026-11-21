import type { HybridBriefResult } from "../types/triage";

const DEDUP_DB_NAME = "localfirst_dedup_cache_db";
const DEDUP_DB_VERSION = 1;
const DEDUP_STORE = "triage_dedup_cache";

export interface DedupCacheEntry {
  fingerprint: string;
  normalizedPreview: string;
  aiSolution: string;
  executiveBrief: HybridBriefResult | null;
  hitCount: number;
  lastUsedAt: number;
  modelUsed: string;
  savedCloudCalls: number;
}

export interface DedupLookupResult {
  entry: DedupCacheEntry;
  latencyMs: number;
}

export interface DedupCacheStats {
  entryCount: number;
  totalHits: number;
  totalSavedCloudCalls: number;
}

const memoryDedupStore = new Map<string, DedupCacheEntry>();

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDedupDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DEDUP_DB_NAME, DEDUP_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DEDUP_STORE)) {
        db.createObjectStore(DEDUP_STORE, { keyPath: "fingerprint" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Normalizes ONLY already-sanitized text so structurally identical alerts
 * (with varying timestamps, UUIDs, request IDs, line numbers, or redaction indices)
 * collapse to the exact same Zero-PII template fingerprint.
 */
export function normalizeSanitizedTemplate(sanitizedText: string): string {
  return sanitizedText
    // Normalize indexed placeholders: [REDACTED:API_KEY_1] -> [REDACTED:API_KEY]
    .replace(/\[REDACTED:([A-Z0-9_]+?)_\d+\]/g, "[REDACTED:$1]")
    // Strip ISO-8601 timestamps & common log dates
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/gi, "<ts>")
    // Strip UUIDs
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    // Strip hex request/trace IDs (e.g. 0x9f2a1c, req_8a7b6c5d)
    .replace(/\b(?:0x[0-9a-f]{6,}|req_[a-z0-9]{6,}|trace_[a-z0-9]{6,})\b/gi, "<req_id>")
    // Strip line numbers on stack frames (:line 42 or :42)
    .replace(/(?::line\s+\d+|:\d+(?=:\d+|\s|$))/gi, ":<line>")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Deterministic non-crypto fallback only if WebCrypto is unavailable
  let h1 = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h1 ^= bytes[i];
    h1 = Math.imul(h1, 0x01000193);
  }
  return (h1 >>> 0).toString(16).padStart(64, "0");
}

export async function computeTemplateFingerprint(
  sanitizedText: string,
): Promise<{ fingerprint: string; normalizedPreview: string }> {
  const normalized = normalizeSanitizedTemplate(sanitizedText);
  const fingerprint = await sha256Hex(normalized);
  return {
    fingerprint,
    normalizedPreview: normalized.slice(0, 140),
  };
}

async function readEntry(fingerprint: string): Promise<DedupCacheEntry | null> {
  if (!hasIndexedDb()) {
    return memoryDedupStore.get(fingerprint) ?? null;
  }
  try {
    const db = await openDedupDb();
    return await new Promise<DedupCacheEntry | null>((resolve, reject) => {
      const tx = db.transaction(DEDUP_STORE, "readonly");
      const store = tx.objectStore(DEDUP_STORE);
      const req = store.get(fingerprint);
      req.onsuccess = () => resolve((req.result as DedupCacheEntry | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return memoryDedupStore.get(fingerprint) ?? null;
  }
}

async function writeEntry(entry: DedupCacheEntry): Promise<void> {
  memoryDedupStore.set(entry.fingerprint, entry);
  if (!hasIndexedDb()) return;
  try {
    const db = await openDedupDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DEDUP_STORE, "readwrite");
      const store = tx.objectStore(DEDUP_STORE);
      store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback already stored in memoryDedupStore
  }
}

export async function lookupDedupCache(
  sanitizedText: string,
): Promise<DedupLookupResult | null> {
  const startedAt = performance.now();
  const { fingerprint } = await computeTemplateFingerprint(sanitizedText);
  const existing = await readEntry(fingerprint);
  if (!existing) return null;

  const updated: DedupCacheEntry = {
    ...existing,
    hitCount: existing.hitCount + 1,
    savedCloudCalls: existing.savedCloudCalls + 1,
    lastUsedAt: Date.now(),
  };
  await writeEntry(updated);
  const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));
  return { entry: updated, latencyMs };
}

export async function saveToDedupCache(params: {
  sanitizedText: string;
  aiSolution: string;
  executiveBrief?: HybridBriefResult | null;
  modelUsed?: string;
}): Promise<DedupCacheEntry> {
  const { fingerprint, normalizedPreview } = await computeTemplateFingerprint(
    params.sanitizedText,
  );
  const existing = await readEntry(fingerprint);
  const entry: DedupCacheEntry = {
    fingerprint,
    normalizedPreview,
    aiSolution: params.aiSolution,
    executiveBrief: params.executiveBrief ?? existing?.executiveBrief ?? null,
    hitCount: existing?.hitCount ?? 0,
    lastUsedAt: Date.now(),
    modelUsed: params.modelUsed ?? existing?.modelUsed ?? "gemini-2.5-flash",
    savedCloudCalls: existing?.savedCloudCalls ?? 0,
  };
  await writeEntry(entry);
  return entry;
}

export async function getDedupCacheStats(): Promise<DedupCacheStats> {
  let entries: DedupCacheEntry[] = Array.from(memoryDedupStore.values());
  if (hasIndexedDb()) {
    try {
      const db = await openDedupDb();
      entries = await new Promise<DedupCacheEntry[]>((resolve, reject) => {
        const tx = db.transaction(DEDUP_STORE, "readonly");
        const store = tx.objectStore(DEDUP_STORE);
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result as DedupCacheEntry[]) ?? []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      // use memory entries
    }
  }
  return {
    entryCount: entries.length,
    totalHits: entries.reduce((sum, e) => sum + e.hitCount, 0),
    totalSavedCloudCalls: entries.reduce((sum, e) => sum + e.savedCloudCalls, 0),
  };
}

export async function clearDedupCache(): Promise<void> {
  memoryDedupStore.clear();
  if (!hasIndexedDb()) return;
  try {
    const db = await openDedupDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DEDUP_STORE, "readwrite");
      tx.objectStore(DEDUP_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // memory store already cleared
  }
}
