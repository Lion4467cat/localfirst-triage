package com.localfirst.triage.data

import com.localfirst.triage.firewall.LocalFirewallEngine
import com.localfirst.triage.model.DetectorSource
import com.localfirst.triage.model.InferenceSource
import com.localfirst.triage.model.NanoStatus
import com.localfirst.triage.model.RedactionSpan
import com.localfirst.triage.model.ResolutionMode
import com.localfirst.triage.model.Severity
import com.localfirst.triage.model.SourcePlatform
import com.localfirst.triage.model.Stage2Source
import com.localfirst.triage.model.TriageResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ZeroLeakageAndSyncTest {

    private fun sampleTicket(
        sanitizedText: String = "Ticket with [REDACTED:API_KEY_1] sanitized cleanly.",
        resolution: String = "Rotate [REDACTED:API_KEY_1].",
        spans: List<RedactionSpan> = listOf(
            RedactionSpan(
                start = 12,
                end = 51,
                category = "API_KEY",
                detector = DetectorSource.REGEX_FIREWALL,
                placeholder = "[REDACTED:API_KEY_1]",
                matchedText = "AIzaSyD-1234567890abcdefghijklmnopqrs",
                masked = true,
            ),
        ),
    ): TriageResult = TriageResult(
        id = "ticket-android-1",
        title = "Android Synced Alert",
        rawText = "Ticket with AIzaSyD-1234567890abcdefghijklmnopqrs sanitized cleanly.",
        sanitizedText = sanitizedText,
        severity = Severity.P0,
        category = "SECURITY",
        runbookId = null,
        spans = spans,
        resolution = resolution,
        resolutionMode = ResolutionMode.QUARANTINED_PENDING_APPROVAL,
        inferenceSource = InferenceSource.LOCAL_REGEX_FALLBACK,
        stage1Source = "HEURISTIC_GUARD",
        stage1LatencyMs = 8L,
        stage2Source = Stage2Source.HELD_QUARANTINE,
        stage2LatencyMs = 0L,
        nanoStatus = NanoStatus.UNAVAILABLE,
        latencyMs = 8L,
        estimatedTokensSaved = 45,
        createdAt = 1_700_000_000_000L,
        updatedAt = 1_700_000_001_000L,
        sourcePlatform = SourcePlatform.ANDROID,
    )

    @Test
    fun serializerStrictlyMatchesFirestoreRulesAllowlistAndStripsRawPii() {
        val result = FirestoreSyncRepository.buildZeroPiiTicketPayload(
            uid = "uid-android-42",
            result = sampleTicket(),
            nowMs = 1_700_000_002_000L,
        )

        assertTrue(result is ZeroPiiPayloadResult.Valid)
        val payload = (result as ZeroPiiPayloadResult.Valid).data

        assertEquals(FirestoreSyncRepository.TICKET_ALLOWED_KEYS, payload.keys)
        assertFalse(payload.containsKey("rawText"))
        assertFalse(payload.containsKey("matchedText"))
        assertFalse(payload.containsKey("constituentTexts"))
        assertFalse(payload.containsKey("spans"))
        assertEquals("ANDROID", payload["sourcePlatform"])
        assertEquals(true, payload["zeroLeakageVerified"])
        assertEquals(1_700_000_000_000L, payload["createdAt"])
        assertEquals(1_700_000_002_000L, payload["updatedAt"])
        assertEquals(1, payload["activeMaskCount"])
        assertEquals(listOf("API_KEY"), payload["redactedCategories"])

        val roundTripped = FirestoreSyncRepository.firestoreMapToLocalResult(payload)
        assertNotNull(roundTripped)
        assertEquals(LocalFirewallEngine.PURGED_PLACEHOLDER, roundTripped?.rawText)
        assertEquals(SourcePlatform.ANDROID, roundTripped?.sourcePlatform)
        assertTrue(roundTripped?.loadedFromZeroPiiStore == true)
    }

    @Test
    fun verifyZeroLeakageBlocksRawSecretsFromFirestoreAndCloudPrompts() {
        // 1. Span still present verbatim in sanitizedText
        val leakedSpanResult = FirestoreSyncRepository.buildZeroPiiTicketPayload(
            uid = "uid-1",
            result = sampleTicket(
                sanitizedText = "Ticket with AIzaSyD-1234567890abcdefghijklmnopqrs still raw!",
            ),
        )
        assertTrue(leakedSpanResult is ZeroPiiPayloadResult.Blocked)
        assertTrue((leakedSpanResult as ZeroPiiPayloadResult.Blocked).blockedByZeroLeakage)

        // 2. Raw AWS key hidden inside resolution even with empty spans
        val leakedAwsResolution = FirestoreSyncRepository.buildZeroPiiTicketPayload(
            uid = "uid-1",
            result = sampleTicket(
                spans = emptyList(),
                resolution = "Mitigation: revoke AKIAIOSFODNN7EXAMPLE now.",
            ),
        )
        assertTrue(leakedAwsResolution is ZeroPiiPayloadResult.Blocked)

        // 3. URL-encoded span bypass attempt blocked by verifyZeroLeakage
        val spans = listOf(
            RedactionSpan(
                start = 0,
                end = 15,
                category = "EMAIL",
                detector = DetectorSource.REGEX_FIREWALL,
                placeholder = "[REDACTED:EMAIL_1]",
                matchedText = "victim@acme.org",
                masked = true,
            ),
        )
        val urlAudit = LocalFirewallEngine.verifyZeroLeakage(
            "Outbound prompt referencing victim%40acme.org",
            spans,
        )
        assertFalse(urlAudit.verified)
        assertEquals(listOf("EMAIL"), urlAudit.leakedCategories)
    }
}
