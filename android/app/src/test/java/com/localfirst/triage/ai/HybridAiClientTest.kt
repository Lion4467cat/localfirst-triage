package com.localfirst.triage.ai

import com.localfirst.triage.firewall.LocalFirewallEngine
import com.localfirst.triage.model.DetectorSource
import com.localfirst.triage.model.InferenceSource
import com.localfirst.triage.model.NanoStatus
import com.localfirst.triage.model.RedactionSpan
import com.localfirst.triage.model.ResolutionMode
import com.localfirst.triage.model.RuntimeConfigValues
import com.localfirst.triage.model.Stage2Source
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

private class FakeHybridAiTransport(
    var status: NanoStatus = NanoStatus.UNAVAILABLE,
    var hybridBriefThrows: Boolean = false,
    var cloudThrows: Boolean = false,
    var onDeviceOutput: String = "P0|SECURITY|NONE",
    var streamCloudCalled: Int = 0,
    var cloudUnaryCalled: Int = 0,
) : HybridAiTransport {
    var lastCloudPrompt: String? = null

    override suspend fun checkOnDeviceStatus(cloudModelName: String): NanoStatus = status

    override fun downloadOnDeviceModel(cloudModelName: String): Flow<Int> = emptyFlow()

    override suspend fun generateOnDeviceOnly(
        prompt: String,
        cloudModelName: String,
    ): Pair<String, InferenceSource> = onDeviceOutput to InferenceSource.ON_DEVICE

    override fun streamCloudEscalation(
        prompt: String,
        modelName: String,
        systemInstruction: String,
    ): Flow<Pair<String, InferenceSource>> {
        streamCloudCalled++
        lastCloudPrompt = prompt
        if (cloudThrows) {
            return flow { throw IllegalStateException("403 App Check token rejected (sideload debug)") }
        }
        return flow {
            emit("### Root Cause\n" to InferenceSource.IN_CLOUD)
            emit("Revoke leaked credential cleanly." to InferenceSource.IN_CLOUD)
        }
    }

    override suspend fun generateCloudUnary(
        prompt: String,
        modelName: String,
        systemInstruction: String,
    ): Pair<String, InferenceSource> {
        cloudUnaryCalled++
        if (cloudThrows) {
            throw IllegalStateException("403 App Check token rejected (sideload debug)")
        }
        return "Cloud-recovered executive summary after on-device worker failure." to InferenceSource.IN_CLOUD
    }

    override suspend fun generateHybridBrief(
        prompt: String,
        cloudModelName: String,
    ): Pair<String, InferenceSource> {
        if (hybridBriefThrows) {
            error("Simulated PREFER_ON_DEVICE mid-call AICore failure")
        }
        return "On-device executive brief." to InferenceSource.ON_DEVICE
    }
}

class HybridAiClientTest {

    private val testFirebaseKey = listOf("AI", "zaSyD-1234567890abcdefghijklmnopqrs").joinToString("")
    private val firebasePrefix = listOf("AI", "zaSyD-").joinToString("")

    @Test
    fun failClosedQuarantinesWhenNanoUnavailableAndRecoversPreferOnDeviceBriefToInCloud() = runTest {
        val transport = FakeHybridAiTransport(
            status = NanoStatus.UNAVAILABLE,
            hybridBriefThrows = true,
        )
        val client = HybridAiClient(transport)
        val cfg = RuntimeConfigValues()

        val quarantined = client.runStage1AndTriage(
            id = "t-q-1",
            title = "P0 Secret Leak",
            rawText = "P0 outage with leaked key $testFirebaseKey and Project-Apollo",
            offlineMode = false,
            runtimeConfig = cfg,
        )

        assertEquals(ResolutionMode.QUARANTINED_PENDING_APPROVAL, quarantined.resolutionMode)
        assertEquals(Stage2Source.HELD_QUARANTINE, quarantined.stage2Source)
        assertEquals(0, transport.streamCloudCalled)
        assertFalse(quarantined.sanitizedText.contains(firebasePrefix))
        assertFalse(quarantined.sanitizedText.contains("Project-Apollo"))

        // Auto-recovery on PREFER_ON_DEVICE Hybrid Brief throwing mid-call -> IN_CLOUD
        val brief = client.generateSanitizedHybridBrief(quarantined, runtimeConfig = cfg, offlineMode = false)
        assertEquals("IN_CLOUD", brief.inferenceSource)
        assertEquals(1, transport.cloudUnaryCalled)
        assertTrue(brief.stakeholderDraft.contains("Cloud-recovered executive summary"))

        // Escalate approved sanitized ticket -> streams IN_CLOUD cleanly with zero PII in outbound prompt
        val chunks = mutableListOf<String>()
        val escalated = client.escalateApprovedTicket(
            ticket = quarantined,
            updatedSpans = quarantined.spans,
            runtimeConfig = cfg,
            offlineMode = false,
            onStreamChunk = { chunks.add(it) },
        )
        assertEquals(ResolutionMode.CLOUD_ESCALATION, escalated.resolutionMode)
        assertEquals(1, transport.streamCloudCalled)
        assertTrue(chunks.isNotEmpty())
        assertFalse(transport.lastCloudPrompt.orEmpty().contains(firebasePrefix))
        assertEquals(quarantined.createdAt, escalated.createdAt)
    }

