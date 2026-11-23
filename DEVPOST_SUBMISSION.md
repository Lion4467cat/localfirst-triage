# Cordon (`v4.6.1`) — #BuildHybridAI 2026 Submission

- **Live Web PWA:** [`https://para-1-2e22b.web.app/`](https://para-1-2e22b.web.app/)
- **Public GitHub Repository:** [`https://github.com/Lion4467cat/localfirst-triage`](https://github.com/Lion4467cat/localfirst-triage)
- **Releases (Extension ZIP + Android APK `v4.6.1`):** [`github.com/Lion4467cat/localfirst-triage/releases`](https://github.com/Lion4467cat/localfirst-triage/releases)
- **Demo video (≤3 min, YouTube, public):** `<!-- VIDEO_URL: add the public YouTube link here before submitting -->`

---

## Elevator Pitch

**Zero-leakage hybrid AI incident copilot across Web PWA, Chrome Extension (MV3), and native Android (`com.localfirst.triage`).** Cordon masks secrets, clinical PHI, password hints, and M&A deal terms strictly on-device with **Gemini Nano 4 (`ONLY_ON_DEVICE`) plus a deterministic defense-in-depth floor**, before a single byte reaches Cloud Gemini or Firestore. It runs on the **$0 Firebase Spark tier** and works offline.

The core interaction is deliberately boring: **you never see a popup while typing.** Cordon speaks exactly once — when you press Send with an unredacted secret still in the box.

---

## The Problem

Engineers and support teams paste raw production stack traces, crash logs, and customer threads containing API keys, database URIs, PEM private keys, SSNs, Luhn-valid cards, ICU notes, password hints, and M&A codenames directly into cloud LLMs. Regex scripts miss secrets phrased in natural language; on-device models under-extract. A single paste is enough to leak.

---

## What Cordon Does

1. **Stage 1 — Local Semantic Privacy Firewall (`InferenceMode.ONLY_ON_DEVICE`).**
   Firebase AI Logic (`firebase/ai`, `firebase-ai-ondevice:16.0.0-beta08`) runs Gemini Nano 4 fully on-device, unioned with a deterministic floor: `REGEX_FIREWALL`, Shannon `ENTROPY_SCANNER`, `POLICY_TERM` (custom + Remote Config), and `HEURISTIC_GUARD` (`CONTEXTUAL_PHI`, `M_AND_A_SECRET`, `NATURAL_SECRET`, `PERSONAL_PII_LOCATION`). Priority-ordered merging gives Nano 4 top automated priority while the heuristic guard prevents leaks when Nano under-extracts or is still downloading.
2. **Six offline runbooks ($0 cloud tokens).** `RB_LOCAL_TLS_CERT`, `RB_LOCAL_DEPENDENCY_CONFLICT`, `RB_LOCAL_CORS_DEV`, `RB_OAUTH_CLOCK_SKEW`, `RB_PORT_IN_USE`, `RB_OFFLINE_SW_CACHE` resolve entirely on-device on Web and Android — including airplane mode.
3. **Human-in-the-loop pre-cloud gate.** Nano ready → cancelable review with highlight pills and manual masking. Nano unavailable → fail **closed** into `QUARANTINED_PENDING_APPROVAL` until an engineer approves.
4. **Stage 2 — verified cloud escalation.** `verifyZeroLeakage()` inspects every outbound string for unredacted spans, constituent texts, URL-encoded bypasses, and JSON-escaped bypasses; egress is blocked on any failure. RCA streams from Cloud Gemini (`gemini-3.5-flash-lite` → `gemini-3.8-flash`, Remote Config tunable); stakeholder briefs use `PREFER_ON_DEVICE`.
5. **Three surfaces, one contract.**
   - **Web PWA:** lazy-loaded Firestore (549 kB chunk) after Guest/Google sign-in, App Check, Zero-PII rules, ECDSA P-256 receipts with the public key embedded so anyone can re-verify them.
   - **Chrome Extension (MV3):** capture-phase paste shield and Send interception on ChatGPT, Claude, Gemini, GitHub, Slack, and Discord; side panel control center; sanitized-only `#handoff=` bridge.
   - **Native Android:** Jetpack Compose **Shield · History · Settings**, a field-watching accessibility shield that opens a full-screen decision modal before text leaves any guarded app (`Scrub in Field` rewrites the field, `Allow Once (Unsafe)` releases that draft), guard-any-app search over every installed app, plus `ACTION_PROCESS_TEXT` ("Scrub with Cordon"), Share Sheet, and Zero-PII sync.

---

## Try It (no setup knowledge required)

- **Web (30 s):** open the live PWA → **Sign in as Guest** → **Run Privacy Firewall** on any scenario.
- **Chrome extension (1 min):** download the ZIP from Releases → unzip → `chrome://extensions` → Developer mode → **Load unpacked** → pick the folder → click the Cordon icon → open ChatGPT and paste a key.
- **Android (2 min):** install `cordon-android-v4.6.1.apk` from Releases → open Cordon → **Enable Background Shield** → turn on **Cordon** in Accessibility settings → open ChatGPT, type a secret, tap Send.

Each surface shows exactly one confirmation on Send (**Scrub & Send** / **Send anyway**) and never interrupts typing.

---

## How Firebase AI Logic Is Used (runtime, not just imported)

Every row below is a call site in tracked source, verified on the connected device and in a real Chromium run.

| Surface | Runtime call | Where |
| :--- | :--- | :--- |
| Web | `initializeAppCheck` + `getAI(app, { backend: GoogleAIBackend })` | `src/config/firebase.ts:179`, `:197` |
| Web | Three models: `ONLY_ON_DEVICE`, `PREFER_ON_DEVICE`, `PREFER_IN_CLOUD` | `src/config/firebase.ts:219`, `:229`, `:245` |
| Web | Stage 2 cloud call on every escalation | `src/firewall/pipeline.ts:145` |
| Web | `loadRuntimeConfig()` — startup + manual refresh, 3.5 s deadline | `src/App.tsx:243`, `:219` |
| Android | `Firebase.ai(backend = GenerativeBackend.googleAI())` | `ai/HybridAiClient.kt:78` |
| Android | `ONLY_ON_DEVICE` status probe, download, semantic pass — fails closed to `LocalFirewallEngine` | `ai/HybridAiClient.kt:111`, `:163`, `:248` |
| Android | `ONLY_IN_CLOUD` Stage 2 escalation (stream + unary) | `ai/HybridAiClient.kt:267`, `:283` |
| Android | `PREFER_ON_DEVICE` stakeholder brief | `ai/HybridAiClient.kt:296` |
| Android | App Check: Play Integrity (release) / Debug provider (debug) | `src/release|debug/…/AppCheckInitializer.kt:11` |
| Android | `loadRuntimeConfig()` on ViewModel init, 3.5 s deadline | `ui/TriageViewModel.kt:204` → `data/RemoteConfigRepository.kt:18` |
| Extension | Chrome built-in `LanguageModel` semantic pass | `extension/firewall-core.js:934`, `:952` |

**The extension does not call AI Logic directly.** An MV3 content script runs under the page CSP plus the extension CSP, and a service worker cannot load the remote reCAPTCHA script `ReCaptchaEnterpriseProvider` needs. The extension keeps the deterministic floor plus Chrome's built-in model locally and hands cloud escalation to the App Check–protected Web Workbench through `#handoff=` — a stated platform constraint, not a hidden gap.

**Why no Firestore or Auth on the hot path.** The scrub-and-escalate path never opens a database and never needs an identity; Stage 2 rides the anonymous session AI Logic mints for its own auth token (`HybridAiClient.kt:68-70`). Firestore serves only opt-in sync of already-sanitized records, gated twice: `buildZeroPiiTicketPayload` refuses the write when `verifyZeroLeakage()` finds a surviving span (`FirestoreSyncRepository.kt:293-298`), and `firestore.rules` rejects `rawText`/`matchedText`/`constituentTexts` server-side. The database therefore never holds the data the product exists to protect.

**Remote Config is read-only and fails safe.** Five knobs (`cloud_primary_model`, `cloud_fallback_model`, `enable_cloud_escalation`, `entropy_threshold`, `enterprise_blocked_terms`) load at startup; every failure path returns the compiled defaults, the threshold is clamped to `[2.0, 5.5]`, and the term list is capped at 200. A bad remote value degrades the firewall, it does not disarm it.

---

## Challenges Overcome

- **Defense-in-depth was necessary, not decorative.** On real hardware, Nano 4 sometimes extracted only the first person name (`John`); gating the heuristic guard off when Nano was "ready" let clinical PHI and M&A terms through. Stage 1 is now an always-on union.
- **Boundary bugs found in production text.** Apostrophe boundaries (`dog's name`) and parenthesis overruns in `NATURAL_SECRET` / `CONTEXTUAL_PHI` were fixed identically across Web, Extension, and Android.
- **Deterministic storage rules.** Identical TypeScript and Kotlin serializers strip `rawText`, `matchedText`, `constituentTexts`, and `spans`; `firestore.rules` rejects those fields and blocks unredacted AWS/Google/PEM/JWT/Stripe/Slack/GitHub shapes with RE2.
- **Android send interception, rebuilt around what the platform actually allows.** The first design hunted the Send node and failed on unlabelled arrow buttons. It was replaced by a full-screen `TYPE_ACCESSIBILITY_OVERLAY` decision modal covering `[0,0][1080,2400]` with `BLOCK_UNTRUSTED` occlusion: while it is up, no control in the app underneath — including its Send button — can be tapped, and the keyboard's own Send arrow is covered by the same window. Measured on a Moto G82 5G: with no modal, one tap on the keyboard action key at `(996,2154)` navigates Chrome to `about:blank`; with the modal up, the identical tap leaves the omnibox intact, the page unchanged, and the screen byte-identical. `onKeyEvent` filtering is still configured via `canRequestFilterKeyEvents`, but this device has no evdev node that emits `KEY_ENTER` and `adb shell input keyevent` injects below the accessibility input filter, so we do not claim a hardware-Enter proof we could not run. Trigger policy is a 250 ms debounce for open-ended PII still growing at the end of the buffer and immediate lock for anything structured or terminated, which measured `elapsedMs=25–38` typed and `34` pasted.

---

## Measured Results (Medium tier, real third-party data)

| Suite | Baseline | Cordon |
| :--- | :---: | :---: |
| A1 — structured PII (`ai4privacy/pii-masking-300k`, 89 specs) | 22.5% | **70.8% (63/89)** |
| A2 — unstructured PII (23 specs) | 0% | **0% (0/23)** — why the Nano 4 pass exists |
| B — Gitleaks credentials (42 specs, 221 upstream rules parsed) | 59.5% | **100% (42/42)** |
| C — dev/code false positives (100 chunks) | 1.0% | **0.0% (0/100)** |
| Latency (median / P95) | 0.016 / 0.025 ms | **0.022 / 0.036 ms** |
| 3-pass idempotency failures | 0 | **0** |

Reproduce: `node scripts/benchmark-third-party.mjs --out=benchmarks/third-party-optimized.json`.

### On-device benchmark (`CordonBench`, Moto G82 5G, API 33, arm64)

| Metric | Result |
| :--- | :---: |
| Recall, 81 synthetic secrets/PII across 20 categories | **100.0% (81/81)** |
| False positives, 46 benign developer & everyday prompts | **0.0% (0/46)** |
| Latency p50 / p95 / max | **1.42 ms / 4.01 ms / 6.94 ms** |
| Raw secret substrings persisted in `ShieldStore` | **0** |
| Raw values surviving the scrub in output | **0** |

Every category scored 100%: `ADDRESS`, `API_KEY`, `AWS_ACCESS_KEY`, `AWS_SECRET_KEY`, `BEARER_OR_JWT`, `CARD_EXPIRY`, `CREDIT_CARD`, `CVV`, `DB_CONNECTION_URI`, `EMAIL`, `GOV_ID`, `HIGH_ENTROPY_SECRET`, `IBAN`, `IFSC`, `PAN_ID`, `PASSWORD`, `PEM_PRIVATE_KEY`, `PHONE`, `UPI_ID`, `US_SSN`. The Chrome extension scores 80 positives / 48 benign at 100% recall and 0% false positives across 26 categories.

### Hardware benchmark — Gemini Nano 4 on a Galaxy S26 Ultra, fail-closed on a Moto G82, MV3 in Chrome

| Metric | Galaxy S26 Ultra (SM-S948B, API 37) | Moto G82 5G (API 33) | Chrome Extension (MV3) |
| :--- | :---: | :---: | :---: |
| AICore status | `AVAILABLE` → `NanoStatus.READY` (`nano-v4-fast`) | `UNAVAILABLE` | n/a |
| "Cover for Maya… oncology clinic in Indiranagar" | **3/3 semantic spans** (person, PHI, neighbourhood) | 0/3 — fail-closed | 0/3 — fail-closed |
| Deterministic recall / FP (`CordonBench`, MEDIUM dial) | **100.0% (81/81)** / **0.0% (0/46)** | **100.0% (81/81)** / **0.0% (0/46)** | **100.0% (80/80)** / **0.0% (0/48)** |
| Deterministic latency p50 / p95 / max | **0.44 ms / 0.63 ms / 0.91 ms** | **1.42 ms / 4.01 ms / 6.94 ms** | in-page (`npm test`) |
| Live AI-app lock latency | **7–44 ms** — WhatsApp 7, ChatGPT 10, Gemini 11, Chrome 16, Google 31, Perplexity 44 | n/a | n/a |
| Multi-turn post-scrub re-lock | **7–17 ms** | n/a | n/a |
| Hybrid pass: sentence + card + key, Airplane Mode | **6 spans, 2,513 ms**, `ON_DEVICE` badge, 0 network bytes | 6 spans, ~1.4 ms | n/a |
| Composition interruptions | **0** | **0** | **0** |
| Raw PII left device | **0** | **0** | **0 raw secrets in handoff** |

The app offered a real download (`DOWNLOADABLE` → `DOWNLOADING` with live bytes, MB/s and ETA → `AVAILABLE`), then ran stage 1 with Wi-Fi off and rendered the `Gemini Nano` badge next to `Scrubbed · 6 blocked · 0 Leaked`. Logcat: `onDevice modelName=nano-v4-fast` · `sandbox status=READY semantic=5 spans=6 latency=2513ms` · `CordonBench: device=SM-S948B api=37 abi=arm64-v8a`. The live lock figures come from the six-app sweep (`CordonA11y`: `textChanged → modalShown elapsedMs`), where every app redacted all six categories with zero raw secrets left in the field.

Reproduce: `cd android && ./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.localfirst.triage.OnDeviceFirewallBenchmarkTest`, then `adb logcat -d | grep CordonBench`.

---

## 3-Minute Demo (hard cap)

| Time | Beat | On screen |
| :--- | :--- | :--- |
| 0:00–0:25 | Hook | Paste a key + PII into ChatGPT on Android → full-screen lock in 34 ms → Scrub in Field → redaction token in the composer, nothing sent |
| 0:25–1:05 | Hybrid airgap | Web Workbench → paste a multi-secret prompt → Stage 1 scrubs locally → Approve → Stage 2 answers via Firebase AI Logic, with `inferenceSource` and App Check visible |
| 1:05–1:55 | Multi-surface sweep | Android Chrome omnibox lock + scrub, Settings guard-any-app, Quick Sandbox; then the extension blocking Send on a real ChatGPT DOM and the `#handoff=` bridge |
| 1:55–2:30 | Hard proof | `CordonBench` table: 100.0% recall (81/81), 0.0% false positives (0/46), 1.42 ms p50, and fail-closed `ONLY_ON_DEVICE` on devices without AICore |
| 2:30–2:55 | Close | Apache-2.0 repo, v4.6.1 release assets, one line: sensitive data never leaves the device; cloud AI only ever sees redacted intent |

---

## Tech Stack

- **Firebase:** AI Logic (`firebase/ai`, `firebase-ai:18.2.0`, `firebase-ai-ondevice:16.0.0-beta08`), Firestore (Zero-PII rules + indexes), Auth (Anonymous + Google), Remote Config, App Check (reCAPTCHA Enterprise + Play Integrity + Debug), Hosting — **Spark tier**
- **Web & Extension:** React 19, TypeScript 5, Tailwind CSS 4, Vite 6, IndexedDB, MV3
- **Android:** Kotlin, Jetpack Compose Material 3, `compileSdk`/`targetSdk` 36, `minSdk` 26, Gradle 9.8.0 / AGP 9.4.1
- **Verification:** Vitest **20 files / 138 tests**, Playwright **10/10 flows**, Android JUnit **88 tests**, Gradle Lint **0 errors**

---

## Submission Disclosures (required)

**Pre-existing work.** Cordon extends an earlier LocalFirst Triage prototype (`v2.4`, first committed 2026-11-15): the deterministic Kotlin/TypeScript redaction engine and an early two-screen Android shell. No proprietary third-party code is included; all dependencies are open-source and listed in `package.json` and the Gradle files.

**Built during the submission period (2026-11-11 → 2026-11-30).** The Chrome MV3 extension (paste shield, send interception, side panel, `#handoff=` bridge), the three-surface Zero-PII sync model and `firestore.rules`, the hybrid Nano 4 defense-in-depth pipeline, ECDSA audit receipts with embedded public keys, the Android accessibility send-button shield, the 3-tab Compose UI, the third-party benchmark harness, and all test suites were built during the submission period.

**Known limits (stated up front).** The Android shield covers the 12 listed packages; other apps are covered by the manual text-action and Share Sheet scrub. The accessibility path is deterministic — Nano 4 runs in the in-app workbench. Shield placement no longer needs a detectable Send control (it is geometric), but a Send control outside the composer's trailing corner is not covered, and a soft keyboard's own Send arrow can only be caught after the fact.
