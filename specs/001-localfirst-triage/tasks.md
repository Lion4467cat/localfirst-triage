# Tasks: LocalFirst Triage

**Input**: Design documents from `/specs/001-localfirst-triage/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `quickstart.md`

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 Initialize Vite + React + TypeScript + Tailwind + Vitest project files (`package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/index.css`)
- [x] T002 [P] Add Apache-2.0 `LICENSE`, `.gitignore` (excluding `node_modules/`, `dist/`, `.env.local`, `graphify-out/`), `.env.example`, and `firebase.json` (Spark static hosting)

## Phase 2: Foundational (Blocking Prerequisites)

- [x] T003 Create domain types (`RedactionSpan`, `TriageResult`, `HybridTelemetry`, `DemoScenario`) in `src/types/triage.ts` matching `data-model.md`
- [x] T004 [P] Implement `src/config/firebase.ts` with `initializeApp`, `ReCaptchaV3Provider` / `ReCaptchaEnterpriseProvider` (and `FIREBASE_APPCHECK_DEBUG_TOKEN` strictly on `localhost`/`127.0.0.1`), `getAI(app, { backend: new GoogleAIBackend() })`, and non-blocking `getRemoteConfig` (`1500ms` timeout + `defaultConfig`)
- [x] T005 [P] Implement `src/storage/ticketStore.ts` (`IndexedDB` persistence for sanitized `TriageResult` history with safe in-memory fallback)

## Phase 3: User Story 1 - Dual-Layer Local Privacy Firewall (Priority: P1)

- [x] T006 [P] [US1] Write unit tests in `tests/regexScrubber.test.ts` (API keys, JWTs, Bearer tokens, emails, phones, AWS, PEM, DB URI, Luhn CC, SSN, entropy, heuristics, policy terms)
- [x] T007 [P] [US1] Write unit tests in `tests/spanMerger.test.ts` (overlapping intervals, `"May"` vs `"api.may.com"` `\b` guard, right-to-left offsets, manual mask, zero-leakage audit)
- [x] T008 [P] [US1] Write unit tests in `tests/nanoExtractor.test.ts` (`<1500` char chunking, `8000ms` timeout, defensive JSON parse, `DOWNLOADABLE`/`MODEL_DOWNLOADING` states, text-only `expectedInputs`)
- [x] T009 [US1] Implement `src/firewall/regexScrubber.ts`
- [x] T010 [US1] Implement `src/firewall/spanMerger.ts`
- [x] T011 [US1] Implement `src/firewall/nanoExtractor.ts` using `InferenceMode.ONLY_ON_DEVICE`
- [x] T012 [US1] Implement `src/components/RedactionDiff.tsx` (inline color-highlighted diff with mask/unmask toggling, manual selection masking, and copy sanitized button)

## Phase 4: User Story 2 - Zero-Cloud Local Resolution & Sanitized Cloud Escalation (Priority: P2)

- [x] T013 [P] [US2] Write unit tests in `tests/pipeline.test.ts` (P2/P3 local runbook `0` cloud calls, P0 sanitized escalation, offline queue, `CLOUD_ERROR`, zero-leakage gate, streaming RCA, `PREFER_ON_DEVICE` brief)
- [x] T014 [US2] Create `src/config/demoScenarios.ts` (5 semantic-secret + local-runbook + PCI/PEM escalation scenarios + 6 local runbooks)
- [x] T015 [US2] Implement `src/firewall/pipeline.ts` orchestrating Stage 1 -> local runbook check -> zero-leakage gate -> Stage 2 sanitized streaming cloud escalation + hybrid brief
- [x] T016 [US2] Implement `src/components/TriageInbox.tsx` (split-pane ticket editor, drag-and-drop file upload, 5 demo scenarios, offline queue, sanitized history list)

## Phase 5: User Story 3 - Live Hybrid Telemetry HUD & Offline Mode (Priority: P3)

- [x] T017 [US3] Implement `src/components/TelemetryHud.tsx` (Nano 4 status/warm-up progress, App Check & Remote Config badges, Chrome Nano setup drawer, Airplane/Offline toggle)
- [x] T018 [US3] Wire `src/App.tsx` integrating `TriageInbox`, `PipelineStepper`, `RedactionDiff`, `ResolutionPanel`, `RunbookPolicyModal`, `TelemetryHud`, and `ticketStore`

## Phase 6: Polish, v3.0 Companion & Verification

- [x] T019 [P] Write `README.md`, `DEVPOST_SUBMISSION.md`, and `DEMO_VIDEO_SCRIPT.md`
- [x] T020 Run `npm test`, `npm run build`, and Graphify on `/home/tinkerer/Desktop/Money/localfirst-triage`
- [x] T021 [v3.0] Fix `@firebase/ai` `inCloudParams.model`, lowercase `InferenceSource`, and text-only `expectedInputs` (`tests/firebase.test.ts`)
- [x] T022 [v3.0] Add `PipelineStepper.tsx`, `ResolutionPanel.tsx` (Markdown RCA, Zero-Leakage Proof tab, JSON/MD export), and `RunbookPolicyModal.tsx` (custom runbooks + privacy policy)
- [x] T023 [v3.0] Build Manifest V3 Chrome Extension Side Panel companion in `extension/` with real PNG icons and `#handoff=` sanitized import (`tests/extension.test.ts`)
- [x] T024 [v3.0] Generate real PWA icons (`192x192`, `512x512`) and update `public/manifest.json` & `public/sw.js`
