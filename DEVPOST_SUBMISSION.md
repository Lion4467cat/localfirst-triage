# Devpost Submission Copy — `#BuildHybridAI 2026`

## Project Name
**LocalFirst Triage**

## Elevator Pitch (Tagline)
Zero-leakage Hybrid AI Incident Copilot & Chrome Extension: sanitizes PII, PHI & secrets on-device via Gemini Nano 4 / Gemma 4 before streaming Cloud RCA via Firebase AI Logic.

## Selected Platform(s)
- **Web (Chrome)** — Web PWA (`https://para-1-2e22b.web.app`) + Chrome Extension (Manifest V3 Side Panel in `/extension`)

---

## About the Project

### Inspiration
Engineering and support teams want Gemini's reasoning speed on chaotic P0 production incidents—but pasting customer logs into cloud LLMs risks leaking API keys, database passwords, credit card numbers, medical PHI, and confidential M&A codenames. Worse, simple regex scrubbers are mathematically blind to unstructured natural-language leaks (*"Customer John's daughter admitted to Manipal ICU Floor 3 after Tuesday's seizure"* or *"admin told me to log in using his dog's name followed by 2026exclamation"*), while routine local P2/P3 tickets (expired dev TLS certs, OAuth clock skew) waste cloud tokens unnecessarily.

We built **LocalFirst Triage (`v3.0`)** to prove why **hybrid on-device + cloud inference via Firebase AI Logic (`firebase/ai`)** isn't just a cost optimization—it's an architectural requirement for zero-leakage enterprise AI.

### What It Does
1. **Stage 1 — 3-Layer On-Device Privacy Firewall (`InferenceMode.ONLY_ON_DEVICE`):**
   - **Layer 1A (Deterministic Regex + Luhn + Shannon Entropy):** Scrubs **9** ReDoS-safe regex categories (PEM private keys, Postgres/Mongo/Redis DB URIs, AWS keys, Google/Stripe/GitHub/Slack API keys, JWT/Bearer headers, Luhn-verified credit cards, US SSNs, emails, phone numbers) plus high-entropy secret assignments (**`shannonEntropy >= 3.25 bits/char`** or `>=16`-char mixed-class credentials, including JSON-escaped and URL-encoded tokens) and custom `[POLICY_TERM]` rules.
   - **Layer 1B (Chrome Gemini Nano 4 / Gemma 4 `ONLY_ON_DEVICE` + Heuristic Guard):** Uses Chrome's Built-in AI (`gemma4_component` via `InferenceMode.ONLY_ON_DEVICE`) with strict single-session serialization to extract unstructured clinical PHI, natural-language password hints, and M&A deal codenames (`[NANO_SEMANTIC_FIREWALL]`).
   - **Inline Redaction Diff Viewer:** Color-codes every redacted span by detector (`[REGEX_FIREWALL]`, `[ENTROPY_SCANNER]`, `[NANO_SEMANTIC_FIREWALL]`, `[HEURISTIC_GUARD]`, `[POLICY_TERM]`, `[MANUAL_MASK]`), supports 1-click pill toggling, and lets users highlight arbitrary text to mask manually.
2. **100% Local P2/P3 Runbook Resolution (`$0` Cloud Tokens):**
   - Includes **4** 1-click demo scenarios across all 4 severity tiers (`P0`, `P3`, `P1`, `P2`) and **5** default offline Markdown runbooks (`RB_CERT_EXPIRED`, `RB_OAUTH_CLOCK_SKEW`, `RB_NPM_ERESOLVE`, `RB_CORS_ORIGIN`, `RB_INDEXEDDB_QUOTA`) plus custom user-defined runbooks that resolve `100%` on-device with zero cloud calls.
3. **Fail-Closed Quarantine & Mathematical Zero-Leakage Gate (`verifyZeroLeakage()`):**
   - If Gemini Nano 4 is unavailable, downloading, or recovering from a GPU worker reset in a judge's browser, LocalFirst Triage **never fails open**. It pre-masks spans locally with **4** contextual heuristic rules, holds P0/P1 escalation in `QUARANTINED_PENDING_APPROVAL` until human review, and runs `verifyZeroLeakage()` across all merged and constituent spans before any Stage 2 call.
4. **Stage 2 — Streaming Cloud RCA (`PREFER_IN_CLOUD`) & Hybrid Executive Brief (`PREFER_ON_DEVICE`):**
   - Escalates strictly sanitized P0/P1 payloads to **`gemini-3.5-flash-lite`** (with automatic unary `generateContent()` retry and **`gemini-2.5-flash`** model fallback, configured dynamically via Firebase Remote Config) using `generateContentStream()` for real-time Root Cause Hypothesis & Mitigation checklists.
   - Uses `InferenceMode.PREFER_ON_DEVICE` to generate a 2-sentence executive summary and Slack/Jira update on-device when Nano 4 is ready, falling back cleanly to Cloud Gemini when unavailable.
5. **Manifest V3 Chrome Extension Side Panel Companion (`/extension`):**
   - Right-click selected log text on GitHub, Jira, Zendesk, PagerDuty, or Linear to sanitize locally in Chrome's Side Panel (`extension/sidepanel/firewall-core.js`, kept in 100% rule parity with `src/firewall/regexScrubber.ts`) and hand off **only the redacted payload** to `https://para-1-2e22b.web.app/#handoff=<base64url>`.

