import type {
  RiskProfile,
  TriageResult,
  ZeroLeakageAuditReceipt,
} from "../types/triage";

let sessionKeyPairPromise: Promise<CryptoKeyPair> | null = null;

const KEY_DB_NAME = "localfirst_receipt_keys";
const KEY_DB_VERSION = 1;
const KEY_STORE = "ecdsa_p256";
const KEY_ID = "device-signing-key";

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KEY_DB_NAME, KEY_DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(KEY_STORE)) {
        req.result.createObjectStore(KEY_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Reuse one P-256 key per browser profile so receipts stay verifiable across sessions. */
async function loadOrCreatePersistentKeyPair(): Promise<CryptoKeyPair> {
  if (typeof indexedDB === "undefined") {
    return createEphemeralKeyPair();
  }
  try {
    const db = await openKeyDb();
    const stored = await new Promise<CryptoKeyPair | undefined>((resolve, reject) => {
      const tx = db.transaction(KEY_STORE, "readonly");
      const req = tx.objectStore(KEY_STORE).get(KEY_ID);
      req.onsuccess = () => resolve(req.result as CryptoKeyPair | undefined);
      req.onerror = () => reject(req.error);
    });
    if (stored?.privateKey && stored?.publicKey) {
      db.close();
      return stored;
    }
    const created = await createEphemeralKeyPair();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(KEY_STORE, "readwrite");
      tx.objectStore(KEY_STORE).put(created, KEY_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return created;
  } catch {
    // Private browsing / blocked IndexedDB: fall back to a session-scoped key.
    return createEphemeralKeyPair();
  }
}

function createEphemeralKeyPair(): Promise<CryptoKeyPair> {
  const crypto = getWebCrypto();
  return crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false, // privateKey is non-extractable
    ["sign", "verify"],
  );
}

function getWebCrypto(): Crypto {
  if (typeof globalThis.crypto === "undefined" || !globalThis.crypto.subtle) {
    throw new Error("Web Crypto API (crypto.subtle) is unavailable in this environment.");
  }
  return globalThis.crypto;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(b64u: string): Uint8Array<ArrayBuffer> {
  const b64 = b64u.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const buffer = new ArrayBuffer(binary.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`)
    .join(",")}}`;
}

async function sha256Hex(input: string): Promise<string> {
  const crypto = getWebCrypto();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return bytesToHex(new Uint8Array(digest));
}

async function getSessionSigningKeyPair(): Promise<CryptoKeyPair> {
  if (!sessionKeyPairPromise) {
    sessionKeyPairPromise = loadOrCreatePersistentKeyPair();
  }
  return sessionKeyPairPromise;
}

export async function mintZeroLeakageAuditReceipt(params: {
  rawText: string;
  sanitizedText: string;
  result: TriageResult;
  riskProfile?: RiskProfile | null;
}): Promise<ZeroLeakageAuditReceipt> {
  const crypto = getWebCrypto();
  const keyPair = await getSessionSigningKeyPair();

  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = bytesToHex(saltBytes);
  // Salted commitment prevents brute-forcing low-entropy secrets; salt is never exported
  const rawCommitmentSha256 = await sha256Hex(`${saltHex}::${params.rawText}`);
  const sanitizedSha256 = await sha256Hex(params.sanitizedText);

  let regexCount = 0;
  let heuristicCount = 0;
  let nano4Count = 0;
  for (const span of params.result.spans) {
    if (span.masked === false) continue;
    if (span.detector === "NANO_SEMANTIC_FIREWALL") nano4Count++;
    else if (span.detector === "REGEX_FIREWALL" || span.detector === "ENTROPY_SCANNER") regexCount++;
    else heuristicCount++;
  }

  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const keyThumbprintSha256 = await sha256Hex(canonicalizeJson(publicKeyJwk));

  const risk = params.riskProfile ?? params.result.riskProfile ?? {
    score: 0,
    tier: "LOW" as const,
    action: "LOCAL_RUNBOOK" as const,
  };

  const leakedCount = params.result.zeroLeakageAudit?.leakedSpansCount ?? 0;
  const zeroLeakageVerified =
    (params.result.zeroLeakageAudit?.verified ?? true) && leakedCount === 0;

  const receiptId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `rcpt-${Date.now()}-${saltHex.slice(0, 8)}`;

  const unsignedPayload = {
    receiptId,
    schemaVersion: "1.0.0" as const,
    issuedAt: new Date().toISOString(),
    rawCommitmentSha256,
    sanitizedSha256,
    leakedCount,
    zeroLeakageVerified,
    layerBreakdown: {
      regex: regexCount,
      heuristic: heuristicCount,
      nano4: nano4Count,
      totalMasks: regexCount + heuristicCount + nano4Count,
    },
    riskProfile: {
      score: risk.score,
      tier: risk.tier,
      action: risk.action,
    },
    inferenceModes: {
      stage1: "ONLY_ON_DEVICE" as const,
      stage2: "PREFER_IN_CLOUD" as const,
      brief: "PREFER_ON_DEVICE" as const,
    },
    publicKeyJwk,
    keyThumbprintSha256,
  };

  const canonicalBytes = new TextEncoder().encode(canonicalizeJson(unsignedPayload));
  const signatureBuffer = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    canonicalBytes,
  );

  return {
    ...unsignedPayload,
    signatureBase64Url: toBase64Url(new Uint8Array(signatureBuffer)),
  };
}

export async function verifyAuditReceipt(
  receipt: ZeroLeakageAuditReceipt,
): Promise<{ valid: boolean; reason?: string }> {
  try {
    const crypto = getWebCrypto();
    const { signatureBase64Url, ...unsignedPayload } = receipt;
    if (!signatureBase64Url || !receipt.publicKeyJwk) {
      return { valid: false, reason: "Missing ECDSA signature or publicKeyJwk." };
    }

    const expectedThumbprint = await sha256Hex(canonicalizeJson(receipt.publicKeyJwk));
    if (expectedThumbprint !== receipt.keyThumbprintSha256) {
      return { valid: false, reason: "Public key thumbprint mismatch." };
    }

    const pubKey = await crypto.subtle.importKey(
      "jwk",
      receipt.publicKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );

    const canonicalBytes = new TextEncoder().encode(canonicalizeJson(unsignedPayload));
    const sigBytes = fromBase64Url(signatureBase64Url);
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pubKey,
      sigBytes,
      canonicalBytes,
    );

    return valid
      ? { valid: true }
      : { valid: false, reason: "ECDSA-P256 signature verification failed (payload tampered)." };
  } catch (err) {
    return {
      valid: false,
      reason: err instanceof Error ? err.message : "Verification error",
    };
  }
}
