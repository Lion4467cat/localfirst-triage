# Devpost Submission Copy — `#BuildHybridAI 2026`

## Project Name
**LocalFirst Triage**

## Elevator Pitch (Tagline)
Zero-leakage Hybrid AI Incident Copilot & Chrome Extension: sanitizes PII, PHI & secrets on-device via Gemini Nano 4 before streaming Cloud RCA via Firebase AI Logic.

## Selected Platform(s)
- **Web (Chrome)** — Web PWA + Chrome Extension (Manifest V3 Side Panel)

---

## About the Project

### Inspiration
Engineering and support teams want Gemini's reasoning speed on chaotic P0 production incidents—but pasting customer logs into cloud LLMs risks leaking API keys, database passwords, credit card numbers, medical PHI, and confidential M&A codenames. Worse, simple regex scrubbers are mathematically blind to unstructured natural-language leaks (*"Customer John's daughter admitted to ICU Floor 3"* or *"admin told me to log in using his dog's name"*), while routine local P2/P3 tickets (expired dev TLS certs, OAuth clock skew) waste cloud tokens unnecessarily.

We built **LocalFirst Triage** to prove why **hybrid on-device + cloud inference via Firebase AI Logic** isn't just a cost optimization—it's an architectural requirement for zero-leakage enterprise AI.

### What It Does
1. **Stage 1 — Dual-Layer On-Device Privacy Firewall (`InferenceMode.ONLY_ON_DEVICE`):**
   - Combines an enterprise deterministic scanner (`[REGEX_FIREWALL]` for AWS/GCP/Stripe/GitHub/PEM keys, Postgres/Mongo URIs, JWTs, Luhn-validated credit cards, SSNs, emails, phones + `[ENTROPY_SCANNER]` via Shannon entropy + user-defined `[POLICY_TERM]` rules) with **Chrome Gemini Nano 4** (`ONLY_ON_DEVICE`) to detect unstructured contextual PHI, natural-language passwords, and deal codenames.
   - Displays an **Inline Color-Highlighted Diff Viewer** where users can click any highlighted span or pill to toggle mask/unmask, or highlight any custom snippet to add a `[MANUAL_MASK]`.
2. **100% Local P2/P3 Runbook Resolution (`$0` Cloud Tokens):**
   - Classifies severity (`P0–P3`) on-device across chunked stack traces and resolves routine P2/P3 incidents (including user-created custom runbooks) directly offline with zero cloud calls.
3. **Fail-Closed Quarantine & Programmatic Zero-Leakage Gate:**
   - If Gemini Nano 4 is unavailable or still downloading in a judge's browser, LocalFirst Triage **never fails open**. It pre-masks spans locally with Heuristic Guard, holds P0/P1 escalation in `QUARANTINED_PENDING_APPROVAL`, and runs `verifyZeroLeakage()` before any Stage 2 call to guarantee `0` masked raw secrets appear in the outbound prompt.
4. **Stage 2 — Streaming Cloud RCA (`PREFER_IN_CLOUD`) & Hybrid Executive Brief (`PREFER_ON_DEVICE`):**
   - Escalates strictly sanitized P0/P1 payloads to Gemini Flash (`inCloudParams.model` controlled dynamically via Firebase Remote Config) using `generateContentStream()` for real-time Root Cause Hypothesis & Mitigation checklists.
   - Uses `InferenceMode.PREFER_ON_DEVICE` to generate a Slack/Jira executive brief on-device when Nano 4 is ready, falling back cleanly to Cloud when unavailable.
5. **Manifest V3 Chrome Extension Side Panel Companion (`/extension`):**
   - Right-click selected log text on GitHub, Jira, Zendesk, PagerDuty, or Linear to sanitize locally in Chrome's Side Panel and hand off **only the redacted payload** to the hosted Web workbench.

### How We Built It
- **Frontend & PWA:** React 19, TypeScript 5, Vite 6, Tailwind CSS v4, Service Worker + Web App Manifest, and zero-PII `IndexedDB` persistence (`stripRawTextForStorage()` purges raw text before disk write).
- **Firebase AI Logic (`firebase/ai`):** Used `getAI(app, { backend: new GoogleAIBackend() })` with explicit `ONLY_ON_DEVICE` (with text-only `expectedInputs` + JSON schema `responseConstraint`), `PREFER_ON_DEVICE`, `PREFER_IN_CLOUD`, `generateContentStream()`, and `initializeDeviceModel()` warm-up progress tracking.
- **Firebase App Check & Remote Config:** Protected API quota with `ReCaptchaV3Provider` / `ReCaptchaEnterpriseProvider` (with `localhost`-gated debug tokens) and non-blocking `1500ms` Remote Config model switching—all running at **`$0.00`** on the Firebase Spark free tier.
- **Chrome Extension MV3:** Side Panel + Context Menu + `chrome.storage.session` + `chrome.scripting` + Chrome Prompt API (`LanguageModel`).

