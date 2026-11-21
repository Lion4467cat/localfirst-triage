# LocalFirst Triage (`v4.0`) — #BuildHybridAI 2026 Submission

- **Live Web PWA:** [`https://para-1-2e22b.web.app/`](https://para-1-2e22b.web.app/)
- **Public GitHub Repository:** [`https://github.com/Lion4467cat/localfirst-triage`](https://github.com/Lion4467cat/localfirst-triage)
- **Android Companion APK (`v4.0.0`):** [`https://github.com/Lion4467cat/localfirst-triage/releases/tag/v4.0.0`](https://github.com/Lion4467cat/localfirst-triage/releases/tag/v4.0.0) (`localfirst-triage-v4.0.0-android-debug.apk`)

## Elevator Pitch
**Zero-Leakage Hybrid AI Incident Copilot across Web PWA, Chrome Extension (MV3), and Native Android (`com.localfirst.triage`).** Sanitizes secrets, clinical PHI, password hints, and M&A deal terms strictly on-device with **Gemini Nano 4 (`ONLY_ON_DEVICE`) + Defense-in-Depth Heuristics** before a single byte ever reaches Cloud Gemini or Firestore—running 100% on **$0.00 Firebase Spark** infrastructure.

---

## The Problem
Engineers and support teams routinely paste raw production stack traces, crash logs, and customer threads containing API keys, database connection URIs, PEM private keys, SSNs, Luhn payment cards, hospital ICU notes, password hints, and M&A codenames directly into cloud LLMs. Even well-intentioned regex scripts fail when secrets are phrased in natural language or when on-device LLMs under-extract.

## What LocalFirst Triage v4.0 Does
1. **Stage 1 — Local Semantic Privacy Firewall (`InferenceMode.ONLY_ON_DEVICE`):**
   - Uses **Firebase AI Logic (`firebase/ai` & `firebase-ai-ondevice:16.0.0-beta08`)** to execute **Gemini Nano 4** purely on-device (`ONLY_ON_DEVICE`), backed by a **Defense-in-Depth Union** with deterministic `REGEX_FIREWALL`, Shannon `ENTROPY_SCANNER`, custom/remote `POLICY_TERM`, and `HEURISTIC_GUARD` (covering `CONTEXTUAL_PHI`, `M_AND_A_SECRET`, `NATURAL_SECRET`, and `PERSONAL_PII_LOCATION`).
   - Priority-ordered span merging gives Nano 4 top automated priority (`4`) while guaranteeing `HEURISTIC_GUARD` (`1`) prevents leaks whenever Nano 4 under-extracts or is downloading.
2. **6 Offline-Capable P2/P3 Local Runbooks (`$0` Cloud Tokens):**
   - Matches `RB_LOCAL_TLS_CERT`, `RB_LOCAL_DEPENDENCY_CONFLICT`, `RB_LOCAL_CORS_DEV`, `RB_OAUTH_CLOCK_SKEW`, `RB_PORT_IN_USE`, and `RB_OFFLINE_SW_CACHE` completely on-device across Web and Android—even in **Airplane / Offline Mode**.
3. **Human-in-the-Loop Pre-Cloud Gate & Fail-Closed Quarantine:**
   - When Nano 4 is ready: opens a cancelable countdown review window with clickable highlight pills and drag-to-mask manual spans.
   - When Nano 4 is unavailable/downloading: fails **closed** into `QUARANTINED_PENDING_APPROVAL` until an engineer reviews the diff and explicitly clicks **Approve & Escalate**.
4. **Stage 2 — Zero-Leakage Cloud Escalation & Hybrid Executive Brief (`PREFER_ON_DEVICE`):**
   - `verifyZeroLeakage()` inspects every outbound string for unredacted spans, merged `constituentTexts`, URL-encoded bypasses, JSON-escaped bypasses, and raw credential patterns—blocking egress on any failure.
   - Streams Root Cause Analysis via Cloud Gemini (`gemini-3.5-flash-lite` → `gemini-2.5-flash`, live-tunable via **Firebase Remote Config**) and drafts executive/Slack stakeholder updates via `InferenceMode.PREFER_ON_DEVICE`.
5. **Cross-Platform Multi-Surface Companion:**
   - **Web PWA (`https://para-1-2e22b.web.app/`):** Lazy-loads Firestore (`549.03 kB` chunk) only after Anonymous Guest or Google Sign-In, protected by App Check & Zero-PII Firestore Security Rules.
   - **Chrome Extension (MV3):** Pre-scrubs highlighted web text offline inside a Side Panel and transfers only sanitized payloads over `#handoff=` URL fragments.
   - **Native Android App (`com.localfirst.triage`):** Jetpack Compose 3-tab app (`Triage`, `Diff & Proof`, `Synced Feed`) using `firebase-bom:35.2.0`, `firebase-ai-ondevice`, generation-guarded coroutines, volatile RAM raw-text isolation, Play Integrity / Debug App Check, and seamless sideload Guest sync.

---

## How We Built It & Challenges Overcome
- **Chrome 158 GPU Diagnostics & Real Hardware Fix:** Testing on real Chrome `158.0.8127.36-1` with NVIDIA GPU acceleration (`gemma4_component: 2026.11.3.1140`, `model_crash_count: 0`, Stage 1 `3726ms`, Hybrid Brief `3779ms`) revealed that real Nano 4 sometimes extracts only the first person name (`John`), and gating `HEURISTIC_GUARD` off when Nano 4 was ready allowed clinical PHI and M&A details through. We converted Stage 1 to an **always-on Defense-in-Depth Union** and fixed an apostrophe boundary bug (`dog's name`) + parenthesis overrun in `NATURAL_SECRET` and `CONTEXTUAL_PHI` identically across Web, Chrome Extension, and Android.
- **Strict Zero-PII Storage & Rules Parity:** Built identical TypeScript and Kotlin serializers stripping `rawText`, `matchedText`, `constituentTexts`, and `spans`, enforced server-side by RE2 credential guards in `firestore.rules`.
- **Android Sideload & Coroutine Race-Safety:** Inspected `firebase-ai-ondevice` AAR bindings directly, eliminated deprecation warnings, added coroutine `Job` cancellation + monotonic `runGeneration` guards across tab/scenario switches, and added friendly Guest sync fallback for sideloaded APKs without enrolled Google Sign-In SHA-1.

---

## Tech Stack
- **Firebase:** Firebase AI Logic (`firebase/ai`, `firebase-ai:18.2.0`, `firebase-ai-ondevice:16.0.0-beta08`), Cloud Firestore (`(default)` Zero-PII rules & indexes), Firebase Auth (Anonymous + Google), Firebase Remote Config, Firebase App Check (reCAPTCHA Enterprise + Play Integrity + Debug providers), Firebase Hosting — **$0.00 Spark Tier**
- **Web & Extension:** React 19, TypeScript 5, Tailwind CSS, Vite 6, IndexedDB (`idb`), Chrome Extension Manifest V3, Vitest (`10/10` files, `72/72` tests), Playwright (`9/9` E2E flows)
- **Android:** Kotlin, Jetpack Compose Material 3 (`2025.05.00`), `compileSdk = 36`, `targetSdk = 36`, `minSdk = 26`, Gradle `9.8.0` / AGP `9.4.1`, JUnit (`10/10` tests, `0` compiler warnings)
