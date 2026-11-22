import type { RedactionSpan } from "../types/triage";

export type RehydrationTier = "PERMANENTLY_LOCKED" | "REHYDRATABLE_CONTEXT";

export const PERMANENTLY_LOCKED_CATEGORIES = new Set([
  "API_KEY",
  "AWS_ACCESS_KEY",
  "BEARER_OR_JWT",
  "PRIVATE_KEY",
  "PASSWORD",
  "NATURAL_SECRET",
  "DB_URI",
  "CREDIT_CARD",
  "HIGH_ENTROPY_SECRET",
  "PHONE",
  "EMAIL",
  "MEDICAL_PHI",
  "CONTEXTUAL_PHI",
]);

export const REHYDRATABLE_CONTEXT_CATEGORIES = new Set([
  "M_AND_A_SECRET",
  "ORG_TERM",
  "CUSTOM_TERM",
  "PROJECT_CODENAME",
  "INTERNAL_SERVICE",
  "PERSON",
]);

export interface VaultEntry {
  placeholder: string;
  originalText: string;
  category: string;
  tier: RehydrationTier;
}

export interface RehydratedSegment {
  kind: "text" | "rehydrated" | "locked";
  value: string;
  placeholder?: string;
  category?: string;
}

// Strictly RAM-only, tab-scoped Map. Never persisted to storage, URL, or Firestore.
const ramVaultByTicket = new Map<string, Map<string, VaultEntry>>();
let autoPurgeAttached = false;

export function classifyRehydrationTier(category: string): RehydrationTier {
  const upper = category.toUpperCase();
  if (PERMANENTLY_LOCKED_CATEGORIES.has(upper)) {
    return "PERMANENTLY_LOCKED";
  }
  if (REHYDRATABLE_CONTEXT_CATEGORIES.has(upper)) {
    return "REHYDRATABLE_CONTEXT";
  }
  // Fail-closed default for any unknown category
  return "PERMANENTLY_LOCKED";
}

export function attachVaultAutoPurge(): void {
  if (autoPurgeAttached || typeof window === "undefined") return;
  autoPurgeAttached = true;
  const wipe = () => {
    purgeRehydrationVault();
  };
  window.addEventListener("beforeunload", wipe);
  window.addEventListener("pagehide", wipe);
}

export function registerTicketSpansInVault(
  ticketId: string,
  spans: RedactionSpan[],
): void {
  attachVaultAutoPurge();
  const ticketMap = new Map<string, VaultEntry>();
  for (const span of spans) {
    if (span.masked === false) continue;
    const tier = classifyRehydrationTier(span.category);
    // Do not store permanently locked raw secrets in rehydration value lookup if already identical to placeholder
    ticketMap.set(span.placeholder, {
      placeholder: span.placeholder,
      originalText:
        tier === "REHYDRATABLE_CONTEXT" ? span.matchedText : span.placeholder,
      category: span.category.toUpperCase(),
      tier,
    });
  }
  ramVaultByTicket.set(ticketId, ticketMap);
}

export function rehydrateTextForLocalView(
  ticketId: string,
  text: string,
  enabled: boolean,
): {
  segments: RehydratedSegment[];
  unmaskedContextCount: number;
  lockedCredentialsCount: number;
} {
  const ticketMap = ramVaultByTicket.get(ticketId);
  const parts = text.split(/(\[REDACTED:[A-Z0-9_]+\])/g);
  const segments: RehydratedSegment[] = [];
  let unmaskedContextCount = 0;
  let lockedCredentialsCount = 0;

  for (const part of parts) {
    if (!part) continue;
    if (/^\[REDACTED:[A-Z0-9_]+\]$/.test(part)) {
      const entry = ticketMap?.get(part);
      if (
        enabled &&
        entry &&
        entry.tier === "REHYDRATABLE_CONTEXT" &&
        entry.originalText &&
        entry.originalText !== part
      ) {
        unmaskedContextCount += 1;
        segments.push({
          kind: "rehydrated",
          value: entry.originalText,
          placeholder: part,
          category: entry.category,
        });
      } else {
        if (entry?.tier === "PERMANENTLY_LOCKED" || !entry) {
          lockedCredentialsCount += 1;
        }
        segments.push({
          kind: "locked",
          value: part,
          placeholder: part,
          category: entry?.category,
        });
      }
    } else {
      segments.push({ kind: "text", value: part });
    }
  }

  return { segments, unmaskedContextCount, lockedCredentialsCount };
}

export function getVaultSummary(ticketId?: string): {
  activeTickets: number;
  rehydratableCount: number;
  lockedCount: number;
} {
  if (ticketId) {
    const map = ramVaultByTicket.get(ticketId);
    if (!map) return { activeTickets: ramVaultByTicket.size, rehydratableCount: 0, lockedCount: 0 };
    let rehydratableCount = 0;
    let lockedCount = 0;
    for (const entry of map.values()) {
      if (entry.tier === "REHYDRATABLE_CONTEXT") rehydratableCount++;
      else lockedCount++;
    }
    return { activeTickets: ramVaultByTicket.size, rehydratableCount, lockedCount };
  }
  let rehydratableCount = 0;
  let lockedCount = 0;
  for (const map of ramVaultByTicket.values()) {
    for (const entry of map.values()) {
      if (entry.tier === "REHYDRATABLE_CONTEXT") rehydratableCount++;
      else lockedCount++;
    }
  }
  return { activeTickets: ramVaultByTicket.size, rehydratableCount, lockedCount };
}

export function purgeRehydrationVault(ticketId?: string): void {
  if (ticketId) {
    ramVaultByTicket.delete(ticketId);
  } else {
    ramVaultByTicket.clear();
  }
}