    @Test
    fun enforcesDefenseInDepthUnionWhenNanoUnderExtractsAndBlocksCorruptedSpans() = runTest {
        val transport = FakeHybridAiTransport(
            status = NanoStatus.READY,
            onDeviceOutput = "P0|GENERAL_INCIDENT|NONE\nJohn|PERSON_PII",
        )
        val client = HybridAiClient(transport)
        val scenario1 = LocalFirewallEngine.DEMO_SCENARIOS[0]
        val cfg = RuntimeConfigValues()

        val staged = client.runStage1AndTriage(
            id = "t-union-1",
            title = scenario1.title,
            rawText = scenario1.rawText,
            offlineMode = false,
            runtimeConfig = cfg,
            approveCloudEscalation = false,
        )

        assertEquals(ResolutionMode.PRE_CLOUD_COUNTDOWN, staged.resolutionMode)
        val johnSpan = staged.spans.firstOrNull { it.matchedText == "John" }
        assertEquals(DetectorSource.NANO_SEMANTIC_FIREWALL, johnSpan?.detector)
        assertFalse(staged.sanitizedText.contains("Manipal ICU Floor 3"))
        assertFalse(staged.sanitizedText.contains("2026exclamation"))
        assertFalse(staged.sanitizedText.contains("Project-Chimera"))
        assertFalse(staged.sanitizedText.contains("\$42M valuation"))

        client.escalateApprovedTicket(
            ticket = staged,
            updatedSpans = staged.spans,
            runtimeConfig = cfg,
            offlineMode = false,
        )
        val outbound = transport.lastCloudPrompt.orEmpty()
        assertFalse(outbound.contains("Manipal ICU Floor 3"))
        assertFalse(outbound.contains("2026exclamation"))
        assertFalse(outbound.contains("Project-Chimera"))
        assertFalse(outbound.contains("\$42M valuation"))

        // Verify Zero-Leakage Gate blocks corrupted/unredacted span before any cloud call
        val countBeforeCorrupt = transport.streamCloudCalled
        val corruptedSpans = listOf(
            RedactionSpan(
                start = -1,
                end = -1,
                category = "API_KEY",
                detector = DetectorSource.REGEX_FIREWALL,
                placeholder = "[REDACTED:API_KEY_1]",
                matchedText = "\$42M valuation",
                masked = true,
            ),
        )
        val leakedInput = staged.copy(
            rawText = "Exposed \$42M valuation in payload",
            sanitizedText = "Exposed \$42M valuation in payload",
            loadedFromZeroPiiStore = false,
            spans = corruptedSpans,
        )
        val blocked = client.escalateApprovedTicket(
            ticket = leakedInput,
            updatedSpans = corruptedSpans,
            runtimeConfig = cfg,
            offlineMode = false,
        )
        assertEquals(countBeforeCorrupt, transport.streamCloudCalled)
        assertEquals(ResolutionMode.QUARANTINED_PENDING_APPROVAL, blocked.resolutionMode)
        assertFalse(blocked.zeroLeakageAudit?.verified ?: true)
    }

    @Test
    fun producesDeterministicEmergencyFallbackOnCloudErrorWithoutLeakingPii() = runTest {
        val transport = FakeHybridAiTransport(
            status = NanoStatus.UNAVAILABLE,
            cloudThrows = true,
        )
        val client = HybridAiClient(transport)
        val cfg = RuntimeConfigValues()

        val errorTicket = client.runStage1AndTriage(
            id = "t-cloud-err-1",
            title = "Cloud Rejected",
            rawText = "P0 incident with key $testFirebaseKey",
            offlineMode = false,
            runtimeConfig = cfg,
            approveCloudEscalation = true,
        )

        assertEquals(ResolutionMode.CLOUD_ERROR, errorTicket.resolutionMode)
        assertEquals(Stage2Source.CLOUD_ERROR, errorTicket.stage2Source)
        assertEquals(InferenceSource.CLOUD_ERROR, errorTicket.inferenceSource)
        assertTrue(errorTicket.cloudError.orEmpty().contains("App Check rejected"))
        assertTrue(errorTicket.resolution.contains("DebugAppCheckProvider"))
        assertFalse(errorTicket.resolution.contains(firebasePrefix))
    }
}