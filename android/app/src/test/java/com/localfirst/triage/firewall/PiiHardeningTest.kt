package com.localfirst.triage.firewall

import com.localfirst.triage.model.ProtectionLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Round 2 PII hardening: addresses, the card bundle (card + expiry + CVV) and Indian financial
 * identifiers. Every case here also exists in the web corpus, so the three engines stay in step.
 */
class PiiHardeningTest {

    private fun spansOf(text: String, level: ProtectionLevel = ProtectionLevel.MEDIUM) =
        LocalFirewallEngine.scrub(text, level).second.filter { it.masked }

    private fun categories(text: String, level: ProtectionLevel = ProtectionLevel.MEDIUM) =
        spansOf(text, level).map { it.category }.toSet()

    @Test
    fun `cue anchored Indian address keeps the cue and drops the fragments`() {
        val text = "address 143/A, 2nd Cross, Indiranagar, Bengaluru 560038"
        val (sanitized, spans) = LocalFirewallEngine.scrub(text)
        val addressSpans = spans.filter { it.category == "ADDRESS" }

        assertTrue("expected an ADDRESS span, got ${spans.map { it.category }}", addressSpans.isNotEmpty())
        assertTrue("the cue must stay readable: $sanitized", sanitized.startsWith("address "))
        assertFalse(sanitized.contains("143/A"))
        assertFalse(sanitized.contains("Indiranagar"))
        assertFalse(sanitized.contains("560038"))
    }

    @Test
    fun `cue anchored western address survives commas and a ZIP`() {
        val text = "ship to 742 Evergreen Terrace, Springfield, IL 62704"
        val sanitized = LocalFirewallEngine.scrub(text).first
        assertTrue(sanitized.startsWith("ship to "))
        assertFalse(sanitized.contains("Evergreen"))
        assertFalse(sanitized.contains("62704"))
    }

    @Test
    fun `standalone addresses need a door token plus a marker or PIN`() {
        val positives = listOf(
            "143/A Main Road, Koramangala 560034",
            "#42-B Sector 21, Gurugram 122016",
            "B-12 Green Layout, Pune 411045",
            "Flat 7 Shanti Nagar, Mysuru 570001",
            "742 Evergreen Terrace, Springfield, IL 62704",
        )
        val missed = positives.filter { !categories(it).contains("ADDRESS") }
        assertTrue("standalone addresses missed: $missed", missed.isEmpty())

        val negatives = listOf(
            "v2.1/A released today",
            "HTTP 404 from the gateway",
            "listening on port 8080",
            "invoice INV-2026-0042 is paid",
            "order 4111111111111112 shipped",
            "tracking 1234567890123456",
            "a1b2c3d4e5 build hash",
            "deployed 2026-11-22 at noon",
        )
        val falsePositives = negatives.filter { categories(it).contains("ADDRESS") }
        assertTrue("over-redacted as ADDRESS: $falsePositives", falsePositives.isEmpty())
    }

    @Test
    fun `card bundle captures number expiry and security code`() {
        val text = "pay with 4111 1111 1111 1111 exp 09/29 cvv 123"
        val found = categories(text)
        assertTrue("missing card: $found", found.contains("CREDIT_CARD"))
        assertTrue("missing expiry: $found", found.contains("CARD_EXPIRY"))
        assertTrue("missing cvv: $found", found.contains("CVV"))

        val sanitized = LocalFirewallEngine.scrub(text).first
        assertFalse(sanitized.contains("4111"))
        assertFalse(sanitized.contains("09/29"))
        assertFalse(sanitized.contains("123"))
    }

    @Test
    fun `rupay and labelled security code are detected`() {
        assertTrue(categories("rupay 6521567890123453").contains("CREDIT_CARD"))
        assertTrue(categories("security code 456").contains("CVV"))
        assertTrue(categories("valid thru 11/27").contains("CARD_EXPIRY"))
    }

    @Test
    fun `a bare three digit number is never a security code`() {
        val benign = listOf(
            "retry after 500 ms",
            "order 4111111111111112 needs 250 units",
            "the queue has 128 items",
            "invoice 0042 paid",
        )
        val falsePositives = benign.filter { categories(it).contains("CVV") }
        assertTrue("bare digits became CVV: $falsePositives", falsePositives.isEmpty())
    }

