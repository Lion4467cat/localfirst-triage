package com.localfirst.triage.benchmark

import com.localfirst.triage.firewall.LocalFirewallEngine
import com.localfirst.triage.model.ProtectionLevel
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Host-side parity check for the shared corpus. The on-device benchmark measures the same corpus
 * on ARM; this keeps detection regressions visible without a phone attached.
 */
class CorpusRecallTest {

    @Test
    fun `shared corpus has at least sixty positives and thirty benign prompts`() {
        assertTrue("positives=${FirewallBenchmarkCorpus.positives.size}", FirewallBenchmarkCorpus.positives.size >= 60)
        assertTrue("benign=${FirewallBenchmarkCorpus.benign.size}", FirewallBenchmarkCorpus.benign.size >= 30)
    }

    @Test
    fun `every positive payload is detected at the medium dial`() {
        val misses = FirewallBenchmarkCorpus.positives.filter { case ->
            LocalFirewallEngine.scrub(case.text, ProtectionLevel.MEDIUM).second.none { it.masked }
        }
        assertTrue(
            "undetected payloads: " + misses.joinToString { "${it.id} (${it.category})" },
            misses.isEmpty(),
        )
    }

    @Test
    fun `false positive rate stays under five percent`() {
        val flagged = FirewallBenchmarkCorpus.benign.filter { text ->
            LocalFirewallEngine.scrub(text, ProtectionLevel.MEDIUM).second.any { it.masked }
        }
        val rate = flagged.size.toDouble() / FirewallBenchmarkCorpus.benign.size
        assertTrue("false positives ($flagged) rate=$rate", rate <= 0.05)
    }

    @Test
    fun `scrubbed output never contains the raw matched value`() {
        val leaks = ArrayList<String>()
        for (case in FirewallBenchmarkCorpus.positives) {
            val (sanitized, spans) = LocalFirewallEngine.scrub(case.text, ProtectionLevel.MEDIUM)
            for (span in spans.filter { it.masked }) {
                if (span.matchedText.length >= 6 && sanitized.contains(span.matchedText)) {
                    leaks.add("${case.id}:${span.category}")
                }
            }
        }
        assertTrue("raw values survived the scrub: $leaks", leaks.isEmpty())
    }
}
