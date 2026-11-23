package com.localfirst.triage.benchmark

/**
 * Synthetic detection corpus shared by the JVM parity test and the on-device benchmark.
 *
 * Every secret is assembled with string concatenation so GitHub Push Protection (GH013) never
 * treats this file as a real credential leak. All values are fake.
 */
data class BenchmarkCase(
    val id: String,
    val category: String,
    val text: String,
)

object FirewallBenchmarkCorpus {

    private fun case(id: String, category: String, text: String) = BenchmarkCase(id, category, text)

    private val awsKey1 = "AKIA" + "IOSFODNN7EXAMPLE"
    private val awsKey2 = "ASIA" + "Y34F7H2KLMNOPQRS"
    private val awsKey3 = "AKIA" + "Q7Z2X9W4V6U8T1S3"
    private val awsKey4 = "AIDA" + "B2C4D6E8F1G3H5J7"
    private val awsKey5 = "AROA" + "K9L8M7N6P5Q4R3S2"
    private val awsSecret1 = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
    private val awsSecret2 = "je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY"

    private val openAiKey1 = "sk-proj-" + "AbCdEfGhIjKlMnOpQrStUvWx1234567890"
    private val openAiKey2 = "sk-ant-api03-" + "XyZ123abcDEF456ghiJKL789mnoPQR012"
    private val openAiKey3 = "sk-" + "Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56"
    private val stripeLive1 = "sk_live_" + "51NxMockSecret9988776655"
    private val stripeLive2 = "sk_live_" + "4eC39HqLyjWDarjtT1zdp7dc"
    private val stripePublishable = "pk_test_" + "TGNb3kLm9Qr2Xv5Yz8Wc1Ae4"
    private val stripeRestricted = "rk_live_" + "8fH2jK4mN6pQ8rS1tU3vW5xY"

    private val githubPat1 = "ghp_" + "16C7e42F292c6912E7710c838347Ae178B4a"
    private val githubPat2 = "gho_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"
    private val githubFineGrained = "github_pat_" + "11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz"

    private val firebaseKey1 = "AIza" + "SyD-1234567890abcdefghijklmnopqrs"
    private val firebaseKey2 = "AIza" + "SyB7cD8eF9gH0iJ1kL2mN3oP4qR5sT6uV7wX"

    private val slackBot = "xoxb-" + "123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx"
    private val slackUser = "xoxp-" + "987654321098-9876543210987-ZyXwVuTsRqPoNmLkJiHgFeDc"

    private val twilioKey = "SK" + "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d"
    private val twilioToken = "0123456789abcdef0123456789abcdef"

    private val supabaseService = "sbp_" + "0123456789abcdef0123456789abcdef01234567"
    private val supabaseJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
        ".eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIn0" +
        ".c2lnbmF0dXJlLXZhbHVlLWZvci10ZXN0aW5n"

    private val jwt1 = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0" +
        ".dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
    private val jwt2 = "eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJjb3Jkb24ifQ.c2lnbmF0dXJlLXZhbHVl"
    private val jwt3 = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjE3MDAwMDB9.abcdefghijklmnop"

    private val pemRsa = "-----BEGIN " + "RSA PRIVATE KEY-----\n" +
        "MIIEowIBAAKCAQEA7V5k9demoSyntheticKeyMaterialForTestingOnly0001\n" +
        "-----END " + "RSA PRIVATE KEY-----"
    private val pemEc = "-----BEGIN " + "EC PRIVATE KEY-----\n" +
        "MHcCAQEEIBdemoSyntheticKeyMaterialForTestingOnly0002\n" +
        "-----END " + "EC PRIVATE KEY-----"
    private val pemOpenSsh = "-----BEGIN " + "OPENSSH PRIVATE KEY-----\n" +
        "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB\n" +
        "-----END " + "OPENSSH PRIVATE KEY-----"

    private val cardVisa1 = "4532" + "015112830366"
    private val cardVisa2 = "4242" + "424242424242"
    private val cardMastercard = "5555" + "555555554444"
    private val cardAmex = "3782" + "82246310005"

