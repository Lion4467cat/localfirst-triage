# LocalFirst Triage (`v4.0`)

**Hybrid-AI Zero-Leakage Incident Copilot across Web PWA, Chrome Extension (MV3), and Native Android.**

Built for **#BuildHybridAI 2026** on **100% `$0.00` Firebase Spark Tier** infrastructure (`para-1-2e22b`).

- **Live Web PWA:** [`https://para-1-2e22b.web.app/`](https://para-1-2e22b.web.app/)
- **Platforms:** React/TypeScript Web PWA + Manifest V3 Chrome Extension + Native Kotlin/Jetpack Compose Android App (`com.localfirst.triage`)
- **License:** [Apache-2.0](./LICENSE)

---

## Core Architectural Breakthrough

Production support tickets and crash dumps routinely mix secrets (AWS/Firebase/OpenAI/Stripe/GitHub keys, PEM keys, DB URIs, Luhn payment cards, SSNs) with implicit **clinical PHI**, **natural-language password hints**, and **confidential M&A deal terms**. Sending raw logs straight to a cloud LLM violates compliance; stripping everything into brittle placeholders breaks diagnostics.

**LocalFirst Triage v4.0** enforces a **Two-Stage Hybrid AI + Defense-in-Depth Union Privacy Firewall**:

1. **Stage 1 — Local Semantic Privacy Firewall (`InferenceMode.ONLY_ON_DEVICE`):**
   - Runs **Gemini Nano 4** on-device (`firebase/ai` on Web; `com.google.firebase:firebase-ai-ondevice:16.0.0-beta08` on Android) with strict **Defense-in-Depth Union** (`includeHeuristics: true` always):
     `NANO_SEMANTIC_FIREWALL (priority 4)` ∪ `POLICY_TERM (3)` ∪ `REGEX_FIREWALL (2)` ∪ `ENTROPY_SCANNER (2)` ∪ `HEURISTIC_GUARD (1)` ∪ `MANUAL_MASK (5)`.
   - Priority resolution ensures Gemini Nano 4 keeps badge attribution on overlapping spans while deterministic `HEURISTIC_GUARD`, `REGEX_FIREWALL`, and Shannon `ENTROPY_SCANNER` guarantee **zero leakage** even if on-device Nano 4 under-extracts or is still downloading.
   - **Local P2/P3 Runbook Short-Circuit (`$0` Cloud Tokens, Offline-Capable):** Resolves **6** built-in engineering runbooks completely on-device without touching Cloud Gemini.
2. **Pre-Cloud Review Gate & Fail-Closed Quarantine:**
   - If Nano 4 is `READY`: enters a cancelable `PRE_CLOUD_COUNTDOWN` review window with interactive inline diff pills and manual text-selection masking.
   - If Nano 4 is unavailable/downloading: fails **closed** into `QUARANTINED_PENDING_APPROVAL`—zero bytes leave the browser/device until a human explicitly reviews the redaction diff and clicks **Approve & Escalate**.
   - **Airplane / Offline Mode:** Hard-blocks Cloud calls and Firestore sync (`OFFLINE_QUEUED`) and queues sanitized payloads for reconnect.
3. **Stage 2 — Zero-Leakage Cloud Escalation & Hybrid Executive Brief:**
   - Before any outbound Cloud call or Firestore write, `verifyZeroLeakage()` inspects outbound strings across raw, URL-encoded, JSON-escaped, and merged `constituentTexts` forms plus raw credential regex guards.
   - **Streaming Cloud RCA:** Uses Firebase AI Logic (`gemini-3.5-flash-lite` primary → `gemini-2.5-flash` fallback, remotely tunable via Firebase Remote Config).
   - **Hybrid Stakeholder Brief (`InferenceMode.PREFER_ON_DEVICE`):** Prefers on-device Nano 4 (`Source: ON_DEVICE`) when ready and falls back cleanly to Cloud Gemini when unavailable.

---

## Multi-Platform Parity (Web PWA + Chrome MV3 Extension + Native Android)

| Capability | Web PWA (`src/`) | Chrome Extension (`extension/`) | Android Companion (`android/`) |
| :--- | :--- | :--- | :--- |
| **On-Device AI SDK** | `firebase/ai` (`ONLY_ON_DEVICE` + `PREFER_ON_DEVICE`) | `sidepanel` + `firewall-core.js` | `firebase-bom:35.2.0` (`firebase-ai:18.2.0`, `firebase-ai-ondevice:16.0.0-beta08`) |
| **Deterministic Firewall** | `REGEX_FIREWALL`, `ENTROPY_SCANNER`, `HEURISTIC_GUARD`, `POLICY_TERM` | 100% parity offline pre-redaction + `#handoff=` fragment transfer | `LocalFirewallEngine.kt` (`100%` rule & 6-runbook parity) |
| **Zero-PII Sync** | Lazy-loaded `firestoreTransport.ts` (`549.03 kB` split chunk, loaded only after sign-in) + IndexedDB | Zero-PII hash handoff into PWA (raw secret never in URL) | `FirestoreSyncRepository.kt` + volatile RAM map (`0` `Log.*`/`SavedStateHandle` PII) |
| **Auth & Security** | Anonymous Guest + Google Sign-In (`firebase/auth`), `ReCaptchaEnterpriseProvider` App Check (`localhost` debug restricted) | Strict CSP (`Manifest V3`), `openPanelOnActionClick` | Guest + Google Sign-In with sideload Guest guidance; Play Integrity / Debug App Check |
| **Remote Config** | `cloudModel`, `cloudFallbackModel`, `enableCloudEscalation`, `entropyThreshold`, `enterpriseBlockedTerms` | Inherits via Web PWA target | `RemoteConfigRepository.kt` live fetch + safe defaults |

### Built-In 6 Local Runbooks & 4 Demo Scenarios

- **6 Built-In P2/P3 Runbooks (On-Device, `$0` Cloud Tokens):**
  1. `RB_LOCAL_TLS_CERT` (`P3`) — Local Dev TLS Certificate Expired (`ERR_CERT_DATE_INVALID`, `CERT_HAS_EXPIRED`)
  2. `RB_LOCAL_DEPENDENCY_CONFLICT` (`P3`) — Local Package Dependency Conflict
  3. `RB_LOCAL_CORS_DEV` (`P3`) — Localhost CORS / Port Mismatch
  4. `RB_OAUTH_CLOCK_SKEW` (`P2`) — OAuth2 `invalid_grant` / NTP Clock Skew
  5. `RB_PORT_IN_USE` (`P3`) — Local Dev Port Already Bound (`EADDRINUSE`)
  6. `RB_OFFLINE_SW_CACHE` (`P2`) — Stale Service Worker / IndexedDB Cache Desync
- **4 Demo Scenarios:**
  1. `scenario-p0-semantic-leak` (`P0`): Semantic PHI (`Manipal ICU Floor 3`), natural-language password hint (`log in using his dog's name followed by 2026exclamation`), M&A deal (`Project-Chimera acquisition target at $42M valuation`), JWT, Firebase API key, email, phone
  2. `scenario-p3-local-runbook` (`P3`): Expired local TLS certificate resolved 100% locally via `RB_LOCAL_TLS_CERT`
  3. `scenario-p1-billing-webhook` (`P1`): PostgreSQL deadlock (`pg_locks`), DB URI, AWS/Stripe keys, Luhn Visa card, webhook secrets, US SSN, RSA PEM private key, person/location PII
  4. `scenario-p2-offline-oauth` (`P2`): Offline field kiosk OAuth clock skew resolved locally via `RB_OAUTH_CLOCK_SKEW`

---

## Security & Privacy Guarantees

- **Strict Zero-PII Storage & Cloud Rules:** `rawText`, `matchedText`, `constituentTexts`, and `spans` are NEVER written to IndexedDB or Cloud Firestore. Disk records store `[PURGED_FROM_DISK_FOR_PRIVACY]`, bounded lengths (`title <= 200`, `sanitizedText <= 50,000`, `resolution <= 50,000`), and immutable `createdAt`.
- **Enforced Firestore Security Rules (`firestore.rules`):** Owner-only UID ACL (`request.auth.uid == uid`), strict key allowlists, RE2 secret-prefix & PEM guards rejecting any unredacted credential server-side, and immutable `createdAt` enforcement.
- **Zero Git-Tracked Secrets:** `.env.local` and `android/app/google-services.json` are strictly gitignored (`android/app/google-services.json.example` provided as safe template); all synthetic fixtures in tests/demos assemble token prefixes dynamically so static secret scanners stay clean.

---

## Verified Test Coverage & Hardware Benchmarks

- **Chrome 158 Real GPU Hardware Verification:**
  - Verified on `google-chrome 158.0.8127.36-1` bound to NVIDIA GPU (`/dev/dri/renderD129`, `performance_class: 6`, `vram_mb: 8188`, `gemma4_component: 2026.11.3.1140`, `model_crash_count: 0`):
    - Stage 1 `InferenceMode.ONLY_ON_DEVICE`: `ON_DEVICE (Nano 4) · 3726ms`
    - Hybrid Brief `InferenceMode.PREFER_ON_DEVICE`: `Source: ON_DEVICE · 3779ms`
  - Live testing on real Nano 4 hardware uncovered that Nano 4 sometimes extracted only the first person name (`John`), proving why **Defense-in-Depth Union** (`includeHeuristics: true` always) and apostrophe-aware `NATURAL_SECRET` / paren-bounded `CONTEXTUAL_PHI` regex rules are essential across Web, Extension, and Android.
- **Web Automated Suite:** `npm test` — **`10/10` test files, `72/72` tests passing** (`vitest run`)
- **Web Production Bundle (`npm run build`):** `tsc --noEmit` + Vite build (`dist/index.html` `1.06 kB`, `index` `335.79 kB`; lazy `firestoreTransport` `549.03 kB` excluded until Auth sign-in)
- **Web E2E (`npm run test:e2e`):** **`9/9` Playwright flows passing**, `0` page errors, `0` Firebase AI SDK warnings
- **Android Native Suite (`./gradlew :app:testDebugUnitTest :app:assembleDebug`):** **`10/10` JUnit tests passing** (`LocalFirewallEngineTest`: 4, `ZeroLeakageAndSyncTest`: 3, `HybridAiClientTest`: 3), **`0` Kotlin warnings**, debug APK `27,791,717` bytes (`27M`).

---

## Local Setup & Verification

```bash
# 1. Install Web dependencies & configure .env.local (Spark Firebase keys)
npm install
cp .env.example .env.local

# 2. Run Web unit + integration tests, typecheck/build, and Playwright E2E
npm test
npm run build
npm run test:e2e

# 3. Android Native Companion (copy android/app/google-services.json first)
cd android
./gradlew :app:testDebugUnitTest :app:assembleDebug
```
