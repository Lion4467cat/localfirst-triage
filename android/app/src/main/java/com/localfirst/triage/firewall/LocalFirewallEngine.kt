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
        """^(?:4\d{12}(?:\d{3})?(?:\d{3})?|5[1-5]\d{14}|2(?:2[2-9]\d{12}|[3-6]\d{13}|7[01]\d{12}|720\d{12})|3[47]\d{13}|6(?:011|5\d{2})\d{12})$""",
    )

    private val RAW_CREDENTIAL_GUARDS = listOf(
        Regex("""AKIA[0-9A-Z]{16}"""),
        Regex("""AIza[0-9A-Za-z_-]{35}"""),
        Regex("""-----BEGIN [A-Z ]*PRIVATE KEY-----"""),
    )

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
            category = "API_KEY",
            detector = DetectorSource.REGEX_FIREWALL,
            pattern = Regex(
                """\b(?:AIza[0-9A-Za-z\-_]{20,}|(?:sk|pk|rk)_(?:live|test)_[0-9A-Za-z]{16,}|sk-(?:proj-|ant-)?[0-9A-Za-z\-_]{20,}|(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{22,}|xox[baprs]-[0-9A-Za-z\-]{10,})\b""",
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
            pattern = Regex("""\b\d(?:[ -]?\d){12,18}\b"""),
            validator = { matched ->
                val digits = matched.replace(Regex("""\D"""), "")
                digits.length in 13..19 &&
                    CARD_IIN_PREFIX_REGEX.matches(digits) &&
                    passesLuhnCheck(digits)
            },
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
            pattern = Regex("""\b\d{4}[\s-]\d{4}[\s-]\d{4}\b"""),
        ),
        RegexRule(
            category = "EMAIL",
            detector = DetectorSource.REGEX_FIREWALL,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex("""\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"""),
        ),
        RegexRule(
            category = "PHONE",
            detector = DetectorSource.REGEX_FIREWALL,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}|\+?\d{1,3}[\s.-]\d{5}[\s.-]\d{5})\b""",
            ),
        ),
        RegexRule(
            category = "PHONE",
            detector = DetectorSource.REGEX_FIREWALL,
            captureGroup = 1,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """\b(?:phone|mobile|cell|call|whatsapp|contact|number|tel|ph)\b[^0-9\n]{0,25}((?:\+?\d{1,3}[\s.-]?)?\d{10})\b""",
                RegexOption.IGNORE_CASE,
            ),
        ),
        RegexRule(
            category = "API_KEY",
            detector = DetectorSource.REGEX_FIREWALL,
            captureGroup = 1,
            pattern = Regex(
                """\b(?:(?:api\s+key|apikey|secret\s+key|access\s+key|auth\s+token|bearer\s+token|private\s+token|client\s+secret)(?:\s+(?:is|was|are))?\s*(?:[:=]|->)?|(?:api_key|password|passcode|passwd)\s+(?:is|was|are|->))\s*([^\s"',;\[\]\u0000]{6,})""",
                RegexOption.IGNORE_CASE,
            ),
            validator = { !it.contains("[REDACTED:") && !it.contains("\u0000") },
        ),
    )

    private val ADDRESS_INDICATOR_REGEX = Regex(
        """\b(?:\d{1,5}\s+[A-Za-z]|\d{5,6}\b|road|rd|street|st|ave|avenue|lane|ln|layout|nagar|sector|cross|main|block|apt|flat|floor)\b""",
        RegexOption.IGNORE_CASE,
    )

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
            category = "ADDRESS",
            detector = DetectorSource.HEURISTIC_GUARD,
            captureGroup = 1,
            minLevel = ProtectionLevel.MEDIUM,
            pattern = Regex(
                """\b(?:pin\s*code|pincode|zip\s*code|postal\s*code|pin|zip)\s*(?:is|:|=)?\s*([1-9]\d{5}|\d{5}(?:-\d{4})?)\b""",
                RegexOption.IGNORE_CASE,
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
        val digits = rawDigits.replace(Regex("""\D"""), "")
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

    fun detectRegexSpans(
        text: String,
        protectionLevel: ProtectionLevel = ProtectionLevel.MEDIUM,
    ): List<RedactionSpan> =
        runRules(text, DETERMINISTIC_REGEX_RULES, 1, protectionLevel)

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
            val hasLower = Regex("""[a-z]""").containsMatchIn(secretValue)
            val hasUpper = Regex("""[A-Z]""").containsMatchIn(secretValue)
            val hasDigit = Regex("""[0-9]""").containsMatchIn(secretValue)
            val hasSymbol = Regex("""[^A-Za-z0-9]""").containsMatchIn(secretValue)
            val classCount = listOf(hasLower, hasUpper, hasDigit, hasSymbol).count { it }
            val hasStrongMix = classCount >= 3 || (hasDigit && Regex("""[_-]""").containsMatchIn(secretValue))

            val meetsThreshold = if (threshold < 3.0) {
                entropy >= threshold
            } else {
                !Regex("""^[a-z]+$""").matches(secretValue) && hasStrongMix && entropy >= threshold
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
            val escaped = Regex.escape(term)
            val leading = if (Regex("""^[A-Za-z0-9_]""").containsMatchIn(term)) "\\b" else ""
            val trailing = if (Regex("""[A-Za-z0-9_]$""").containsMatchIn(term)) "\\b" else ""
            val regex = Regex("""$leading$escaped$trailing""", RegexOption.IGNORE_CASE)
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
                !Regex("""[A-Za-z0-9]""").containsMatchIn(phrase) ||
                isTechnicalAllowlisted(phrase) ||
                phrase.lowercase() in NANO_STOPWORDS
            ) {
                continue
            }
            val escaped = Regex.escape(phrase)
            val leading = if (Regex("""^[A-Za-z0-9_]""").containsMatchIn(phrase)) "\\b" else ""
            val trailing = if (Regex("""[A-Za-z0-9_]$""").containsMatchIn(phrase)) "\\b" else ""
            val isShortAmbiguous = Regex("""^[A-Za-z]{1,6}$""").matches(phrase)
            val pattern = if (isShortAmbiguous) {
                """(?<![/@-])(?<!\w\.)$leading$escaped$trailing(?![/@-])(?!\.\w)"""
            } else {
                """$leading$escaped$trailing"""
            }
            val regex = Regex(pattern, RegexOption.IGNORE_CASE)
            val category = (item.category.ifBlank { "SEMANTIC_PII" })
                .uppercase()
                .replace(Regex("""[^A-Z0-9_]"""), "_")

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