    /** 65 positive payloads across every category the engine supports. */
    val positives: List<BenchmarkCase> = listOf(
        // AWS access keys (5)
        case("aws-1", "AWS_ACCESS_KEY", "Here is my access key $awsKey1, can you check the IAM policy?"),
        case("aws-2", "AWS_ACCESS_KEY", "aws_access_key_id = $awsKey2"),
        case("aws-3", "AWS_ACCESS_KEY", "The build log printed $awsKey3 before failing"),
        case("aws-4", "AWS_ACCESS_KEY", "Credentials: $awsKey4 (dev account)"),
        case("aws-5", "AWS_ACCESS_KEY", "role arn uses $awsKey5 internally"),

        // AWS secret keys (2)
        case("aws-secret-1", "AWS_SECRET_KEY", "aws_secret_access_key = $awsSecret1"),
        case("aws-secret-2", "AWS_SECRET_KEY", "AWS_SECRET_ACCESS_KEY=$awsSecret2"),

        // OpenAI / Anthropic / Stripe API keys (7)
        case("openai-1", "API_KEY", "My OpenAI key is $openAiKey1 and it is rate limited"),
        case("openai-2", "API_KEY", "anthropic key $openAiKey2 stopped working"),
        case("openai-3", "API_KEY", "export OPENAI_API_KEY=$openAiKey3"),
        case("stripe-1", "API_KEY", "Stripe secret $stripeLive1 keeps returning 429"),
        case("stripe-2", "API_KEY", "billing worker uses $stripeLive2 in production"),
        case("stripe-3", "API_KEY", "publishable key $stripePublishable is safe to ship"),
        case("stripe-4", "API_KEY", "restricted key $stripeRestricted for the ledger job"),

        // GitHub tokens (3)
        case("github-1", "API_KEY", "git remote uses $githubPat1 as the password"),
        case("github-2", "API_KEY", "the action leaked $githubPat2 in the log"),
        case("github-3", "API_KEY", "fine grained token $githubFineGrained expires soon"),

        // Google / Firebase (2)
        case("firebase-1", "API_KEY", "Firebase key $firebaseKey1 is embedded in the app"),
        case("firebase-2", "API_KEY", "maps sdk key $firebaseKey2 needs restriction"),

        // Slack (2)
        case("slack-1", "API_KEY", "bot token $slackBot can post to #incidents"),
        case("slack-2", "API_KEY", "user token $slackUser has admin scope"),

        // Twilio (2)
        case("twilio-1", "API_KEY", "twilio api key $twilioKey sends SMS"),
        case("twilio-2", "API_KEY", "twilio auth token: $twilioToken"),

        // Supabase (2)
        case("supabase-1", "API_KEY", "service role key $supabaseService bypasses RLS"),
        case("supabase-2", "BEARER_OR_JWT", "supabase anon key $supabaseJwt is public but still sensitive"),

        // JWTs (3)
        case("jwt-1", "BEARER_OR_JWT", "Authorization: Bearer $jwt1"),
        case("jwt-2", "BEARER_OR_JWT", "the gateway logged Bearer $jwt2 during the trace"),
        case("jwt-3", "BEARER_OR_JWT", "session token: $jwt3"),

        // Private keys (3)
        case("pem-1", "PEM_PRIVATE_KEY", "Deploy failed with this key:\n$pemRsa"),
        case("pem-2", "PEM_PRIVATE_KEY", "EC signing material:\n$pemEc"),
        case("pem-3", "PEM_PRIVATE_KEY", "ssh key pasted by mistake:\n$pemOpenSsh"),

        // Emails (6)
        case("email-1", "EMAIL", "Contact alice.dev@internal.corp for access"),
        case("email-2", "EMAIL", "ops-lead@acme-health.org reported the outage"),
        case("email-3", "EMAIL", "reach field.tech@logistics-ops.io before noon"),
        case("email-4", "EMAIL", "billing@stripe-payments.co sent the invoice"),
        case("email-5", "EMAIL", "escalate to ceo@example.com right away"),
        case("email-6", "EMAIL", "support+urgent@acme.io owns the ticket"),

        // Phones (6)
        case("phone-1", "PHONE", "Call me on +1-415-555-0199 when the deploy finishes"),
        case("phone-2", "PHONE", "customer phone +91 99000 54954"),
        case("phone-3", "PHONE", "callback number (415) 555-0132"),
        case("phone-4", "PHONE", "text 415.555.0177 after hours"),
        case("phone-5", "PHONE", "UK line +44 20 7946 0958 is the office"),
        case("phone-6", "PHONE", "mobile +1 212-555-0188 belongs to the on-call lead"),

        // Cards (4)
        case("card-1", "CREDIT_CARD", "card number $cardVisa1 was declined"),
        case("card-2", "CREDIT_CARD", "use $cardVisa2 for the test charge"),
        case("card-3", "CREDIT_CARD", "mastercard $cardMastercard expires 09/29"),
        case("card-4", "CREDIT_CARD", "amex $cardAmex is on file"),

        // Street addresses (5)
        case("address-1", "ADDRESS", "ship it to 742 Evergreen Terrace tomorrow"),
        case("address-2", "ADDRESS", "the office is at 1600 Amphitheatre Parkway"),
        case("address-3", "ADDRESS", "meet at 221 Baker Street at nine"),
        case("address-4", "ADDRESS", "warehouse 12 MG Road needs a delivery"),
        case("address-5", "ADDRESS", "my address is 45 Indiranagar 100ft Road"),

        // Database URIs (2)
        case("db-1", "DB_CONNECTION_URI", "DB URI leaked: postgres://billing_svc:s3cr3tP4ssword99@db-shard-04.internal:5432/ledger"),
        case("db-2", "DB_CONNECTION_URI", "connection string mongodb+srv://admin:Pa55w0rd@cluster0.example.mongodb.net"),

        // IBAN (2)
        case("iban-1", "IBAN", "wire the refund to DE89370400440532013000"),
        case("iban-2", "IBAN", "iban GB82WEST12345698765432 belongs to finance"),

        // Government IDs (3)
        case("gov-1", "US_SSN", "customer SSN 123-45-6789 is on the form"),
        case("gov-2", "GOV_ID", "aadhaar 1234 5678 9012 was shared in chat"),
        case("gov-3", "US_SSN", "ssn 876-54-3210 needs redaction"),

        // High-entropy assignments (3)
        case("entropy-1", "HIGH_ENTROPY_SECRET", "client_secret=" + "9F8a7B6c5D4e3F2a1B0c9D8e7F6a5B4c"),
        case("entropy-2", "HIGH_ENTROPY_SECRET", "webhook_secret=" + "whsec_9Kf8Lm2Qp7Zx4Tv1Bn6Yc3Rd8Wx5Hj2M"),
        case("entropy-3", "HIGH_ENTROPY_SECRET", "signing_key = " + "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg"),

        // Passwords (3)
        case("password-1", "PASSWORD", "password: Tr0ub4dor&3"),
        case("password-2", "PASSWORD", "my password is Hunter2xSecure"),
        case("password-3", "PASSWORD", "passphrase = correct-horse-battery"),
    )