    @Test
    fun `upi pan and ifsc are named for what they are`() {
        assertEquals(setOf("UPI_ID"), categories("pay me at ravi.kumar@oksbi"))
        assertEquals(setOf("PAN_ID"), categories("pan ABCPE1234F on file"))
        assertEquals(setOf("IFSC"), categories("ifsc HDFC0001234"))

        // A normal mailbox with a mail TLD stays an email, not a UPI handle.
        val emailOnly = categories("write to user@ybl.com")
        assertTrue(emailOnly.contains("EMAIL"))
        assertFalse(emailOnly.contains("UPI_ID"))
    }

    @Test
    fun `a card being typed is never labelled a government id`() {
        // Exactly twelve digits is a valid Aadhaar on its own; the trigger policy debounces that
        // case (see SendInterceptionTest). A thirteenth digit makes it unambiguously a card.
        listOf("4111 1111 1111 1", "4111 1111 1111 11", "4111 1111 1111 1111 1").forEach { partial ->
            val found = categories("card $partial")
            assertFalse("partial '$partial' became GOV_ID", found.contains("GOV_ID"))
        }
        val full = categories("card 4111 1111 1111 1111")
        assertTrue("full card missing: $full", full.contains("CREDIT_CARD"))
        assertFalse("full card also became GOV_ID: $full", full.contains("GOV_ID"))
    }

    @Test
    fun `an address body ends at the next labelled field on a single line`() {
        val text = "address 143/A, 2nd Cross, Indiranagar, Bengaluru 560038 " +
            "card 4111 1111 1111 1111 exp 09/29 cvv 123 upi ravi.kumar@oksbi"
        val spans = spansOf(text)
        assertEquals(
            listOf("ADDRESS", "CREDIT_CARD", "CARD_EXPIRY", "CVV", "UPI_ID"),
            spans.map { it.category },
        )
        // The address must not swallow the card, which is what a longer body used to do.
        val address = spans.first { it.category == "ADDRESS" }
        assertEquals(
            "143/A, 2nd Cross, Indiranagar, Bengaluru 560038",
            text.substring(address.start, address.end),
        )
    }

    @Test
    fun `a line continued address stays one span but prose does not join it`() {
        val multiline = "Address: 143/A, 2nd Cross\nIndiranagar, Bengaluru 560038"
        val (sanitized, spans) = LocalFirewallEngine.scrub(multiline)
        val address = spans.single { it.category == "ADDRESS" }
        assertEquals(multiline.substringAfter("Address: "), multiline.substring(address.start, address.end))
        listOf("2nd Cross", "Indiranagar", "Bengaluru", "560038")
            .forEach { assertFalse("leaked $it in: $sanitized", sanitized.contains(it)) }

        // A lower-case prose line and a following "Field:" label both end the address.
        val prose = LocalFirewallEngine.scrub("address 143/A\nthe build failed").first
        assertTrue(prose.contains("the build failed"))

        val labelled = LocalFirewallEngine.scrub("Address: 143/A, 2nd Cross\nPAN: ABCPE1234F").first
        assertTrue(labelled.contains("PAN:"))
        assertFalse(labelled.contains("ABCPE1234F"))
    }

    @Test
    fun `a western street carries its city and ZIP into the span`() {
        val text = "742 Evergreen Terrace, Springfield 62704"
        val sanitized = LocalFirewallEngine.scrub(text).first
        assertFalse("city leaked: $sanitized", sanitized.contains("Springfield"))
        assertFalse("zip leaked: $sanitized", sanitized.contains("62704"))

        // Prose after the comma stays prose.
        val prose = LocalFirewallEngine.scrub("meet at 221 Baker Street at nine").first
        assertTrue(prose.contains("at nine"))
    }

    @Test
    fun `a pipe separated KYC line keeps its fields distinct`() {
        val text = "KYC: address 143/A, 2nd Cross, Indiranagar, Bengaluru 560038 | " +
            "card 4111 1111 1111 1111 exp 09/29 cvv 123 | " +
            "upi ravi.kumar@oksbi | pan ABCPE1234F | ifsc HDFC0001234"

        val found = categories(text)
        listOf("ADDRESS", "CREDIT_CARD", "CARD_EXPIRY", "CVV", "UPI_ID", "PAN_ID", "IFSC")
            .forEach { assertTrue("missing $it in $found", found.contains(it)) }

        val sanitized = LocalFirewallEngine.scrub(text).first
        listOf("143/A", "560038", "4111", "09/29", "ravi.kumar@oksbi", "ABCPE1234F", "HDFC0001234")
            .forEach { assertFalse("leaked $it in: $sanitized", sanitized.contains(it)) }
    }

