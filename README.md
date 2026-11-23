# Cordon (`v4.4.0`)

**Unified 3-surface on-device hybrid AI privacy firewall across Chrome Extension (MV3), Native Android, and Web PWA.**

Built for **#BuildHybridAI 2026** on **Firebase Spark** infrastructure (`para-1-2e22b`) using **Firebase AI Logic** (`firebase/ai` & `firebase-ai`), **Gemini Nano 4** on-device inference, **Cloud Gemini** (`gemini-3.5-flash-lite` primary → `gemini-3.8-flash` fallback, live-tunable via Remote Config), **Firebase App Check**, and **Zero-PII Cloud Firestore**.

- **Live Web PWA:** [`https://para-1-2e22b.web.app/`](https://para-1-2e22b.web.app/)
- **Public GitHub Repo:** [`https://github.com/Lion4467cat/localfirst-triage`](https://github.com/Lion4467cat/localfirst-triage)
- **Releases (Extension ZIP + Android APK):** [`github.com/Lion4467cat/localfirst-triage/releases`](https://github.com/Lion4467cat/localfirst-triage/releases)
- **License:** [Apache-2.0](./LICENSE)

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

1. On the phone, open the [Releases page](https://github.com/Lion4467cat/localfirst-triage/releases) and download `cordon-android-v4.4.0.apk`, then tap it to install (allow "install unknown apps" when Android asks).
2. Open **Cordon**. On the **Shield** tab, tap **Enable Background Shield**.
3. Android opens Accessibility settings: tap **Cordon**, then switch it **on** and confirm.
4. Go back to Cordon. The Shield tab now says the shield is on. Open ChatGPT (or any listed app), type a secret, and tap **Send**.

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

## Build & Test (verified counts)

```bash
npm ci && npm run build            # TypeScript + Vite production build
npm test                           # Vitest: 20 files, 138 tests passing
npm run test:e2e                   # Playwright: 10/10 flows, 0 page errors
cd android && ./gradlew testDebugUnitTest lintDebug assembleDebug
                                   # 88 tests passing, 0 lint errors
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
- The shield is placed by geometry, not by finding the Send control: it covers the trailing 34% of the composer row, clamped to the screen, to a 132 dp height and to the top of the keyboard. Unlabelled arrow buttons are therefore covered, but a Send control that lives outside that corner (rare) is not.
- A soft keyboard's own Send arrow cannot be pre-empted: Android does not deliver IME key presses to accessibility services, and the keyboard window sits above any overlay. Cordon blocks that path with the composer shield, and if the send still leaves, proves it by finding the secret in the transcript and shows a "Sent unredacted" screen.
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
