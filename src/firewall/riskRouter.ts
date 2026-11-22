import type {
  PrivacyPolicy,
  ProtectionLevel,
  RedactionSpan,
  RiskProfile,
  RiskRoutingAction,
  RiskTier,
} from "../types/triage";

const HARD_CREDENTIAL_CATEGORIES = new Set([
  "API_KEY",
  "AWS_ACCESS_KEY",
  "AWS_SECRET_KEY",
  "BEARER_OR_JWT",
  "PRIVATE_KEY",
  "DB_URI",
  "PASSWORD",
  "NATURAL_SECRET",
  "GOV_ID",
]);

const SENSITIVE_PII_PHI_CATEGORIES = new Set([
  "CONTEXTUAL_PHI",
  "MEDICAL_PHI",
  "CREDIT_CARD",
  "PHONE",
  "EMAIL",
]);

const CORPORATE_CATEGORIES = new Set([
  "M_AND_A_SECRET",
  "ORG_TERM",
  "CUSTOM_TERM",
  "PROJECT_CODENAME",
  "INTERNAL_SERVICE",
]);

export interface RiskRouterOptions {
  cacheHit?: boolean;
  isLocalRunbook?: boolean;
  protectionLevel?: ProtectionLevel;
}

function resolveTier(score: number): RiskTier {
  if (score >= 80) return "CRITICAL";
  if (score >= 55) return "HIGH";
  if (score >= 25) return "ELEVATED";
  return "LOW";
}

function resolveAction(
  score: number,
  options: RiskRouterOptions,
): RiskRoutingAction {
  const lockdownThreshold = options.protectionLevel === "high" ? 50 : 80;
  if (options.cacheHit) return "CACHE_HIT_LOCAL";
  if (options.isLocalRunbook) return "LOCAL_RUNBOOK";
  if (score >= lockdownThreshold) return "CRITICAL_AIRGAP_LOCKDOWN";
  if (score >= 40) return "HYBRID_GATED_REVIEW";
  return "LOCAL_RUNBOOK";
}

export function computeRiskProfile(
  rawText: string,
  redactionResult: { spans: RedactionSpan[]; sanitizedText?: string },
  policy?: PrivacyPolicy,
  options: RiskRouterOptions = {},
): RiskProfile {
  const activeSpans = redactionResult.spans.filter((s) => s.masked !== false);

  let credentialCount = 0;
  let piiPhiCount = 0;
  let corporateCount = 0;
  let entropySpanCount = 0;
  let nanoCaughtCount = 0;

  for (const span of activeSpans) {
    const cat = span.category.toUpperCase();
    if (HARD_CREDENTIAL_CATEGORIES.has(cat)) {
      credentialCount += 1;
    } else if (SENSITIVE_PII_PHI_CATEGORIES.has(cat)) {
      piiPhiCount += 1;
    } else if (CORPORATE_CATEGORIES.has(cat)) {
      corporateCount += 1;
    } else if (cat === "HIGH_ENTROPY_SECRET") {
      entropySpanCount += 1;
    }

    if (span.detector === "ENTROPY_SCANNER" && cat !== "HIGH_ENTROPY_SECRET") {
      entropySpanCount += 1;
    }
    if (span.detector === "NANO_SEMANTIC_FIREWALL") {
      nanoCaughtCount += 1;
    }
  }

  // Also check custom policy terms present in rawText if not already counted
  if (policy?.customTerms?.length && rawText) {
    const lowerRaw = rawText.toLowerCase();
    const alreadyCovered = new Set(
      activeSpans.map((s) => s.matchedText.toLowerCase()),
    );
    for (const term of policy.customTerms) {
      const normalized = term.trim().toLowerCase();
      if (normalized.length >= 3 && lowerRaw.includes(normalized) && !alreadyCovered.has(normalized)) {
        corporateCount += 1;
      }
    }
  }

  const credentials = Math.min(60, credentialCount * 30);
  const piiPhi = Math.min(40, piiPhiCount * 20);
  const corporate = Math.min(30, corporateCount * 15);
  const entropyBonus = Math.min(10, entropySpanCount * 5);
  const nanoBonus = nanoCaughtCount > 0 ? 10 : 0;

  const score = Math.min(
    100,
    credentials + piiPhi + corporate + entropyBonus + nanoBonus,
  );
  const tier = resolveTier(score);
  const action = resolveAction(score, options);

  const reasons: string[] = [];
  if (credentials > 0) {
    reasons.push(`+${credentials} Hard credentials (${credentialCount}x)`);
  }
  if (piiPhi > 0) {
    reasons.push(`+${piiPhi} PII / Medical PHI (${piiPhiCount}x)`);
  }
  if (corporate > 0) {
    reasons.push(`+${corporate} Corporate / M&A terms (${corporateCount}x)`);
  }
  if (entropyBonus > 0) {
    reasons.push(`+${entropyBonus} High-entropy token density`);
  }
  if (nanoBonus > 0) {
    reasons.push(`+${nanoBonus} Nano 4 semantic catch`);
  }
  if (reasons.length === 0) {
    reasons.push("0 sensitive spans detected (low-risk baseline)");
  }

  return {
    score,
    tier,
    action,
    reasons,
    breakdown: {
      credentials,
      piiPhi,
      corporate,
      entropyBonus,
      nanoBonus,
    },
  };
}
