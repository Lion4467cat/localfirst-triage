import {
  GoogleAuthProvider,
  linkWithPopup,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signOut,
  type Auth,
  type AuthProvider,
  type User,
} from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import { getFirebaseAuth } from "../config/firebase";
import { verifyZeroLeakage } from "../firewall/spanMerger";
import type {
  AuthUserSummary,
  CustomRunbook,
  PrivacyPolicy,
  SourcePlatform,
  TriageResult,
} from "../types/triage";
import {
  sanitizeStoredPolicy,
  sanitizeStoredRunbooks,
  stripRawTextForStorage,
} from "./ticketStore";

const RAW_SECRET_PATTERNS: RegExp[] = [
  /AKIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z_-]{35}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export interface FirestoreTicketDoc {
  id: string;
  uid: string;
  title: string;
  sanitizedText: string;
  severity: "P0" | "P1" | "P2" | "P3";
  category: string;
  runbookId: string | null;
  resolution: string;
  resolutionMode: string;
  inferenceSource: string;
  stage1Source: string;
  stage1LatencyMs: number;
  stage2Source: string;
  stage2LatencyMs: number;
  nanoStatus: string;
  latencyMs: number;
  estimatedTokensSaved: number;
  activeCloudModel: string | null;
  sourcePlatform: SourcePlatform;
  zeroLeakageVerified: true;
  activeMaskCount: number;
  redactedCategories: string[];
  queuedForReconnect: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface FirestorePolicyDoc {
  uid: string;
  customTerms: string[];
  enableEntropyScanner: boolean;
  autoCountdownSeconds: number;
  createdAt: number;
  updatedAt: number;
}

export interface FirestoreRunbookDoc {
  id: string;
  uid: string;
  title: string;
  category: string;
  severity: "P2" | "P3";
  keywords: string[];
  resolution: string;
  builtIn: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ZeroPiiBuildResult =
  | { ok: true; doc: FirestoreTicketDoc }
  | { ok: false; blockedByZeroLeakage: boolean; reason: string };

export interface CloudAuthActionResult {
  ok: boolean;
  user?: AuthUserSummary | null;
  linkedFromAnonymous?: boolean;
  recoveredFromExistingAccount?: boolean;
  error?: string;
}

export interface CloudWriteResult {
  ok: boolean;
  blockedByZeroLeakage?: boolean;
  reason?: string;
}

export interface CloudAuthDeps {
  getAuthFn?: () => Auth | null;
  signInAnonymouslyFn?: (auth: Auth) => Promise<{ user: User }>;
  signInWithPopupFn?: (auth: Auth, provider: AuthProvider) => Promise<{ user: User }>;
  linkWithPopupFn?: (user: User, provider: AuthProvider) => Promise<{ user: User }>;
  signOutFn?: (auth: Auth) => Promise<void>;
  onAuthStateChangedFn?: (
    auth: Auth,
    nextOrObserver: (user: User | null) => void,
    error?: (err: Error) => void,
  ) => () => void;
  createGoogleProvider?: () => AuthProvider;
}

export interface CloudFirestoreDeps {
  getFirestoreFn?: () => Firestore | null;
  docFn?: (...args: unknown[]) => unknown;
  collectionFn?: (...args: unknown[]) => unknown;
  queryFn?: (...args: unknown[]) => unknown;
  orderByFn?: (...args: unknown[]) => unknown;
  limitFn?: (...args: unknown[]) => unknown;
  setDocFn?: (ref: unknown, data: unknown) => Promise<void>;
  deleteDocFn?: (ref: unknown) => Promise<void>;
  writeBatchFn?: (db: Firestore) => {
    delete: (ref: unknown) => void;
    commit: () => Promise<void>;
  };
  onSnapshotFn?: (
    target: unknown,
    onNext: (snapshot: {
      docs: Array<{ data: () => unknown }>;
      exists?: () => boolean;
      data?: () => unknown;
    }) => void,
    onError?: (err: Error) => void,
  ) => () => void;
}

function containsRawSecretPattern(text: string): string | null {
  for (const pattern of RAW_SECRET_PATTERNS) {
    if (pattern.test(text)) {
      return `Raw credential pattern matched (${pattern.source})`;
    }
  }
  return null;
}

export function toAuthUserSummary(user: User | null | undefined): AuthUserSummary | null {
  if (!user || !user.uid) return null;
  return {
    uid: user.uid,
    isAnonymous: Boolean(user.isAnonymous),
    displayName: user.displayName ?? null,
    email: user.email ?? null,
  };
}

export async function signInWorkspaceAnonymously(
  deps: CloudAuthDeps = {},
): Promise<CloudAuthActionResult> {
  const auth = (deps.getAuthFn ?? getFirebaseAuth)();
  if (!auth) {
    return { ok: false, error: "Firebase Auth is not configured." };
  }
  try {
    const cred = await (deps.signInAnonymouslyFn ?? signInAnonymously)(auth);
    return { ok: true, user: toAuthUserSummary(cred.user) };
  } catch (err) {
    const code = (err as { code?: string } | null)?.code ?? "";
    const rawMsg = err instanceof Error ? err.message : String(err);
    const isLoopbackIp =
      typeof window !== "undefined" && window.location?.hostname === "127.0.0.1";
    const port =
      typeof window !== "undefined" && window.location?.port
        ? `:${window.location.port}`
        : "";

    let friendly = rawMsg;
    if (code === "auth/unauthorized-domain" || rawMsg.includes("unauthorized-domain")) {
      friendly = isLoopbackIp
        ? `127.0.0.1 is not authorized for Google OAuth popups. Open http://localhost${port} or use 1-click Sync as Guest.`
        : "This domain is not authorized for Google OAuth popups. Add it in Firebase Auth settings or use 1-click Sync as Guest.";
    } else if (code === "auth/popup-blocked" || rawMsg.includes("popup-blocked")) {
      friendly =
        "Browser blocked the Google sign-in popup. Allow popups for this site or use 1-click Sync as Guest.";
    } else if (
      code === "auth/cancelled-popup-request" ||
      code === "auth/popup-closed-by-user"
    ) {
      friendly = "Google sign-in popup was closed before completing. Try again or use Sync as Guest.";
    } else if (code === "auth/operation-not-allowed") {
      friendly = "Google sign-in is not enabled on this Firebase project. Use 1-click Sync as Guest.";
    } else if (code === "auth/network-request-failed") {
      friendly = "Network error during Google sign-in. Check your connection or use Offline ($0 Local).";
    }

    return { ok: false, error: friendly };
  }
}

export async function signInOrLinkWithGoogle(
  deps: CloudAuthDeps = {},
): Promise<CloudAuthActionResult> {
  const auth = (deps.getAuthFn ?? getFirebaseAuth)();
  if (!auth) {
    return { ok: false, error: "Firebase Auth is not configured." };
  }
  const provider = (deps.createGoogleProvider ?? (() => new GoogleAuthProvider()))();
  const popupSignIn = deps.signInWithPopupFn ?? signInWithPopup;
  const popupLink = deps.linkWithPopupFn ?? linkWithPopup;

  try {
    if (auth.currentUser && auth.currentUser.isAnonymous) {
      try {
        const linked = await popupLink(auth.currentUser, provider);
        return {
          ok: true,
          user: toAuthUserSummary(linked.user),
          linkedFromAnonymous: true,
        };
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        if (code === "auth/credential-already-in-use") {
          const recovered = await popupSignIn(auth, provider);
          return {
            ok: true,
            user: toAuthUserSummary(recovered.user),
            recoveredFromExistingAccount: true,
          };
        }
        throw err;
      }
    }

    const cred = await popupSignIn(auth, provider);
    return { ok: true, user: toAuthUserSummary(cred.user) };
  } catch (err) {
    const code = (err as { code?: string } | null)?.code ?? "";
    const rawMsg = err instanceof Error ? err.message : String(err);
    const isLoopbackIp =
      typeof window !== "undefined" && window.location?.hostname === "127.0.0.1";
    const port =
      typeof window !== "undefined" && window.location?.port
        ? `:${window.location.port}`
        : "";

    let friendly = rawMsg;
    if (code === "auth/unauthorized-domain" || rawMsg.includes("unauthorized-domain")) {
      friendly = isLoopbackIp
        ? `127.0.0.1 is not authorized for Google OAuth popups. Open http://localhost${port} or use 1-click Sync as Guest.`
        : "This domain is not authorized for Google OAuth popups. Add it in Firebase Auth settings or use 1-click Sync as Guest.";
    } else if (code === "auth/popup-blocked" || rawMsg.includes("popup-blocked")) {
      friendly =
        "Browser blocked the Google sign-in popup. Allow popups for this site or use 1-click Sync as Guest.";
    } else if (
      code === "auth/cancelled-popup-request" ||
      code === "auth/popup-closed-by-user"
    ) {
      friendly = "Google sign-in popup was closed before completing. Try again or use Sync as Guest.";
    } else if (code === "auth/operation-not-allowed") {
      friendly = "Google sign-in is not enabled on this Firebase project. Use 1-click Sync as Guest.";
    } else if (code === "auth/network-request-failed") {
      friendly = "Network error during Google sign-in. Check your connection or use Offline ($0 Local).";
    }

    return { ok: false, error: friendly };
  }
}

export async function signOutWorkspace(deps: CloudAuthDeps = {}): Promise<CloudAuthActionResult> {
  const auth = (deps.getAuthFn ?? getFirebaseAuth)();
  if (!auth) {
    return { ok: true, user: null };
  }
  try {
    await (deps.signOutFn ?? signOut)(auth);
    return { ok: true, user: null };
  } catch (err) {
    const code = (err as { code?: string } | null)?.code ?? "";
    const rawMsg = err instanceof Error ? err.message : String(err);
    const isLoopbackIp =
      typeof window !== "undefined" && window.location?.hostname === "127.0.0.1";
    const port =
      typeof window !== "undefined" && window.location?.port
        ? `:${window.location.port}`
        : "";

    let friendly = rawMsg;
    if (code === "auth/unauthorized-domain" || rawMsg.includes("unauthorized-domain")) {
      friendly = isLoopbackIp
        ? `127.0.0.1 is not authorized for Google OAuth popups. Open http://localhost${port} or use 1-click Sync as Guest.`
        : "This domain is not authorized for Google OAuth popups. Add it in Firebase Auth settings or use 1-click Sync as Guest.";
    } else if (code === "auth/popup-blocked" || rawMsg.includes("popup-blocked")) {
      friendly =
        "Browser blocked the Google sign-in popup. Allow popups for this site or use 1-click Sync as Guest.";
    } else if (
      code === "auth/cancelled-popup-request" ||
      code === "auth/popup-closed-by-user"
    ) {
      friendly = "Google sign-in popup was closed before completing. Try again or use Sync as Guest.";
    } else if (code === "auth/operation-not-allowed") {
      friendly = "Google sign-in is not enabled on this Firebase project. Use 1-click Sync as Guest.";
    } else if (code === "auth/network-request-failed") {
      friendly = "Network error during Google sign-in. Check your connection or use Offline ($0 Local).";
    }

    return { ok: false, error: friendly };
  }
}

export function subscribeAuthState(
  onChange: (user: AuthUserSummary | null) => void,
  onError?: (error: string) => void,
  deps: CloudAuthDeps = {},
): () => void {
  const auth = (deps.getAuthFn ?? getFirebaseAuth)();
  if (!auth) {
    return () => {};
  }
  return (deps.onAuthStateChangedFn ?? onAuthStateChanged)(
    auth,
    (user) => {
      onChange(toAuthUserSummary(user));
    },
    (err) => {
      onError?.(err.message);
    },
  );
}

/**
 * Strips all raw PII/secrets and constructs a strict schema-allowlisted Firestore document.
 * Aborts cleanly if verifyZeroLeakage() or raw credential regex guards fail.
 */
export function buildZeroPiiFirestoreTicket(
  uid: string,
  result: TriageResult,
): ZeroPiiBuildResult {
  if (!uid.trim() || !result.id.trim()) {
    return {
      ok: false,
      blockedByZeroLeakage: false,
      reason: "Missing uid or ticket ID for Firestore write.",
    };
  }
  if (!result.sanitizedText || !result.sanitizedText.trim()) {
    return {
      ok: false,
      blockedByZeroLeakage: true,
      reason: "Cannot sync empty sanitizedText to Firestore.",
    };
  }

  const audit = verifyZeroLeakage(result.sanitizedText, result.spans);
  if (!audit.verified) {
    return {
      ok: false,
      blockedByZeroLeakage: true,
      reason: `Zero-Leakage gate blocked Firestore write: ${audit.leakedSpansCount} unredacted span(s) (${audit.leakedCategories.join(", ")}).`,
    };
  }

  const sanitizedLeak = containsRawSecretPattern(result.sanitizedText);
  if (sanitizedLeak) {
    return {
      ok: false,
      blockedByZeroLeakage: true,
      reason: `Zero-Leakage gate blocked Firestore write in sanitizedText: ${sanitizedLeak}`,
    };
  }

  const resolutionText = result.resolution ?? "";
  const resolutionLeak = containsRawSecretPattern(resolutionText);
  if (resolutionLeak) {
    return {
      ok: false,
      blockedByZeroLeakage: true,
      reason: `Zero-Leakage gate blocked Firestore write in resolution: ${resolutionLeak}`,
    };
  }

  const zeroPii = stripRawTextForStorage(result);
  const activeSpans = zeroPii.spans.filter((s) => s.masked !== false);
  const redactedCategories = Array.from(new Set(activeSpans.map((s) => s.category))).slice(0, 100);
  const sourcePlatform: SourcePlatform =
    zeroPii.sourcePlatform ?? (zeroPii.importedFromExtension ? "CHROME_EXTENSION" : "WEB");
  const createdAt =
    typeof zeroPii.createdAt === "number" && zeroPii.createdAt > 0
      ? zeroPii.createdAt
      : Date.now();
  const updatedAt = Math.max(createdAt, zeroPii.updatedAt ?? createdAt, Date.now());

  const docData: FirestoreTicketDoc = {
    id: zeroPii.id.slice(0, 128),
    uid,
    title: (zeroPii.title.trim() || "Untitled Incident").slice(0, 200),
    sanitizedText: zeroPii.sanitizedText.slice(0, 50_000),
    severity: zeroPii.severity,
    category: (zeroPii.category || "GENERAL_INCIDENT").slice(0, 100),
    runbookId: zeroPii.runbookId ? zeroPii.runbookId.slice(0, 100) : null,
    resolution: resolutionText.slice(0, 50_000),
    resolutionMode: String(zeroPii.resolutionMode).slice(0, 64),
    inferenceSource: String(zeroPii.inferenceSource).slice(0, 64),
    stage1Source: String(zeroPii.stage1Source).slice(0, 64),
    stage1LatencyMs: Math.max(0, zeroPii.stage1LatencyMs),
    stage2Source: String(zeroPii.stage2Source).slice(0, 64),
    stage2LatencyMs: Math.max(0, zeroPii.stage2LatencyMs),
    nanoStatus: String(zeroPii.nanoStatus).slice(0, 32),
    latencyMs: Math.max(0, zeroPii.latencyMs),
    estimatedTokensSaved: Math.max(0, zeroPii.estimatedTokensSaved),
    activeCloudModel: zeroPii.activeCloudModel ? zeroPii.activeCloudModel.slice(0, 100) : null,
    sourcePlatform,
    zeroLeakageVerified: true,
    activeMaskCount: activeSpans.length,
    redactedCategories,
    queuedForReconnect: Boolean(zeroPii.queuedForReconnect),
    createdAt,
    updatedAt,
  };

  return { ok: true, doc: docData };
}

export function firestoreTicketToLocalResult(raw: unknown): TriageResult | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Partial<FirestoreTicketDoc>;
  if (
    typeof d.id !== "string" ||
    !d.id.trim() ||
    typeof d.sanitizedText !== "string" ||
    d.zeroLeakageVerified !== true
  ) {
    return null;
  }

  const sourcePlatform: SourcePlatform =
    d.sourcePlatform === "WEB" ||
    d.sourcePlatform === "CHROME_EXTENSION" ||
    d.sourcePlatform === "ANDROID"
      ? d.sourcePlatform
      : "WEB";

  const activeMaskCount = typeof d.activeMaskCount === "number" ? d.activeMaskCount : 0;
  const redactedCategories = Array.isArray(d.redactedCategories)
    ? d.redactedCategories.filter((c): c is string => typeof c === "string")
    : [];
  const updatedAt = typeof d.updatedAt === "number" ? d.updatedAt : Date.now();

  return {
    id: d.id,
    title: typeof d.title === "string" && d.title.trim() ? d.title : "Synced Ticket",
    rawText: "[PURGED_FROM_DISK_FOR_PRIVACY]",
    sanitizedText: d.sanitizedText,
    severity:
      d.severity === "P0" || d.severity === "P1" || d.severity === "P2" || d.severity === "P3"
        ? d.severity
        : "P2",
    category: typeof d.category === "string" ? d.category : "GENERAL_INCIDENT",
    runbookId: typeof d.runbookId === "string" ? d.runbookId : null,
    spans: [],
    resolution: typeof d.resolution === "string" ? d.resolution : "",
    resolutionMode: (d.resolutionMode as TriageResult["resolutionMode"]) ?? "QUARANTINED_PENDING_APPROVAL",
    inferenceSource:
      (d.inferenceSource as TriageResult["inferenceSource"]) ?? "LOCAL_REGEX_FALLBACK",
    stage1Source: (d.stage1Source as TriageResult["stage1Source"]) ?? "HEURISTIC_GUARD",
    stage1LatencyMs: typeof d.stage1LatencyMs === "number" ? d.stage1LatencyMs : 1,
    stage2Source: (d.stage2Source as TriageResult["stage2Source"]) ?? "HELD_QUARANTINE",
    stage2LatencyMs: typeof d.stage2LatencyMs === "number" ? d.stage2LatencyMs : 0,
    nanoStatus: (d.nanoStatus as TriageResult["nanoStatus"]) ?? "UNAVAILABLE",
    latencyMs: typeof d.latencyMs === "number" ? d.latencyMs : 1,
    estimatedTokensSaved: typeof d.estimatedTokensSaved === "number" ? d.estimatedTokensSaved : 40,
    createdAt: typeof d.createdAt === "number" ? d.createdAt : updatedAt,
    updatedAt,
    activeCloudModel: typeof d.activeCloudModel === "string" ? d.activeCloudModel : undefined,
    cloudError: null,
    zeroLeakageAudit: {
      verified: true,
      checkedSpansCount: activeMaskCount,
      leakedSpansCount: 0,
      leakedCategories: redactedCategories,
      outboundPromptPreview: d.sanitizedText,
      verifiedAt: updatedAt,
    },
    hybridBrief: null,
    importedFromExtension: sourcePlatform === "CHROME_EXTENSION",
    sourcePlatform,
    queuedForReconnect: Boolean(d.queuedForReconnect),
    loadedFromZeroPiiStore: true,
  };
}

export async function syncTicketToFirestore(
  uid: string,
  result: TriageResult,
  deps: CloudFirestoreDeps = {},
): Promise<CloudWriteResult> {
  const built = buildZeroPiiFirestoreTicket(uid, result);
  if (!built.ok) {
    return {
      ok: false,
      blockedByZeroLeakage: built.blockedByZeroLeakage,
      reason: built.reason,
    };
  }

  if (deps.getFirestoreFn) {
    const db = deps.getFirestoreFn();
    if (!db) {
      return { ok: false, reason: "Firestore not configured." };
    }
    try {
      const ref = deps.docFn?.(db, "workspaces", uid, "tickets", built.doc.id);
      await deps.setDocFn?.(ref, built.doc);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  const transport = await import("./firestoreTransport");
  return transport.writeFirestoreDoc(["workspaces", uid, "tickets", built.doc.id], built.doc);
}

export async function syncPolicyToFirestore(
  uid: string,
  policy: PrivacyPolicy,
  createdAt = Date.now(),
  deps: CloudFirestoreDeps = {},
): Promise<CloudWriteResult> {
  if (!uid.trim()) {
    return { ok: false, reason: "Missing uid for policy sync." };
  }
  const cleanTerms = policy.customTerms
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .slice(0, 200);
  const safeCreatedAt = createdAt > 0 ? createdAt : Date.now();
  const docData: FirestorePolicyDoc = {
    uid,
    customTerms: cleanTerms,
    enableEntropyScanner: policy.enableEntropyScanner !== false,
    autoCountdownSeconds: Math.max(0, Math.min(60, policy.autoCountdownSeconds)),
    createdAt: safeCreatedAt,
    updatedAt: Math.max(safeCreatedAt, Date.now()),
  };

  if (deps.getFirestoreFn) {
    const db = deps.getFirestoreFn();
    if (!db) {
      return { ok: false, reason: "Firestore not configured." };
    }
    try {
      const ref = deps.docFn?.(db, "workspaces", uid, "policies", "default");
      await deps.setDocFn?.(ref, docData);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  const transport = await import("./firestoreTransport");
  return transport.writeFirestoreDoc(["workspaces", uid, "policies", "default"], docData);
}

export async function syncCustomRunbooksToFirestore(
  uid: string,
  runbooks: CustomRunbook[],
  prevCustomIds: Set<string>,
  createdAtMap: Map<string, number>,
  deps: CloudFirestoreDeps = {},
): Promise<CloudWriteResult> {
  if (!uid.trim()) {
    return { ok: false, reason: "Missing uid for runbook sync." };
  }

  const customRunbooks = runbooks.filter((rb) => !rb.builtIn);
  const nextIds = new Set(customRunbooks.map((rb) => rb.id));
  const preparedDocs: FirestoreRunbookDoc[] = [];

  for (const rb of customRunbooks) {
    if (containsRawSecretPattern(rb.resolution)) {
      return {
        ok: false,
        blockedByZeroLeakage: true,
        reason: `Runbook ${rb.id} contains a raw secret pattern and was blocked.`,
      };
    }
    const existingCreated = createdAtMap.get(rb.id) ?? Date.now();
    createdAtMap.set(rb.id, existingCreated);
    preparedDocs.push({
      id: rb.id.slice(0, 100),
      uid,
      title: rb.title.slice(0, 200),
      category: rb.category.slice(0, 100),
      severity: rb.severity,
      keywords: rb.keywords.slice(0, 50),
      resolution: rb.resolution.slice(0, 50_000),
      builtIn: false,
      createdAt: existingCreated,
      updatedAt: Math.max(existingCreated, Date.now()),
    });
  }

  try {
    if (deps.getFirestoreFn) {
      const db = deps.getFirestoreFn();
      if (!db) {
        return { ok: false, reason: "Firestore not configured." };
      }
      for (const docData of preparedDocs) {
        const ref = deps.docFn?.(db, "workspaces", uid, "runbooks", docData.id);
        await deps.setDocFn?.(ref, docData);
      }
      for (const oldId of prevCustomIds) {
        if (!nextIds.has(oldId)) {
          const ref = deps.docFn?.(db, "workspaces", uid, "runbooks", oldId);
          await deps.deleteDocFn?.(ref);
          createdAtMap.delete(oldId);
        }
      }
    } else {
      const transport = await import("./firestoreTransport");
      for (const docData of preparedDocs) {
        const writeRes = await transport.writeFirestoreDoc(
          ["workspaces", uid, "runbooks", docData.id],
          docData,
        );
        if (!writeRes.ok) return writeRes;
      }
      for (const oldId of prevCustomIds) {
        if (!nextIds.has(oldId)) {
          const delRes = await transport.deleteFirestoreDoc([
            "workspaces",
            uid,
            "runbooks",
            oldId,
          ]);
          if (!delRes.ok) return delRes;
          createdAtMap.delete(oldId);
        }
      }
    }

    prevCustomIds.clear();
    for (const id of nextIds) prevCustomIds.add(id);

    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function clearWorkspaceTicketsInFirestore(
  uid: string,
  ticketIds: string[],
  deps: CloudFirestoreDeps = {},
): Promise<CloudWriteResult> {
  if (!uid.trim() || ticketIds.length === 0) {
    return { ok: true };
  }

  if (deps.getFirestoreFn) {
    const db = deps.getFirestoreFn();
    if (!db) {
      return { ok: true };
    }
    try {
      const batch = deps.writeBatchFn?.(db);
      if (batch) {
        for (const id of ticketIds) {
          if (id.trim()) {
            batch.delete(deps.docFn?.(db, "workspaces", uid, "tickets", id));
          }
        }
        await batch.commit();
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  const transport = await import("./firestoreTransport");
  return transport.batchDeleteFirestoreTickets(uid, ticketIds);
}

export interface WorkspaceSyncCallbacks {
  onTickets: (tickets: TriageResult[]) => void;
  onPolicy: (policy: PrivacyPolicy, createdAt: number) => void;
  onRunbooks: (customRunbooks: CustomRunbook[], createdAtMap: Map<string, number>) => void;
  onError?: (message: string) => void;
}

export function subscribeWorkspaceSync(
  uid: string,
  callbacks: WorkspaceSyncCallbacks,
  deps: CloudFirestoreDeps = {},
): () => void {
  if (!uid.trim()) {
    return () => {};
  }

  if (deps.getFirestoreFn && deps.onSnapshotFn) {
    const db = deps.getFirestoreFn();
    if (!db) {
      return () => {};
    }

    const ticketsQuery = deps.queryFn?.(
      deps.collectionFn?.(db, "workspaces", uid, "tickets"),
      deps.orderByFn?.("createdAt", "desc"),
      deps.limitFn?.(50),
    );
    const unsubTickets = deps.onSnapshotFn(
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

    const policyRef = deps.docFn?.(db, "workspaces", uid, "policies", "default");
    const unsubPolicy = deps.onSnapshotFn(
      policyRef,
      (snap) => {
        const single = snap as unknown as { exists?: () => boolean; data?: () => unknown };
        if (!single.exists?.()) return;
        const raw = single.data?.() as Partial<FirestorePolicyDoc>;
        const valid = sanitizeStoredPolicy(raw);
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

    const runbooksRef = deps.collectionFn?.(db, "workspaces", uid, "runbooks");
    const unsubRunbooks = deps.onSnapshotFn(
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
        const valid = sanitizeStoredRunbooks(rawDocs);
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

  let cancelled = false;
  let activeUnsub: (() => void) | null = null;
  void import("./firestoreTransport")
    .then((transport) => {
      if (cancelled) return;
      activeUnsub = transport.attachFirestoreWorkspaceListeners(uid, callbacks);
    })
    .catch((err) => {
      if (!cancelled) {
        callbacks.onError?.(err instanceof Error ? err.message : String(err));
      }
    });

  return () => {
    cancelled = true;
    activeUnsub?.();
  };
}
