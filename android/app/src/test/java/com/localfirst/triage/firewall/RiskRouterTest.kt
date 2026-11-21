package com.localfirst.triage.firewall

import com.localfirst.triage.model.DetectorSource
import com.localfirst.triage.model.ProtectionLevel
import com.localfirst.triage.model.RedactionSpan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RiskRouterTest {
    private fun span(
        category: String,
        detector: DetectorSource = DetectorSource.REGEX_FIREWALL,
        text: String = "secret",
    ) = RedactionSpan(
        start = 0,
        end = text.length,
        category = category,
        detector = detector,
        placeholder = "[REDACTED:${category}_1]",
        matchedText = text,
        masked = true,
    )

    @Test
    fun `returns LOW and LOCAL_RUNBOOK for empty spans`() {
        val profile = RiskRouter.computeRiskProfile(emptyList())
        assertEquals(0, profile.score)
        assertEquals(RiskTier.LOW, profile.tier)
        assertEquals(RiskRoutingAction.LOCAL_RUNBOOK, profile.action)
    }

    @Test
    fun `returns HIGH and HYBRID_GATED_REVIEW with Nano 4 semantic bonus`() {
        val profile = RiskRouter.computeRiskProfile(
            listOf(
                span("API_KEY", DetectorSource.REGEX_FIREWALL),
                span("CONTEXTUAL_PHI", DetectorSource.NANO_SEMANTIC_FIREWALL),
            ),
        )
        assertEquals(60, profile.score)
        assertEquals(RiskTier.HIGH, profile.tier)
        assertEquals(RiskRoutingAction.HYBRID_GATED_REVIEW, profile.action)
    }

    @Test
    fun `caps score at 100 and triggers CRITICAL_AIRGAP_LOCKDOWN`() {
        val profile = RiskRouter.computeRiskProfile(
            listOf(
                span("AWS_ACCESS_KEY"),
                span("BEARER_OR_JWT"),
                span("API_KEY"),
                span("MEDICAL_PHI", DetectorSource.NANO_SEMANTIC_FIREWALL),
                span("M_AND_A_SECRET", DetectorSource.HEURISTIC_GUARD),
            ),
        )
        assertEquals(100, profile.score)
        assertEquals(RiskTier.CRITICAL, profile.tier)
        assertEquals(RiskRoutingAction.CRITICAL_AIRGAP_LOCKDOWN, profile.action)
        assertTrue(profile.reasons.isNotEmpty())
    }

    @Test
    fun `HIGH protection level lowers CRITICAL_AIRGAP_LOCKDOWN threshold to 50`() {
        val spans = listOf(
            span("API_KEY", DetectorSource.REGEX_FIREWALL),
            span("PHONE", DetectorSource.REGEX_FIREWALL),
        )
        // 30 + 20 = 50 -> HYBRID_GATED_REVIEW in MEDIUM, CRITICAL_AIRGAP_LOCKDOWN in HIGH
        val mediumProfile = RiskRouter.computeRiskProfile(spans, protectionLevel = ProtectionLevel.MEDIUM)
        val highProfile = RiskRouter.computeRiskProfile(spans, protectionLevel = ProtectionLevel.HIGH)
        assertEquals(50, mediumProfile.score)
        assertEquals(RiskRoutingAction.HYBRID_GATED_REVIEW, mediumProfile.action)
        assertEquals(RiskRoutingAction.CRITICAL_AIRGAP_LOCKDOWN, highProfile.action)
    }
}