    /** 35 benign prompts that must stay silent. */
    val benign: List<String> = listOf(
        "Can you summarise this article about privacy-preserving analytics?",
        "npm install --save-dev typescript",
        "Version 4.8.2 fixed the timeout bug in pg_locks",
        "Deploy is scheduled for Tuesday at 10:30",
        "Order ABC123 was delivered yesterday",
        "https://example.com/docs/getting-started",
        "SELECT * FROM orders WHERE id = 42",
        "const total = items.reduce((a, b) => a + b, 0);",
        "The meeting moved to 3pm in room 12B",
        "Error code ERR_CERT_DATE_INVALID on localhost:8443",
        "Please review PR #1284 before the release",
        "Sprint 24 ends on 2026-12-04",
        "Use npm ci --legacy-peer-deps to reinstall",
        "The card game starts at eight tonight",
        "My favourite phone is the Pixel 9",
        "Send the report to the team channel",
        "Kubernetes pod restarted twice overnight",
        "HTTP 502 from the gateway during the load test",
        "docker compose up -d --build",
        "The build takes about 90 seconds",
        "Cache hit ratio improved to 98%",
        "Meeting notes: budget approved for Q1",
        "git rebase origin/main then push",
        "Temperature in the server room hit 31C",
        "Invoice number INV-2026-0042 is unpaid",
        "Latency p95 dropped from 240ms to 180ms",
        "Please rotate the on-call schedule next week",
        "The quick brown fox jumps over the lazy dog",
        "Reorder stock item SKU-4471 before Friday",
        "User feedback: the dark theme looks great",
        "Enable 2FA for all admin accounts",
        "Upload the screenshot to the shared drive",
        "The release candidate passed all 138 tests",
        "Remind me to book a dentist appointment",
        "Vite dev server is running on port 5173",
    )
}
