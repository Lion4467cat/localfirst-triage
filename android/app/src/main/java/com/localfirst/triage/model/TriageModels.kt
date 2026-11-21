package com.localfirst.triage.model

enum class DetectorSource(val priority: Int) {
    MANUAL_MASK(5),
    NANO_SEMANTIC_FIREWALL(4),
    POLICY_TERM(3),
    REGEX_FIREWALL(2),
    ENTROPY_SCANNER(2),
    HEURISTIC_GUARD(1),
}

enum class Severity {
    P0,
    P1,
    P2,
    P3,
}

enum class SourcePlatform {
    WEB,
    CHROME_EXTENSION,
    ANDROID,
}

enum class NanoStatus {
    READY,
    DOWNLOADABLE,
    MODEL_DOWNLOADING,
    UNAVAILABLE,
}

enum class InferenceSource {
    ON_DEVICE,
    LOCAL_REGEX_FALLBACK,
    IN_CLOUD,
    OFFLINE_BLOCKED,
    CLOUD_ERROR,
}

enum class Stage2Source {
    SKIPPED_LOCAL_RUNBOOK,
    PENDING_PRE_CLOUD,
    HELD_QUARANTINE,
    OFFLINE_BLOCKED,
    OFFLINE_QUEUED,
    IN_CLOUD,
    ON_DEVICE_FALLBACK,
    CLOUD_DISABLED,
    CLOUD_ERROR,
}

enum class ResolutionMode {
    LOCAL_RUNBOOK,
    CLOUD_ESCALATION,
    LOCAL_FALLBACK_ONLY,
    QUARANTINED_PENDING_APPROVAL,
    PRE_CLOUD_COUNTDOWN,
    OFFLINE_QUEUED,
    CLOUD_ERROR,
}

enum class RemoteConfigSource {
    LOADED,
    DEFAULT_FALLBACK,
    TIMEOUT,
}

enum class CloudSyncStatus {
    DISCONNECTED,
    SIGNING_IN,
    SYNCED,
    OFFLINE,
    ERROR,
}

data class AuthUserSummary(
    val uid: String,
    val isAnonymous: Boolean,
    val displayName: String? = null,
    val email: String? = null,
)

data class RedactionSpan(
    val start: Int,
    val end: Int,
    val category: String,
    val detector: DetectorSource,
    val placeholder: String,
    val matchedText: String,
    val masked: Boolean = true,
    val constituentTexts: List<String> = emptyList(),
)

data class SemanticExtractionItem(
    val phrase: String,
    val category: String,
)

data class CustomRunbook(
    val id: String,
    val title: String,
    val category: String,
    val severity: Severity,
    val keywords: List<String>,
    val resolution: String,
    val builtIn: Boolean = false,
)

data class PrivacyPolicy(
    val customTerms: List<String> = emptyList(),
    val enableEntropyScanner: Boolean = true,
    val autoCountdownSeconds: Int = 3,
)

data class RuntimeConfigValues(
    val cloudModel: String = DEFAULT_CLOUD_PRIMARY_MODEL,
    val cloudFallbackModel: String = DEFAULT_CLOUD_FALLBACK_MODEL,
    val enableCloudEscalation: Boolean = true,
    val entropyThreshold: Double = DEFAULT_ENTROPY_THRESHOLD,
    val enterpriseBlockedTerms: List<String> = DEFAULT_ENTERPRISE_BLOCKED_TERMS,
    val source: RemoteConfigSource = RemoteConfigSource.DEFAULT_FALLBACK,
) {
    companion object {
        const val DEFAULT_CLOUD_PRIMARY_MODEL = "gemini-3.5-flash-lite"
        const val DEFAULT_CLOUD_FALLBACK_MODEL = "gemini-2.5-flash"
        const val DEFAULT_ENTROPY_THRESHOLD = 3.25
        val DEFAULT_ENTERPRISE_BLOCKED_TERMS = listOf("Project-Apollo", "Project-Valkyrie")
    }
}

data class ZeroLeakageAudit(
    val verified: Boolean,
    val checkedSpansCount: Int,
    val leakedSpansCount: Int,
    val leakedCategories: List<String>,
    val outboundPromptPreview: String,
    val verifiedAt: Long,
)

data class HybridBriefResult(
    val summary: String,
    val stakeholderDraft: String,
    val inferenceSource: String, // "ON_DEVICE" | "IN_CLOUD" | "LOCAL_FALLBACK"
    val latencyMs: Long,
    val generatedAt: Long,
)

data class TriageResult(
    val id: String,
    val title: String,
    val rawText: String,
    val sanitizedText: String,
    val severity: Severity,
    val category: String,
    val runbookId: String? = null,
    val spans: List<RedactionSpan>,
    val resolution: String,
    val resolutionMode: ResolutionMode,
    val inferenceSource: InferenceSource,
    val stage1Source: String, // "ON_DEVICE (Nano 4)" | "HEURISTIC_GUARD"
    val stage1LatencyMs: Long,
    val stage2Source: Stage2Source,
    val stage2LatencyMs: Long,
    val nanoStatus: NanoStatus,
    val latencyMs: Long,
    val estimatedTokensSaved: Int,
    val createdAt: Long,
    val updatedAt: Long = createdAt,
    val activeCloudModel: String? = null,
    val cloudError: String? = null,
    val zeroLeakageAudit: ZeroLeakageAudit? = null,
    val hybridBrief: HybridBriefResult? = null,
    val sourcePlatform: SourcePlatform = SourcePlatform.ANDROID,
    val queuedForReconnect: Boolean = false,
    val loadedFromZeroPiiStore: Boolean = false,
)

data class DemoScenario(
    val id: String,
    val title: String,
    val subtitle: String,
    val expectedSeverity: Severity,
    val rawText: String,
)
