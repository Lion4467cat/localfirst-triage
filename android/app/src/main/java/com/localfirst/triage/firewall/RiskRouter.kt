package com.localfirst.triage.firewall

import com.localfirst.triage.model.DetectorSource
import com.localfirst.triage.model.RedactionSpan

enum class RiskTier {
    LOW,
    ELEVATED,
    HIGH,
    CRITICAL,
}

enum class RiskRoutingAction {
    LOCAL_RUNBOOK,
    HYBRID_GATED_REVIEW,
    CRITICAL_AIRGAP_LOCKDOWN,
}

data class RiskProfile(
    val score: Int,
    val tier: RiskTier,
    val action: RiskRoutingAction,
    val reasons: List<String>,
)

object RiskRouter {
    private val HARD_CREDENTIAL_CATEGORIES = setOf(
        "API_KEY",
        "AWS_ACCESS_KEY",
        "BEARER_OR_JWT",
        "JWT_TOKEN",
        "PEM_PRIVATE_KEY",
        "PRIVATE_KEY",
        "DB_CONNECTION_URI",
        "DB_URI",
        "DATABASE_URI",
        "PASSWORD",
        "PASSWORD_HINT",
        "NATURAL_SECRET",
        "FIREBASE_KEY",
        "STRIPE_KEY",
        "WEBHOOK_SECRET",
    )

    private val SENSITIVE_PII_PHI_CATEGORIES = setOf(
        "CONTEXTUAL_PHI",
        "MEDICAL_PHI",
        "CREDIT_CARD",
        "PHONE",
        "EMAIL",
        "US_SSN",
        "SSN",
        "PERSONAL_PII_LOCATION",
    )

    private val CORPORATE_CATEGORIES = setOf(
        "M_AND_A_SECRET",
        "ORG_TERM",
        "POLICY_TERM",
        "CUSTOM_TERM",
        "INTERNAL_CODENAME",
    )

    fun computeRiskProfile(
        spans: List<RedactionSpan>,
        isLocalRunbook: Boolean = false,
    ): RiskProfile {
        val activeSpans = spans.filter { it.masked }

        var credentialCount = 0
        var piiPhiCount = 0
        var corporateCount = 0
        var entropyCount = 0
        var nanoCaught = false

        for (span in activeSpans) {
            val cat = span.category.uppercase()
            when {
                cat in HARD_CREDENTIAL_CATEGORIES -> credentialCount++
                cat in SENSITIVE_PII_PHI_CATEGORIES -> piiPhiCount++
                cat in CORPORATE_CATEGORIES -> corporateCount++
                cat == "HIGH_ENTROPY_SECRET" -> entropyCount++
            }
            if (span.detector == DetectorSource.ENTROPY_SCANNER && cat != "HIGH_ENTROPY_SECRET") {
                entropyCount++
            }
            if (span.detector == DetectorSource.NANO_SEMANTIC_FIREWALL) {
                nanoCaught = true
            }
        }

        val credPts = minOf(60, credentialCount * 30)
        val piiPts = minOf(40, piiPhiCount * 20)
        val corpPts = minOf(30, corporateCount * 15)
        val entropyBonus = minOf(10, entropyCount * 5)
        val nanoBonus = if (nanoCaught) 10 else 0

        val score = minOf(100, credPts + piiPts + corpPts + entropyBonus + nanoBonus)
        val tier = when {
            score >= 80 -> RiskTier.CRITICAL
            score >= 55 -> RiskTier.HIGH
            score >= 25 -> RiskTier.ELEVATED
            else -> RiskTier.LOW
        }
        val action = when {
            isLocalRunbook -> RiskRoutingAction.LOCAL_RUNBOOK
            score >= 80 -> RiskRoutingAction.CRITICAL_AIRGAP_LOCKDOWN
            score >= 40 -> RiskRoutingAction.HYBRID_GATED_REVIEW
            else -> RiskRoutingAction.LOCAL_RUNBOOK
        }

        val reasons = buildList {
            if (credPts > 0) add("+$credPts Hard credentials (${credentialCount}x)")
            if (piiPts > 0) add("+$piiPts PII / Medical PHI (${piiPhiCount}x)")
            if (corpPts > 0) add("+$corpPts Corporate / M&A terms (${corporateCount}x)")
            if (entropyBonus > 0) add("+$entropyBonus High-entropy token density")
            if (nanoBonus > 0) add("+$nanoBonus Nano 4 semantic catch")
            if (isEmpty()) add("0 sensitive spans detected (low-risk baseline)")
        }

        return RiskProfile(
            score = score,
            tier = tier,
            action = action,
            reasons = reasons,
        )
    }
}
