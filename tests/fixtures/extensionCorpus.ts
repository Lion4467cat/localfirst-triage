/**
 * Adversarial corpus for the extension detector.
 *
 * Every credential is assembled from fragments so no contiguous provider-shaped
 * token ever lands in the repository (GitHub push protection stays quiet).
 * The corpus is test data only: it never ships in the extension bundle.
 */

export interface PositiveCase {
  id: string;
  category: string;
  text: string;
}

const j = (...parts: string[]) => parts.join("");

export const POSITIVES: PositiveCase[] = [
  // --- AWS -----------------------------------------------------------------
  {
    id: "aws-access-akia",
    category: "AWS_ACCESS_KEY",
    text: j("Deploy role uses ", "AKIA", "Q7XK2M9PLR4T6VWZ", " for the nightly sync."),
  },
  {
    id: "aws-access-asia",
    category: "AWS_ACCESS_KEY",
    text: j("temporary creds ", "ASIA", "Y34F7H2KLMNOPQRS", " expire in an hour"),
  },
  {
    id: "aws-secret-assignment",
    category: "AWS_SECRET_KEY",
    text: j("aws_secret_access_key = ", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"),
  },
  {
    id: "aws-secret-json",
    category: "AWS_SECRET_KEY",
    text: j(
      '{"AccessKeyId":"AKIA', "Q7XK2M9PLR4T6VWZ", '","SecretAccessKey":"',
      "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", '"}',
    ),
  },

  // --- OpenAI / Anthropic --------------------------------------------------
  {
    id: "openai-proj",
    category: "API_KEY",
    text: j("openai key ", "sk-proj-", "T3BlbkFJx9Qm2LpV7rK4nW8sZ1aB6cD0eF5gH2iJ4kL"),
  },
  {
    id: "openai-classic",
    category: "API_KEY",
    text: j("OPENAI_API_KEY=", "sk-", "Qm2LpV7rK4nW8sZ1aB6cD0eF5gH2iJ4kL9mN"),
  },
  {
    id: "openai-in-json",
    category: "API_KEY",
    text: j('{"api_key":"', "sk-", "Qm2LpV7rK4nW8sZ1aB6cD0eF5gH2iJ4kL9mN", '"}'),
  },
  {
    id: "anthropic",
    category: "API_KEY",
    text: j("claude ", "sk-ant-api03-", "Xk2Lm9Qp4Rt7Wv1Yz6Bc3Df8Gh5Jk0Mn2Pq4Rs"),
  },
  {
    id: "anthropic-env",
    category: "API_KEY",
    text: j("ANTHROPIC_API_KEY=", "sk-ant-api03-", "Xk2Lm9Qp4Rt7Wv1Yz6Bc3Df8Gh5Jk0Mn2Pq4Rs"),
  },

  // --- Stripe --------------------------------------------------------------
  {
    id: "stripe-live-secret",
    category: "API_KEY",
    text: j("stripe ", "sk_live_", "51HxKq9dPz3rT7wY2nB8mC4v"),
  },
  {
    id: "stripe-test-secret",
    category: "API_KEY",
    text: j("sk_test_", "4eC39HqLyjWDarjtT1zdp7dc"),
  },
  {
    id: "stripe-restricted",
    category: "API_KEY",
    text: j("rk_live_", "51HxKq9dPz3rT7wY2nB8mC4v"),
  },
  {
    id: "stripe-publishable",
    category: "API_KEY",
    text: j("pk_live_", "51HxKq9dPz3rT7wY2nB8mC4v"),
  },
  {
    id: "stripe-url-query",
    category: "API_KEY",
    text: j("https://api.example.com/v1/charges?key=", "sk_live_", "51HxKq9dPz3rT7wY2nB8mC4v"),
  },

  // --- GitHub --------------------------------------------------------------
  {
    id: "github-classic",
    category: "API_KEY",
    text: j("ghp_", "aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0dF3hJ6"),
  },
  {
    id: "github-fine-grained",
    category: "API_KEY",
    text: j("github_pat_", "11ABCDEFG0aBcDeFgHiJkL_9mNoPqRsTuVwXyZ0123456789"),
  },
  {
    id: "github-oauth",
    category: "API_KEY",
    text: j("gho_", "Zx8Cv7Bn6Mm5Ll4Kk3Jj2Hh1Gg0Ff9Ee8Dd7Cc6"),
  },
  {
    id: "github-env-export",
    category: "API_KEY",
    text: j("export GITHUB_TOKEN=", "ghp_", "aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0dF3hJ6"),
  },

  // --- Google / Firebase ---------------------------------------------------
  {
    id: "google-api-key",
    category: "API_KEY",
    text: j("AIza", "SyA9bC2dE5fG8hJ1kL4mN7pQ0rS3tU6vW9xY"),
  },
  {
    id: "firebase-web-key",
    category: "API_KEY",
    text: j('"apiKey": "AIza', "SyD4eF7gH0jK3mN6pQ9sT2vW5yZ8bC1dE4fG", '"'),
  },

  // --- Chat / SaaS ---------------------------------------------------------
  {
    id: "slack-bot",
    category: "API_KEY",
    text: j("xoxb-", "2847392018-2847392019-AbCdEfGhIjKlMnOpQrStUvWx"),
  },
  {
    id: "slack-user",
    category: "API_KEY",
    text: j("xoxp-", "1122334455-6677889900-AbCdEfGhIjKlMnOpQrStUvWx"),
  },
  {
    id: "twilio-sid",
    category: "API_KEY",
    text: j("twilio ", "SK", "9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c"),
  },
  {
    id: "supabase-service",
    category: "API_KEY",
    text: j("supabase ", "sbp_", "8f7e6d5c4b3a29180f7e6d5c4b3a2918"),
  },
  {
    id: "gitlab-pat",
    category: "API_KEY",
    text: j("glpat-", "Xy9Kd2Lm5Np8Qr1St4Vw7Yz0Ab3Cd6Ef9Gh"),
  },
  {
    id: "huggingface",
    category: "API_KEY",
    text: j("hf_", "Qm2LpV7rK4nW8sZ1aB6cD0eF5gH2iJ4kL"),
  },
  {
    id: "npm-token",
    category: "API_KEY",
    text: j("npm_", "aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0dF3hJ6"),
  },
  {
    id: "pypi-token",
    category: "API_KEY",
    text: j("pypi-", "AgEIcHlwaS5vcmcCJGFiY2RlZmdoaWprbG1ub3A"),
  },
  {
    id: "shopify-admin",
    category: "API_KEY",
    text: j("shpat_", "9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c"),
  },
  {
    id: "doppler",
    category: "API_KEY",
    text: j("dop_v1_", "8f7e6d5c4b3a29180f7e6d5c4b3a29180f7e6d5c4b3a29180f7e6d5c4b3a2918"),
  },
  {
    id: "groq",
    category: "API_KEY",
    text: j("gsk_", "Qm2LpV7rK4nW8sZ1aB6cD0eF5gH2iJ4kL"),
  },
  {
    id: "perplexity",
    category: "API_KEY",
    text: j("pplx-", "Qm2LpV7rK4nW8sZ1aB6cD0eF5gH2iJ4kL"),
  },
  {
    id: "postman",
    category: "API_KEY",
    text: j("PMAK-", "9f8a7b6c5d4e3f2a1b0c9d8e", "-", "7f6a5b4c3d2e1f0a9b8c7d6e"),
  },
  {
    id: "datadog",
    category: "API_KEY",
    text: j("ddapi_", "Qm2LpV7rK4nW8sZ1aB6cD0eF5gH2iJ4kL"),
  },
  {
    id: "linear",
    category: "API_KEY",
    text: j("lin_api_", "Qm2LpV7rK4nW8sZ1aB6cD0eF5gH2iJ4kL"),
  },

  // --- Tokens --------------------------------------------------------------
  {
    id: "jwt-bare",
    category: "BEARER_OR_JWT",
    text: j(
      "eyJhbGciOiJIUzI1NiJ9",
      ".eyJzdWIiOiIxMjM0NTY3ODkwIn0",
      ".dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    ),
  },
  {
    id: "jwt-bearer-header",
    category: "BEARER_OR_JWT",
    text: j(
      "Authorization: Bearer ",
      "eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJhYyJ9.c2lnbmF0dXJlLXZhbHVl",
    ),
  },
  {
    id: "bearer-opaque",
    category: "BEARER_OR_JWT",
    text: j("Authorization: Bearer ", "aB3dE6gH9jK2mN5pQ8sT1vW4"),
  },

  // --- Private keys --------------------------------------------------------
  {
    id: "pem-rsa",
    category: "PEM_PRIVATE_KEY",
    text: j(
      "-----BEGIN RSA PRIVATE KEY-----\n",
      "MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun",
      "\n-----END RSA PRIVATE KEY-----",
    ),
  },
  {
    id: "pem-openssh",
    category: "PEM_PRIVATE_KEY",
    text: j(
      "-----BEGIN OPENSSH PRIVATE KEY-----\n",
      "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtz",
      "\n-----END OPENSSH PRIVATE KEY-----",
    ),
  },
  {
    id: "pem-generic",
    category: "PEM_PRIVATE_KEY",
    text: j(
      "-----BEGIN PRIVATE KEY-----\n",
      "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg",
      "\n-----END PRIVATE KEY-----",
    ),
  },

  // --- Connection strings --------------------------------------------------
  {
    id: "postgres-uri",
    category: "DB_CONNECTION_URI",
    text: j("postgres://", "svc_worker", ":", "S3cr3tPass99", "@db.internal:5432/app"),
  },
  {
    id: "mongo-srv-uri",
    category: "DB_CONNECTION_URI",
    text: j(
      "mongodb+srv://",
      "analytics",
      ":",
      "Hq7Lm2Np9Rs",
      "@cluster0.abcd.mongodb.net/prod",
    ),
  },
  {
    id: "mysql-uri",
    category: "DB_CONNECTION_URI",
    text: j("mysql://", "root", ":", "R00tPassw0rd", "@10.20.30.40:3306/shop"),
  },
  {
    id: "redis-uri",
    category: "DB_CONNECTION_URI",
    text: j("redis://", "cache", ":", "Zx8Cv7Bn6Mm5", "@redis-prod:6379"),
  },

  // --- Payment / identity --------------------------------------------------
  { id: "card-visa", category: "CREDIT_CARD", text: j("card ", "4111 1111 1111 1111") },
  { id: "card-mastercard", category: "CREDIT_CARD", text: j("5555 5555 5555 4444") },
  { id: "card-amex", category: "CREDIT_CARD", text: j("amex ", "3782 822463 10005") },
  { id: "ssn", category: "US_SSN", text: j("ssn ", "123-45-6789") },
  { id: "aadhaar", category: "GOV_ID", text: j("aadhaar ", "1234 5678 9012") },
  { id: "iban", category: "IBAN", text: j("IBAN ", "GB82 WEST 1234 5698 7654 32") },

  // --- Contact / personal --------------------------------------------------
  { id: "email-personal", category: "EMAIL", text: j("reach me at ", "maya.reyes", "@", "gmail.com") },
  { id: "email-work", category: "EMAIL", text: j("escalate to ", "oncall", "@", "acme-corp.io", " today") },
  { id: "phone-us", category: "PHONE", text: j("call ", "+1-415-555-0199") },
  { id: "phone-labelled", category: "PHONE", text: j("phone: ", "(415) 555-0199") },
  {
    id: "address-us",
    category: "ADDRESS",
    text: j("my address is ", "742 Evergreen Terrace, Springfield 49007"),
  },
  { id: "person-name", category: "PERSON", text: j("my name is ", "Jonathan Reyes") },
  { id: "postal-code", category: "POSTAL_CODE", text: j("zip code: ", "94107") },
  {
    id: "company-name",
    category: "ORG_TERM",
    text: j("i work at ", "Northwind Traders Inc"),
  },

  // --- Secrets in prose ----------------------------------------------------
  {
    id: "password-inline",
    category: "PASSWORD",
    text: j("password: ", "Tr0ub4dor&3x"),
  },
  {
    id: "phi-diagnosis",
    category: "CONTEXTUAL_PHI",
    text: j("diagnosed with ", "stage 2 lymphoma at Mercy General"),
  },
  {
    id: "ma-terms",
    category: "M_AND_A_SECRET",
    text: j("Project Bluebird ", "valuation $4.2B term sheet"),
  },
  {
    id: "account-number",
    category: "ACCOUNT_NUMBER",
    text: j("account number: ", "000123456789"),
  },

  // --- Encoding variants ---------------------------------------------------
  {
    id: "multiline-assignment",
    category: "API_KEY",
    text: j("token:\n  ghp_", "aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0dF3hJ6"),
  },
  {
    id: "quoted-secret",
    category: "API_KEY",
    text: j("const key = '", "sk_live_", "51HxKq9dPz3rT7wY2nB8mC4v", "';"),
  },
  {
    id: "url-encoded-db-uri",
    category: "DB_CONNECTION_URI",
    text: j(
      "postgres%3A%2F%2F",
      "svc_worker",
      "%3A",
      "S3cr3tPass99",
      "%40db.internal%3A5432%2Fapp",
    ),
  },
  {
    id: "entropy-assigned",
    category: "HIGH_ENTROPY_SECRET",
    text: j('secret = "', "9F8a7B6c5D4e3F2a1B0c9D8e7F6a5B4c", '"'),
  },

  // --- Card bundle, addresses and Indian financial identifiers --------------
  { id: "card-rupay", category: "CREDIT_CARD", text: j("rupay ", "6521 5678 9012 3453") },
  {
    id: "card-bundle",
    category: "CREDIT_CARD",
    text: j("pay with ", "4111 1111 1111 1111", " exp 09/29 cvv 123"),
  },
  { id: "card-expiry", category: "CARD_EXPIRY", text: j("the card is valid thru ", "11/27") },
  { id: "cvv-labelled", category: "CVV", text: j("security code ", "456", " is on the back") },
  { id: "upi-oksbi", category: "UPI_ID", text: j("send the split to ", "ravi.kumar@oksbi") },
  { id: "upi-ybl", category: "UPI_ID", text: j("merchant collects on ", "9876543210@ybl") },
  { id: "pan-id", category: "PAN_ID", text: j("pan ", "ABCPE1234F", " is on the KYC form") },
  { id: "ifsc", category: "IFSC", text: j("transfer to ", "HDFC0001234", " for the refund") },
  {
    id: "address-india-cued",
    category: "ADDRESS",
    text: j("address ", "143/A, 2nd Cross, Indiranagar, Bengaluru 560038"),
  },
  {
    id: "address-india-flat",
    category: "ADDRESS",
    text: j("flat no ", "7, Shanti Nagar, Mysuru 570001"),
  },
  {
    id: "address-india-hash",
    category: "ADDRESS",
    text: j("#42-B Sector 21, Gurugram 122016"),
  },
  {
    // The locality and PIN sit on the next line, so the span has to cross the newline.
    id: "address-india-multiline",
    category: "ADDRESS",
    text: j("Address: ", "143/A, 2nd Cross\nIndiranagar, Bengaluru 560038"),
  },
  {
    // No cue and no door token: the street suffix plus the ZIP has to carry the span.
    id: "address-us-zip",
    category: "ADDRESS",
    text: j("742 Evergreen Terrace, ", "Springfield 62704"),
  },
];

export const BENIGN: string[] = [
  "commit 3f2a9c1b8e4d7f6a0c5b2e9d1a4f7c3b8e6d0a2f broke the build",
  "short sha abc1234 on main",
  "request id 550e8400-e29b-41d4-a716-446655440000",
  "bump to v4.5.0 and tag the release",
  "npm install --save-dev @types/node@22.10.2",
  "minified bundle a=function(t){return t.map(function(e){return e*2})}",
  "TypeError: Cannot read properties of undefined (reading 'map')",
  "HTTP 502 Bad Gateway on /healthz after the rollout",
  "Order INV-2026-0042 is still unpaid",
  "Invoice number INV-2026-0042 is unpaid",
  "tracking number 1Z999AA10123456784 cleared customs",
  "Deploy is scheduled for Tuesday at 10:30",
  "the dev server listens on port 8080",
  "open http://localhost:3000/settings and check the toggle",
  "edit package.json and tsconfig.json",
  "the accent colour is #00E5A3 and the border is #2A3342",
  "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "the sklearn pipeline trains in under a minute",
  "The quick brown fox jumps over the lazy dog",
  "Error: ECONNREFUSED 127.0.0.1:5432 while connecting",
  "update README.md and CHANGELOG.md before merging",
  "SELECT id, email FROM users WHERE id = 1",
  "curl -X POST https://api.example.com/v1/items -d '{}'",
  "npm ERR! code E404 while resolving the dependency",
  "12 files changed, 340 insertions(+), 88 deletions(-)",
  "the iPhone 15 Pro Max ships with a USB-C port",
  "Windows 11 build 22631.3155 fixed the audio bug",
  "we run Node 22.23.3 in CI",
  "git rebase --onto main~3 main feature/login",
  "Add retry with exponential backoff to the upload queue",
  "meeting moved to 3pm in Room 4B",
  "the invoice total is 1,250.00 USD",
  "docker run -p 8080:8080 myimage:latest",
  "the password field is empty on Safari",
  "why does the password reset email never arrive",
  "cache hit ratio is 94.2% this hour",
  "the feature flag rollout is at 25 percent",
  "v2.1/A shipped to staging this morning",
  "HTTP 404 from the CDN edge node",
  "order 4111111111111112 shipped today",
  "tracking 1234567890123456 cleared customs",
  "retry after 500 ms with exponential backoff",
  "the queue still holds 128 items",
  "deployed 2026-11-22 at noon",
  "phase 2 rollout finished ahead of schedule",
  "build hash a1b2c3d4e5 is stable",
  // The word "address" with no number after it is a topic, not a location.
  "the diff touches address parsing, not the build",
  "see the address column in the users table",
];
