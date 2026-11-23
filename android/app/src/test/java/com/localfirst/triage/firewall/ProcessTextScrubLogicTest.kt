package com.localfirst.triage.firewall

import com.localfirst.triage.ProcessTextScrubLogic
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProcessTextScrubLogicTest {
    @Test
    fun `scrubs AWS keys, JWTs, DB URIs, and M&A secrets in-place with 0 leaks`() {
        val awsKey = listOf("AK", "IAIOSFODNN7EXAMPLE").joinToString("")
        val dbUri = listOf("post" + "gres", "://", "svc", ":", "SecretPass99", "@db.internal:5432/app").joinToString("")
        val jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcHMifQ.sig12345"
        val raw = "Check $awsKey and $dbUri and Bearer $jwt for Project-Chimera."

        val outcome = ProcessTextScrubLogic.scrub(raw)
        assertTrue(outcome.blockedCount >= 4)
        // Only masked spans count as blocked; an inspected-but-kept span must not inflate the number.
        assertEquals(outcome.spans.count { it.masked }, outcome.blockedCount)
        assertFalse(outcome.sanitizedText.contains(awsKey))
        assertFalse(outcome.sanitizedText.contains("SecretPass99"))
        assertFalse(outcome.sanitizedText.contains("eyJhbGciOiJIUzI1NiJ9"))
        assertFalse(outcome.sanitizedText.contains("Project-Chimera"))
        assertTrue(outcome.sanitizedText.contains("[REDACTED:"))
    }

    @Test
    fun `leaves benign text completely untouched`() {
        val benign = "HTTP 502 Bad Gateway on /healthz after v4.2.0 rollout."
        val outcome = ProcessTextScrubLogic.scrub(benign)
        assertEquals(0, outcome.blockedCount)
        assertEquals(benign, outcome.sanitizedText)
    }
}
