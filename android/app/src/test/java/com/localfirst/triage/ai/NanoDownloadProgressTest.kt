package com.localfirst.triage.ai

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NanoDownloadProgressTest {

    @Test
    fun `percentage comes from bytes not a timer`() {
        assertEquals(0, NanoDownloadState().percent)
        assertEquals(0, NanoDownloadState(bytesDownloaded = 10, totalBytes = 0).percent)
        assertEquals(10, NanoDownloadState(bytesDownloaded = 385_000_000, totalBytes = 3_850_000_000).percent)
        assertEquals(100, NanoDownloadState(bytesDownloaded = 3_850_000_000, totalBytes = 3_850_000_000).percent)
        assertEquals(100, NanoDownloadState(completed = true).percent)
        // A report that overshoots the total can never render above 100%.
        assertEquals(100, NanoDownloadState(bytesDownloaded = 5_000, totalBytes = 4_000).percent)
    }

    @Test
    fun `size speed and eta read like a download manager`() {
        val state = NanoDownloadState(
            bytesDownloaded = 412_000_000,
            totalBytes = 3_850_000_000,
            bytesPerSecond = 18_400_000,
            etaSeconds = 135,
        )
        assertEquals("412 MB / 3.85 GB", state.sizeLabel)
        assertEquals("412 MB / 3.85 GB · 18.4 MB/s · ~2m 15s left", state.detailLabel)
    }

    @Test
    fun `stalled and failed states replace the numbers with a reason`() {
        val stalled = NanoDownloadState(bytesDownloaded = 412_000_000, totalBytes = 3_850_000_000, stalled = true)
        assertEquals("Waiting for unmetered Wi-Fi / AICore…", stalled.detailLabel)

        val failed = NanoDownloadState(failed = true)
        assertEquals("Download failed — tap Retry to resume", failed.detailLabel)
    }

    @Test
    fun `byte and duration formatting cover the boundaries`() {
        assertEquals("0 MB", formatBytes(0))
        assertEquals("512 KB", formatBytes(512_000))
        assertEquals("412 MB", formatBytes(412_000_000))
        assertEquals("3.85 GB", formatBytes(3_850_000_000))

        assertEquals("0s", formatDuration(0))
        assertEquals("45s", formatDuration(45))
        assertEquals("2m 15s", formatDuration(135))
        assertEquals("1h 1m", formatDuration(3_700))
    }

    @Test
    fun `transfer meter averages a burst instead of reporting zero`() {
        val meter = TransferRateMeter(windowMs = 4_000)
        assertEquals(0L, meter.sample(0, 0))
        // 100 MB over 4 s is 25 MB/s, even though the last single tick moved 100 MB at once.
        val speed = meter.sample(4_000, 100_000_000)
        assertEquals(25_000_000L, speed)
        // No movement in the window reads as stalled, not as a huge average.
        assertEquals(0L, meter.sample(20_000, 100_000_000))
    }

    @Test
    fun `download flow is monotonic and ends ready`() = runTest {
        val states = FakeDownloadTransport().downloadOnDeviceModel("gemini-3.5-flash-lite").toList()

        assertTrue(states.first().percent == 0)
        assertEquals(listOf(0, 10, 54, 100), states.map { it.percent })
        assertTrue(states.last().completed)
        assertEquals("gemini-nano-4", states.last().modelName)
        // ETA shrinks as bytes land.
        val etas = states.mapNotNull { it.etaSeconds }
        assertEquals(etas.sortedDescending(), etas)
        assertNull(states.first().etaSeconds)
    }
}

/** Replays the four SDK statuses the way AICore emits them. */
private class FakeDownloadTransport : HybridAiTransport {
    override suspend fun checkOnDeviceStatus(cloudModelName: String) = com.localfirst.triage.model.NanoStatus.READY

    override suspend fun onDeviceModelName(cloudModelName: String): String? = "gemini-nano-4"

    override fun downloadOnDeviceModel(cloudModelName: String): Flow<NanoDownloadState> = flow {
        emit(NanoDownloadState(modelName = "gemini-nano-4"))
        emit(NanoDownloadState(modelName = "gemini-nano-4", bytesDownloaded = 385_000_000, totalBytes = 3_850_000_000, bytesPerSecond = 20_000_000, etaSeconds = 173))
        emit(NanoDownloadState(modelName = "gemini-nano-4", bytesDownloaded = 2_100_000_000, totalBytes = 3_850_000_000, bytesPerSecond = 24_000_000, etaSeconds = 73))
        emit(NanoDownloadState(modelName = "gemini-nano-4", bytesDownloaded = 3_850_000_000, totalBytes = 3_850_000_000, completed = true))
    }

    override suspend fun generateOnDeviceOnly(prompt: String, cloudModelName: String) =
        "" to com.localfirst.triage.model.InferenceSource.ON_DEVICE

    override fun streamCloudEscalation(prompt: String, modelName: String, systemInstruction: String) =
        flow<Pair<String, com.localfirst.triage.model.InferenceSource>> { }

    override suspend fun generateCloudUnary(prompt: String, modelName: String, systemInstruction: String) =
        "" to com.localfirst.triage.model.InferenceSource.IN_CLOUD

    override suspend fun generateHybridBrief(prompt: String, cloudModelName: String) =
        "" to com.localfirst.triage.model.InferenceSource.IN_CLOUD
}
