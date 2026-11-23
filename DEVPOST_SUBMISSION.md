# Cordon (`v4.4.0`) — #BuildHybridAI 2026 Submission

- **Live Web PWA:** [`https://para-1-2e22b.web.app/`](https://para-1-2e22b.web.app/)
- **Public GitHub Repository:** [`https://github.com/Lion4467cat/localfirst-triage`](https://github.com/Lion4467cat/localfirst-triage)
- **Releases (Extension ZIP + Android APK `v4.4.0`):** [`github.com/Lion4467cat/localfirst-triage/releases`](https://github.com/Lion4467cat/localfirst-triage/releases)
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
   - **Native Android:** Jetpack Compose **Shield · History · Settings**, a layered accessibility send guard across 12 guarded apps (6 chat + 6 browsers) — composer-corner shield, hardware-Enter filter, typing banner, post-send blocker — plus `ACTION_PROCESS_TEXT` ("Scrub with Cordon"), Share Sheet, and Zero-PII sync.

---

## Try It (no setup knowledge required)

- **Web (30 s):** open the live PWA → **Sign in as Guest** → **Run Privacy Firewall** on any scenario.
- **Chrome extension (1 min):** download the ZIP from Releases → unzip → `chrome://extensions` → Developer mode → **Load unpacked** → pick the folder → click the Cordon icon → open ChatGPT and paste a key.
- **Android (2 min):** install `cordon-android-v4.4.0.apk` from Releases → open Cordon → **Enable Background Shield** → turn on **Cordon** in Accessibility settings → open ChatGPT, type a secret, tap Send.

Each surface shows exactly one confirmation on Send (**Scrub & Send** / **Send anyway**) and never interrupts typing.

---

## How Firebase AI Logic Is Used (runtime, not just imported)

- **Web:** `src/config/firebase.ts` builds `getAI(app, { backend: GoogleAIBackend })` and three models — `ONLY_ON_DEVICE`, `PREFER_ON_DEVICE`, `PREFER_IN_CLOUD` — called by `src/firewall/pipeline.ts` on every triage.
- **Android:** `ai/HybridAiClient.kt` calls `firebase-ai` with on-device params and cloud fallback; `AppCheckInitializer` installs Play Integrity in release and the Debug provider in debug.
- **App Check:** reCAPTCHA Enterprise/V3 on web, Play Integrity on Android. Debug tokens accepted for judging.

---

## Challenges Overcome

- **Defense-in-depth was necessary, not decorative.** On real hardware, Nano 4 sometimes extracted only the first person name (`John`); gating the heuristic guard off when Nano was "ready" let clinical PHI and M&A terms through. Stage 1 is now an always-on union.
- **Boundary bugs found in production text.** Apostrophe boundaries (`dog's name`) and parenthesis overruns in `NATURAL_SECRET` / `CONTEXTUAL_PHI` were fixed identically across Web, Extension, and Android.
- **Deterministic storage rules.** Identical TypeScript and Kotlin serializers strip `rawText`, `matchedText`, `constituentTexts`, and `spans`; `firestore.rules` rejects those fields and blocks unredacted AWS/Google/PEM/JWT/Stripe/Slack/GitHub shapes with RE2.
- **Android send interception, rebuilt around what the platform actually allows.** Matching the Send node failed on unlabelled arrow buttons, so placement is now pure geometry: the trailing 34% of the composer row, clamped to the screen, to 132 dp of height and to the top of the keyboard (read from the IME window). Hardware Enter is swallowed through `flagRequestFilterKeyEvents` before the app sees it. A soft keyboard's own arrow cannot be pre-empted — Android delivers no KeyEvents for IME presses and the IME window sits above any overlay — so that path is covered by the composer shield and, if it still escapes, proven by finding the secret in the transcript and reported with a "Sent unredacted" screen. The overlay itself is `TYPE_ACCESSIBILITY_OVERLAY` with `LAYOUT_IN_SCREEN | LAYOUT_NO_LIMITS`, `fitInsetsTypes = 0`, cutout mode `ALWAYS`, verified at runtime against the target bounds, and torn down immediately on clean text with a 450 ms debounce only for transient node misses.

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
