package com.localfirst.triage.firewall

import com.localfirst.triage.data.RemoteConfigRepository
import com.localfirst.triage.model.DetectorSource
import com.localfirst.triage.model.RedactionSpan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalFirewallEngineTest {

    @Test
    fun redactsAllNineDeterministicSecretTypesAndChecksLuhn() {
        val awsKey = listOf("AK", "IAIOSFODNN7EXAMPLE").joinToString("")
        val firebaseKey = listOf("AI", "zaSyD-1234567890abcdefghijklmnopqrs").joinToString("")
        val stripeKey = listOf("sk_", "live_51N9x8y7z6w5v4u3t2s1r").joinToString("")
        val pemStart = listOf("-----BEGIN ", "RSA PRIVATE KEY-----").joinToString("")
        val pemEnd = listOf("-----END ", "RSA PRIVATE KEY-----").joinToString("")
        val input = listOf(
            "AWS=$awsKey",
            "Firebase=$firebaseKey",
            "Stripe=$stripeKey",
            "DB=postgres://svc:mySecret99@db.internal:5432/prod",
            "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcHMifQ.sig12345",
            "SSN: 123-45-6789 | Email: alice@acme.org | Phone: +1 415-555-0199",
            "Card: 4532-0151-1283-0366 | Trace: 1795-2422-8142-4999",
            "$pemStart\nMIIEowIBAAKCAQEAtest\n$pemEnd",
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
        val pgpStart = listOf("-----BEGIN", "%20PGP%20", "PRIVATE%20KEY%20BLOCK-----").joinToString("")
        val pgpEnd = listOf("-----END", "%20PGP%20", "PRIVATE%20KEY%20BLOCK-----").joinToString("")
        val adversarial = listOf(
            """{"api_key": "xK9#mP2${'$'}vL5@nQ8!rT1wZ4", "client_secret": "s3cr3t_V9mK2pL8qR4tW7y"}""",
            "Encoded DB: postgresql%3A%2F%2Fadmin%3ASuperSecret99%40db.internal%3A5432%2Fprod",
            """Escaped DB: mongodb+srv:\/\/svc:MyMongoPass123@cluster0.example.net\/admin""",
            "$pgpStart%0AmQINBFtestKeyData%0A$pgpEnd",
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
        assertTrue("ReDoS guard exceeded 200ms budget: ${elapsed}ms", elapsed < 200)
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
    fun fixesRedactionTagLeakAndPluralApisKeyCue() {
        val raw = "my apis key is 544245453"
        val (localSanitized, _) = LocalFirewallEngine.scrub(raw, com.localfirst.triage.model.ProtectionLevel.MEDIUM)
        assertEquals("my apis key is [REDACTED:API_KEY_1]", localSanitized)

        val nanoSpans = LocalFirewallEngine.buildSemanticSpans(
            raw,
            listOf(
                com.localfirst.triage.model.SemanticExtractionItem(phrase = "my apis key is", category = "MY_APIS_KEY_IS"),
                com.localfirst.triage.model.SemanticExtractionItem(phrase = "544245453", category = "544245453"),
            ),
        )
        val (nanoSanitized, _) = LocalFirewallEngine.mergeAndRedactSpans(raw, nanoSpans)
        assertEquals("my apis key is [REDACTED:SENSITIVE_1]", nanoSanitized)
        assertFalse(nanoSanitized.contains("544245453"))
    }

    @Test
    fun coversAllFourBuiltInDemoScenariosSixExactRunbooksAndConstituentMergeTracking() {
        assertEquals(4, LocalFirewallEngine.DEMO_SCENARIOS.size)
        for (scenario in LocalFirewallEngine.DEMO_SCENARIOS) {
            val (sanitized, spans) = LocalFirewallEngine.scanAndRedactLocal(
                scenario.rawText,
                LocalFirewallEngine.ScanOptions(includeHeuristics = true),
            )
            assertTrue("Expected spans for ${scenario.id}", spans.isNotEmpty())
            val audit = LocalFirewallEngine.verifyZeroLeakage(sanitized, spans)
            assertTrue("Expected zero leakage for ${scenario.id}", audit.verified)
        }

        assertEquals(
            listOf(
                "RB_LOCAL_TLS_CERT",
                "RB_LOCAL_DEPENDENCY_CONFLICT",
                "RB_LOCAL_CORS_DEV",
                "RB_OAUTH_CLOCK_SKEW",
                "RB_PORT_IN_USE",
                "RB_OFFLINE_SW_CACHE",
            ),
            LocalFirewallEngine.DEFAULT_RUNBOOKS.map { it.id },
        )

        val p3Match = LocalFirewallEngine.matchLocalRunbook("ERR_CERT_DATE_INVALID on localhost:8443")
        assertNotNull(p3Match)
        assertEquals("RB_LOCAL_TLS_CERT", p3Match?.id)
        assertNull(LocalFirewallEngine.matchLocalRunbook("P0 incident with ERR_CERT_DATE_INVALID"))

        val rawOverlap = "Deal note: Project-Chimera acquisition target at \$42M valuation confirmed."
        val heur = RedactionSpan(
            start = 11,
            end = rawOverlap.length - 11,
            category = "M_AND_A_SECRET",
            detector = DetectorSource.HEURISTIC_GUARD,
            placeholder = "[REDACTED:M_AND_A_SECRET_1]",
            matchedText = "Project-Chimera acquisition target at \$42M valuation",
        )
        val nano = RedactionSpan(
            start = 11,
            end = 26,
            category = "M_AND_A_SECRET",
            detector = DetectorSource.NANO_SEMANTIC_FIREWALL,
            placeholder = "[REDACTED:M_AND_A_SECRET_NANO]",
            matchedText = "Project-Chimera",
        )
        val (mergedText, mergedSpans) = LocalFirewallEngine.mergeAndRedactSpans(rawOverlap, listOf(heur, nano))
        assertEquals(1, mergedSpans.size)
        assertEquals(DetectorSource.NANO_SEMANTIC_FIREWALL, mergedSpans[0].detector)
        assertTrue(mergedSpans[0].constituentTexts.contains("Project-Chimera"))
        assertTrue(mergedSpans[0].constituentTexts.contains("Project-Chimera acquisition target at \$42M valuation"))
        assertFalse(mergedText.contains("Project-Chimera"))
        assertFalse(mergedText.contains("\$42M valuation"))
    }
}