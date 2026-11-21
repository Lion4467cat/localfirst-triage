import {
  collection,
  deleteDoc,
  doc,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { getFirebaseApp, initAppCheckIfConfigured } from "../config/firebase";
import type { CustomRunbook, PrivacyPolicy, TriageResult } from "../types/triage";
import {
  firestoreTicketToLocalResult,
  type CloudWriteResult,
  type FirestorePolicyDoc,
  type FirestoreRunbookDoc,
  type WorkspaceSyncCallbacks,
} from "./cloudSync";
import { sanitizeStoredPolicy, sanitizeStoredRunbooks } from "./ticketStore";

let cachedFirestore: Firestore | null = null;

export function getLazyFirestore(): Firestore | null {
  const app = getFirebaseApp();
  if (!app) {
    return null;
  }
  initAppCheckIfConfigured(app);
  if (!cachedFirestore) {
    cachedFirestore = getFirestore(app);
  }
  return cachedFirestore;
}

export function resetLazyFirestoreForTests(): void {
  cachedFirestore = null;
}

export async function writeFirestoreDoc(
  pathSegments: string[],
  data: unknown,
): Promise<CloudWriteResult> {
  const db = getLazyFirestore();
  if (!db) {
    return { ok: false, reason: "Firestore not configured." };
  }
  const [root, ...rest] = pathSegments;
  if (!root) {
    return { ok: false, reason: "Invalid Firestore document path." };
  }
  try {
    await setDoc(doc(db, root, ...rest), data);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteFirestoreDoc(pathSegments: string[]): Promise<CloudWriteResult> {
  const db = getLazyFirestore();
  if (!db) {
    return { ok: false, reason: "Firestore not configured." };
  }
  const [root, ...rest] = pathSegments;
  if (!root) {
    return { ok: false, reason: "Invalid Firestore document path." };
  }
  try {
    await deleteDoc(doc(db, root, ...rest));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function batchDeleteFirestoreTickets(
  uid: string,
  ticketIds: string[],
): Promise<CloudWriteResult> {
  const db = getLazyFirestore();
  if (!db || !uid.trim() || ticketIds.length === 0) {
    return { ok: true };
  }
  try {
    const batch = writeBatch(db);
    for (const id of ticketIds) {
      if (id.trim()) {
        batch.delete(doc(db, "workspaces", uid, "tickets", id));
      }
    }
    await batch.commit();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export function attachFirestoreWorkspaceListeners(
  uid: string,
  callbacks: WorkspaceSyncCallbacks,
): () => void {
  const db = getLazyFirestore();
  if (!db || !uid.trim()) {
    return () => {};
  }

  const ticketsQuery = query(
    collection(db, "workspaces", uid, "tickets"),
    orderBy("createdAt", "desc"),
    limit(50),
  );
  const unsubTickets = onSnapshot(
    ticketsQuery,
    (snapshot) => {
      const parsed = snapshot.docs
        .map((snap) => firestoreTicketToLocalResult(snap.data()))
        .filter((item): item is TriageResult => item !== null);
      callbacks.onTickets(parsed);
    },
    (err) => {
      callbacks.onError?.(err.message);
    },
  );

  const policyRef = doc(db, "workspaces", uid, "policies", "default");
  const unsubPolicy = onSnapshot(
    policyRef,
    (snap) => {
      if (!snap.exists()) return;
      const raw = snap.data() as Partial<FirestorePolicyDoc>;
      const valid: PrivacyPolicy | null = sanitizeStoredPolicy(raw);
      if (valid) {
        callbacks.onPolicy(
          valid,
          typeof raw.createdAt === "number" && raw.createdAt > 0 ? raw.createdAt : Date.now(),
        );
      }
    },
    (err) => {
      callbacks.onError?.(err.message);
    },
  );

  const runbooksRef = collection(db, "workspaces", uid, "runbooks");
  const unsubRunbooks = onSnapshot(
    runbooksRef,
    (snapshot) => {
      const createdMap = new Map<string, number>();
      const rawDocs = snapshot.docs.map((snap) => {
        const data = snap.data() as Partial<FirestoreRunbookDoc>;
        if (typeof data.id === "string" && typeof data.createdAt === "number") {
          createdMap.set(data.id, data.createdAt);
        }
        return data;
      });
      const valid: CustomRunbook[] | null = sanitizeStoredRunbooks(rawDocs);
      if (valid) {
        callbacks.onRunbooks(
          valid.map((rb) => ({ ...rb, builtIn: false })),
          createdMap,
        );
      } else if (rawDocs.length === 0) {
        callbacks.onRunbooks([], createdMap);
      }
    },
    (err) => {
      callbacks.onError?.(err.message);
    },
  );

  return () => {
    unsubTickets();
    unsubPolicy();
    unsubRunbooks();
  };
}
