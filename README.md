# Cordon (`v4.6.2`)

**Unified 3-surface on-device hybrid AI privacy firewall across Chrome Extension (MV3), Native Android, and Web PWA.**

Built for **#BuildHybridAI 2026** on **Firebase Spark** infrastructure (`para-1-2e22b`) using **Firebase AI Logic** (`firebase/ai` & `firebase-ai`), **Gemini Nano 4** on-device inference, **Cloud Gemini** (`gemini-3.5-flash-lite` primary → `gemini-3.8-flash` fallback, live-tunable via Remote Config), **Firebase App Check**, and **Zero-PII Cloud Firestore**.

- **Live Web PWA:** [`https://para-1-2e22b.web.app/`](https://para-1-2e22b.web.app/)
- **4K Demo Video (2:33):** [`https://youtu.be/-O2F9ngdGJ4`](https://youtu.be/-O2F9ngdGJ4)
- **Public GitHub Repo:** [`https://github.com/Lion4467cat/localfirst-triage`](https://github.com/Lion4467cat/localfirst-triage)
- **Latest Release (`v4.6.2` — Extension ZIP + Android APK):** [`github.com/Lion4467cat/localfirst-triage/releases/tag/v4.6.2`](https://github.com/Lion4467cat/localfirst-triage/releases/tag/v4.6.2)
- **License:** [Apache-2.0](./LICENSE)

---

## Judge Quick-Check: Firebase AI Logic, App Check & Remote Config Runtime Map

Every claim below is a runtime call in tracked source, not a dependency sitting in a manifest.

| Surface | What runs at runtime | Where |
| :--- | :--- | :--- |
| **Web** | `initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true })` | `src/config/firebase.ts:179` |
| **Web** | `getAI(app, { backend: new GoogleAIBackend() })` | `src/config/firebase.ts:197` |
| **Web** | `getGenerativeModel(..., mode: InferenceMode.ONLY_ON_DEVICE)` — local semantic probe | `src/config/firebase.ts:219` |
| **Web** | `getGenerativeModel(..., mode: InferenceMode.PREFER_ON_DEVICE)` — hybrid brief | `src/config/firebase.ts:229` |
| **Web** | `getGenerativeModel(..., mode: InferenceMode.PREFER_IN_CLOUD)` — post-scrub cloud escalation | `src/config/firebase.ts:245` |
| **Web** | Cloud call site: `createCloudEscalationModel(ai, modelName, …)` | `src/firewall/pipeline.ts:162` |
| **Web** | `inferenceSource` surfaced in telemetry (`ON_DEVICE` vs `IN_CLOUD`) | `src/config/firebase.ts:260`, `src/firewall/pipeline.ts:778` |
| **Android** | `Firebase.ai(backend = GenerativeBackend.googleAI())` | `ai/HybridAiClient.kt:81` |
| **Android** | `InferenceMode.ONLY_ON_DEVICE` — status probe, model download, semantic PII pass; fails closed to `LocalFirewallEngine` | `ai/HybridAiClient.kt:118`, `:171`, `:256` |
| **Android** | `InferenceMode.ONLY_IN_CLOUD` — post-scrub Stage 2 escalation (stream + unary) | `ai/HybridAiClient.kt:275`, `:291` |
| **Android** | `InferenceMode.PREFER_ON_DEVICE` — stakeholder brief | `ai/HybridAiClient.kt:304` |
| **Android** | App Check, release: `PlayIntegrityAppCheckProviderFactory` | `src/release/…/AppCheckInitializer.kt:11` |
| **Android** | App Check, debug: `DebugAppCheckProviderFactory` (token never committed) | `src/debug/…/AppCheckInitializer.kt:11` |
| **Extension** | Chrome built-in `LanguageModel` semantic pass (`runExtensionNanoScan`) | `extension/firewall-core.js:1026`, `:1044` |
| **Web** | `loadRuntimeConfig()` on startup and on manual refresh — `fetchAndActivate` with a 3.5 s deadline | `src/App.tsx:246`, `:222` → `src/config/firebase.ts:366` |
| **Android** | `remoteConfigRepo.loadRuntimeConfig()` on ViewModel init — `fetchAndActivate` with a 3.5 s deadline | `ui/TriageViewModel.kt:204` → `data/RemoteConfigRepository.kt:18` |

**Why the extension does not call Firebase AI Logic directly.** An MV3 content script runs under the page's CSP and the extension's own CSP, and a service worker cannot load the remote reCAPTCHA script that `ReCaptchaEnterpriseProvider` requires. The extension therefore keeps the deterministic floor plus the Chrome built-in model locally, and routes cloud escalation through the `#handoff=` bridge to the Firebase-hosted, App Check–protected Web Workbench at [`https://para-1-2e22b.web.app/`](https://para-1-2e22b.web.app/). That is a platform constraint, stated rather than hidden.

**Why the two escalation modes differ.** The Web Workbench uses `PREFER_IN_CLOUD`: it already holds a warmed on-device model, so a dropped network can be served locally instead of failing. Android uses `ONLY_IN_CLOUD`: the escalation input has been scrubbed and verified, and if the cloud cannot answer the app must say so rather than quietly substitute a different model. That failure is visible — `inferenceSource = CLOUD_ERROR` renders the amber `LOCAL FALLBACK` card with the reason, and `inferenceSource` reports which path actually served every successful response.

**Why Remote Config, and why it cannot break the demo.** Five non-sensitive knobs are fetched at startup on Web and Android: `cloud_primary_model` (with `cloud_model` kept as a legacy alias), `cloud_fallback_model`, `enable_cloud_escalation`, `entropy_threshold`, `enterprise_blocked_terms`. Every read is bounded by a 3.5 s `withTimeoutOrNull` and every failure path — offline, unconfigured Firebase, timeout, malformed JSON — returns `DEFAULT_FALLBACK` with the same values compiled into the binary (`RemoteConfigRepository.kt:23-27`, `:69-70`; `src/config/firebase.ts:371-375`). The entropy threshold is clamped to `[2.0, 5.5]` and the term list is length-capped at 200, so a bad remote value degrades rather than disarms the firewall. No PII is ever sent to Remote Config; it is read-only configuration.

**Why there is no Firebase Auth or Firestore on the hot path.** Cordon's cloud surface is deliberately minimal: AI Logic plus App Check plus Hosting plus Remote Config. The scrub-and-escalate path never opens a database connection and never needs a user identity — Stage 2 runs on the anonymous session AI Logic creates for its own auth token (`HybridAiClient.kt:88-96`). Firestore exists only for *opt-in* sync of already-sanitized triage records, and that write is gated twice: `buildZeroPiiTicketPayload` refuses the write if `verifyZeroLeakage()` finds a single surviving span (`FirestoreSyncRepository.kt:293-298`), and `firestore.rules` rejects `rawText`, `matchedText` and `constituentTexts` server-side. So the auth-gated database never holds the thing the product exists to protect — that is the architectural point, not an omission.

---

## The UX contract

1. **The browser shield never interrupts composition.** The extension stays silent while you type or paste.
2. **One confirmation when a draft holds an unredacted secret.** The extension asks at Send; Android asks when the watched field changes.
3. **Scrub & Send** replaces the text with the sanitized version and sends it. **Reject & Send Anyway** sends the raw text once and never re-prompts for that exact draft.

Every surface enforces the same rule: a secret is masked locally before any byte reaches a cloud model.

---

## 3-Surface Architecture

| Surface | Role & Capabilities | Core Engine |
| :--- | :--- | :--- |
| **Chrome Extension (`extension/`)** | Capture-phase Paste shield + Send interception on `chatgpt.com`, `claude.ai`, `gemini.google.com`, `github.com`, `app.slack.com`, `discord.com`; Side Panel control center (`Low` / `Medium` / `High`, 0-PII stats, `#handoff=` bridge) | `firewall-core.js` + Chrome `LanguageModel` (Nano 4 semantic pass at Medium & High) |
| **Native Android (`android/`)** | Watches the composer field in every guarded app and opens a full-screen decision modal before text leaves: `Scrub in Field` rewrites the field in place, `Allow Once (Unsafe)` releases that exact draft. Password fields, keyboards, launchers and system surfaces are never locked. Guard any installed app from Settings, plus `Scrub with Cordon` text action (`ACTION_PROCESS_TEXT`), Share Sheet (`ACTION_SEND`), offline runbook resolution and Zero-PII Firestore sync | `LocalFirewallEngine.kt` + `firebase-ai` (`18.2.0`) & `firebase-ai-ondevice` (`16.0.0-beta08`) |
| **Web PWA (`src/`)** | Hybrid Workbench (`ONLY_ON_DEVICE`, `PREFER_ON_DEVICE`, `PREFER_IN_CLOUD`), `<5ms` IndexedDB dedup cache, RAM-only rehydration vault, ECDSA P-256 audit receipts (public key embedded, independently verifiable), lazy-loaded Firestore sync | `src/firewall/` + `firebase/ai` (`firebase@13.3.0`) |

### Android guarded apps (12)

Chat: ChatGPT (`com.openai.chatgpt`), Claude (`com.anthropic.claude`), Gemini (`com.google.android.apps.bard`), Slack (`com.Slack`), WhatsApp (`com.whatsapp`), Discord (`com.discord`).
Browsers: Chrome, Firefox, Brave, Edge, Samsung Internet, Opera.

### Chrome extension guarded sites (6)

ChatGPT, Claude, Gemini, GitHub, Slack, Discord. Textareas are protected on `Ctrl/Cmd+Enter`; rich-text composers on plain `Enter`.

---

## Verified Third-Party Benchmarks (`Before → After`, Medium tier)

Measured against real external datasets — `ai4privacy/pii-masking-300k` (150 English rows), upstream `gitleaks/gitleaks` (`config/gitleaks.toml`, 221 rules parsed), and 100 clean developer/prose chunks:

| Metric (`medium` Default · Web & Extension Parity) | Baseline | Optimized |
| :--- | :---: | :---: |
| **Suite A1 — Structured PII (`ai4privacy/pii-masking-300k`, 89 specs)** | `22.5%` (`20/89`) | **`70.8%` (`63/89`)** |
| **Suite A2 — Unstructured PII (`23 specs`)** | `0.0%` (`0/23`) | **`0.0%` (`0/23`)** — deterministic-only limit; see *Scope & limits* |
| **Suite B — Gitleaks Vendor Credentials (`42` specs)** | `59.5%` (`25/42`) | **`100.0%` (`42/42`)** |
| **Suite C — Dev / Code False-Positive Rate (`100` chunks)** | `1.0%` (`1/100`) | **`0.0%` (`0/100`)** |
| **Deterministic Latency (Median / P95)** | `0.016ms` / `0.025ms` | **`0.022ms`** / **`0.036ms`** |
| **Strict 3-Pass Idempotency Failures** | `0` | **`0`** |

Reproduce anytime locally:

```bash
node scripts/benchmark-third-party.mjs --out=benchmarks/third-party-optimized.json
```

Suite A2 is reported honestly: deterministic regex/entropy heuristics do not resolve unstructured PII, which is why the on-device Nano 4 semantic pass exists. Benchmarks measure the deterministic floor only.

### On-device benchmark (Moto G82 5G, API 33, arm64, `CordonBench`)

The same engine measured on a mid-range ARM phone, not a workstation:

| Metric | Result |
| :--- | :---: |
| **Recall** (81 synthetic secrets/PII across 20 categories) | **`100.0%` (81/81)** |
| **False positives** (46 benign developer & everyday prompts) | **`0.0%` (0/46)** |
| **Latency p50 / p95 / max** | **`1.42 ms` / `4.01 ms` / `6.94 ms`** |
| **Raw secret substrings persisted in `ShieldStore`** | **`0`** |
| **Raw values surviving the scrub in output** | **`0`** |

Every category scored 100%: `ADDRESS`, `API_KEY`, `AWS_ACCESS_KEY`, `AWS_SECRET_KEY`, `BEARER_OR_JWT`, `CARD_EXPIRY`, `CREDIT_CARD`, `CVV`, `DB_CONNECTION_URI`, `EMAIL`, `GOV_ID`, `HIGH_ENTROPY_SECRET`, `IBAN`, `IFSC`, `PAN_ID`, `PASSWORD`, `PEM_PRIVATE_KEY`, `PHONE`, `UPI_ID`, `US_SSN`.

Reproduce: `cd android && ./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.localfirst.triage.OnDeviceFirewallBenchmarkTest`, then `adb logcat -d | grep CordonBench`.

The Chrome extension scores `80` positives / `48` benign at `100%` recall and `0%` false positives across 26 categories (`npm test`, `tests/extensionBenchmark.test.ts`).

### Hardware benchmark (three surfaces, same corpus)

Retail AICore ships Gemini Nano on the S26 Ultra, so the same APK runs the hybrid path with no developer preview. The Moto G82 has no AICore, so it fails closed to the deterministic rules. The extension runs the same rules in MV3.

| Metric | Galaxy S26 Ultra (SM-S948B, API 37) | Moto G82 5G (API 33) | Chrome Extension (MV3) |
| :--- | :---: | :---: | :---: |
| **Stage 1 engine** | `ON_DEVICE` (`nano-v4-fast` via AICore) + deterministic union | `HEURISTIC_GUARD` + deterministic | `HEURISTIC_GUARD` + deterministic |
| **AICore status** | `AVAILABLE` → `NanoStatus.READY` | `UNAVAILABLE` (fail-closed) | n/a |
| **Demo sentence** ("cover for Maya… oncology clinic in Indiranagar") | **`3/3` semantic spans** (person, PHI, neighbourhood) | **`0/3`** semantic, fail-closed | **`0/3`** semantic, fail-closed |
| **Deterministic recall / FP** (MEDIUM dial) | **`100.0%` (81/81)** / **`0.0%` (0/46)** | **`100.0%` (81/81)** / **`0.0%` (0/46)** | **`100.0%` (80/80)** / **`0.0%` (0/48)** |
| **Deterministic latency p50 / p95 / max** | **`0.44 ms` / `0.63 ms` / `0.91 ms`** | **`1.42 ms` / `4.01 ms` / `6.94 ms`** | in-page, `npm test` |
| **Live AI-app lock latency** | **`7–44 ms`** — WhatsApp `7`, ChatGPT `10`, Gemini `11`, Chrome `16`, Google `31`, Perplexity `44` | n/a | n/a |
| **Multi-turn post-scrub re-lock** | **`7–17 ms`** | n/a | n/a |
| **Hybrid on-device pass** (sentence + card + key, Airplane Mode) | **`6` spans in `2,513 ms`**, `ON_DEVICE` badge, **0 network bytes** | `6` spans, `~1.4 ms` | n/a |
| **Composition interruptions** | **`0`** | **`0`** | **`0`** |
| **Raw PII left device** | **`0`** | **`0`** | **`0` raw secrets in handoff** |

Measured with Wi-Fi off. `adb logcat -s CordonNano` on the S26 shows `probe option=preview status=READY`, `onDevice modelName=nano-v4-fast` and `sandbox status=READY model=nano-v4-fast semantic=5 spans=6 latency=2513ms`; the result card renders the `Gemini Nano` badge next to `Scrubbed · 6 blocked · 0 Leaked`. `CordonBench` on the same phone: `device=SM-S948B api=37 abi=arm64-v8a`, `overall recall=100.0% (81/81)`, `false positive rate=0.0% (0/46)`, `storedEntries=81 rawSecretSubstringsInStore=0`, `scrubbedOutputLeaks=0`. The live lock figures come from the six-app sweep (`adb logcat -s CordonA11y`, `textChanged → modalShown elapsedMs`).

---

## Use Cordon (no coding needed)

### A. Web app — 30 seconds

1. Open [`https://para-1-2e22b.web.app/`](https://para-1-2e22b.web.app/).
2. Click **Sign in as Guest** (or Google).
3. Click **Run Privacy Firewall** on any built-in scenario and watch the secrets turn into `[REDACTED:...]` before the AI answer appears.

### B. Chrome extension — 1 minute

1. Open the [Releases page](https://github.com/Lion4467cat/localfirst-triage/releases) and download the extension ZIP, then unzip it anywhere.
2. In Chrome, open `chrome://extensions` and switch on **Developer mode** (top-right).
3. Click **Load unpacked** and pick the unzipped `extension` folder. Pin Cordon to the toolbar.
4. Click the Cordon icon. The side panel opens and shows the switch at **ON**. Follow the three steps shown there: open ChatGPT, type or paste a secret, press **Send**.

You will see exactly **one** confirmation: **Scrub & Send** (safe version goes out) or **Send anyway** (raw text goes out once). Typing alone never opens anything.

### C. Android app — 2 minutes

1. On the phone, open the [`v4.6.2` Release page](https://github.com/Lion4467cat/localfirst-triage/releases/tag/v4.6.2) and download [`cordon-android-v4.6.2.apk`](https://github.com/Lion4467cat/localfirst-triage/releases/download/v4.6.2/cordon-android-v4.6.2.apk), then tap it to install (allow "install unknown apps" when Android asks).
2. Open **Cordon**. On the **Shield** tab, tap **Enable Background Shield**.
3. Android opens Accessibility settings: tap **Cordon**, then switch it **on** and confirm. *(Samsung One UI / Android 13+ sideload note: if **Cordon** is greyed out in Accessibility, open **Settings → Apps → Cordon → ⋮ (top-right) → Allow restricted settings**, then return to Accessibility and toggle **Cordon** ON.)*
4. Go back to Cordon. The Shield tab now says the shield is on. Open ChatGPT (or any listed app), type a secret, and tap **Send**. *(Note on App Check & sideloaded APKs: debug/sideloaded APKs fail closed on `ONLY_IN_CLOUD` unless Play Store–distributed or debug-token registered — the UI reports `LOCAL FALLBACK` / `CLOUD_ERROR`, while 100% of on-device Gemini Nano `ONLY_ON_DEVICE` and Accessibility firewall protections keep running locally.)*

To scrub text without sending: highlight it in any app and tap **Scrub with Cordon**, or use the Share Sheet.

### Nothing happened? (quick checks)

| Symptom | Fix |
| :--- | :--- |
| Extension does nothing on a site | The switch must be **ON**; only the 6 listed sites are auto-guarded; reload the tab after installing. |
| No prompt on Send in a textarea | Use `Ctrl/Cmd+Enter` — plain Enter inserts a newline there. |
| Android never prompts | Accessibility is on for **Cordon**, the app is in the guarded list, and the message actually contains a secret. |
| Cloud answer missing | You are offline or App Check is not configured; local scrubbing still works and fails closed. |

---

## Build from Source (developers)

```bash
# Web + extension
npm ci
npm run dev            # local web app
# extension: chrome://extensions -> Load unpacked -> select extension/

# Android (needs your own Firebase Android app config)
cp android/app/google-services.json.example android/app/google-services.json
#   then replace the placeholder values with your Firebase project's
#   (or download the real file from Firebase Console -> Project settings -> Your apps)
cd android && ./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The Release APK ships this project's Firebase config, so AI Logic and App Check work out of the box. A build with the placeholder config still runs: Stage 1 keeps scrubbing on-device, cloud escalation reports `CLOUD_ERROR`, and the UI says so instead of pretending it succeeded.

## Build & Test (verified counts)

```bash
npm ci && npm run build            # TypeScript + Vite production build
npm test                           # Vitest: 26 files, 227 tests passing
npm run test:e2e                   # Playwright: 10/10 flows, 0 page errors
cd android && ./gradlew testDebugUnitTest lintDebug assembleDebug
                                   # 17 classes, 123 tests passing, 0 lint errors
```

---

## Zero-PII Guarantees

- **RAM-only raw text.** Raw text and the rehydration vault never touch IndexedDB, Firestore, URLs, or logs. The dedup cache stores a SHA-256 fingerprint plus a sanitized 140-char preview.
- **Server-enforced storage.** `firestore.rules` validates every field, rejects `rawText` / `matchedText` / `constituentTexts`, and blocks unredacted AWS, Google, PEM, JWT, Stripe, Slack, and GitHub credential shapes with RE2 matches.
- **Verified egress.** `verifyZeroLeakage()` checks raw, URL-encoded, and JSON-escaped variants of every masked span before any cloud call.
- **Verifiable receipts.** Each triage mints an ECDSA P-256 receipt containing the public key JWK and thumbprint; `verifyAuditReceipt()` re-verifies the signature from the receipt alone, including after export/re-import.

---

## Scope & Limits (stated honestly)

- The Android shield guards the **12 listed packages**. Other browsers and niche apps are covered by the manual `ACTION_PROCESS_TEXT` / Share Sheet scrub, not by automatic interception.
- The Android accessibility path is **deterministic (regex + entropy + heuristics)**; Nano 4 runs in the in-app workbench, not inside the accessibility service.
- Automatic interception requires a detectable Send control. Icon-only custom canvases without a label or `contentDescription` fall back to manual scrub.
- The Android decision is a full-screen `TYPE_ACCESSIBILITY_OVERLAY` covering `[0,0][1080,2400]` with `BLOCK_UNTRUSTED` occlusion, not a shield placed over the Send control. While it is up, no control in the app underneath can be tapped, including the app's own Send button.
- The soft keyboard's own Send arrow is covered by the same window. Measured on the Moto G82: with no modal, one tap on the keyboard action key at `(996,2154)` navigates Chrome to `about:blank`; with the modal up, the identical tap at the identical coordinate leaves the omnibox text intact, the page unchanged, and the screen byte-identical.
- `onKeyEvent` hardware-Enter filtering is configured (`canRequestFilterKeyEvents`) but could not be exercised on this device: no evdev node emits `KEY_ENTER` (gpio-keys exposes only `0x73`, qpnp_pon `0x72`/`0x74`, uinput-focal `0x26e`, double-tap `0x3b`–`0x3e`), and `adb shell input keyevent` injects below the accessibility input filter, so the callback is never invoked. The touch-path measurement above is the proof that matters on a touch-only device.
- Extension textareas need `Ctrl/Cmd+Enter`; plain `Enter` keeps inserting newlines by design.
- On devices without the Chrome built-in model, the extension's Nano pass is skipped and the deterministic floor applies.

---

## Disclosure (required by the hackathon rules)

**Pre-existing work.** Cordon builds on an earlier LocalFirst Triage prototype (`v2.4`, first committed 2026-11-15). The pre-existing code covered the deterministic Kotlin/TypeScript redaction engine and an early two-screen Android shell. No third-party proprietary code is incorporated; all dependencies are open-source and listed in `package.json` / Gradle files.

**Built during the submission period (2026-11-11 → 2026-11-30).** The Chrome MV3 extension (paste shield, send interception, side panel, `#handoff=` bridge), the three-surface Zero-PII sync model with `firestore.rules`, the hybrid pipeline with Nano 4 defense-in-depth union, ECDSA audit receipts, the accessibility send-button shield, the 3-tab Compose UI, the third-party benchmark harness, and all test suites were written during the submission period.

---

## Built With

- **Antigravity** & **Firebase Agent Skills** (`firebase-ai-logic-basics`, `firebase-auth-basics`, `firebase-firestore`, `firebase-hosting-basics`, `firebase-security-rules-auditor`)
- **Zero-Cost Spark Stack:** Firebase Hosting, Auth, Cloud Firestore, Remote Config, App Check (reCAPTCHA Enterprise / Play Integrity / Debug)
- **Web & Extension:** React 19, TypeScript 5, Tailwind CSS 4, Vite 6, IndexedDB, MV3, Vitest, Playwright
- **Android:** Kotlin, Jetpack Compose Material 3, `compileSdk`/`targetSdk` 36, `minSdk` 26, Gradle 9.8.0 / AGP 9.4.1, JUnit
