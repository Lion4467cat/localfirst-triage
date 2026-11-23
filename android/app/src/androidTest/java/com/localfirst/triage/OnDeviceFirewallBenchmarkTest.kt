package com.localfirst.triage

import android.os.Build
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.localfirst.triage.benchmark.BenchmarkCase
import com.localfirst.triage.benchmark.FirewallBenchmarkCorpus
import com.localfirst.triage.data.ShieldStore
import com.localfirst.triage.firewall.LocalFirewallEngine
import com.localfirst.triage.model.ProtectionLevel
import com.localfirst.triage.model.RedactionSpan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.Locale
import kotlin.math.roundToInt

/**
 * Runs the real detection engine on the phone's ARM CPU against the shared corpus and prints a
 * benchmark table under the `CordonBench` tag.
 *
 * The final assertion is the one that matters for the product promise: after every detection has
 * been written through [ShieldStore], not a single raw secret substring exists in the stored
 * preferences.
 */
@RunWith(AndroidJUnit4::class)
class OnDeviceFirewallBenchmarkTest {

    private companion object {
        const val TAG = "CordonBench"
        const val MIN_OVERALL_RECALL = 0.95
        const val MAX_FALSE_POSITIVE_RATE = 0.05
    }

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private data class Measurement(
        val case: BenchmarkCase,
        val latencyMs: Double,
        val spans: List<RedactionSpan>,
        val sanitized: String,
    ) {
        val detected: Boolean get() = spans.any { it.masked }
        val categoryHit: Boolean get() = spans.any { it.masked && it.category == case.category }
    }

    @Test
    fun benchmarkDetectionEngineOnDevice() {
        ShieldStore.clearHistory(context)
        val level = ShieldStore.getProtectionLevel(context)

        // Warm up the regex/JIT paths so the first payload does not dominate the max latency.
        repeat(2) {
            FirewallBenchmarkCorpus.positives.take(10).forEach {
                LocalFirewallEngine.scrub(it.text, level)
            }
        }

        val positives = FirewallBenchmarkCorpus.positives.map { case ->
            val start = System.nanoTime()
            val (sanitized, spans) = LocalFirewallEngine.scrub(case.text, level)
            val latencyMs = (System.nanoTime() - start) / 1_000_000.0
            Measurement(case, latencyMs, spans.filter { it.masked }, sanitized)
        }

        val benignResults = FirewallBenchmarkCorpus.benign.map { text ->
            val start = System.nanoTime()
            val (_, spans) = LocalFirewallEngine.scrub(text, level)
            val latencyMs = (System.nanoTime() - start) / 1_000_000.0
            text to (latencyMs to spans.count { it.masked })
        }

        val detected = positives.count { it.detected }
        val overallRecall = detected.toDouble() / positives.size
        val flaggedBenign = benignResults.withIndex().filter { it.value.second.second > 0 }
        val falsePositiveRate = flaggedBenign.size.toDouble() / benignResults.size
        val latencies = positives.map { it.latencyMs }.sorted()
        val benignLatencies = benignResults.map { it.second.first }.sorted()
        val allLatencies = (latencies + benignLatencies).sorted()

        // ---- Zero-PII proof -----------------------------------------------------------------
        // Every detected span is written through the real history path, exactly as the service
        // does, then the stored preferences are scanned for the raw values.
        for (measurement in positives) {
            if (measurement.spans.isEmpty()) continue
            ShieldStore.recordBlockEvent(
                context = context,
                appName = "CordonBench",
                spans = measurement.spans,
                engineUsed = "Deterministic Rules",
            )
        }
        val storedStrings = ShieldStore.prefs(context).all.values
            .filterIsInstance<String>()
            .joinToString("\n")
        val rawSecrets = positives
            .flatMap { measurement -> measurement.spans.map { it.matchedText } }
            .filter { it.length >= 6 }
            .distinct()
        val leakedIntoStore = rawSecrets.filter { storedStrings.contains(it) }

        val sanitizerLeaks = positives.flatMap { measurement ->
            measurement.spans
                .filter { it.matchedText.length >= 6 && measurement.sanitized.contains(it.matchedText) }
                .map { "${measurement.case.id}:${it.category}" }
        }

        logReport(
            level = level,
            positiveCount = positives.size,
            detected = detected,
            overallRecall = overallRecall,
            benignCount = benignResults.size,
            flaggedBenignIndices = flaggedBenign.map { it.index },
            falsePositiveRate = falsePositiveRate,
            p50 = percentile(allLatencies, 0.50),
            p95 = percentile(allLatencies, 0.95),
            max = allLatencies.lastOrNull() ?: 0.0,
            positives = positives,
            storeEntries = ShieldStore.getHistory(context).size,
            leakedIntoStore = leakedIntoStore,
            sanitizerLeaks = sanitizerLeaks,
        )

        assertTrue(
            "overall recall too low: $detected/${positives.size}",
            overallRecall >= MIN_OVERALL_RECALL,
        )
        assertTrue(
            "false positive rate too high: ${flaggedBenign.map { it.index }}",
            falsePositiveRate <= MAX_FALSE_POSITIVE_RATE,
        )
        assertEquals("raw secret substrings found in ShieldStore", 0, leakedIntoStore.size)
        assertEquals("scrubbed output still contained a raw value", 0, sanitizerLeaks.size)
        assertTrue("history should record metadata", ShieldStore.getHistory(context).isNotEmpty())
    }

