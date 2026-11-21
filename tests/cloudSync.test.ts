import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Auth, User } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import {
  buildZeroPiiFirestoreTicket,
  firestoreTicketToLocalResult,
  signInOrLinkWithGoogle,
  signInWorkspaceAnonymously,
  subscribeWorkspaceSync,
  syncTicketToFirestore,
} from "../src/storage/cloudSync";
import type { TriageResult } from "../src/types/triage";

function makeSampleTicket(overrides: Partial<TriageResult> = {}): TriageResult {
  return {
    id: "ticket-sync-1",
    title: "Checkout Auth Spike",
    rawText: "Raw incident with key AIzaSyD-1234567890abcdefghijklmnopqrs and user@corp.org",
    sanitizedText: "Raw incident with key [REDACTED:API_KEY_1] and [REDACTED:EMAIL_2]",
    severity: "P0",
    category: "AUTH_OUTAGE",
    runbookId: null,
    spans: [
      {
        start: 22,
        end: 61,
        category: "API_KEY",
        detector: "REGEX_FIREWALL",
        placeholder: "[REDACTED:API_KEY_1]",
        matchedText: "AIzaSyD-1234567890abcdefghijklmnopqrs",
        masked: true,
        constituentTexts: ["AIzaSyD-1234567890abcdefghijklmnopqrs"],
      },
      {
        start: 66,
        end: 79,
        category: "EMAIL",
        detector: "REGEX_FIREWALL",
        placeholder: "[REDACTED:EMAIL_2]",
        matchedText: "user@corp.org",
        masked: true,
      },
    ],
    resolution: "### Root Cause\nRotate [REDACTED:API_KEY_1] immediately.",
    resolutionMode: "QUARANTINED_PENDING_APPROVAL",
    inferenceSource: "LOCAL_REGEX_FALLBACK",
    stage1Source: "HEURISTIC_GUARD",
    stage1LatencyMs: 9,
    stage2Source: "HELD_QUARANTINE",
    stage2LatencyMs: 0,
    nanoStatus: "UNAVAILABLE",
    latencyMs: 9,
    estimatedTokensSaved: 55,
    sourcePlatform: "WEB",
    createdAt: 1700000000000,
    ...overrides,
  };
}