### How We Built It
- **Frontend & Offline PWA:** React 19, TypeScript 5.7, Vite 6, Tailwind CSS v4, Service Worker (`localfirst-triage-shell-v3.2`) + Web App Manifest, and zero-PII `IndexedDB` v2 persistence (`stripRawTextForStorage()` purges `rawText` and `matchedText` before disk write).
- **Firebase AI Logic (`firebase/ai`):** Used `getAI(app, { backend: new GoogleAIBackend() })` with all 3 `InferenceMode` patterns (`ONLY_ON_DEVICE`, `PREFER_ON_DEVICE`, `PREFER_IN_CLOUD`), `generateContentStream()`, `normalizeSdkInferenceSource()`, and `initializeDeviceModel()` download progress tracking.
- **Firebase App Check & Remote Config:** Protected live API quota on `https://para-1-2e22b.web.app` with **reCAPTCHA Enterprise App Check** (`ReCaptchaEnterpriseProvider`, with `localhost`-restricted debug tokens) and non-blocking `3500ms` Remote Config model management—all running at **`$0.00`** on the Firebase Spark free tier.
- **Chrome Extension MV3:** Side Panel + Context Menu + `chrome.storage.session` + `chrome.scripting` + Chrome Built-in AI (`LanguageModel`).

### Challenges We Ran Into
- **Small-LLM Paraphrasing vs. Exact UTF-16 Offsets:** Early prototypes rewrote whole paragraphs, corrupting stack trace indices. We solved this with JSON `{type, value}` entity extraction, boundary lookaround guards, priority interval merging (`constituentTexts`), and right-to-left UTF-16 splicing.
- **Linux Dual-GPU Chrome 154 `OnDeviceModelService` Sandbox:** On hybrid Intel iGPU (`/dev/dri/renderD128`) + NVIDIA dGPU (`/dev/dri/renderD129`) Linux laptops, Chrome 154's utility sandbox defaults to `--render-node-override=/dev/dri/renderD128`, which can crash `libLiteRtWebGpuAccelerator.so` when loading the 2.47 GB Gemma 4 weights. We hardened `nanoExtractor.ts` with single-session serialization, guaranteed `session.destroy()` cleanup, union-free schema extraction, and seamless Fail-Closed Quarantine fallback—and documented the exact `--render-node-override=/dev/dri/renderD129` NVIDIA launch flag.

### Accomplishments That We're Proud Of
- Demonstrating all three `InferenceMode` patterns (`ONLY_ON_DEVICE`, `PREFER_ON_DEVICE`, `PREFER_IN_CLOUD`) plus streaming and `initializeDeviceModel()` in one cohesive, judge-verifiable enterprise workflow.
- **60+ passing Vitest unit & adversarial tests** across 9 suites plus **9/9 headless Playwright Chromium E2E flows** (with 0 console/page errors).
- Running the entire production stack—hosted PWA, reCAPTCHA Enterprise App Check, Remote Config, and Gemini Developer API—at **`$0.00`** on Firebase Spark.

### What We Learned
- Designing **fail-closed privacy boundaries first** (Airplane Mode, missing Nano flags, model download progress, zero-PII storage, constituent-span outbound prompt audits) transforms hybrid AI from a fragile demo into trustworthy production infrastructure.

### What's Next
- Chrome Web Store publication for the MV3 companion extension, PagerDuty/Jira webhook automation, and team-shared encrypted runbook repositories.

---

## Built With
`firebase`, `firebase-ai-logic`, `gemini-nano`, `gemma-4`, `gemini-flash`, `firebase-app-check`, `firebase-remote-config`, `firebase-hosting`, `chrome-extension`, `manifest-v3`, `react`, `typescript`, `tailwindcss`, `vite`, `vitest`, `playwright`

## Testing Instructions (For Judges)
1. **Hosted App:** Open `https://para-1-2e22b.web.app` in Chrome Desktop (no login required, free of charge).
2. *(Optional for on-device Nano 4 / Gemma 4)*: Enable **`Gemma 4 for Built-in AI`** in `chrome://flags` and relaunch Chrome. If unavailable, the app automatically demonstrates **Fail-Closed Quarantine** with deterministic Regex + Shannon Entropy (`>= 3.25 bits/char`) + Heuristic Guard before sanitized Cloud escalation.
3. Click **Scenario 1 (`P0: Semantic PHI + Natural Secret + OAuth Trace`)** -> **Run Hybrid Triage** -> inspect the inline diff & click any highlighted span/pill to test unmask/re-mask -> click **Approve & Escalate Sanitized Payload to Cloud** (or **Escalate Now**) -> open the **Zero-Leakage Proof** tab to verify `0 / 9 raw secrets leaked`.
4. Click **Generate Hybrid Stakeholder Brief** (`InferenceMode.PREFER_ON_DEVICE`) to generate an executive summary & Slack update.
5. Click **Scenario 2 (`P3: Expired Local Dev TLS Cert`)** or toggle **Airplane / Offline Mode: ON** to observe `0`-token local runbook resolution and the Offline Reconnect Queue.
6. *(Optional Extension)*: Load `/extension` unpacked in `chrome://extensions`, right-click any log snippet on GitHub, click **Sanitize & Triage with LocalFirst**, and click **Escalate Sanitized to Cloud Workbench** (hands off to `https://para-1-2e22b.web.app/#handoff=...`).

## Originality & AI Assistance Disclosure (Rules §6)
- Built from scratch during the `#BuildHybridAI 2026` submission window (Nov 15–30, 2026).
- Open-source packages: React 19, Vite 6, Tailwind CSS v4, Lucide React, Firebase JS SDK (`firebase@^13.3.0`), Vitest, `@testing-library/react`, Playwright Core.
- AI coding tools used during development: Google Antigravity IDE / coding agents with Firebase Agent Skills, Matt Pocock's `improve-codebase-architecture` & `tdd` skills, Floorplan, and Graphify code-graph analysis.
