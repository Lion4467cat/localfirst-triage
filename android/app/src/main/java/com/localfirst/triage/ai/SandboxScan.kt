package com.localfirst.triage.ai

import com.localfirst.triage.model.InferenceSource
import com.localfirst.triage.model.RedactionSpan

/**
 * Result of one Quick Sandbox pass. The sandbox is the only surface where a user can watch the
 * on-device model work, so it records which engine actually produced the spans instead of assuming
 * the deterministic rules ran.
 */
data class SandboxScan(
    val rawText: String,
    val sanitizedText: String,
    val spans: List<RedactionSpan>,
    val inferenceSource: InferenceSource,
    val modelName: String? = null,
    val semanticPhraseCount: Int = 0,
    val latencyMs: Long = 0L,
) {
    val usedNano: Boolean get() = inferenceSource == InferenceSource.ON_DEVICE
}
