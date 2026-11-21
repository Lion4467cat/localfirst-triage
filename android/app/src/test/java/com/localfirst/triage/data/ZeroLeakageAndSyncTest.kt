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

    private val testFirebaseKey = listOf("AI", "zaSyD-1234567890abcdefghijklmnopqrs").joinToString("")
    private val testAwsKey = listOf("AK", "IAIOSFODNN7EXAMPLE").joinToString("")

    private fun sampleTicket(
        sanitizedText: String = "Ticket with [REDACTED:API_KEY_1] sanitized cleanly.",
        resolution: String = "Rotate [REDACTED:API_KEY_1].",
        title: String = "Android Synced Alert",
        createdAt: Long = 1_700_000_000_000L,
        updatedAt: Long = 1_700_000_001_000L,
        spans: List<RedactionSpan> = listOf(
            RedactionSpan(
                start = 12,
                end = 51,
                category = "API_KEY",
                detector = DetectorSource.REGEX_FIREWALL,
                placeholder = "[REDACTED:API_KEY_1]",
                matchedText = testFirebaseKey,
                masked = true,
            ),
        ),
    ): TriageResult = TriageResult(
        id = "ticket-android-1",
        title = title,
        rawText = "Ticket with $testFirebaseKey sanitized cleanly.",
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
        createdAt = createdAt,
        updatedAt = updatedAt,
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
    fun verifyZeroLeakageBlocksRawUrlAndJsonEscapedSecretsIncludingConstituents() {
        // 1. Span still present verbatim in sanitizedText
        val leakedSpanResult = FirestoreSyncRepository.buildZeroPiiTicketPayload(
            uid = "uid-1",
            result = sampleTicket(
                sanitizedText = "Ticket with $testFirebaseKey still raw!",
            ),
        )
        assertTrue(leakedSpanResult is ZeroPiiPayloadResult.Blocked)
        assertTrue((leakedSpanResult as ZeroPiiPayloadResult.Blocked).blockedByZeroLeakage)

        // 2. Raw AWS key hidden inside resolution even with empty spans
        val leakedAwsResolution = FirestoreSyncRepository.buildZeroPiiTicketPayload(
            uid = "uid-1",
            result = sampleTicket(
                spans = emptyList(),
                resolution = "Mitigation: revoke $testAwsKey now.",
            ),
        )
        assertTrue(leakedAwsResolution is ZeroPiiPayloadResult.Blocked)

        // 3. URL-encoded span bypass attempt blocked by verifyZeroLeakage
        val emailSpan = RedactionSpan(
            start = 0,
            end = 15,
            category = "EMAIL",
            detector = DetectorSource.REGEX_FIREWALL,
            placeholder = "[REDACTED:EMAIL_1]",
            matchedText = "victim@acme.org",
            masked = true,
        )
        val urlAudit = LocalFirewallEngine.verifyZeroLeakage(
            "Outbound prompt referencing victim%40acme.org",
            listOf(emailSpan),
        )
        assertFalse(urlAudit.verified)
        assertEquals(listOf("EMAIL"), urlAudit.leakedCategories)

        // 4. Merged span constituentTexts & JSON-escaped bypass attempt blocked by verifyZeroLeakage
        val mergedSpan = RedactionSpan(
            start = 0,
            end = 30,
            category = "M_AND_A_SECRET",
            detector = DetectorSource.NANO_SEMANTIC_FIREWALL,
            placeholder = "[REDACTED:M_AND_A_SECRET_1]",
            matchedText = "Project-Chimera \"$42M\" valuation",
            masked = true,
            constituentTexts = listOf("Project-Chimera", "\"\$42M\" secret"),
        )
        val constituentAudit = LocalFirewallEngine.verifyZeroLeakage(
            "Summary mentions Project-Chimera quietly.",
            listOf(mergedSpan),
        )
        assertFalse(constituentAudit.verified)
        assertEquals(listOf("M_AND_A_SECRET"), constituentAudit.leakedCategories)

        val jsonEscapedAudit = LocalFirewallEngine.verifyZeroLeakage(
            """{"note": "\"$42M\" secret leaked"}""",
            listOf(mergedSpan),
        )
        assertFalse(jsonEscapedAudit.verified)
        assertEquals(listOf("M_AND_A_SECRET"), jsonEscapedAudit.leakedCategories)
    }

    @Test
    fun enforcesFirestoreSchemaLengthCapsAndImmutableCreatedAtOnUpdates() {
        val oversizedTitle = "T".repeat(450)
        val oversizedSanitized = "S".repeat(65_000)
        val oversizedResolution = "R".repeat(65_000)

        val initial = FirestoreSyncRepository.buildZeroPiiTicketPayload(
            uid = "uid-bounds",
            result = sampleTicket(
                title = oversizedTitle,
                sanitizedText = oversizedSanitized,
                resolution = oversizedResolution,
                createdAt = 1_700_000_000_000L,
                updatedAt = 1_700_000_000_500L,
            ),
            nowMs = 1_700_000_010_000L,
        )
        assertTrue(initial is ZeroPiiPayloadResult.Valid)
        val initialData = (initial as ZeroPiiPayloadResult.Valid).data
        assertEquals(200, (initialData["title"] as String).length)
        assertEquals(50_000, (initialData["sanitizedText"] as String).length)
        assertEquals(50_000, (initialData["resolution"] as String).length)
        assertEquals(1_700_000_000_000L, initialData["createdAt"])
        assertEquals(1_700_000_010_000L, initialData["updatedAt"])

        val updated = FirestoreSyncRepository.buildZeroPiiTicketPayload(
            uid = "uid-bounds",
            result = sampleTicket(
                createdAt = 1_700_000_000_000L,
                updatedAt = 1_700_000_010_000L,
            ),
            nowMs = 1_700_000_025_000L,
        )
        assertTrue(updated is ZeroPiiPayloadResult.Valid)
        val updatedData = (updated as ZeroPiiPayloadResult.Valid).data
        assertEquals(initialData["createdAt"], updatedData["createdAt"])
        assertTrue((updatedData["updatedAt"] as Long) > (initialData["updatedAt"] as Long))
    }
}