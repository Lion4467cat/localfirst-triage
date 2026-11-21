package com.localfirst.triage.firewall

import com.localfirst.triage.data.RemoteConfigRepository
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalFirewallEngineTest {

    @Test
    fun redactsAllNineDeterministicSecretTypesAndChecksLuhn() {
        val input = listOf(
            "AWS=AKIAIOSFODNN7EXAMPLE",
            "Firebase=AIzaSyD-1234567890abcdefghijklmnopqrs",
            "Stripe=sk_live_51N9x8y7z6w5v4u3t2s1r",
            "DB=postgres://svc:mySecret99@db.internal:5432/prod",
            "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcHMifQ.sig12345",
            "SSN: 123-45-6789 | Email: alice@acme.org | Phone: +1 415-555-0199",
            "Card: 4532-0151-1283-0366 | Trace: 1795-2422-8142-4999",
            "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAtest\n-----END RSA PRIVATE KEY-----",
        ).joinToString("\n")

        val spans = LocalFirewallEngine.detectRegexSpans(input)
        val categories = spans.map { it.category }.toSet()

        assertTrue(categories.contains("AWS_ACCESS_KEY"))
        assertTrue(categories.contains("API_KEY"))
        assertTrue(categories.contains("DB_CONNECTION_URI"))
        assertTrue(categories.contains("BEARER_OR_JWT"))
        assertTrue(categories.contains("US_SSN"))
        assertTrue(categories.contains("EMAIL"))
        assertTrue(categories.contains("PHONE"))
        assertTrue(categories.contains("CREDIT_CARD"))
        assertTrue(categories.contains("PEM_PRIVATE_KEY"))

        val cardSpans = spans.filter { it.category == "CREDIT_CARD" }
        assertEquals(1, cardSpans.size)
        assertEquals("4532-0151-1283-0366", cardSpans[0].matchedText)
        assertTrue(LocalFirewallEngine.passesLuhnCheck("4532-0151-1283-0366"))
        assertFalse(LocalFirewallEngine.passesLuhnCheck("4532-0151-1283-0367"))
    }

    @Test
    fun redactsUrlEncodedJsonEscapedAndAdversarialPayloadsWithLinearTimeReDoSSafety() {
        val adversarial = listOf(
            """{"api_key": "xK9#mP2${'$'}vL5@nQ8!rT1wZ4", "client_secret": "s3cr3t_V9mK2pL8qR4tW7y"}""",
            "Encoded DB: postgresql%3A%2F%2Fadmin%3ASuperSecret99%40db.internal%3A5432%2Fprod",
            """Escaped DB: mongodb+srv:\/\/svc:MyMongoPass123@cluster0.example.net\/admin""",
            "-----BEGIN%20PGP%20PRIVATE%20KEY%20BLOCK-----%0AmQINBFtestKeyData%0A-----END%20PGP%20PRIVATE%20KEY%20BLOCK-----",
        ).joinToString("\n")

        val (sanitized, _) = LocalFirewallEngine.scanAndRedactLocal(adversarial)
        assertFalse(sanitized.contains("SuperSecret99"))
        assertFalse(sanitized.contains("MyMongoPass123"))
        assertFalse(sanitized.contains("xK9#mP2"))
        assertFalse(sanitized.contains("mQINBFtestKeyData"))

        val pathological = "4" + "-1".repeat(2500) + "X"
        val start = System.currentTimeMillis()
        val cc = LocalFirewallEngine.detectRegexSpans(pathological)
        val elapsed = System.currentTimeMillis() - start
        assertTrue(cc.isEmpty())
        assertTrue("ReDoS guard exceeded budget: ${elapsed}ms", elapsed < 500)
    }

    @Test
    fun appliesRemoteConfigEntropyThresholdAndBlockedTermsDynamically() {
        val payload = "api_key=aaabbbcccdddeeefffgg\nDeploy targeting Project-Apollo and Project-Valkyrie."

        val defaultScan = LocalFirewallEngine.scanAndRedactLocal(
            payload,
            LocalFirewallEngine.ScanOptions(entropyThreshold = 3.25),
        )
        assertTrue(defaultScan.first.contains("aaabbbcccdddeeefffgg"))

        val hardenedScan = LocalFirewallEngine.scanAndRedactLocal(
            payload,
            LocalFirewallEngine.ScanOptions(
                entropyThreshold = 2.5,
                remoteBlockedTerms = listOf("Project-Apollo", "Project-Valkyrie"),
            ),
        )
        assertFalse(hardenedScan.first.contains("aaabbbcccdddeeefffgg"))
        assertFalse(hardenedScan.first.contains("Project-Apollo"))
        assertFalse(hardenedScan.first.contains("Project-Valkyrie"))
        assertTrue(hardenedScan.first.contains("[REDACTED:HIGH_ENTROPY_SECRET_"))
        assertTrue(hardenedScan.first.contains("[REDACTED:REMOTE_POLICY_"))

        assertEquals(
            listOf("Project-Apollo", "Project-Valkyrie"),
            RemoteConfigRepository.parseEnterpriseBlockedTerms("""["Project-Apollo", "a", "Project-Valkyrie"]"""),
        )
    }

    @Test
    fun coversAllFourBuiltInDemoScenariosAndContextualHeuristics() {
        for (scenario in LocalFirewallEngine.DEMO_SCENARIOS) {
            val (sanitized, spans) = LocalFirewallEngine.scanAndRedactLocal(
                scenario.rawText,
                LocalFirewallEngine.ScanOptions(includeHeuristics = true),
            )
            assertTrue("Expected spans for ${scenario.id}", spans.isNotEmpty())
            val audit = LocalFirewallEngine.verifyZeroLeakage(sanitized, spans)
            assertTrue("Expected zero leakage for ${scenario.id}", audit.verified)
        }

        val p3Match = LocalFirewallEngine.matchLocalRunbook("ERR_CERT_DATE_INVALID on localhost:8443")
        assertNotNull(p3Match)
        assertEquals("RB_LOCAL_TLS_CERT", p3Match?.runbookIdOrNull())

        assertNull(LocalFirewallEngine.matchLocalRunbook("P0 incident with ERR_CERT_DATE_INVALID"))
    }

    private fun com.localfirst.triage.model.CustomRunbook.runbookIdOrNull(): String = id
}
