# Tasks: LocalFirst Triage

**Input**: Design documents from `/specs/001-localfirst-triage/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `quickstart.md`

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Initialize Vite + React + TypeScript + Tailwind + Vitest project files (`package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/index.css`)
- [ ] T002 [P] Add Apache-2.0 `LICENSE`, `.gitignore` (excluding `node_modules/`, `dist/`, `.env.local`, `graphify-out/`), `.env.example`, and `firebase.json` (Spark static hosting)

## Phase 2: Foundational (Blocking Prerequisites)

- [ ] T003 Create domain types (`RedactionSpan`, `TriageResult`, `HybridTelemetry`, `DemoScenario`) in `src/types/triage.ts` matching `data-model.md`
- [ ] T004 [P] Implement `src/config/firebase.ts` with `initializeApp`, `ReCaptchaV3Provider` (and `FIREBASE_APPCHECK_DEBUG_TOKEN` strictly on `localhost`/`127.0.0.1`), `getAI(app, { backend: new GoogleAIBackend() })`, and non-blocking `getRemoteConfig` (`1500ms` timeout + `defaultConfig`)
- [ ] T005 [P] Implement `src/storage/ticketStore.ts` (`IndexedDB` persistence for sanitized `TriageResult` history with safe in-memory fallback)

## Phase 3: User Story 1 - Dual-Layer Local Privacy Firewall (Priority: P1)

**Goal**: Deterministic `[REGEX_FIREWALL]` + `ONLY_ON_DEVICE` `[NANO_SEMANTIC_FIREWALL]` with `<1,500` char chunking, `8000ms` timeout, defensive JSON parse, interval-merging + `\b` guards, and surgical right-to-left diff.

- [ ] T006 [P] [US1] Write failing unit tests in `tests/regexScrubber.test.ts` (API keys, JWTs, Bearer tokens, emails, phones)
- [ ] T007 [P] [US1] Write failing unit tests in `tests/spanMerger.test.ts` (overlapping intervals, `"May"` vs `"api.may.com"` `\b` guard, right-to-left offsets)
- [ ] T008 [P] [US1] Write failing unit tests in `tests/nanoExtractor.test.ts` (`<1500` char chunking, `8000ms` timeout, defensive JSON parse, `"after-download"` state)
- [ ] T009 [US1] Implement `src/firewall/regexScrubber.ts`
- [ ] T010 [US1] Implement `src/firewall/spanMerger.ts`
- [ ] T011 [US1] Implement `src/firewall/nanoExtractor.ts` using `InferenceMode.ONLY_ON_DEVICE`
- [ ] T012 [US1] Implement `src/components/RedactionDiff.tsx` (side-by-side raw vs sanitized diff with `[REGEX_FIREWALL]` and `[NANO_SEMANTIC_FIREWALL]` badges)

## Phase 4: User Story 2 - Zero-Cloud Local Resolution & Sanitized Cloud Escalation (Priority: P2)

**Goal**: 1-click semantic demo scenarios, local P2/P3 runbook resolution (`0` cloud tokens), and sanitized P0/P1 cloud fallback via `InferenceMode.PREFER_IN_CLOUD`.

- [ ] T013 [P] [US2] Write failing unit tests in `tests/pipeline.test.ts` (P2/P3 local runbook `0` cloud calls, P0 sanitized escalation, offline toggle, Remote Config `1500ms` timeout)
- [ ] T014 [US2] Create `src/config/demoScenarios.ts` (3 semantic-secret + local-runbook + P0 escalation scenarios + local runbooks)
- [ ] T015 [US2] Implement `src/firewall/pipeline.ts` orchestrating Stage 1 -> local runbook check -> Stage 2 sanitized cloud escalation
- [ ] T016 [US2] Implement `src/components/TriageInbox.tsx` (split-pane ticket editor, 1-click demo buttons, sanitized history list)

## Phase 5: User Story 3 - Live Hybrid Telemetry HUD & Offline Mode (Priority: P3)

**Goal**: Live visibility into `inferenceSource`, Nano 4 availability (`READY`, `MODEL_DOWNLOADING`, `UNAVAILABLE`), latency, token savings, and Airplane/Offline toggle.

- [ ] T017 [US3] Implement `src/components/TelemetryHud.tsx` (Nano 4 status banner, `inferenceSource` badge, latency, % local resolved, tokens saved, Airplane/Offline toggle)
- [ ] T018 [US3] Wire `src/App.tsx` integrating `TriageInbox`, `RedactionDiff`, `TelemetryHud`, and `ticketStore`

## Phase 6: Polish & Verification

- [ ] T019 [P] Write `README.md` with `#BuildHybridAI 2026` architecture diagram, Chrome Nano 4 flags, App Check debug token instructions, and `$0` Spark deploy steps
- [ ] T020 Run `npm test`, `npm run build`, and `/home/tinkerer/Desktop/Money/.venv/bin/graphify` on `/home/tinkerer/Desktop/Money/localfirst-triage`
