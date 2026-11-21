export type DetectorSource =
  | "REGEX_FIREWALL"
  | "ENTROPY_SCANNER"
  | "HEURISTIC_GUARD"
  | "NANO_SEMANTIC_FIREWALL"
  | "POLICY_TERM"
  | "MANUAL_MASK";

export type Severity = "P0" | "P1" | "P2" | "P3";

export type NanoStatus = "READY" | "DOWNLOADABLE" | "MODEL_DOWNLOADING" | "UNAVAILABLE";

export type InferenceSource =
  | "ON_DEVICE"
  | "LOCAL_REGEX_FALLBACK"
  | "IN_CLOUD"
  | "OFFLINE_BLOCKED"
  | "CLOUD_ERROR";

export type Stage2Source =
  | "SKIPPED_LOCAL_RUNBOOK"
  | "PENDING_PRE_CLOUD"
  | "HELD_QUARANTINE"
  | "OFFLINE_BLOCKED"
  | "OFFLINE_QUEUED"
  | "IN_CLOUD"
  | "ON_DEVICE_FALLBACK"
  | "CLOUD_DISABLED"
  | "CLOUD_ERROR";

export type ResolutionMode =
  | "LOCAL_RUNBOOK"
  | "CLOUD_ESCALATION"
  | "LOCAL_FALLBACK_ONLY"
  | "QUARANTINED_PENDING_APPROVAL"
  | "PRE_CLOUD_COUNTDOWN"
  | "OFFLINE_QUEUED"
  | "CLOUD_ERROR";

export type AppCheckProviderKind = "RECAPTCHA_V3" | "RECAPTCHA_ENTERPRISE" | "UNCONFIGURED";

export type RemoteConfigSource = "LOADED" | "DEFAULT_FALLBACK" | "TIMEOUT";

export type SourcePlatform = "WEB" | "CHROME_EXTENSION" | "ANDROID";

export type CloudSyncStatus = "DISCONNECTED" | "SIGNING_IN" | "SYNCED" | "OFFLINE" | "ERROR";

export interface AuthUserSummary {
  uid: string;
  isAnonymous: boolean;
  displayName: string | null;
  email: string | null;
}

export interface RedactionSpan {
  start: number;
  end: number;
  category: string;
  detector: DetectorSource;
  placeholder: string;
  matchedText: string;
  masked?: boolean;
  constituentTexts?: string[];
}

export interface SemanticExtractionItem {
  phrase: string;
  category: string;
}

export interface CustomRunbook {
  id: string;
  title: string;
  category: string;
  severity: "P2" | "P3";
  keywords: string[];
  resolution: string;
  builtIn?: boolean;
}

export interface PrivacyPolicy {
  customTerms: string[];
  enableEntropyScanner: boolean;
  autoCountdownSeconds: number;
}

export interface ZeroLeakageAudit {
  verified: boolean;
  checkedSpansCount: number;
  leakedSpansCount: number;
  leakedCategories: string[];
  outboundPromptPreview: string;
  verifiedAt: number;
}

export interface HybridBriefResult {
  summary: string;
  stakeholderDraft: string;
  inferenceSource: "ON_DEVICE" | "IN_CLOUD" | "LOCAL_FALLBACK";
  latencyMs: number;
  generatedAt: number;
}

export type RiskTier = "LOW" | "ELEVATED" | "HIGH" | "CRITICAL";

export type RiskRoutingAction =
  | "CACHE_HIT_LOCAL"
  | "LOCAL_RUNBOOK"
  | "HYBRID_GATED_REVIEW"
  | "CRITICAL_AIRGAP_LOCKDOWN";

export interface RiskProfile {
  score: number;
  tier: RiskTier;
  action: RiskRoutingAction;
  reasons: string[];
  breakdown: {
    credentials: number;
    piiPhi: number;
    corporate: number;
    entropyBonus: number;
    nanoBonus: number;
  };
}

export interface ZeroLeakageAuditReceipt {
  receiptId: string;
  schemaVersion: "1.0.0";
  issuedAt: string;
  rawCommitmentSha256: string;
  sanitizedSha256: string;
  leakedCount: number;
  zeroLeakageVerified: boolean;
  layerBreakdown: {
    regex: number;
    heuristic: number;
    nano4: number;
    totalMasks: number;
  };
  riskProfile: {
    score: number;
    tier: RiskTier;
    action: RiskRoutingAction;
  };
  inferenceModes: {
    stage1: "ONLY_ON_DEVICE";
    stage2: "PREFER_IN_CLOUD";
    brief: "PREFER_ON_DEVICE";
  };
  publicKeyJwk: JsonWebKey;
  keyThumbprintSha256: string;
  signatureBase64Url: string;
}

export interface TriageResult {
  id: string;
  title: string;
  rawText: string;
  sanitizedText: string;
  severity: Severity;
  category: string;
  runbookId?: string | null;
  spans: RedactionSpan[];
  resolution: string;
  resolutionMode: ResolutionMode;
  inferenceSource: InferenceSource;
  stage1Source: "ON_DEVICE (Nano 4)" | "HEURISTIC_GUARD";
  stage1LatencyMs: number;
  stage2Source: Stage2Source;
  stage2LatencyMs: number;
  nanoStatus: NanoStatus;
  latencyMs: number;
  estimatedTokensSaved: number;
  createdAt: number;
  activeCloudModel?: string;
  cloudError?: string | null;
  zeroLeakageAudit?: ZeroLeakageAudit | null;
  hybridBrief?: HybridBriefResult | null;
  riskProfile?: RiskProfile | null;
  dedupCacheHit?: {
    hit: boolean;
    latencyMs: number;
    hitCount: number;
    fingerprint: string;
    modelUsed?: string;
  } | null;
  auditReceipt?: ZeroLeakageAuditReceipt | null;
  importedFromExtension?: boolean;
  sourcePlatform?: SourcePlatform;
  queuedForReconnect?: boolean;
  loadedFromZeroPiiStore?: boolean;
  updatedAt?: number;
}

export interface HybridTelemetry {
  nanoStatus: NanoStatus;
  totalRuns: number;
  localResolvedCount: number;
  cloudEscalatedCount: number;
  estimatedTokensSaved: number;
  lastLatencyMs: number;
  offlineMode: boolean;
  browserOnline: boolean;
  activeCloudModel: string;
  remoteConfigStatus: RemoteConfigSource;
  appCheckProvider: AppCheckProviderKind;
  downloadProgress: number | null;
  queuedOfflineCount: number;
  entropyThreshold?: number;
  enterpriseBlockedTermsCount?: number;
  cloudSyncStatus?: CloudSyncStatus;
  authUser?: AuthUserSummary | null;
  cloudSyncError?: string | null;
}

export interface DemoScenario {
  id: string;
  title: string;
  subtitle: string;
  expectedSeverity: Severity;
  rawText: string;
}
