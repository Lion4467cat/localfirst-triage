package com.localfirst.triage.firewall

import com.localfirst.triage.model.CustomRunbook
import com.localfirst.triage.model.DemoScenario
import com.localfirst.triage.model.DetectorSource
import com.localfirst.triage.model.ProtectionLevel
import com.localfirst.triage.model.RedactionSpan
import com.localfirst.triage.model.RuntimeConfigValues
import com.localfirst.triage.model.SemanticExtractionItem
import com.localfirst.triage.model.Severity
import com.localfirst.triage.model.ZeroLeakageAudit
import java.net.URLEncoder
import kotlin.math.ln

object LocalFirewallEngine {
    const val PURGED_PLACEHOLDER = "[PURGED_FROM_DISK_FOR_PRIVACY]"

    private val HAS_LOWER = Regex("""[a-z]""")
    private val HAS_UPPER = Regex("""[A-Z]""")
    private val HAS_DIGIT = Regex("""[0-9]""")
    private val HAS_SYMBOL = Regex("""[^A-Za-z0-9]""")
    private val HAS_SEPARATOR = Regex("""[_-]""")
    private val LOWER_ONLY = Regex("""^[a-z]+$""")
    private val HAS_ALNUM = Regex("""[A-Za-z0-9]""")
    private val SHORT_WORD = Regex("""^[A-Za-z]{1,6}$""")
    private val WORD_START = Regex("""^[A-Za-z0-9_]""")
    private val WORD_END = Regex("""[A-Za-z0-9_]$""")
    private val NON_DIGIT = Regex("""\D""")
    private val SEPARATOR = Regex("""[\s-]""")

    private data class RegexRule(
        val category: String,
        val detector: DetectorSource,
        val pattern: Regex,
        val captureGroup: Int? = null,
        val minLevel: ProtectionLevel = ProtectionLevel.LOW,
        val validator: ((String) -> Boolean)? = null,
    )

    private val TECHNICAL_ALLOWLIST = setOf(
        "pg_locks",
        "invalid_grant",
        "oauth2",
        "err_cert_date_invalid",
        "cert_has_expired",
        "econnrefused",
        "etimedout",
        "typeerror",
        "referenceerror",
        "http 500",
        "http 502",
        "http 503",
        "http 504",
        "http 429",
        "deadlock in pg_locks",
        "postgresql",
        "stripe",
        "kubernetes",
        "localhost",
        "127.0.0.1",
    )

    private val CARD_IIN_PREFIX_REGEX = Regex(
        """^(?:4\d{12}(?:\d{3})?(?:\d{3})?|5[1-5]\d{14}|2(?:2[2-9]\d{12}|[3-6]\d{13}|7[01]\d{12}|720\d{12})|3[47]\d{13}|6(?:011|5\d{2})\d{12}|(?:60|81|82)\d{14}|508\d{13})$""",
    )

    private val RAW_CREDENTIAL_GUARDS = listOf(
        Regex("""AKIA[0-9A-Z]{16}"""),
        Regex("""AIza[0-9A-Za-z_-]{35}"""),
        Regex("""-----BEGIN [A-Z ]*PRIVATE KEY-----"""),
    )

    private val CANONICAL_CATEGORIES = setOf(
        "API_KEY", "AWS_ACCESS_KEY", "AWS_SECRET_KEY", "SECRET", "PASSWORD", "BEARER_OR_JWT",
        "PRIVATE_KEY", "DB_URI", "CREDIT_CARD", "GOV_ID", "PHONE", "EMAIL",
        "ADDRESS", "PERSON", "ORG_TERM", "PHI", "M_AND_A_SECRET", "HIGH_ENTROPY",
        "IP_ADDRESS", "IBAN", "ACCOUNT_NUMBER", "POSTAL_CODE", "SENSITIVE",
        "UPI_ID", "PAN_ID", "IFSC", "CARD_EXPIRY", "CVV",
    )

    private val CATEGORY_SYNONYMS = mapOf(
        "KEY" to "API_KEY", "TOKEN" to "API_KEY", "CREDENTIAL" to "API_KEY", "APIKEY" to "API_KEY",
        "NAME" to "PERSON", "PERSON_PII" to "PERSON", "FIRSTNAME" to "PERSON", "LASTNAME" to "PERSON",
        "COMPANY" to "ORG_TERM", "ORG" to "ORG_TERM", "ORGANIZATION" to "ORG_TERM",
        "LOCATION" to "ADDRESS", "STREET" to "ADDRESS", "PERSONAL_PII_LOCATION" to "ADDRESS",
        "MEDICAL" to "PHI", "HEALTH" to "PHI", "CONTEXTUAL_PHI" to "PHI", "MEDICAL_PHI" to "PHI",
        "SSN" to "GOV_ID", "US_SSN" to "GOV_ID", "PAN" to "GOV_ID", "PASSPORT" to "GOV_ID", "AADHAAR" to "GOV_ID",
        "MOBILE" to "PHONE", "TEL" to "PHONE", "TELEPHONENUM" to "PHONE", "PHONENUMBER" to "PHONE",
        "IP" to "IP_ADDRESS", "IPV4" to "IP_ADDRESS", "IPV6" to "IP_ADDRESS",
        "ZIP" to "POSTAL_CODE", "ZIPCODE" to "POSTAL_CODE", "PINCODE" to "POSTAL_CODE",
        "PEM_PRIVATE_KEY" to "PRIVATE_KEY", "DB_CONNECTION_URI" to "DB_URI",
        "HIGH_ENTROPY_SECRET" to "HIGH_ENTROPY", "NATURAL_SECRET" to "SECRET",
        "FINANCIAL_ID" to "ACCOUNT_NUMBER", "CARD" to "CREDIT_CARD", "CREDITCARD" to "CREDIT_CARD",
    )

    fun normalizeRedactionCategory(rawType: String?): String {
        if (rawType.isNullOrBlank()) return "SENSITIVE"
        val cleaned = rawType.trim().uppercase()
            .replace(Regex("""[^A-Z0-9_]+"""), "_")
            .trim('_')
        if (cleaned.isEmpty()) return "SENSITIVE"
        if (cleaned in CANONICAL_CATEGORIES) return cleaned
        CATEGORY_SYNONYMS[cleaned]?.let { return it }
        if (cleaned.any { it.isDigit() } || cleaned.length > 24) return "SENSITIVE"
        return "SENSITIVE"
    }

    private val PASSWORD_STOPWORDS = setOf(
        "required", "invalid", "reset", "expired", "policy", "manager", "field",
        "hash", "missing", "incorrect", "protected", "strength", "prompt",
        "input", "change", "update", "placeholder", "string", "boolean", "hints",
    )

    private val NANO_CUE_PHRASE_REGEX = Regex(
        """^(?:my\s+)?(?:apis?\s*key|secret\s*key|access\s*key|auth\s*token|password|passcode|passphrase|pin|phone(?:\s+number)?|email|address|full\s+name|name|company)\s*(?:is|was|are|:|=)?$""",
        RegexOption.IGNORE_CASE,
    )

    fun passesIbanMod97(raw: String): Boolean {
        val cleaned = raw.replace(SEPARATOR, "").uppercase()
        if (!Regex("""^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$""").matches(cleaned)) return false
        val rearranged = cleaned.substring(4) + cleaned.substring(0, 4)
        var remainder = 0
        for (ch in rearranged) {
            val digits = if (ch in 'A'..'Z') (ch.code - 55).toString() else ch.toString()
            for (d in digits) {
                remainder = (remainder * 10 + (d.code - 48)) % 97
            }
        }
        return remainder == 1
    }

