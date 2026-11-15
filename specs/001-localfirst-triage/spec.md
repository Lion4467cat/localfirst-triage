# Feature Specification: LocalFirst Triage

**Feature Branch**: `001-localfirst-triage`
**Created**: 2026-11-15
**Status**: Frozen Architecture (v2.4 — Ready for Live Chrome + Firebase Testing)
**Input**: Privacy-first incident and customer support copilot using Firebase AI Logic (`ONLY_ON_DEVICE` Gemini Nano 4 + `PREFER_IN_CLOUD` Gemini Flash), dual-layer `[REGEX_FIREWALL]` + `[NANO_SEMANTIC_FIREWALL]` surgical diffing, local P2/P3 runbook resolution, App Check (`ReCaptchaV3Provider`), non-blocking `RemoteConfig`, and `IndexedDB` persistence.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Dual-Layer Local Privacy Firewall & Surgical Diff (Priority: P1)

A developer or support engineer pastes or selects an incident ticket containing both structured secrets (API keys, JWTs, emails) and unstructured contextual PII/PHI/secrets (e.g., patient family details, acquisition codenames, or natural-language password hints). Stage 1 executes strictly locally via deterministic regex/entropy matching plus Chrome Gemini Nano 4 (`ONLY_ON_DEVICE`, chunked `<1,500` chars, `8000ms` timeout). The UI displays a side-by-side **Visual Redaction Diff Viewer** distinguishing `[REGEX_FIREWALL]` vs `[NANO_SEMANTIC_FIREWALL]` replacements with zero word-boundary corruption.

**Why this priority**: Core differentiator proving why on-device AI is irreplaceable (catching semantic/contextual leaks regex cannot see) and ensuring unredacted text never leaves the browser.

**Independent Test**: Paste a mixed secret + contextual-PII ticket, run Stage 1, and verify that regex catches keys/emails, Nano 4 (or mock/unit test) catches contextual phrases, overlapping spans merge cleanly, short words like `"May"` do not corrupt `"api.may.com"`, and zero network calls occur during Stage 1.

**Acceptance Scenarios**:

1. **Given** a ticket with `"sk-live-abc123456"` and `"Customer John's daughter in Manipal ICU Floor 3"`, **When** Stage 1 executes with Gemini Nano 4 available, **Then** `[REGEX_FIREWALL]` redacts the key and `[NANO_SEMANTIC_FIREWALL]` redacts the contextual medical/identity phrase using merged right-to-left span replacement.
2. **Given** a browser where Gemini Nano 4 is unavailable or downloading (`after-download`) on a P0/P1 ticket, **When** Stage 1 runs, **Then** `ONLY_ON_DEVICE` does not fail open to cloud unredacted; regex + deterministic contextual risk heuristics pre-mask sensitive spans, and escalation holds in `QUARANTINED_PENDING_APPROVAL` until the user reviews the interactive Diff Viewer (toggling pills if needed) and clicks `"Approve & Escalate Sanitized Payload to Cloud"`.

---

### User Story 2 - Local P2/P3 Resolution vs. Sanitized P0/P1 Cloud Escalation (Priority: P1)

After Stage 1 classifies ticket severity (`P0–P3`) and redacts sensitive spans, routine `P2/P3` tickets match local cached runbooks and resolve 100% on-device with `$0` cloud tokens. Complex `P0/P1` incidents (or explicit user escalation) pass **only the sanitized payload** to Stage 2 (`PREFER_IN_CLOUD`) to generate structured root-cause analysis and remediation steps.

**Why this priority**: Proves genuine hybrid architecture value — eliminating cloud calls for routine tickets while reserving cloud reasoning exclusively for sanitized hard problems.

**Independent Test**: Run a preloaded P2 offline hardware fault ticket and verify `inferenceSource === "ON_DEVICE"` with `0` Stage 2 cloud requests; run a P0 multi-service failure and verify only redacted tokens reach `PREFER_IN_CLOUD`.

**Acceptance Scenarios**:

1. **Given** a routine P2/P3 ticket matching a local runbook, **When** triage runs with Nano 4 ready, **Then** resolution completes locally (`inferenceSource === "ON_DEVICE"`) and Stage 2 Cloud is skipped (`0` cloud tokens).
2. **Given** a complex P0/P1 outage trace after Stage 1 sanitization, **When** Stage 2 executes `PREFER_IN_CLOUD`, **Then** only `[REDACTED:...]` placeholders appear in the outbound prompt and the response includes `inferenceSource === "IN_CLOUD"` with structured remediation output.

---

### User Story 3 - Airplane/Offline Mode & Live Hybrid Telemetry HUD (Priority: P2)

A judge or field engineer toggles **Airplane/Offline Mode** (or goes offline via browser DevTools) and sees Stage 1 continue functioning smoothly without hanging on `RemoteConfig` or `AppCheck` network handshakes. The **Live Hybrid Telemetry HUD** tracks Nano 4 readiness (`READY`, `MODEL_DOWNLOADING`, `UNAVAILABLE`), `inferenceSource` badges, per-turn latency (`ms`), local vs. cloud call split (`% local`), and estimated cloud tokens saved, while ticket history persists locally in `IndexedDB`.

