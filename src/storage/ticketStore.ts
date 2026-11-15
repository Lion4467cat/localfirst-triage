import type { TriageResult } from "../types/triage";

const DB_NAME = "localfirst_triage_db";
const DB_VERSION = 1;
const STORE_NAME = "sanitized_tickets";

let memoryStore: TriageResult[] = [];

export function stripRawTextForStorage(result: TriageResult): TriageResult {
  // Never persist raw unredacted PII/secrets or original span substrings to IndexedDB
  return {
    ...result,
    rawText: "[PURGED_FROM_DISK_FOR_PRIVACY]",
    loadedFromZeroPiiStore: true,
    spans: result.spans.map((s) => ({
      ...s,
      matchedText: s.placeholder,
    })),
  };
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
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export async function saveSanitizedTicket(result: TriageResult): Promise<void> {
  const safeRecord = stripRawTextForStorage(result);
  memoryStore = [safeRecord, ...memoryStore.filter((item) => item.id !== safeRecord.id)].slice(
    0,
    50,
  );

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(safeRecord);
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
    const items = await new Promise<TriageResult[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as TriageResult[]) ?? []);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
    });
    db.close();
    return items.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [...memoryStore];
  }
}

export async function clearSanitizedTickets(): Promise<void> {
  memoryStore = [];
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB clear failed"));
    });
    db.close();
  } catch {
    // Ignore in-memory only environments
  }
}