    private val DETERMINISTIC_REGEX_RULES: List<RegexRule> = listOf(
        RegexRule(
            category = "PEM_PRIVATE_KEY",
            detector = DetectorSource.REGEX_FIREWALL,
            pattern = Regex(
                """-----BEGIN(?:%20|\s)+(?:RSA(?:%20|\s)+|EC(?:%20|\s)+|DSA(?:%20|\s)+|OPENSSH(?:%20|\s)+|ENCRYPTED(?:%20|\s)+|PGP(?:%20|\s)+)?PRIVATE(?:%20|\s)+KEY(?:(?:%20|\s)+BLOCK)?-----[\s\S]*?-----END(?:%20|\s)+(?:RSA(?:%20|\s)+|EC(?:%20|\s)+|DSA(?:%20|\s)+|OPENSSH(?:%20|\s)+|ENCRYPTED(?:%20|\s)+|PGP(?:%20|\s)+)?PRIVATE(?:%20|\s)+KEY(?:(?:%20|\s)+BLOCK)?-----""",
                RegexOption.IGNORE_CASE,
            ),
        ),
        RegexRule(
            category = "DB_CONNECTION_URI",
            detector = DetectorSource.REGEX_FIREWALL,
            pattern = Regex(
                """\b(?:postgres(?:ql)?|mongodb(?:\+srv)?|mysql|redis|rediss|amqp)(?::\/\/|:\\\/\\\/|%3A%2F%2F)[^:\s/@"']+(?::|%3A)[^@\s/"']+(?:@|%40)[^\s"'<>\\]+""",
                RegexOption.IGNORE_CASE,
            ),
        ),
        RegexRule(
            category = "AWS_ACCESS_KEY",
            detector = DetectorSource.REGEX_FIREWALL,
            pattern = Regex("""\b(?:AKIA|ASIA|AIDA|AROA)[0-9A-Z]{16}\b"""),
        ),
        RegexRule(
            // The 40-char secret that follows AWS_SECRET_ACCESS_KEY= has no recognisable prefix,
            // so it is only identifiable by its assignment label. The optional quote after the
            // name covers JSON camelCase: "SecretAccessKey".
            category = "AWS_SECRET_KEY",
            detector = DetectorSource.REGEX_FIREWALL,
            pattern = Regex(
                """(?i)\b(?:aws[_-]?)?secret[_-]?access[_-]?key\b["']?\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])""",
            ),
        ),
        RegexRule(
            category = "API_KEY",
            detector = DetectorSource.REGEX_FIREWALL,
            pattern = Regex(
                """\b(?:AIza[0-9A-Za-z\-_]{20,}|(?:sk|pk|rk)_(?:live|test)_[0-9A-Za-z]{16,}|sk-(?:proj-|ant-)?[0-9A-Za-z\-_]{20,}|(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{22,}|xox[baprs]-[0-9A-Za-z\-]{10,}|glpat-[A-Za-z0-9_-]{15,}|hf_[A-Za-z0-9]{20,}|SK[0-9a-fA-F]{32}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{20,}|pypi-[A-Za-z0-9_-]{20,}|shp(?:at|ca|pa|ss)_[0-9a-fA-F]{20,}|ddapi_[A-Za-z0-9_-]{16,}|lin_api_[A-Za-z0-9]{20,}|sbp_[0-9a-fA-F]{20,}|glsa_[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{14}\.atlasv1\.[A-Za-z0-9_-]{20,}|PMAK-[0-9a-fA-F]{20,}-[0-9a-fA-F]{20,}|pul-[0-9a-fA-F]{20,}|pplx-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}|dop_v1_[0-9a-fA-F]{32,})\b""",
            ),
        ),
        RegexRule(
            category = "BEARER_OR_JWT",
            detector = DetectorSource.REGEX_FIREWALL,
            pattern = Regex(
                """(?:Authorization\\?["']?\s*(?::|%3A)\s*\\?["']?(?:Bearer|Basic)(?:\s+|%20)[A-Za-z0-9\-._~+/=]{12,}|(?:Bearer(?:\s+|%20))?eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)""",
                RegexOption.IGNORE_CASE,
            ),
        ),
        RegexRule(
            category = "CREDIT_CARD",
            detector = DetectorSource.REGEX_FIREWALL,
            // (?<![\d-]) rejects match starts inside a longer digit/separator run, so a
            // pathological "4-1-1-…" string costs one attempt instead of one per digit (ReDoS guard).
            pattern = Regex("""(?<![\d-])\b\d(?:[ -]?\d){12,18}\b"""),
            validator = { matched ->
                val digits = matched.replace(NON_DIGIT, "")
                digits.length in 13..19 &&
                    CARD_IIN_PREFIX_REGEX.matches(digits) &&
                    passesLuhnCheck(digits)
            },
        ),
        RegexRule(
            // UPI VPA. Listed before EMAIL so an NPCI handle is named for what it is; the trailing
            // lookahead keeps "user@ybl.com" an email.
            category = "UPI_ID",
            detector = DetectorSource.REGEX_FIREWALL,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """\b[A-Za-z0-9][A-Za-z0-9._-]{1,40}@(?:oksbi|okicici|okhdfcbank|okhdfc|okaxis|okbizaxis|ybl|ibl|axl|paytm|apl|upi|jupiteraxis|yapl|sliceaxis|fam|axisb|airtel|freecharge|ikwik|jio|waaxis|wahdfcbank|waicici|wasbi)(?!\.[A-Za-z])\b""",
                RegexOption.IGNORE_CASE,
            ),
            validator = { !it.startsWith(".") && !it.contains("..") },
        ),
        RegexRule(
            // Indian PAN: 5 letters (4th is the assessee type), 4 digits, 1 letter. Must run
            // before the GOV_ID 5-4-1 shape so a PAN is named for what it is.
            category = "PAN_ID",
            detector = DetectorSource.REGEX_FIREWALL,
            pattern = Regex("""\b[A-Z]{3}[PCHFATBLJG][A-Z](?!0000)\d{4}[A-Z]\b""", RegexOption.IGNORE_CASE),
        ),
        RegexRule(
            // Indian IFSC: 4 bank letters, a literal 0, then the branch code.
            category = "IFSC",
            detector = DetectorSource.REGEX_FIREWALL,
            pattern = Regex("""\b[A-Z]{4}0[A-Z0-9]{6}\b""", RegexOption.IGNORE_CASE),
        ),
        RegexRule(
            category = "CARD_EXPIRY",
            detector = DetectorSource.REGEX_FIREWALL,
            captureGroup = 1,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """\b(?:exp(?:iry|iration)?\s*(?:date)?|valid\s*(?:thru|through|until|till))\s*[:\-]?\s*((?:0?[1-9]|1[0-2])\s*[/\-]\s*(?:\d{2}|\d{4}))\b""",
                RegexOption.IGNORE_CASE,
            ),
            validator = { matched ->
                val parts = matched.split("/", "-")
                val month = parts.getOrNull(0)?.trim()?.toIntOrNull() ?: 0
                val year = parts.getOrNull(1)?.trim().orEmpty()
                val y = year.toIntOrNull() ?: -1
                month in 1..12 && if (year.length == 4) y in 2000..2099 else y in 0..99
            },
        ),
        RegexRule(
            // A security code is only meaningful next to its label; the bare form is handled by
            // the card-bundle pass, which also requires a nearby card.
            category = "CVV",
            detector = DetectorSource.REGEX_FIREWALL,
            captureGroup = 1,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """\b(?:cvv2?|cvc2?|cid|csc|security\s*code|card\s*verification(?:\s*(?:value|code))?)\b\s*(?:is|:|=|#|-)?\s*(\d{3,4})(?!\d)""",
                RegexOption.IGNORE_CASE,
            ),
        ),
        RegexRule(
            category = "US_SSN",
            detector = DetectorSource.REGEX_FIREWALL,
            pattern = Regex("""\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b"""),
        ),
        RegexRule(
            category = "GOV_ID",
            detector = DetectorSource.REGEX_FIREWALL,
            pattern = Regex("""\b[A-Z]{5}[0-9]{4}[A-Z]\b"""),
        ),
        RegexRule(
            category = "GOV_ID",
            detector = DetectorSource.REGEX_FIREWALL,
            captureGroup = 1,
            pattern = Regex(
                """\b(?:aadhaar|aadhar|uid|uidai)\b[^0-9\n]{0,20}(\d{4}[\s-]?\d{4}[\s-]?\d{4})\b""",
                RegexOption.IGNORE_CASE,
            ),
        ),
        RegexRule(
            category = "GOV_ID",
            detector = DetectorSource.REGEX_FIREWALL,
            // Aadhaar's 4-4-4 shape. The trailing lookahead stops a card from being read as a
            // 12-digit Aadhaar prefix while the user is still typing it.
            pattern = Regex("""\b\d{4}[\s-]\d{4}[\s-]\d{4}(?![\s-]\d)\b"""),
        ),
        RegexRule(
            category = "IBAN",
            detector = DetectorSource.REGEX_FIREWALL,
            pattern = Regex("""\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]){11,30}\b"""),
            validator = { passesIbanMod97(it) },
        ),
        RegexRule(
            category = "IBAN",
            detector = DetectorSource.REGEX_FIREWALL,
            captureGroup = 1,
            pattern = Regex(
                """\b(?:iban|bank|account|wire|swift|sepa)\b[^A-Z0-9\n]{0,25}([A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]){11,30})\b""",
                RegexOption.IGNORE_CASE,
            ),
        ),
        RegexRule(
            category = "PASSWORD",
            detector = DetectorSource.REGEX_FIREWALL,
            captureGroup = 1,
            pattern = Regex(
                """\b(?:password|passwd|passcode|passphrase|pwd|login\s+pass)\s*(?:is|was|are|[:=]|->)?\s*["']?([^\s"',;\[\]\u0000*]{6,64})["']?""",
                RegexOption.IGNORE_CASE,
            ),
            validator = {
                !it.contains("[REDACTED:") &&
                    !it.contains('\u0000') &&
                    it.lowercase() !in PASSWORD_STOPWORDS
            },
        ),
        RegexRule(
            category = "IP_ADDRESS",
            detector = DetectorSource.REGEX_FIREWALL,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """(?<![vV\d.])\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b(?![.\d])""",
            ),
            validator = { it != "127.0.0.1" && it != "0.0.0.0" && it != "255.255.255.255" },
        ),
        RegexRule(
            category = "IP_ADDRESS",
            detector = DetectorSource.REGEX_FIREWALL,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """(?<![:\w])(?:(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4})(?![:\w])""",
            ),
            validator = { it.length >= 6 && it.count { ch -> ch == ':' } >= 2 },
        ),
        RegexRule(
            category = "CREDIT_CARD",
            detector = DetectorSource.REGEX_FIREWALL,
            captureGroup = 1,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """\b(?:credit\s*card|debit\s*card|card\s*(?:number|no\.?|#)|cc\s*[:#])\b[^0-9\n]{0,30}(\d(?:[ -]?\d){12,18})\b""",
                RegexOption.IGNORE_CASE,
            ),
        ),
        RegexRule(
            category = "ACCOUNT_NUMBER",
            detector = DetectorSource.REGEX_FIREWALL,
            captureGroup = 1,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """\b(?:account\s*(?:number|no\.?|#)|acct\s*(?:number|no\.?|#)|bank\s*account|routing\s*(?:number|no\.?|#))\b[^A-Za-z0-9\n]{0,25}([A-Z0-9][A-Z0-9-]{5,19})\b""",
                RegexOption.IGNORE_CASE,
            ),
            validator = { it.count { ch -> ch.isDigit() } >= 4 },
        ),
        RegexRule(
            category = "EMAIL",
            detector = DetectorSource.REGEX_FIREWALL,
            minLevel = ProtectionLevel.MEDIUM,
            // Lookbehind keeps the engine from restarting inside a long hyphen/dot run,
            // which made this pattern quadratic on adversarial input (ReDoS guard).
            pattern = Regex("""(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"""),
        ),
        RegexRule(
            category = "PHONE",
            detector = DetectorSource.REGEX_FIREWALL,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """(?<!\d[.-])(?:\+\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}|\(\d{3}\)\s*\d{3}[-.\s]\d{4}|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b)(?!\s*T\d{2}:)""",
            ),
            validator = {
                if (Regex("""^\d{4}[-.]\d{2}[-.]\d{2}$""").matches(it)) return@RegexRule false
                if (Regex("""^\d{4}[-.]\d{4}$""").matches(it)) return@RegexRule false
                val digits = it.count { ch -> ch.isDigit() }
                digits in 7..15
            },
        ),
        RegexRule(
            category = "PHONE",
            detector = DetectorSource.REGEX_FIREWALL,
            captureGroup = 1,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """\b(?:phone|mobile|cell|call|whatsapp|contact|number|tel|fax|ext|ph)\b[^0-9\n]{0,25}((?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[-.\s]?\d{4}(?:[-.\s]?\d{2,4})?)\b""",
                RegexOption.IGNORE_CASE,
            ),
            validator = {
                if (Regex("""^\d{4}[-.]\d{2}[-.]\d{2}$""").matches(it)) return@RegexRule false
                // "invoice number INV-2026-0042" is an identifier, not a line. A bare NNNN-NNNN
                // is never a dialable number; the space form (Hong Kong's 2345 6789) still is.
                if (Regex("""^\d{4}[-.]\d{4}$""").matches(it)) return@RegexRule false
                val digits = it.count { ch -> ch.isDigit() }
                digits in 7..15
            },
        ),
        RegexRule(
            category = "API_KEY",
            detector = DetectorSource.REGEX_FIREWALL,
            captureGroup = 1,
            pattern = Regex(
                """\b(?:(?:apis?\s*key|apikey|secret\s+key|access\s+key|auth\s+token|bearer\s+token|private\s+token|client\s+secret)(?:\s+(?:is|was|are))?\s*(?:[:=]|->)?|(?:api_key)\s+(?:is|was|are|->))\s*([^\s"',;\[\]\u0000]{6,})""",
                RegexOption.IGNORE_CASE,
            ),
            validator = { !it.contains("[REDACTED:") && !it.contains('\u0000') },
        ),
    )

    private val ADDRESS_INDICATOR_REGEX = Regex(
        """\b(?:\d{1,5}\s+[A-Za-z]|\d{5,6}\b|road|rd|street|st|ave|avenue|lane|ln|layout|nagar|sector|cross|main|block|apt|flat|floor)\b""",
        RegexOption.IGNORE_CASE,
    )

    // A door/plot/block identifier. The leading lookbehind stops the match starting inside a
    // version string ("v2.1/A") or an identifier ("INV-2026-0042").
    private val ADDRESS_DOOR_REGEX = Regex(
        """(?<![\w.])(?:\d{1,5}[A-Za-z]?[/-][A-Za-z0-9]{1,4}|#\s?\d{1,5}[A-Za-z]?|[A-Z]-\d{1,4}|(?:plot|flat|door|house)(?!\s*(?:no\.?|number|#))\s*[A-Z]?\d{1,5}[A-Za-z]?|(?:block|unit|apt|apartment)\s*(?:no\.?|#)?\s*[A-Z]?\d{1,5}[A-Za-z]?)(?![\w/])""",
        RegexOption.IGNORE_CASE,
    )

    private val ADDRESS_LOCALITY_REGEX = Regex(
        """\b(?:main|cross|layout|nagar|colony|phase|sector|block|enclave|extension|marg|gali|street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|way|highway|hwy\.?|parkway|pkwy\.?|court|ct\.?|place|terrace|apartments?|flats?|residency|vihar|pura|bagh|chowk)\b""",
        RegexOption.IGNORE_CASE,
    )

    private val ADDRESS_LOCALITY_AT_END = Regex(
        """\b(?:main|cross|layout|nagar|colony|phase|sector|block|enclave|extension|marg|gali|street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|way|highway|hwy\.?|parkway|pkwy\.?|court|ct\.?|place|terrace|apartments?|flats?|residency|vihar|pura|bagh|chowk)\s*\z""",
        RegexOption.IGNORE_CASE,
    )

    private val ADDRESS_PIN_AT_END = Regex("""(?:\b\d{6}|\b\d{5}(?:-\d{4})?)\s*\z""")

    private fun looksLikeAddressBody(body: String): Boolean {
        val text = body.trim()
        if (!HAS_DIGIT.containsMatchIn(text)) return false
        if (ADDRESS_DOOR_REGEX.containsMatchIn(text)) return true
        if (!ADDRESS_LOCALITY_REGEX.containsMatchIn(text)) return false
        // "address 12 main street" has no comma but is unambiguous: a number opens the body.
        if (Regex("""^\s*(?:#\s*)?\d{1,5}[A-Za-z]?(?![\w.])""").containsMatchIn(text)) return true
        return ADDRESS_PIN_AT_END.containsMatchIn(text) || text.contains(",")
    }

    private fun looksLikeStandaloneAddress(body: String): Boolean {
        val text = body.trim()
        if (!HAS_DIGIT.containsMatchIn(text)) return false
        // A year-serial pair ("2026-0042") or a date ("2026-11-22") is an identifier, not a door number.
        if (Regex("""^(?:\d{4}-\d{4}|\d{4}-\d{2}-\d{2})\b""").containsMatchIn(text)) return false
        if (ADDRESS_PIN_AT_END.containsMatchIn(text)) return true
        if (!ADDRESS_LOCALITY_REGEX.containsMatchIn(text)) return false
        if (text.contains(",")) return true
        // No comma, no PIN: the street marker has to close the span, so "7 main street cafe"
        // stays a sentence and "742 Evergreen Terrace" stays an address.
        return ADDRESS_LOCALITY_AT_END.containsMatchIn(text) &&
            Regex("""^\s*(?:\d{1,5}[A-Za-z]?[/-]|#)""").containsMatchIn(text)
    }

    private val ORG_IDIOM_BLOCKLIST = setOf(
        "progress", "production", "tech", "software", "silence", "general",
        "home", "night", "remote", "shift", "me", "you", "us", "now", "free", "fine", "well", "scale",
    )

    private val NANO_STOPWORDS = setOf(
        "the", "and", "for", "with", "this", "that", "from", "have", "will", "can",
        "please", "help", "later", "tomorrow", "progress", "production", "scale",
        "localhost", "you", "are", "was", "were", "not", "but", "all", "any",
        "how", "who", "what", "when", "where", "why",
    )

    /**
     * Words that follow "I am", "this is" or "call me" far more often than a real name does.
     * The weak cues only fire on a capitalised token outside this set, which is what keeps
     * "i am ready", "i am testing" and "this is fine" out of the PERSON bucket.
     */
    private val NAME_STOPWORDS = setOf(
        "ready", "testing", "test", "done", "here", "there", "going", "working", "fine", "good",
        "great", "bad", "ok", "okay", "sure", "sorry", "busy", "happy", "tired", "new", "back",
        "out", "in", "on", "up", "not", "no", "yes", "still", "also", "just", "very", "really",
        "the", "a", "an", "this", "that", "it", "he", "she", "they", "we", "you", "i",
        "afraid", "glad", "sad", "angry", "late", "early", "free", "available", "online",
        "offline", "using", "trying", "looking", "writing", "reading", "learning", "building",
        "running", "waiting", "checking", "asking", "curious", "confused", "stuck", "blocked",
        "hungry", "sleepy", "wrong", "correct", "right", "important", "possible", "clear",
        "unclear", "awesome", "amazing", "terrible", "broken", "fixed", "live", "dead",
        "production", "staging", "development", "deploying", "merging", "pushing", "reviewing",
        "updating", "migrating", "debugging", "coding", "shipping", "releasing", "investigating",
        "monitoring", "restarting", "responding", "reporting", "sending", "joining", "leaving",
        "finished", "complete", "completed", "starting", "stopping", "installing",
    )

    /** Explicit name cues ("my name is", "name:", "i am called") never need the capital gate. */
    private fun looksLikePersonName(m: String): Boolean {
        val text = m.trim()
        if (text.isEmpty()) return false
        val head = text.substringBefore(' ').lowercase()
        return head !in NAME_STOPWORDS
    }

    /** Weak cues ("i am", "call me", "this is") need a capitalised first token to fire. */
    private fun looksLikeWeakPersonName(m: String): Boolean {
        val text = m.trim()
        val first = text.firstOrNull() ?: return false
        if (!first.isUpperCase()) return false
        return looksLikePersonName(text)
    }

    private val CONTEXTUAL_HEURISTIC_RULES: List<RegexRule> = listOf(
        RegexRule(
            category = "PERSON",
            detector = DetectorSource.HEURISTIC_GUARD,
            captureGroup = 1,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """\b(?:my\s+name\s+is|i\s+am\s+called|patient\s+name(?:\s+is)?|customer\s+name(?:\s+is)?|full\s+name(?:\s+is)?|name\s*[:=])\s+([A-Za-z][A-Za-z'-]{1,24}(?:\s+(?!(?:and|is|was|from|at|in|who|with|but|so|to|for|on|please|can|will|working|living)\b)[A-Za-z][A-Za-z'-]{1,24}){0,2})""",
                RegexOption.IGNORE_CASE,
            ),
        ),
        RegexRule(
            // Weak self-introduction cues. The name must start with a capital, so "i am ready"
            // never reaches the validator, and the stopword list catches "I am Testing the build".
            category = "PERSON",
            detector = DetectorSource.HEURISTIC_GUARD,
            captureGroup = 1,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """\b(?i:(?:i\s+am|i'm|call\s+me|this\s+is))\s+([A-Z][A-Za-z'-]{1,24}(?:\s+[A-Z][A-Za-z'-]{1,24}){0,2})""",
            ),
            validator = { looksLikeWeakPersonName(it) },
        ),
        RegexRule(
            category = "ORG_TERM",
            detector = DetectorSource.HEURISTIC_GUARD,
            captureGroup = 1,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """\b(?:i\s+work\s+(?:in|at|for)|working\s+(?:at|for)|employed\s+(?:at|by)|my\s+company\s+is)\s+(?!(?:a|an|the|my|our|this|that|progress|production|tech|software|silence|general|home|night|remote|shift|me|you|us|now|free|fine|well|scale)\b)([A-Za-z0-9&._-]{2,28}(?:\s+(?:company|corp|corporation|inc|ltd|pvt|bank|insurance|technologies|tech|labs|group))?)""",
                RegexOption.IGNORE_CASE,
            ),
            validator = { it.trim().lowercase() !in ORG_IDIOM_BLOCKLIST },
        ),
        RegexRule(
            category = "ADDRESS",
            detector = DetectorSource.HEURISTIC_GUARD,
            captureGroup = 1,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """\b(?:my\s+address\s+is|home\s+address(?:\s+is)?|shipping\s+address(?:\s+is)?|address\s*[:=]|residing\s+at|lives?\s+at)\s+((?:(?!\s+(?:and\s+(?:my|i|the|please|can|will|help)\b|my\s+(?:phone|email|name|api)\b|please\b|can\s+you\b))[^.\n;!?\u0000\[\]]){4,120})""",
                RegexOption.IGNORE_CASE,
            ),
        ),
        RegexRule(
            category = "ADDRESS",
            detector = DetectorSource.HEURISTIC_GUARD,
            captureGroup = 1,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """\blive(?:s|d)?\s+(?:at|in|near)\s+((?:(?!\s+(?:and\s+(?:my|i|the|please|can|will|help)\b|my\s+(?:phone|email|name|api)\b|please\b|can\s+you\b))[^.\n;!?\u0000\[\]]){4,120})""",
                RegexOption.IGNORE_CASE,
            ),
            validator = { ADDRESS_INDICATOR_REGEX.containsMatchIn(it) },
        ),
        RegexRule(
            // Cue-anchored address. The cue stays outside the span so the cloud model still knows
            // what the placeholder means. A newline continues the address only when the next line
            // still looks like one (a digit or a comma); a blank line, a lower-case prose line or a
            // "Field:" label ends it, so "address 143/A\n2nd Cross, Bengaluru 560038" is one span
            // while "address 143/A\nthe build failed" is not.
            category = "ADDRESS",
            detector = DetectorSource.HEURISTIC_GUARD,
            captureGroup = 1,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """\b(?:address|addr|house\s*(?:no\.?|number)|flat\s*(?:no\.?|number)|door\s*(?:no\.?|number)|plot\s*(?:no\.?|number)|residing\s+at|resides?\s+at|shipping\s+(?:to|address)|deliver(?:y)?\s+to|lives?\s+at|located\s+at)\b\s*(?:is|was|:|=|-)?\s*((?=[^\n]{0,160}?\d)(?:(?!\s+(?:and|but)\s+(?:my|the|i|we|please|call|email|phone|contact)\b)[^\[\]\u0000]){4,160}?)(?=\s*(?:[;|!?](?:\s|\z)|\n\s*\n|\n\s*[A-Za-z][A-Za-z ]{1,18}[:=]|\n(?!\s*[^\n]{0,60}(?:\d|,))|\z|\.(?=\s+[A-Z]|\s*\z)|(?:card|upi|pan|ifsc|cvv|cvc|cid|csc|exp|expiry|account|acct|iban|vpa)\b))""",
                RegexOption.IGNORE_CASE,
            ),
            validator = { looksLikeAddressBody(it) },
        ),
        RegexRule(
            // Standalone address: no cue, so a door token plus a locality marker or a terminal
            // PIN/ZIP is required. A version string like v2.1/A never reaches this point.
            category = "ADDRESS",
            detector = DetectorSource.HEURISTIC_GUARD,
            captureGroup = 1,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """(?<![\w.])((?:\d{1,5}[A-Za-z]?[/-][A-Za-z0-9]{1,4}|#\s?\d{1,5}[A-Za-z]?|[A-Z]-\d{1,4}|(?:plot|flat|door|house)(?!\s*(?:no\.?|number|#))\s*[A-Z]?\d{1,5}[A-Za-z]?|(?:block|unit|apt|apartment|suite)\s*(?:no\.?|#)?\s*[A-Z]?\d{1,5}[A-Za-z]?)(?:(?![.;!?](?:\s|\z))[^\n\[\]\u0000]){0,80}?)(?=\s*(?:[;|!?](?:\s|\z)|\n|\z|\.(?=\s+[A-Z]|\s*\z)|(?:card|upi|pan|ifsc|cvv|cvc|cid|csc|exp|expiry|account|acct|iban|vpa)\b))""",
                RegexOption.IGNORE_CASE,
            ),
            validator = { looksLikeStandaloneAddress(it) },
        ),
        RegexRule(
            // Secondary address line: "Apt 4B", "Suite 200", "Flat 302". Unambiguous unit words
            // only, so "unit 5 failed" in a test log stays prose.
            category = "ADDRESS",
            detector = DetectorSource.HEURISTIC_GUARD,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """(?<![\w.])((?:apt|apartment|suite|ste|flat)\.?\s*[A-Z]?\d{1,5}[A-Za-z]?(?:\s*[,·]\s*[A-Za-z0-9 .'-]{2,30})?)""",
                RegexOption.IGNORE_CASE,
            ),
        ),
        RegexRule(
            // KYC forms sign off with a name after "Signature:"; without this the block's last
            // line survives while the address above it is redacted.
            category = "PERSON",
            detector = DetectorSource.HEURISTIC_GUARD,
            captureGroup = 1,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """\b(?i:(?:signature|signed\s+by|authorised\s+signatory|authorized\s+signatory))\s*[:=]?\s*([A-Z][A-Za-z.'-]{1,24}(?:\s+[A-Z][A-Za-z.'-]{1,24}){0,3})""",
            ),
            validator = { looksLikePersonName(it) },
        ),
        RegexRule(
            category = "POSTAL_CODE",
            detector = DetectorSource.HEURISTIC_GUARD,
            captureGroup = 1,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """\b(?:zip|postal|post\s*code|postcode|pin\s*code|pincode)\s*(?:code)?\s*(?:is|[:=])?\s*([A-Z0-9][A-Z0-9\s-]{3,9})\b""",
                RegexOption.IGNORE_CASE,
            ),
            validator = { it.count { ch -> ch.isDigit() } >= 2 },
        ),
        RegexRule(
            category = "POSTAL_CODE",
            detector = DetectorSource.HEURISTIC_GUARD,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex("""\b(?:[A-Z]{2}\s+\d{5}(?:-\d{4})?|\d{5}-\d{4})\b"""),
        ),
        RegexRule(
            // Standalone Western street. The trailing group carries the city and ZIP that follow
            // the street word, but only when a 5/6-digit postal code closes them, so prose after
            // the comma ("221 Baker Street, and then we left") stays prose.
            category = "ADDRESS",
            detector = DetectorSource.HEURISTIC_GUARD,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """\b\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9.'-]{2,25}(?:\s+[A-Za-z0-9.'-]{2,25}){0,3}\s+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?|Way|Highway|Hwy\.?|Parkway|Pkwy\.?|Court|Ct\.?|Place|Pl\.?|Circle|Cir\.?|Terrace|Ter\.?|Trail|Trl\.?|Square|Sq\.?|Cross|Main|Nagar|Layout|Sector)\b(?:,\s*[A-Za-z0-9 .,'-]{1,40}?\d{5,6}(?:-\d{4})?)?""",
                RegexOption.IGNORE_CASE,
            ),
        ),
        RegexRule(
            category = "ADDRESS",
            detector = DetectorSource.HEURISTIC_GUARD,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """\b(?:[NSEW]\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\s+(?:Broadway|Highway|Parkway|Boulevard|Avenue|Turnpike|Expressway)\b""",
            ),
        ),
        RegexRule(
            category = "CONTEXTUAL_PHI",
            detector = DetectorSource.HEURISTIC_GUARD,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """\b(?:(?:admitted to|discharged from|diagnosed with|treated at|hospitalized at|undergoing)\s+[^.\n;)\[\]\u0000]{3,70}|(?:patient|daughter|son|wife|husband|mother|father)\b[^.\n;\[\]\u0000]{0,55}\b(?:ICU|ER|NICU|ward|hospital|clinic|chemo|chemotherapy|surgery|seizure|oncology|cardiology|biopsy|MRN|prescription)\b[^.\n;)\[\]\u0000]{0,40}\)?|(?:MRN|DOB|diagnosis)\s*[:#]\s*[^\n,;\[\]\u0000]+)""",
                RegexOption.IGNORE_CASE,
            ),
        ),
        RegexRule(
            category = "M_AND_A_SECRET",
            detector = DetectorSource.HEURISTIC_GUARD,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """(?:\$\d+(?:\.\d+)?\s?(?:[MBK]|million|billion)\s+(?:valuation|offer|deal|acquisition|buyout|term sheet|round)|\bProject-[A-Za-z0-9_-]{2,}\b|\b(?:acquisition target|merger with|undisclosed bid|term sheet)\b)""",
                RegexOption.IGNORE_CASE,
            ),
        ),
        RegexRule(
            category = "NATURAL_SECRET",
            detector = DetectorSource.HEURISTIC_GUARD,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """\b(?:(?:log\s*in|sign\s*in|unlock|authenticate)\s+using\s+(?:[^.\n'"\[\]\u0000]|'[A-Za-z]){4,80}|(?:password|passcode|passphrase|pin|credentials?)\s+(?:is|was|are|:)\s+(?:[^.\n'"\[\]\u0000]|'[A-Za-z]){3,80}|(?:admin|root|prod)\s+(?:password|passphrase)\s*[:=]\s*[^\s,;\[\]\u0000]+)""",
                RegexOption.IGNORE_CASE,
            ),
        ),
        RegexRule(
            category = "PERSONAL_PII_LOCATION",
            detector = DetectorSource.HEURISTIC_GUARD,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """(?:\b(?:lives?\s+(?:near|at|on|in)|home\s+address|resides?\s+at)\s+[A-Z0-9][^.\n;!?\)\[\]\u0000]{3,60}|\b(?:VP|CEO|CFO|CTO|Director|Customer|Client|Patient)\s+(?:of\s+[A-Za-z]+\s+)?\([A-Z][a-z]+\s+[A-Z][a-z]+[^)\n\[\]\u0000]{0,60}\))""",
            ),
            validator = { !Regex("""^lives?\s+""", RegexOption.IGNORE_CASE).containsMatchIn(it) || ADDRESS_INDICATOR_REGEX.containsMatchIn(it) },
        ),
    )

    private val ENTROPY_ASSIGNMENT_REGEX = Regex(
        """\b(?:api[_-]?key|x[_-]?api[_-]?key|secret|token|access[_-]?token|refresh[_-]?token|session[_-]?token|id[_-]?token|password|passwd|pwd|client[_-]?secret|signing[_-]?key|webhook[_-]?secret|private[_-]?key|auth[_-]?secret)\\?["']?\s*(?:[:=]|%3D)\s*\\?["']?([^\s"',;\[\]\\/\u0000]{16,})\\?["']?""",
        RegexOption.IGNORE_CASE,
    )

    val DEMO_SCENARIOS: List<DemoScenario> = listOf(
        DemoScenario(
            id = "scenario-p0-semantic-leak",
            title = "P0: Semantic PHI + Natural Secret + OAuth Trace",
            subtitle = "Proves Nano 4 + Regex catches clinical PHI, password hints, JWT & Firebase key",
            expectedSeverity = Severity.P0,
            rawText = listOf(
                "URGENT P0 Outage in checkout-gateway after v4.8.2 deploy.",
                "Customer John's daughter (the one admitted to Manipal ICU Floor 3 after Tuesday's seizure) had her billing profile exposed.",
                "Also the on-call engineer pasted: 'admin told me to log in using his dog's name followed by 2026exclamation' in Slack.",
                "Raw trace: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJvcHMifQ.sig12345",
                listOf("Leaked Firebase key: ", listOf("AI", "zaSyD-1234567890abcdefghijklmnopqrs").joinToString(""), " | Contact: ops-lead@acme-health.org | Phone: +91 99000 54954").joinToString(""),
                "Internal codename Project-Chimera acquisition target at $42M valuation is also in the stack trace.",
            ).joinToString("\n"),
        ),
        DemoScenario(
            id = "scenario-p3-local-runbook",
            title = "P3: Expired Local Dev TLS Cert (0 Cloud Tokens)",
            subtitle = "Resolved 100% on-device via RB_LOCAL_TLS_CERT — works completely offline",
            expectedSeverity = Severity.P3,
            rawText = listOf(
                "Support ticket from dev-laptop-14 (alice.dev@internal.corp, +1 415-555-0192):",
                "Local proxy fails with ERR_CERT_DATE_INVALID / CERT_HAS_EXPIRED on localhost:8443.",
                "Project-Chimera sandbox build is blocked locally. No production impact.",
            ).joinToString("\n"),
        ),
        DemoScenario(
            id = "scenario-p1-billing-webhook",
            title = "P1: FinTech Billing Deadlock + PEM Key + PCI Card + SSN",
            subtitle = "Redacts Luhn Visa, PEM key, SSN, AWS/Stripe keys, DB URI & high-entropy secret",
            expectedSeverity = Severity.P1,
            rawText = listOf(
                "P1 Incident: Stripe webhook processor returning HTTP 429 + 504 timeout on invoice_sync_worker (Deadlock in pg_locks on shard-04).",
                "DB URI leaked: ${listOf("post" + "gres", "://", "billing_svc", ":", "s3cr3tP4ssword99", "@db-shard-04.internal:5432/ledger").joinToString("")}",
                "AWS Key: ${listOf("AK", "IAIOSFODNN7EXAMPLE").joinToString("")} | Stripe key: ${listOf("sk_", "live_51N9x8y7z6w5v4u3t2s1r").joinToString("")} | Card: 4532-0151-1283-0366",
                "webhook_secret=${listOf("wh", "sec_9Kf8Lm2Qp7Zx4Tv1Bn6Yc3Rd8Wx5Hj2M").joinToString("")} | Affected customer SSN: 123-45-6789",
                "VP of Finance (Priya Nair, who lives near Indiranagar 100ft Road) asked for immediate ETA.",
                listOf("-----BEGIN ", "RSA PRIVATE KEY-----").joinToString(""),
                "MIIEowIBAAKCAQEA7V5k9demoSyntheticKeyMaterialForTestingOnly0001",
                listOf("-----END ", "RSA PRIVATE KEY-----").joinToString(""),
            ).joinToString("\n"),
        ),
        DemoScenario(
            id = "scenario-p2-offline-oauth",
            title = "P2: Field Hardware OAuth Clock Skew (Offline Runbook)",
            subtitle = "Resolves 100% locally via RB_OAUTH_CLOCK_SKEW even in Airplane Mode",
            expectedSeverity = Severity.P2,
            rawText = listOf(
                "Field kiosk #402 at Bengaluru warehouse reporting OAuth2 invalid_grant due to NTP clock skew (>310s drift).",
                "Technician contact: field.tech@logistics-ops.io | +91 98450 11223.",
                "Device cannot sync offline telemetry buffer until token clock skew is resolved.",
            ).joinToString("\n"),
        ),
    )

    val DEFAULT_RUNBOOKS: List<CustomRunbook> = listOf(
        CustomRunbook(
            id = "RB_LOCAL_TLS_CERT",
            title = "Local Dev TLS Certificate Expired",
            category = "LOCAL_TLS_CERT",
            severity = Severity.P3,
            keywords = listOf("cert_has_expired", "err_cert_date_invalid", "self_signed_cert_in_chain"),
            builtIn = true,
            resolution = listOf(
                "### Local Runbook `RB_LOCAL_TLS_CERT` (Resolved On-Device · $0 Cloud)",
                "- **Root Cause:** Local development HTTPS proxy certificate expired or is untrusted.",
                "- **Fix Steps:**",
                "  1. Run `mkcert -install && mkcert localhost 127.0.0.1` inside project certs directory.",
                "  2. Restart Vite dev proxy and clear `chrome://net-internals/#hsts` localhost entry.",
                "  3. Verify `curl -I https://localhost:8443` returns `200 OK`.",
            ).joinToString("\n"),
        ),
        CustomRunbook(
            id = "RB_LOCAL_DEPENDENCY_CONFLICT",
            title = "NPM / Lockfile Peer Dependency Conflict",
            category = "LOCAL_DEPENDENCY_CONFLICT",
            severity = Severity.P3,
            keywords = listOf("npm err! eresolve", "peer dependency", "unable to resolve dependency tree"),
            builtIn = true,
            resolution = listOf(
                "### Local Runbook `RB_LOCAL_DEPENDENCY_CONFLICT` (Resolved On-Device · $0 Cloud)",
                "- **Root Cause:** Stale lockfile or incompatible Node/peer dependency range.",
                "- **Fix Steps:**",
                "  1. Verify active Node runtime (`node -v >= 20 LTS`).",
                "  2. Clean install with `rm -rf node_modules && npm ci --legacy-peer-deps`.",
                "  3. Re-run `npm test && npm run build` before committing.",
            ).joinToString("\n"),
        ),
        CustomRunbook(
            id = "RB_LOCAL_CORS_DEV",
            title = "Localhost Dev Origin CORS Rejection",
            category = "LOCAL_CORS_DEV",
            severity = Severity.P2,
            keywords = listOf("cors", "access-control-allow-origin", "localhost:5173"),
            builtIn = true,
            resolution = listOf(
                "### Local Runbook `RB_LOCAL_CORS_DEV` (Resolved On-Device · $0 Cloud)",
                "- **Root Cause:** Local frontend origin (`http://localhost:5173`) missing from dev proxy/emulator CORS allowlist.",
                "- **Fix Steps:**",
                "  1. Add `http://localhost:5173` and `http://127.0.0.1:5173` to `vite.config.ts` proxy or Firebase emulator config.",
                "  2. Confirm preflight `OPTIONS` returns `204` without exposing production wildcard `*`.",
            ).joinToString("\n"),
        ),
        CustomRunbook(
            id = "RB_OAUTH_CLOCK_SKEW",
            title = "OAuth2 Token / JWT Clock Skew Drift",
            category = "OAUTH_CLOCK_SKEW",
            severity = Severity.P2,
            keywords = listOf("invalid_grant", "clock skew", "ntp", "token used too early"),
            builtIn = true,
            resolution = listOf(
                "### Local Runbook `RB_OAUTH_CLOCK_SKEW` (Resolved On-Device · $0 Cloud)",
                "- **Root Cause:** Device system clock drifted beyond OAuth2/JWT `iat`/`exp` tolerance window.",
                "- **Fix Steps:**",
                "  1. Sync system NTP clock: `sudo timedatectl set-ntp true && chronyc makestep`.",
                "  2. Clear cached OAuth refresh state in local device storage and re-authenticate.",
                "  3. Verify `timedatectl status` reports `System clock synchronized: yes`.",
            ).joinToString("\n"),
        ),
        CustomRunbook(
            id = "RB_PORT_IN_USE",
            title = "Local Dev Port Already Bound (EADDRINUSE)",
            category = "LOCAL_PORT_CONFLICT",
            severity = Severity.P3,
            keywords = listOf("eaddrinuse", "address already in use"),
            builtIn = true,
            resolution = listOf(
                "### Local Runbook `RB_PORT_IN_USE` (Resolved On-Device · $0 Cloud)",
                "- **Root Cause:** Orphaned background dev server holding target port.",
                "- **Fix Steps:**",
                "  1. Inspect bound PID: `lsof -i :<PORT>` or `ss -tulpn | grep <PORT>`.",
                "  2. Gracefully stop stale process or start dev server on `--port 5174`.",
            ).joinToString("\n"),
        ),
        CustomRunbook(
            id = "RB_OFFLINE_SW_CACHE",
            title = "Stale PWA Service Worker Asset Cache",
            category = "PWA_CACHE_STALE",
            severity = Severity.P2,
            keywords = listOf("chunkloaderror", "failed to fetch dynamically imported module", "service worker cache"),
            builtIn = true,
            resolution = listOf(
                "### Local Runbook `RB_OFFLINE_SW_CACHE` (Resolved On-Device · $0 Cloud)",
                "- **Root Cause:** Client browser holds stale Service Worker manifest referencing pruned Vite asset hashes.",
                "- **Fix Steps:**",
                "  1. Bump `CACHE_NAME` in `public/sw.js` and unregister stale worker in DevTools Application tab.",
                "  2. Hard reload (`Ctrl+Shift+R`) to hydrate updated hashed assets.",
            ).joinToString("\n"),
        ),
    )

    fun passesLuhnCheck(rawDigits: String): Boolean {
        val digits = rawDigits.replace(NON_DIGIT, "")
        if (digits.length !in 13..19) return false
        if (Regex("""^(\d)\1+$""").matches(digits)) return false

        var sum = 0
        var shouldDouble = false
        for (i in digits.length - 1 downTo 0) {
            var digit = digits[i].code - 48
            if (shouldDouble) {
                digit *= 2
                if (digit > 9) digit -= 9
            }
            sum += digit
            shouldDouble = !shouldDouble
        }
        return sum % 10 == 0
    }

    fun shannonEntropy(input: String): Double {
        if (input.isEmpty()) return 0.0
        val counts = HashMap<Char, Int>()
        for (ch in input) {
            counts[ch] = (counts[ch] ?: 0) + 1
        }
        var entropy = 0.0
        val total = input.length.toDouble()
        for (count in counts.values) {
            val p = count / total
            entropy -= p * (ln(p) / ln(2.0))
        }
        return entropy
    }

    fun isTechnicalAllowlisted(phrase: String): Boolean {
        val normalized = phrase.trim().lowercase()
        if (normalized.isEmpty()) return true
        if (normalized in TECHNICAL_ALLOWLIST) return true
        return Regex("""^(?:http\s+\d{3}|err_[a-z0-9_]+)$""", RegexOption.IGNORE_CASE).matches(normalized)
    }

    private fun maskProtectedTokens(rawText: String): Pair<String, List<IntRange>> {
        val protectedRanges = PROTECTED_PLACEHOLDER_REGEX.findAll(rawText).map {
            it.range.first..(it.range.last + 1)
        }.toList()
        if (protectedRanges.isEmpty()) return rawText to emptyList()
        val sb = StringBuilder(rawText.length)
        var cursor = 0
        for (pr in protectedRanges) {
            sb.append(rawText, cursor, pr.first)
            repeat(pr.last - pr.first) { sb.append('\u0000') }
            cursor = pr.last
        }
        sb.append(rawText, cursor, rawText.length)
        return sb.toString() to protectedRanges
    }

    private fun isLikelyNormalIdentifier(value: String): Boolean {
        if (value.contains('/') || value.any { it.isWhitespace() }) return true
        if (Regex("""^[a-z]+(?:[A-Z][a-z]+)+$""").matches(value)) return true
        if (Regex("""^[a-z]+(?:-[a-z]+)+$""").matches(value)) return true
        return false
    }

    private fun runRules(
        text: String,
        rules: List<RegexRule>,
        startCounter: Int,
        protectionLevel: ProtectionLevel = ProtectionLevel.MEDIUM,
    ): List<RedactionSpan> {
        val spans = mutableListOf<RedactionSpan>()
        val (scanBuffer, protectedRanges) = maskProtectedTokens(text)
        var counter = startCounter
        for (rule in rules) {
            if (protectionLevel.ordinal < rule.minLevel.ordinal) continue
            for (match in rule.pattern.findAll(scanBuffer)) {
                val group = rule.captureGroup?.let { match.groups[it] }
                val matchedText = if (rule.captureGroup != null) group?.value.orEmpty() else match.value
                val start = if (rule.captureGroup != null) group?.range?.first ?: continue else match.range.first
                val end = if (rule.captureGroup != null) (group?.range?.last ?: continue) + 1 else match.range.last + 1
                if (matchedText.isEmpty() || matchedText.contains('\u0000')) continue
                if (protectedRanges.any { pr -> start < pr.last && end > pr.first }) continue
                if (rule.validator != null && !rule.validator.invoke(matchedText)) continue
                spans.add(
                    RedactionSpan(
                        start = start,
                        end = end,
                        category = rule.category,
                        detector = rule.detector,
                        placeholder = "[REDACTED:${rule.category}_${counter++}]",
                        matchedText = text.substring(start, end),
                        masked = true,
                    ),
                )
            }
        }
        return spans
    }

    private val CARD_EXPIRY_TOKEN = Regex("""(?<!\d)(?:0?[1-9]|1[0-2])\s*[/\-]\s*(?:\d{2}|\d{4})(?!\d)""")
    private val CARD_CVV_LABEL = Regex(
        """\b(?:cvv2?|cvc2?|cid|csc|security\s*code|card\s*verification(?:\s*(?:value|code))?)\b\s*(?:is|:|=|#|-)?\s*(\d{3,4})(?!\d)""",
        RegexOption.IGNORE_CASE,
    )
    private val CARD_BARE_DIGITS = Regex("""(?<![\d.\-/])(\d{3,4})(?![\d.\-/])""")
    private val CARD_UNIT_AFTER = Regex(
        """^\s*(?:%|ms\b|px\b|k\b|m\b|gb\b|mb\b|kb\b|hrs?\b|am\b|pm\b|orders?\b|days?\b|hours?\b|mins?\b|seconds?\b|items?\b|users?\b|requests?\b|retries?\b)""",
        RegexOption.IGNORE_CASE,
    )
    private val CARD_YEAR_LIKE = Regex("""^(?:19|20)\d{2}$""")

    /**
     * CVV and expiry only mean something next to a card. A bare 3-digit number is never a CVV
     * unless a Luhn-valid card (or that card's expiry) sits within 80 characters of it.
     *
     * The token regexes always run over the whole buffer: slicing a window would let a lookbehind
     * succeed at index 0 and turn "4111-1111" into an expiry, which then licenses unrelated digits.
     */
    private fun detectCardBundleSpans(
        text: String,
        cardSpans: List<RedactionSpan>,
        startCounter: Int,
    ): List<RedactionSpan> {
        val extras = mutableListOf<RedactionSpan>()
        var counter = startCounter
        fun push(start: Int, end: Int, category: String) {
            if (extras.any { start < it.end && end > it.start }) return
            extras.add(
                RedactionSpan(
                    start = start,
                    end = end,
                    category = category,
                    detector = DetectorSource.HEURISTIC_GUARD,
                    placeholder = "[REDACTED:${category}_${counter++}]",
                    matchedText = text.substring(start, end),
                    masked = true,
                ),
            )
        }
        fun overlapsCard(start: Int, end: Int) = cardSpans.any { start < it.end && end > it.start }

        for (card in cardSpans) {
            val from = maxOf(0, card.start - 80)
            val to = minOf(text.length, card.end + 80)
            fun inWindow(start: Int, end: Int) = start >= from && end <= to
            val expiries = mutableListOf<IntRange>()

            for (match in CARD_EXPIRY_TOKEN.findAll(text)) {
                val start = match.range.first
                val end = match.range.last + 1
                if (!inWindow(start, end) || overlapsCard(start, end)) continue
                expiries.add(start until end)
                push(start, end, "CARD_EXPIRY")
            }

            for (match in CARD_CVV_LABEL.findAll(text)) {
                val group = match.groups[1] ?: continue
                val start = group.range.first
                val end = group.range.last + 1
                if (!inWindow(start, end)) continue
                push(start, end, "CVV")
            }

            // A bare code is only accepted when the window also carries an expiry, which is what
            // separates a card bundle from an order number sitting near a card number.
            if (expiries.isEmpty()) continue
            for (match in CARD_BARE_DIGITS.findAll(text)) {
                val start = match.range.first
                val end = match.range.last + 1
                if (!inWindow(start, end) || overlapsCard(start, end)) continue
                if (expiries.any { start < it.last + 1 && end > it.first }) continue
                if (CARD_YEAR_LIKE.matches(match.value)) continue
                if (CARD_UNIT_AFTER.containsMatchIn(text.substring(end, minOf(text.length, end + 12)))) continue
                push(start, end, "CVV")
            }
        }
        return extras
    }

    fun detectRegexSpans(
        text: String,
        protectionLevel: ProtectionLevel = ProtectionLevel.MEDIUM,
    ): List<RedactionSpan> {
        val spans = runRules(text, DETERMINISTIC_REGEX_RULES, 1, protectionLevel).toMutableList()
        val cards = spans.filter { it.category == "CREDIT_CARD" }
        if (cards.isEmpty()) return spans
        for (extra in detectCardBundleSpans(text, cards, spans.size + 1)) {
            if (spans.none { it.start == extra.start }) spans.add(extra)
        }
        return spans
    }

    fun detectHighEntropySecrets(
        text: String,
        entropyThreshold: Double = RuntimeConfigValues.DEFAULT_ENTROPY_THRESHOLD,
    ): List<RedactionSpan> {
        val threshold = if (entropyThreshold.isFinite()) entropyThreshold else RuntimeConfigValues.DEFAULT_ENTROPY_THRESHOLD
        val spans = mutableListOf<RedactionSpan>()
        val (scanBuffer, protectedRanges) = maskProtectedTokens(text)
        var counter = 50

        for (match in ENTROPY_ASSIGNMENT_REGEX.findAll(scanBuffer)) {
            val secretGroup = match.groups[1] ?: continue
            val secretValue = secretGroup.value
            if (
                secretValue.isEmpty() ||
                secretValue.contains("[REDACTED:") ||
                secretValue.contains('\u0000') ||
                isLikelyNormalIdentifier(secretValue)
            ) {
                continue
            }
            val start = secretGroup.range.first
            val end = secretGroup.range.last + 1
            if (protectedRanges.any { pr -> start < pr.last && end > pr.first }) continue

            val entropy = shannonEntropy(secretValue)
            val hasLower = HAS_LOWER.containsMatchIn(secretValue)
            val hasUpper = HAS_UPPER.containsMatchIn(secretValue)
            val hasDigit = HAS_DIGIT.containsMatchIn(secretValue)
            val hasSymbol = HAS_SYMBOL.containsMatchIn(secretValue)
            val classCount = listOf(hasLower, hasUpper, hasDigit, hasSymbol).count { it }
            val hasStrongMix = classCount >= 3 || (hasDigit && HAS_SEPARATOR.containsMatchIn(secretValue))

            val meetsThreshold = if (threshold < 3.0) {
                entropy >= threshold
            } else {
                !LOWER_ONLY.matches(secretValue) && hasStrongMix && entropy >= threshold
            }

            if (meetsThreshold) {
                spans.add(
                    RedactionSpan(
                        start = start,
                        end = end,
                        category = "HIGH_ENTROPY_SECRET",
                        detector = DetectorSource.ENTROPY_SCANNER,
                        placeholder = "[REDACTED:HIGH_ENTROPY_SECRET_${counter++}]",
                        matchedText = text.substring(start, end),
                        masked = true,
                    ),
                )
            }
        }
        return spans
    }

    fun detectContextualHeuristicSpans(
        text: String,
        protectionLevel: ProtectionLevel = ProtectionLevel.MEDIUM,
    ): List<RedactionSpan> =
        runRules(text, CONTEXTUAL_HEURISTIC_RULES, 100, protectionLevel)

    /** Word-bounds a literal so "Acme" matches the word and not the "Acme" inside "AcmeCorp". */
    private fun boundedLiteral(term: String): String {
        val leading = if (WORD_START.containsMatchIn(term)) "\\b" else ""
        val trailing = if (WORD_END.containsMatchIn(term)) "\\b" else ""
        return "$leading${Regex.escape(term)}$trailing"
    }

    fun detectPolicyTermSpans(
        text: String,
        terms: List<String>,
        category: String = "POLICY_TERM",
        startCounter: Int = 200,
    ): List<RedactionSpan> {
        if (terms.isEmpty()) return emptyList()
        val spans = mutableListOf<RedactionSpan>()
        var counter = startCounter

        for (rawTerm in terms) {
            val term = rawTerm.trim()
            if (term.length < 3) continue
            val regex = Regex(boundedLiteral(term), RegexOption.IGNORE_CASE)
            for (match in regex.findAll(text)) {
                spans.add(
                    RedactionSpan(
                        start = match.range.first,
                        end = match.range.last + 1,
                        category = category,
                        detector = DetectorSource.POLICY_TERM,
                        placeholder = "[REDACTED:${category}_${counter++}]",
                        matchedText = match.value,
                        masked = true,
                    ),
                )
            }
        }
        return spans
    }

    fun buildSemanticSpans(text: String, items: List<SemanticExtractionItem>): List<RedactionSpan> {
        val spans = mutableListOf<RedactionSpan>()
        val (scanBuffer, protectedRanges) = maskProtectedTokens(text)
        var counter = 1

        for (item in items) {
            val phrase = item.phrase.trim()
            if (
                phrase.length < 3 ||
                phrase.contains("[REDACTED:") ||
                phrase.contains('\u0000') ||
                !HAS_ALNUM.containsMatchIn(phrase) ||
                NANO_CUE_PHRASE_REGEX.matches(phrase) ||
                isTechnicalAllowlisted(phrase) ||
                phrase.lowercase() in NANO_STOPWORDS
            ) {
                continue
            }
            val bounded = boundedLiteral(phrase)
            val isShortAmbiguous = SHORT_WORD.matches(phrase)
            val pattern = if (isShortAmbiguous) {
                """(?<![/@-])(?<!\w\.)$bounded(?![/@-])(?!\.\w)"""
            } else {
                bounded
            }
            val regex = Regex(pattern, RegexOption.IGNORE_CASE)
            val category = normalizeRedactionCategory(item.category)

            for (match in regex.findAll(scanBuffer)) {
                val start = match.range.first
                val end = match.range.last + 1
                if (match.value.contains('\u0000') || protectedRanges.any { pr -> start < pr.last && end > pr.first }) {
                    continue
                }
                spans.add(
                    RedactionSpan(
                        start = start,
                        end = end,
                        category = category,
                        detector = DetectorSource.NANO_SEMANTIC_FIREWALL,
                        placeholder = "[REDACTED:${category}_${counter++}]",
                        matchedText = text.substring(start, end),
                        masked = true,
                    ),
                )
            }
        }
        return spans
    }

    fun applyMaskedSpans(rawText: String, spans: List<RedactionSpan>): String {
        val activeSpans = spans
            .filter { it.masked && it.start >= 0 && it.end <= rawText.length && it.start < it.end }
            .sortedBy { it.start }

        val sb = StringBuilder(rawText)
        for (i in activeSpans.indices.reversed()) {
            val s = activeSpans[i]
            sb.replace(s.start, s.end, s.placeholder)
        }
        return sb.toString()
    }

    private val PROTECTED_PLACEHOLDER_REGEX = Regex("""\[REDACTED:[A-Z0-9_]+\]""")

    fun mergeAndRedactSpans(
        rawText: String,
        spans: List<RedactionSpan>,
    ): Pair<String, List<RedactionSpan>> {
        if (spans.isEmpty()) return rawText to emptyList()

        val protectedRanges = PROTECTED_PLACEHOLDER_REGEX.findAll(rawText).map {
            it.range.first..(it.range.last + 1)
        }.toList()

        val safeSpans = spans.filter { span ->
            !span.matchedText.contains("[REDACTED:") &&
                !span.matchedText.contains('\u0000') &&
                protectedRanges.none { pr -> span.start < pr.last && span.end > pr.first }
        }
        if (safeSpans.isEmpty()) return rawText to emptyList()

        val sorted = safeSpans.sortedWith(
            compareBy<RedactionSpan> { it.start }
                .thenByDescending { it.end - it.start }
                .thenByDescending { it.detector.priority },
        )

        val merged = mutableListOf<RedactionSpan>()
        for (span in sorted) {
            if (span.start < 0 || span.end > rawText.length || span.start >= span.end) continue
            if (span.detector != DetectorSource.MANUAL_MASK && isTechnicalAllowlisted(span.matchedText)) {
                continue
            }

            val prevIdx = merged.lastIndex
            if (prevIdx < 0) {
                merged.add(span.copy(constituentTexts = listOf(span.matchedText)))
                continue
            }

            val prev = merged[prevIdx]
            if (span.start < prev.end) {
                val constituents = prev.constituentTexts.ifEmpty { listOf(prev.matchedText) }.toMutableList()
                if (!constituents.contains(span.matchedText)) {
                    constituents.add(span.matchedText)
                }
                val newEnd = maxOf(prev.end, span.end)
                val newMatchedText = if (newEnd > prev.end) rawText.substring(prev.start, newEnd) else prev.matchedText
                val preferIncoming = span.detector.priority > prev.detector.priority
                merged[prevIdx] = prev.copy(
                    end = newEnd,
                    matchedText = newMatchedText,
                    detector = if (preferIncoming) span.detector else prev.detector,
                    category = if (preferIncoming) span.category else prev.category,
                    placeholder = if (preferIncoming) span.placeholder else prev.placeholder,
                    constituentTexts = constituents,
                )
            } else {
                merged.add(span.copy(constituentTexts = listOf(span.matchedText)))
            }
        }

        val categoryCounts = mutableMapOf<String, Int>()
        val normalized = merged.map { span ->
            val next = (categoryCounts[span.category] ?: 0) + 1
            categoryCounts[span.category] = next
            span.copy(placeholder = "[REDACTED:${span.category}_$next]")
        }

        return applyMaskedSpans(rawText, normalized) to normalized
    }

    data class ScanOptions(
        val protectionLevel: ProtectionLevel = ProtectionLevel.MEDIUM,
        val includeHeuristics: Boolean = true,
        val enableEntropyScanner: Boolean = true,
        val entropyThreshold: Double? = null,
        val customTerms: List<String> = emptyList(),
        val remoteBlockedTerms: List<String> = emptyList(),
        val extraSpans: List<RedactionSpan> = emptyList(),
    )

    fun scanAndRedactLocal(
        rawText: String,
        options: ScanOptions = ScanOptions(),
    ): Pair<String, List<RedactionSpan>> {
        val level = options.protectionLevel
        val resolvedEntropy = options.entropyThreshold ?: when (level) {
            ProtectionLevel.LOW -> 3.8
            ProtectionLevel.MEDIUM -> RuntimeConfigValues.DEFAULT_ENTROPY_THRESHOLD
            ProtectionLevel.HIGH -> 2.9
        }
        val regexSpans = detectRegexSpans(rawText, level)
        val entropySpans =
            if (options.enableEntropyScanner) detectHighEntropySecrets(rawText, resolvedEntropy)
            else emptyList()
        val policySpans = detectPolicyTermSpans(rawText, options.customTerms, "POLICY_TERM", 200)
        val remotePolicySpans = detectPolicyTermSpans(rawText, options.remoteBlockedTerms, "REMOTE_POLICY", 300)
        val heuristicSpans =
            if (options.includeHeuristics) detectContextualHeuristicSpans(rawText, level) else emptyList()

        return mergeAndRedactSpans(
            rawText,
            regexSpans + entropySpans + policySpans + remotePolicySpans + heuristicSpans + options.extraSpans,
        )
    }

    fun scrub(
        rawText: String,
        protectionLevel: ProtectionLevel = ProtectionLevel.MEDIUM,
    ): Pair<String, List<RedactionSpan>> =
        scanAndRedactLocal(rawText, ScanOptions(protectionLevel = protectionLevel))

    private fun escapeJsonSlice(value: String): String {
        val sb = StringBuilder(value.length + 8)
        for (ch in value) {
            when (ch) {
                '\\' -> sb.append("\\\\")
                '"' -> sb.append("\\\"")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> sb.append(ch)
            }
        }
        return sb.toString()
    }

    private fun encodeUrlComponent(value: String): String =
        URLEncoder.encode(value, "UTF-8").replace("+", "%20")

    fun containsRawCredentialGuard(text: String): Boolean =
        RAW_CREDENTIAL_GUARDS.any { it.containsMatchIn(text) }

    fun verifyZeroLeakage(
        outboundPrompt: String,
        spans: List<RedactionSpan>,
        verifiedAt: Long = System.currentTimeMillis(),
    ): ZeroLeakageAudit {
        val activeMasked = spans.filter { it.masked && it.matchedText.trim().length >= 3 }
        val leakedCategories = mutableListOf<String>()

        for (span in activeMasked) {
            val candidates = LinkedHashSet<String>().apply {
                add(span.matchedText)
                addAll(span.constituentTexts)
            }

            var leaked = false
            for (rawCandidate in candidates) {
                val candidate = rawCandidate.trim()
                if (candidate.length < 3 || candidate.startsWith("[REDACTED:")) continue
                val urlEncoded = runCatching { encodeUrlComponent(candidate) }.getOrDefault(candidate)
                val jsonEscaped = escapeJsonSlice(candidate)
                if (
                    outboundPrompt.contains(candidate) ||
                    (urlEncoded.length >= 3 && outboundPrompt.contains(urlEncoded)) ||
                    (jsonEscaped.length >= 3 && outboundPrompt.contains(jsonEscaped))
                ) {
                    leaked = true
                    break
                }
            }
            if (leaked) {
                leakedCategories.add(span.category)
            }
        }

        if (containsRawCredentialGuard(outboundPrompt)) {
            leakedCategories.add("RAW_CREDENTIAL_PATTERN")
        }

        return ZeroLeakageAudit(
            verified = leakedCategories.isEmpty(),
            checkedSpansCount = activeMasked.size,
            leakedSpansCount = leakedCategories.size,
            leakedCategories = leakedCategories.distinct(),
            outboundPromptPreview = outboundPrompt,
            verifiedAt = verifiedAt,
        )
    }

    fun matchLocalRunbook(
        text: String,
        runbooks: List<CustomRunbook> = DEFAULT_RUNBOOKS,
    ): CustomRunbook? {
        val lower = text.lowercase()
        if (
            lower.contains("p0") ||
            lower.contains("p1") ||
            lower.contains("deadlock") ||
            lower.contains("private key")
        ) {
            return null
        }
        return runbooks.firstOrNull { rb ->
            rb.keywords.any { kw -> kw.isNotBlank() && lower.contains(kw.trim().lowercase()) }
        }
    }

    fun getRunbookById(
        runbookId: String?,
        runbooks: List<CustomRunbook> = DEFAULT_RUNBOOKS,
    ): CustomRunbook? =
        if (runbookId.isNullOrBlank()) null else runbooks.firstOrNull { it.id == runbookId }

    fun buildOutboundCloudPrompt(severity: Severity, category: String, sanitizedText: String): String =
        listOf(
            "Analyze this sanitized incident ticket and produce Root Cause Hypothesis, Immediate Mitigation, and Verification Checklist.",
            "NOTE: All PII and secrets have already been redacted locally with [REDACTED:...] placeholders.",
            "Severity: ${severity.name} | Category: $category",
            "Sanitized Ticket:",
            sanitizedText,
        ).joinToString("\n\n")
}