**Why this priority**: Required by judging criteria (*Design* & *Technological Implementation*) to make hybrid behavior immediately observable and offline-resilient.

**Independent Test**: Toggle Offline Mode ON, reload or submit a ticket, and verify Stage 1 completes in `<8500ms` without hanging on Remote Config (`1500ms` timeout + hardcoded `defaultConfig`) and persists the sanitized record to `IndexedDB`.

**Acceptance Scenarios**:

1. **Given** `RemoteConfig` `fetchAndActivate()` is slow or offline, **When** the app boots or runs Stage 1, **Then** `defaultConfig` is used immediately after at most `1500ms` without blocking user interaction.
2. **Given** Airplane/Offline Mode is enabled, **When** a user clicks a P2/P3 demo scenario, **Then** Stage 1 runs strictly locally (`ONLY_ON_DEVICE` + regex) and blocks outbound Stage 2 cloud calls with a clear offline badge.

---

### Edge Cases

- What happens when a stack trace exceeds `1,500` characters? Boilerplate stack frames are trimmed and text is chunked into `<1,500`-character windows before calling Nano 4 (`ONLY_ON_DEVICE`).
- What happens if Nano 4 returns truncated or malformed JSON? A defensive JSON parser extracts valid entity objects or safely degrades without crashing the UI.
- What happens if Nano 4 flags a short ambiguous word like `"May"`? Minimum length/specificity + `\b` word-boundary matching prevent partial corruption of domains like `api.may.com`.
- What happens if primary Remote Config cloud model ID returns 404/400? A `try/catch` chain retries with a verified backup Flash model alias.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST initialize Firebase (`firebase/app`), `firebase/ai` (`GoogleAIBackend()`), `firebase/app-check` (`ReCaptchaV3Provider` on production domains, debug token strictly on `localhost`/`127.0.0.1`), and `firebase/remote-config` at runtime.
- **FR-002**: System MUST run `[REGEX_FIREWALL]` (API keys, JWTs, Bearer tokens, emails, phones) and `[NANO_SEMANTIC_FIREWALL]` (`ONLY_ON_DEVICE`, `<1,500` char chunks, `8000ms` timeout, defensive JSON parser) strictly locally before any cloud call.
- **FR-003**: System MUST merge overlapping `[start, end]` redaction spans from regex and Nano 4 detectors, enforce word-boundary/specificity guards, and apply right-to-left substring replacement to power a **Visual Redaction Diff Viewer** with separate `[REGEX_FIREWALL]` and `[NANO_SEMANTIC_FIREWALL]` badges.
- **FR-004**: System MUST classify ticket severity (`P0–P3`) and resolve `P2/P3` tickets locally against bundled runbooks when Nano 4 is ready, escalating only sanitized `P0/P1` payloads (or fallback cases) to `PREFER_IN_CLOUD`.
- **FR-005**: System MUST wrap `RemoteConfig` `fetchAndActivate()` in a non-blocking `1500ms` timeout with hardcoded `defaultConfig`, skip cloud network handshakes when offline or Airplane Mode is active, and persist history locally in `IndexedDB`.
- **FR-006**: System MUST preload at least 3 realistic 1-click demo scenarios showcasing contextual PII/PHI/semantic secrets, offline field P2 diagnostics, and P0 multi-service escalation.

### Key Entities

- **TriageTicket**: `{ id, title, rawText, sanitizedText, severity: "P0"|"P1"|"P2"|"P3", spans: RedactionSpan[], resolutionSummary, inferenceSource, latencyMs, createdAt }`
- **RedactionSpan**: `{ start, end, category, detector: "REGEX_FIREWALL" | "NANO_SEMANTIC_FIREWALL", placeholder, originalPreview }`
- **HybridTelemetry**: `{ nanoStatus: "READY"|"MODEL_DOWNLOADING"|"UNAVAILABLE", localCount, cloudCount, estimatedTokensSaved, lastLatencyMs, offlineMode }`

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `0` unredacted `[REGEX_FIREWALL]` or `[NANO_SEMANTIC_FIREWALL]` tokens ever appear in outbound `PREFER_IN_CLOUD` prompts across all automated test scenarios.
- **SC-002**: `100%` of overlapping-span and short-token collision test cases (`"May"` vs `"api.may.com"`, adjacent regex+Nano spans) replace accurately with zero character index corruption.
- **SC-003**: Stage 1 + `RemoteConfig` boot never blocks longer than `1500ms` on startup or `8000ms` per Nano chunk when offline or when Nano weights are missing/downloading.
- **SC-004**: Vitest unit & integration test suite achieves 100% pass rate, production build succeeds with zero TypeScript errors, and public repo includes `Apache-2.0` `LICENSE` + zero production secrets.

## Assumptions

- Target runtime is Chrome Web (PWA) hosted on `$0` Firebase Hosting Spark tier; Chrome Extension side-panel is deferred post-MVP.
- No unauthenticated Firestore writes are enabled on Spark tier; `IndexedDB` handles client persistence cleanly without risking the `20k writes/day` Spark quota.
