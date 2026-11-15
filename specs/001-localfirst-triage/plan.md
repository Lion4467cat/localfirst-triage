# Implementation Plan: LocalFirst Triage

**Branch**: `001-localfirst-triage` | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/001-localfirst-triage/spec.md`

## Summary

Build **LocalFirst Triage**, a Chrome-first Responsive Web App (PWA) hosted on `$0` Firebase Hosting Spark Tier. Stage 1 runs a dual-layer local privacy firewall (`[REGEX_FIREWALL]` + Chrome Gemini Nano 4 via `InferenceMode.ONLY_ON_DEVICE`, chunked `<1,500` chars with an `8000ms` timeout and defensive JSON parsing) plus local runbook resolution for P2/P3 tickets (`$0` cloud tokens). Overlapping spans are merged via interval-merging + word-boundary guards and replaced right-to-left for a surgical **Visual Redaction Diff Viewer**. Only sanitized P0/P1 payloads escalate to Stage 2 (`InferenceMode.PREFER_IN_CLOUD` via `GoogleAIBackend()` + Remote Config with `1500ms` non-blocking timeout), protected by Firebase App Check (`ReCaptchaV3Provider` on `*.web.app`, debug token strictly on `localhost`/`127.0.0.1`), with `IndexedDB` local persistence.

## Technical Context

**Language/Version**: TypeScript 5.x, React 19, Vite 6
**Primary Dependencies**: `firebase@latest` (`firebase/app`, `firebase/ai`, `firebase/app-check`, `firebase/remote-config`), `tailwindcss`, `lucide-react`
**Storage**: Browser `IndexedDB` (zero Firestore open-write quota risk on Spark)
**Testing**: Vitest (`vitest` + `@testing-library/react` + `jsdom`)
**Target Platform**: Chrome Desktop/Mobile Web PWA on Firebase Hosting (Spark Free Tier)
**Performance Goals**: Non-blocking boot (`<=1500ms` Remote Config race), `<=8000ms` timeout per Nano 4 chunk, instant deterministic regex fallback
**Constraints**: Strict `$0.00` infrastructure spend; zero raw PII/secrets sent to cloud; zero server/admin secrets in repo; Apache-2.0 license

## Constitution Check

- **I. On-Device Privacy Firewall:** PASS — Stage 1 enforces `InferenceMode.ONLY_ON_DEVICE` + regex/entropy scrubber; never falls back to cloud with unredacted text.
- **II. Irreplaceable Semantic Hybrid Value:** PASS — Demo scenarios and diff UI separate `[REGEX_FIREWALL]` vs `[NANO_SEMANTIC_FIREWALL]` and resolve P2/P3 tickets locally.
- **III. Surgical Determinism & Bounded Execution:** PASS — `<1,500` char chunking, `8000ms` timeout, defensive JSON parser, `\b` guards, interval merge + right-to-left replacement.
- **IV. Offline-First & Zero-Cost Spark Tier:** PASS — `GoogleAIBackend()`, `ReCaptchaV3Provider` (no GCP Enterprise billing block), `1500ms` Remote Config timeout + `defaultConfig`, `IndexedDB`.
- **V. Test-First & Security Hygiene:** PASS — Vitest suite covers redaction, merging, chunking, timeout/fallback, and routing before UI build.

## Project Structure

### Documentation (`specs/001-localfirst-triage/`)
- `spec.md` — Requirements & scenarios
- `plan.md` — Architecture & implementation plan
- `research.md` — Technical & Spark-tier decisions
- `data-model.md` — TypeScript domain entities & state model
- `quickstart.md` — Local dev, test, and Firebase Spark setup

### Source Code (`src/`)
```text
src/
├── config/
│   ├── firebase.ts          # Firebase App, App Check (v3/localhost debug), non-blocking RemoteConfig
│   └── demoScenarios.ts     # 3 semantic-secret + local-runbook + P0 escalation scenarios + runbooks
├── firewall/
│   ├── regexScrubber.ts     # [REGEX_FIREWALL]: API keys, JWTs, Bearer, emails, phones
│   ├── nanoExtractor.ts     # [NANO_SEMANTIC_FIREWALL]: chunking (<1500), ONLY_ON_DEVICE, 8000ms timeout, defensive JSON
│   ├── spanMerger.ts        # Word-boundary matcher, specificity guard, interval merge, right-to-left replace
│   └── pipeline.ts          # Two-stage hybrid orchestrator (P2/P3 local vs P0/P1 sanitized cloud + telemetry)
├── storage/
│   └── ticketStore.ts       # IndexedDB wrapper with safe in-memory fallback
├── components/
│   ├── TriageInbox.tsx      # Split-pane ticket editor, 1-click scenarios, history list
│   ├── RedactionDiff.tsx    # Side-by-side surgical diff with [REGEX_FIREWALL] & [NANO_SEMANTIC_FIREWALL] badges
│   └── TelemetryHud.tsx     # Nano 4 status, inferenceSource, latency, % local, Airplane/Offline toggle
├── App.tsx
└── main.tsx
tests/
├── regexScrubber.test.ts
├── spanMerger.test.ts
├── nanoExtractor.test.ts
└── pipeline.test.ts
```