describe("cloudSync Zero-PII, Auth & Firestore Rules", () => {
  it("strips rawText, matchedText, and constituentTexts completely from outbound Firestore payloads", () => {
    const ticket = makeSampleTicket({ importedFromExtension: true, sourcePlatform: "CHROME_EXTENSION" });
    const built = buildZeroPiiFirestoreTicket("uid-123", ticket);

    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const docRecord = built.doc as unknown as Record<string, unknown>;
    expect("rawText" in docRecord).toBe(false);
    expect("matchedText" in docRecord).toBe(false);
    expect("constituentTexts" in docRecord).toBe(false);
    expect("spans" in docRecord).toBe(false);

    expect(built.doc.zeroLeakageVerified).toBe(true);
    expect(built.doc.sourcePlatform).toBe("CHROME_EXTENSION");
    expect(built.doc.activeMaskCount).toBe(2);
    expect(built.doc.redactedCategories).toEqual(["API_KEY", "EMAIL"]);
    expect(built.doc.createdAt).toBe(1700000000000);
    expect(built.doc.updatedAt).toBeGreaterThanOrEqual(1700000000000);
  });

  it("aborts syncTicketToFirestore when verifyZeroLeakage fails or raw secret regex matches", async () => {
    const setDocMock = vi.fn(async () => {});
    const fakeDb = {} as Firestore;

    // 1. Span marked masked:true still leaked inside sanitizedText
    const leakedViaSpan = makeSampleTicket({
      sanitizedText: "Raw incident with key AIzaSyD-1234567890abcdefghijklmnopqrs still exposed",
    });
    const res1 = await syncTicketToFirestore("uid-123", leakedViaSpan, {
      getFirestoreFn: () => fakeDb,
      docFn: ((_db: unknown, ...segs: string[]) => segs.join("/")) as never,
      setDocFn: setDocMock,
    });
    expect(res1.ok).toBe(false);
    expect(res1.blockedByZeroLeakage).toBe(true);
    expect(setDocMock).not.toHaveBeenCalled();

    // 2. Raw AWS key even with empty spans
    const leakedAwsInResolution = makeSampleTicket({
      spans: [],
      sanitizedText: "Clean text",
      resolution: "Exposed key AKIAIOSFODNN7EXAMPLE in mitigation",
    });
    const res2 = await syncTicketToFirestore("uid-123", leakedAwsInResolution, {
      getFirestoreFn: () => fakeDb,
      docFn: ((_db: unknown, ...segs: string[]) => segs.join("/")) as never,
      setDocFn: setDocMock,
    });
    expect(res2.ok).toBe(false);
    expect(res2.blockedByZeroLeakage).toBe(true);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it("enforces strict Zero-PII, RE2 secret guards, default-deny, and immutable createdAt/uid in firestore.rules", () => {
    const rulesPath = path.resolve(__dirname, "../firestore.rules");
    const rules = fs.readFileSync(rulesPath, "utf8");

    expect(rules).toContain("rules_version = '2';");
    expect(rules).toMatch(/match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
    expect(rules).toContain("request.auth != null");
    expect(rules).toContain("isAuthenticated() && request.auth.uid == uid");
    expect(rules).toContain("hasOnlyAllowedFields([");
    expect(rules).toContain("!('rawText' in data)");
    expect(rules).toContain("!('matchedText' in data)");
    expect(rules).toContain("!('constituentTexts' in data)");
    expect(rules).toContain("data.zeroLeakageVerified is bool && data.zeroLeakageVerified == true");
    expect(rules).toContain("<= 50000");
    // RE2 full-string patterns for AWS, Google API, and PEM keys
    expect(rules).toContain("(?s).*AKIA[0-9A-Z]{16}.*");
    expect(rules).toContain("(?s).*AIza[0-9A-Za-z_-]{35}.*");
    expect(rules).toContain("(?s).*-----BEGIN [A-Z ]*PRIVATE KEY-----.*");
    // Immutable uid & createdAt enforced on updates
    expect(rules).toContain("request.resource.data.uid == resource.data.uid");
    expect(rules).toContain("request.resource.data.createdAt == resource.data.createdAt");
    expect(rules).toContain("allow update: if isOwner(uid) && isValidTicket(request.resource.data, uid, ticketId) && areImmutableFieldsUnchanged();");
    expect(rules).toContain("allow update: if isOwner(uid) && isValidPolicy(request.resource.data, uid) && areImmutableFieldsUnchanged();");
    expect(rules).toContain("allow update: if isOwner(uid) && isValidRunbook(request.resource.data, uid, runbookId) && areImmutableFieldsUnchanged();");
  });

  it("recovers cleanly from auth/credential-already-in-use by falling back to signInWithPopup", async () => {
    const anonUser = { uid: "anon-temp-1", isAnonymous: true } as unknown as User;
    const googleUser = {
      uid: "google-uid-42",
      isAnonymous: false,
      displayName: "Gokula",
      email: "gokula@example.com",
    } as unknown as User;
    const fakeAuth = { currentUser: anonUser } as unknown as Auth;

    const linkMock = vi.fn(async () => {
      throw Object.assign(new Error("Credential already associated with another user"), {
        code: "auth/credential-already-in-use",
      });
    });
    const signInPopupMock = vi.fn(async () => ({ user: googleUser }));

    const result = await signInOrLinkWithGoogle({
      getAuthFn: () => fakeAuth,
      createGoogleProvider: () => ({} as never),
      linkWithPopupFn: linkMock,
      signInWithPopupFn: signInPopupMock,
    });

    expect(linkMock).toHaveBeenCalledTimes(1);
    expect(signInPopupMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.recoveredFromExistingAccount).toBe(true);
    expect(result.user).toEqual({
      uid: "google-uid-42",
      isAnonymous: false,
      displayName: "Gokula",
      email: "gokula@example.com",
    });

    const anonResult = await signInWorkspaceAnonymously({
      getAuthFn: () => fakeAuth,
      signInAnonymouslyFn: async () => ({ user: anonUser }),
    });
    expect(anonResult.ok).toBe(true);
    expect(anonResult.user?.isAnonymous).toBe(true);
  });

  it("converts synced ANDROID/CHROME_EXTENSION Firestore docs to Zero-PII local TriageResult and cleans up snapshot listeners", () => {
    const localFromAndroid = firestoreTicketToLocalResult({
      id: "android-t-9",
      uid: "u1",
      title: "PagerDuty Pod CrashLoop",
      sanitizedText: "Token [REDACTED:API_KEY_1] revoked",
      severity: "P1",
      category: "K8S",
      runbookId: null,
      resolution: "Restarted deployment.",
      resolutionMode: "CLOUD_ESCALATION",
      inferenceSource: "IN_CLOUD",
      stage1Source: "ON_DEVICE (Nano 4)",
      stage1LatencyMs: 42,
      stage2Source: "IN_CLOUD",
      stage2LatencyMs: 310,
      nanoStatus: "READY",
      latencyMs: 352,
      estimatedTokensSaved: 18,
      activeCloudModel: "gemini-3.5-flash-lite",
      sourcePlatform: "ANDROID",
      zeroLeakageVerified: true,
      activeMaskCount: 1,
      redactedCategories: ["API_KEY"],
      queuedForReconnect: false,
      createdAt: 1700000001000,
      updatedAt: 1700000002000,
    });

    expect(localFromAndroid).not.toBeNull();
    expect(localFromAndroid?.rawText).toBe("[PURGED_FROM_DISK_FOR_PRIVACY]");
    expect(localFromAndroid?.loadedFromZeroPiiStore).toBe(true);
    expect(localFromAndroid?.sourcePlatform).toBe("ANDROID");
    expect(localFromAndroid?.importedFromExtension).toBe(false);

    const unsubs = [vi.fn(), vi.fn(), vi.fn()];
    let callIdx = 0;
    const stop = subscribeWorkspaceSync(
      "uid-1",
      {
        onTickets: vi.fn(),
        onPolicy: vi.fn(),
        onRunbooks: vi.fn(),
      },
      {
        getFirestoreFn: () => ({} as Firestore),
        collectionFn: (() => ({})) as never,
        docFn: (() => ({})) as never,
        queryFn: (() => ({})) as never,
        orderByFn: (() => ({})) as never,
        limitFn: (() => ({})) as never,
        onSnapshotFn: (() => unsubs[callIdx++]) as never,
      },
    );

    expect(callIdx).toBe(3);
    stop();
    for (const u of unsubs) expect(u).toHaveBeenCalledTimes(1);
  });

  it("lazy-loads firebase/firestore via dynamic import('./firestoreTransport') with zero static runtime imports on initial boot", () => {
    const firebaseCfgSrc = fs.readFileSync(
      path.resolve(__dirname, "../src/config/firebase.ts"),
      "utf8",
    );
    const cloudSyncSrc = fs.readFileSync(
      path.resolve(__dirname, "../src/storage/cloudSync.ts"),
      "utf8",
    );

    expect(firebaseCfgSrc).not.toContain("firebase/firestore");
    expect(cloudSyncSrc).toContain('import type { Firestore } from "firebase/firestore"');
    expect(cloudSyncSrc).not.toMatch(/import\s*\{[^}]*\}\s*from\s*["']firebase\/firestore["']/);
    expect(cloudSyncSrc).toContain('import("./firestoreTransport")');
  });
});