    @Test
    fun `a multi PII KYC paste redacts every field in one pass`() {
        val text = listOf(
            "KYC for Ravi Kumar",
            "address 143/A, 2nd Cross, Indiranagar, Bengaluru 560038",
            "card 4111 1111 1111 1111 exp 09/29 cvv 123",
            "upi ravi.kumar@oksbi | pan ABCPE1234F | ifsc HDFC0001234",
        ).joinToString("\n")

        val sanitized = LocalFirewallEngine.scrub(text).first
        listOf("143/A", "560038", "4111", "09/29", "ravi.kumar@oksbi", "ABCPE1234F", "HDFC0001234")
            .forEach { assertFalse("leaked $it in: $sanitized", sanitized.contains(it)) }
    }

    @Test
    fun `detects secrets obfuscated with zero width chars soft hyphens and non breaking spaces`() {
        val zwsp = "\u200B"
        val zwnj = "\u200C"
        val zwj = "\u200D"
        val bom = "\uFEFF"
        val shy = "\u00AD"
        val nbsp = "\u00A0"

        val obfStripe = "sk_${zwsp}live_${shy}51NxMock${zwnj}Secret9988776655"
        val obfAws = "AKIA${zwj}IOSFODNN7${bom}EXAMPLE"
        val obfCard = "4111${nbsp}1111${zwsp}1111${shy}1111"
        val obfPan = "ABC${zwsp}PE12${shy}34F"
        val obfIfsc = "HDFC${zwnj}0${shy}001234"
        val obfUpi = "ravi.${zwsp}kumar@ok${shy}sbi"
        val obfAddr = "address${nbsp}143/A,${nbsp}2nd${zwsp} Cross, Indiranagar,${nbsp}Bengaluru 560${shy}038"

        val payload = listOf(
            "Keep prefix intact | key=$obfStripe | aws=$obfAws",
            "pay $obfCard exp${nbsp}09/${zwsp}29 cvv${nbsp}1${zwj}23",
            "pan $obfPan | ifsc $obfIfsc | upi $obfUpi",
            "$obfAddr | Keep suffix intact.",
        ).joinToString("\n")

        val (sanitized, spans) = LocalFirewallEngine.scrub(payload)
        val found = spans.filter { it.masked }.map { it.category }.toSet()

        listOf("API_KEY", "AWS_ACCESS_KEY", "CREDIT_CARD", "CARD_EXPIRY", "CVV", "PAN_ID", "IFSC", "UPI_ID", "ADDRESS")
            .forEach { assertTrue("missing obfuscated category $it in $found", found.contains(it)) }

        assertTrue(sanitized.contains("Keep prefix intact"))
        assertTrue(sanitized.contains("Keep suffix intact."))
        assertFalse(sanitized.contains("51NxMock"))
        assertFalse(sanitized.contains("IOSFODNN7"))
        assertFalse(sanitized.contains("4111"))
        assertFalse(sanitized.contains("09/${zwsp}29"))
        assertFalse(sanitized.contains("PE12"))
        assertFalse(sanitized.contains("001234"))
        assertFalse(sanitized.contains("oksbi"))
        assertFalse(sanitized.contains("Indiranagar"))
        assertTrue(LocalFirewallEngine.verifyZeroLeakage(sanitized, spans).verified)
    }

    @Test
    fun `scrubs 25k char paste with overlapping spans quickly and without index bounds errors`() {
        val awsKey = "AKIA" + "IOSFODNN7EXAMPLE"
        val filler = "2026-11-24T12:00:00Z INFO gateway request_id=req-99812 status=200 latency=4ms\n".repeat(320)
        val largePaste = buildString {
            append(filler)
            append("Customer Priya Sharma at address 143/A, 2nd Cross, Indiranagar, Bengaluru 560038 ")
            append("shared key $awsKey and card 4111\u00A01111\u200B1111 1111 exp 09/29 cvv 123.\n")
            append(filler.take(4000))
        }
        assertTrue("expected >25k chars, got ${largePaste.length}", largePaste.length > 25_000)

        val t0 = System.nanoTime()
        val (sanitized, spans) = LocalFirewallEngine.scanAndRedactLocal(
            largePaste,
            LocalFirewallEngine.ScanOptions(customTerms = listOf("Indiranagar", "Bengaluru 560038")),
        )
        val elapsedMs = (System.nanoTime() - t0) / 1_000_000L

        assertTrue("25k scrub took ${elapsedMs}ms", elapsedMs < 500L)
        assertFalse(sanitized.contains(awsKey))
        assertFalse(sanitized.contains("Indiranagar"))
        assertFalse(sanitized.contains("4111"))
        assertTrue(LocalFirewallEngine.verifyZeroLeakage(sanitized, spans).verified)
    }
}