### Challenges We Ran Into
- **Small-LLM Paraphrasing vs. Exact Offsets:** Early prototypes rewrote whole paragraphs, corrupting log indices and domain names (e.g., `"May"` corrupting `api.may.com`). We solved this with JSON `{type, value}` entity extraction, `\b` + URL lookaround guards, priority interval merging, and right-to-left UTF-16 splicing.
- **Firebase AI Logic Hybrid Edge Cases:** We discovered that passing top-level `model` alongside `mode: InferenceMode.PREFER_IN_CLOUD` triggers an SDK fallback warning unless `inCloudParams: { model }` is used, and that text-only Chrome Nano builds require explicit text-only `onDeviceParams.createOptions.expectedInputs` instead of the SDK's default text+image assumption.

### Accomplishments That We're Proud Of
- Demonstrating all three core `InferenceMode` patterns (`ONLY_ON_DEVICE`, `PREFER_ON_DEVICE`, `PREFER_IN_CLOUD`) plus streaming and `initializeDeviceModel()` in one cohesive, practical enterprise workflow.
- **60/60** passing Vitest unit & React integration tests plus headless Playwright Chromium E2E verification across 9 user & adversarial security flows covering Luhn checks, JSON/URL-encoded entropy detection, ReDoS immunity, 50KB trace chunk capping, fail-closed quarantine, constituent-span zero-leakage verification, corrupted-storage recovery, XSS immunity, responsive viewports (`1280x720`, `1024x768`, `375x667`), and Chrome Extension MV3 handoff re-scrubbing.
- Running the entire stack—including hosted PWA, App Check, Remote Config, and Gemini Developer API—at **`$0.00`** on Firebase Spark.

### What We Learned
- Designing **worst-case resilience first** (Airplane Mode, missing Nano flags, model download progress, zero-PII storage, programmatic outbound prompt audits) transforms hybrid AI from a fragile demo into trustworthy infrastructure.

### What's Next
- Chrome Web Store publishing for the companion extension, bidirectional Jira/PagerDuty webhook templates, and Android/iOS mobile client parity via the shared Firebase AI Logic architecture.

---

## Built With
`firebase`, `firebase-ai-logic`, `gemini-nano`, `gemini-flash`, `firebase-app-check`, `firebase-remote-config`, `firebase-hosting`, `chrome-extension`, `manifest-v3`, `react`, `typescript`, `tailwindcss`, `vite`, `vitest`

## Testing Instructions (For Judges)
1. **Hosted App:** Open `https://para-1-2e22b.web.app` in Chrome Desktop (no login required, free of charge).
2. *(Optional for full on-device Nano 4)*: Enable **`Gemma 4 for Built-in AI`** in `chrome://flags` and relaunch Chrome. If unavailable, the app automatically demonstrates **Fail-Closed Quarantine** with deterministic Regex + Entropy + Heuristic Guard before sanitized Cloud escalation.
3. Click **Scenario 1 (P0 Semantic PHI)** -> **Run Hybrid Triage** -> inspect the inline diff & click any highlighted span/pill to test unmask/re-mask -> click **Approve & Escalate Sanitized Payload to Cloud** -> inspect **Zero-Leakage Proof** tab.
4. Click **Scenario 2 (P3 Local TLS Cert)** or toggle **Airplane / Offline Mode: ON** to observe `0`-token local runbook resolution and the Offline Reconnect Queue.
5. *(Optional Extension)*: Load `/extension` unpacked in `chrome://extensions`, right-click any log snippet on GitHub, and click **Sanitize & Triage with LocalFirst**.

## Originality & AI Assistance Disclosure (Rules §6)
- Built from scratch during the `#BuildHybridAI 2026` submission window (Nov 15–30, 2026).
- Open-source packages: React, Vite, Tailwind CSS, Lucide React, Firebase JS SDK (`firebase`), Vitest, `@testing-library/react`.
- AI coding tools used during development: Google Antigravity IDE / coding agents with Firebase Agent Skills and Graphify code-graph analysis.
