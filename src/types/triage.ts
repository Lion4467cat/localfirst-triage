export type DetectorSource =
  | "REGEX_FIREWALL"
  | "HEURISTIC_GUARD"
  | "NANO_SEMANTIC_FIREWALL";

export type Severity = "P0" | "P1" | "P2" | "P3";

export type NanoStatus = "READY" | "MODEL_DOWNLOADING" | "UNAVAILABLE";

export type InferenceSource =
  | "ON_DEVICE"
  | "LOCAL_REGEX_FALLBACK"
  | "IN_CLOUD"
  | "OFFLINE_BLOCKED";

export type Stage2Source =
  | "SKIPPED_LOCAL_RUNBOOK"
  | "PENDING_PRE_CLOUD"
  | "HELD_QUARANTINE"
  | "OFFLINE_BLOCKED"
  | "IN_CLOUD"
  | "CLOUD_DISABLED";

export type ResolutionMode =
  | "LOCAL_RUNBOOK"
  | "CLOUD_ESCALATION"
  | "LOCAL_FALLBACK_ONLY"
  | "QUARANTINED_PENDING_APPROVAL"
  | "PRE_CLOUD_COUNTDOWN";

export interface RedactionSpan {
  start: number;
  end: number;
  category: string;
  detector: DetectorSource;
  placeholder: string;
  matchedText: string;
  masked?: boolean;
}

export interface SemanticExtractionItem {
  phrase: string;
  category: string;
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
  loadedFromZeroPiiStore?: boolean;
}

export interface HybridTelemetry {
  nanoStatus: NanoStatus;
  totalRuns: number;
  localResolvedCount: number;
  cloudEscalatedCount: number;
  estimatedTokensSaved: number;
  lastLatencyMs: number;
  offlineMode: boolean;
  activeCloudModel: string;
}

export interface DemoScenario {
  id: string;
  title: string;
  subtitle: string;
  expectedSeverity: Severity;
  rawText: string;
}