    private fun logReport(
        level: ProtectionLevel,
        positiveCount: Int,
        detected: Int,
        overallRecall: Double,
        benignCount: Int,
        flaggedBenignIndices: List<Int>,
        falsePositiveRate: Double,
        p50: Double,
        p95: Double,
        max: Double,
        positives: List<Measurement>,
        storeEntries: Int,
        leakedIntoStore: List<String>,
        sanitizerLeaks: List<String>,
    ) {
        Log.i(TAG, "==== Cordon on-device firewall benchmark ====")
        Log.i(TAG, "device=${Build.MODEL} api=${Build.VERSION.SDK_INT} abi=${Build.SUPPORTED_ABIS.firstOrNull()}")
        Log.i(TAG, "activeEngine=On-Device Rules (regex + heuristic + entropy) dial=${level.name}")
        Log.i(
            TAG,
            String.format(
                Locale.US,
                "overall recall=%.1f%% (%d/%d)",
                overallRecall * 100,
                detected,
                positiveCount,
            ),
        )
        Log.i(
            TAG,
            String.format(
                Locale.US,
                "false positive rate=%.1f%% (%d/%d)",
                falsePositiveRate * 100,
                flaggedBenignIndices.size,
                benignCount,
            ),
        )
        Log.i(TAG, String.format(Locale.US, "latency ms: p50=%.2f p95=%.2f max=%.2f", p50, p95, max))
        Log.i(TAG, "| Category | Cases | Recall |")
        Log.i(TAG, "| --- | --- | --- |")
        positives.groupBy { it.case.category }.toSortedMap().forEach { (category, cases) ->
            val hits = cases.count { it.categoryHit }
            Log.i(
                TAG,
                String.format(
                    Locale.US,
                    "| %s | %d | %.0f%% |",
                    category,
                    cases.size,
                    hits * 100.0 / cases.size,
                ),
            )
        }
        positives.filterNot { it.detected }.forEach {
            Log.w(TAG, "miss id=${it.case.id} category=${it.case.category}")
        }
        positives.filter { it.detected && !it.categoryHit }.forEach {
            Log.w(
                TAG,
                "categoryMismatch id=${it.case.id} expected=${it.case.category} " +
                    "got=${it.spans.joinToString(",") { span -> span.category }}",
            )
        }
        flaggedBenignIndices.forEach { index -> Log.w(TAG, "falsePositive benignIndex=$index") }
        Log.i(TAG, "zeroPii: storedEntries=$storeEntries rawSecretSubstringsInStore=${leakedIntoStore.size}")
        Log.i(TAG, "zeroPii: scrubbedOutputLeaks=${sanitizerLeaks.size}")
        Log.i(TAG, "==== end CordonBench ====")
    }

    private fun percentile(sorted: List<Double>, fraction: Double): Double {
        if (sorted.isEmpty()) return 0.0
        val index = ((sorted.size - 1) * fraction).roundToInt().coerceIn(0, sorted.size - 1)
        return sorted[index]
    }
}
