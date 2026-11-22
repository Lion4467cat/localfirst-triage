# Cordon (`v4.2.0`)

**Unified 3-Surface On-Device Hybrid AI Privacy Firewall across Chrome Extension (MV3), Native Android, and Web PWA.**

Built for **#BuildHybridAI 2026** on **100% `$0.00` Firebase Spark Tier** infrastructure (`para-1-2e22b`) using **Firebase AI Logic** (`firebase/ai` & `firebase-ai`), **Gemini Nano 4 / Gemma 4** on-device, **Cloud Gemini** (`gemini-3.5-flash-lite` primary → `gemini-3.8-flash` fallback), **Firebase App Check**, and **Zero-PII Cloud Firestore**.

- **Live Web PWA:** [`https://para-1-2e22b.web.app/`](https://para-1-2e22b.web.app/)
- **Public GitHub Repo:** [`https://github.com/Lion4467cat/localfirst-triage`](https://github.com/Lion4467cat/localfirst-triage)
- **Releases (Extension + Android APK):** [`github.com/Lion4467cat/localfirst-triage/releases`](https://github.com/Lion4467cat/localfirst-triage/releases)
- **License:** [Apache-2.0](./LICENSE)

---

## 3-Surface Architecture

| Surface | Role & Capabilities | Core Engine |
| :--- | :--- | :--- |
| **Chrome Extension (`extension/`)** | Live browser Paste & Submit (`Enter` / Send button) guardrail across `chatgpt.com`, `claude.ai`, `gemini.google.com`, `github.com`, `app.slack.com` + Daily Side Panel Control Center (`Low` / `Medium` / `High`, live tab ping, 0-PII stats, `#handoff=` bridge) | `firewall-core.js` + Chrome `LanguageModel` (Nano 4) |
| **Native Android (`android/`)** | OS-wide text action (`Scrub with Cordon` via `ACTION_PROCESS_TEXT`), Share Sheet (`ACTION_SEND`), weighted Risk Router, offline 6-runbook resolution, and Zero-PII Firestore sync | `LocalFirewallEngine.kt` + `firebase-ai` (`18.2.0`) & `firebase-ai-ondevice` (`16.0.0-beta08`) |
| **Web PWA (`src/`)** | Interactive Hybrid Workbench (`ONLY_ON_DEVICE`, `PREFER_ON_DEVICE`, `PREFER_IN_CLOUD`), `<5ms` IndexedDB Dedup Cache, RAM-only Rehydration Vault, ECDSA P-256 Zero-Leakage Audit Receipts, and lazy-loaded Firestore sync | `src/firewall/` + `firebase/ai` (`firebase@13.3.0`) + Anime.js v4 |

---

## Verified Third-Party Benchmarks (`Before → After`)

Measured directly against real external datasets — `ai4privacy/pii-masking-200k` (150 English rows), official upstream `gitleaks/gitleaks` (`config/gitleaks.toml`), and 100 clean developer/prose chunks:

| Metric (`medium` Default · Web & Extension Parity) | Baseline (`third-party-baseline.json`) | Optimized (`third-party-optimized.json`) |
| :--- | :---: | :---: |
| **Suite B — Gitleaks Vendor Credentials (`42` specs)** | `59.5%` (`25/42`) | **`100.0%` (`42/42`)** |
| **Suite A1 — Structured PII Floor (`ai4privacy/pii-masking-200k`)** | `22.5%` (`20/89`) | **`70.8%` (`63/89`)** *(+ Nano 4 for NER)* |
| **Suite C — Dev / Code False-Positive Rate (`100` chunks)** | `1.0%` (`0.0%` dev/code) | **`1.0%`** (**`0.0%`** on stack traces, TS, SQL, Docker) |
| **Deterministic Latency (Median / P95)** | `0.016ms` / `0.025ms` | **`0.022ms`** / **`0.038ms`** |
| **Strict 3-Pass Idempotency Failures** | `0` | **`0`** |

Reproduce anytime locally:

```bash
node scripts/benchmark-third-party.mjs --out=benchmarks/third-party-optimized.json
```

---

## 1-Minute Judge Testing Guide

1. **Live Web PWA ([`para-1-2e22b.web.app`](https://para-1-2e22b.web.app/)):**
   - Sign in as Guest (or Google) and click **Run Privacy Firewall** on any built-in scenario.
   - To test **on-device Gemma 4 / Gemini Nano 4** in Chrome: enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` (or `Gemma 4 on built-in AI`) and `chrome://flags/#optimization-guide-on-device-model` (`Enabled BypassPerfRequirement`). On machines without flags, Stage 1 fails closed locally and never leaks raw secrets.
2. **Chrome Extension (Unpacked):**
   - Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `extension/`.
   - Open ChatGPT/Claude/Gemini/GitHub/Slack, paste a key or type a secret and click Send to see single-modal interception (`0` popups while typing).
3. **Android App:**
   - Install `app-debug.apk` from Releases (or build via `cd android && ./gradlew :app:assembleDebug`).
   - Highlight text in any Android app and tap **Scrub with Cordon** or share text via the OS Share Sheet.

---

## Built With

- **Antigravity** & **Firebase Agent Skills** (`firebase-ai-logic-basics`, `firebase-auth-basics`, `firebase-firestore`, `firebase-hosting-basics`, `firebase-security-rules-auditor`)
- **Zero-Cost Spark Stack:** Firebase Hosting, Firebase Auth, Cloud Firestore (strict RE2 secret-blocking `firestore.rules`), Firebase Remote Config, Firebase App Check (reCAPTCHA v3/Enterprise)
