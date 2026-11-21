package com.localfirst.triage.ai

import com.localfirst.triage.model.InferenceSource
import com.localfirst.triage.model.NanoStatus
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
    var streamCloudCalled: Int = 0,
    var cloudUnaryCalled: Int = 0,
) : HybridAiTransport {
    var lastCloudPrompt: String? = null

    override suspend fun checkOnDeviceStatus(cloudModelName: String): NanoStatus = status

    override fun downloadOnDeviceModel(cloudModelName: String): Flow<Int> = emptyFlow()

    override suspend fun generateOnDeviceOnly(
        prompt: String,
        cloudModelName: String,
    ): Pair<String, InferenceSource> = "P0|SECURITY|NONE" to InferenceSource.ON_DEVICE

    override fun streamCloudEscalation(
        prompt: String,
        modelName: String,
        systemInstruction: String,
    ): Flow<Pair<String, InferenceSource>> {
        streamCloudCalled++
        lastCloudPrompt = prompt
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
            rawText = "P0 outage with leaked key AIzaSyD-1234567890abcdefghijklmnopqrs and Project-Apollo",
            offlineMode = false,
            runtimeConfig = cfg,
        )

        assertEquals(ResolutionMode.QUARANTINED_PENDING_APPROVAL, quarantined.resolutionMode)
        assertEquals(Stage2Source.HELD_QUARANTINE, quarantined.stage2Source)
        assertEquals(0, transport.streamCloudCalled)
        assertFalse(quarantined.sanitizedText.contains("AIzaSyD-"))
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
        assertFalse(transport.lastCloudPrompt.orEmpty().contains("AIzaSyD-"))
        assertEquals(quarantined.createdAt, escalated.createdAt)
    }
}
