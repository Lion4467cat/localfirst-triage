<!--
Sync Impact Report:
- Version change: template -> 1.0.0 (initial ratification)
- Added sections: Core Principles (I-V), Technical & Security Constraints, Hackathon Compliance & Workflow Gates, Governance
- Follow-up TODOs: None
-->

# LocalFirst Triage Constitution

## Core Principles

### I. On-Device Privacy Firewall (NON-NEGOTIABLE)
Every sensitive PII, PHI, and credential detection pass MUST execute strictly locally using Chrome Gemini Nano 4 via `InferenceMode.ONLY_ON_DEVICE` paired with a deterministic regex/entropy scrubber. Raw, unredacted user payloads MUST NEVER silently fall back to cloud inference when on-device weights are unavailable or still downloading.

### II. Irreplaceable Semantic Hybrid Value
Stage 1 MUST distinguish deterministic pattern matches (`[REGEX_FIREWALL]`) from contextual semantic extractions (`[NANO_SEMANTIC_FIREWALL]`) covering unstructured medical, financial, organizational, and natural-language secrets. Routine P2/P3 tickets MUST resolve 100% on-device against local runbooks with zero cloud calls; only sanitized P0/P1 payloads escalate to Stage 2 cloud reasoning (`PREFER_IN_CLOUD`).

### III. Surgical Determinism & Bounded Execution
Small-model outputs MUST NEVER rewrite full prose directly for diffing. Entity extraction MUST pass word-boundary and specificity guards, merge overlapping `[start, end]` spans across regex and Nano 4 detectors, and apply replacements right-to-left. Stack traces MUST be trimmed and chunked below `1,500` characters per Nano 4 call, wrapped in an `8000ms` `Promise.race` timeout and defensive JSON parser.

### IV. Offline-First & Strict Zero-Cost Spark Tier ($0.00)
The application MUST run completely on Firebase Spark Free Tier without any attached billing account or credit card. `RemoteConfig` MUST provide hardcoded `defaultConfig` and wrap `fetchAndActivate()` in a non-blocking `1500ms` timeout so Airplane/Offline Mode never hangs. Persistent ticket history MUST use browser `IndexedDB` rather than unauthenticated open Firestore writes.

### V. Test-First Verification & Security Hygiene
All redaction, interval-merging, chunking, timeout handling, and hybrid routing policies MUST have passing Vitest unit and integration tests before release. Live hosted builds (`*.web.app`) MUST use `ReCaptchaV3Provider` (or Enterprise only if enabled without billing) while `FIREBASE_APPCHECK_DEBUG_TOKEN` MUST be strictly gated to `localhost` / `127.0.0.1`.

## Technical & Security Constraints

- **Runtime Firebase Stack:** `firebase@latest` (`firebase/app`, `firebase/ai` with `GoogleAIBackend()`, `firebase/app-check`, `firebase/remote-config`) imported and invoked at runtime.
- **Zero-Secret Repo Policy:** No server/admin credentials, GCP service accounts, or real PII may appear in source, tests, or documentation; public Web `firebaseConfig` identifiers must be domain-restricted.
- **License & Platform:** Public GitHub repository under `Apache-2.0` (`LICENSE` at repo root), targeting a Chrome-first Responsive Web App (PWA) on Firebase Hosting Spark.

## Development Workflow & Submission Gates

- **Spec-Kit Order:** Changes follow `speckit-constitution` → `speckit-specify` → `speckit-clarify` → `speckit-plan` → `speckit-tasks` → `speckit-analyze` → `speckit-implement`.
- **Graphify Intelligence:** Run `/home/tinkerer/Desktop/Money/.venv/bin/graphify` on `localfirst-triage` as modules grow to verify architecture boundaries and test coverage.
- **Commit Freeze:** All evaluated commits, live Firebase Hosting deploy, `<= 3:00` public English YouTube demo video, and Devpost submission (`firebasehybridaihackathon.devpost.com`) MUST complete prior to **2026-11-30 14:00 PT**.

## Governance

This constitution supersedes ad-hoc implementation shortcuts. Amendments require updating this file, bumping semantic version (`MAJOR.MINOR.PATCH`), and verifying alignment against `company/venture-org/projects/hackathon-sprint-1/OFFICIAL_RULES.md`.

**Version**: 1.0.0 | **Ratified**: 2026-11-15 | **Last Amended**: 2026-11-15
