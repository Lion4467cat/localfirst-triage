# Research & Architecture Decisions: LocalFirst Triage

## 1. App Check on No-Card Firebase Spark Plan
- **Decision**: Use `ReCaptchaV3Provider` (configured via `google.com/recaptcha/admin`) for production `*.web.app` / `*.firebaseapp.com`, with `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` gated strictly to `localhost` / `127.0.0.1`, and `ReCaptchaEnterpriseProvider` only if verified enabled without billing.
- **Rationale**: GCP `recaptchaenterprise.googleapis.com` can require an active Cloud Billing account on strict no-card projects; classic reCAPTCHA v3 runs at `$0` without a billing gate and prevents `403 App Check token invalid` for Devpost judges.

## 2. Existential Hybrid Value (Semantic vs. Regex)
- **Decision**: Separate `[REGEX_FIREWALL]` from `[NANO_SEMANTIC_FIREWALL]` and include local P2/P3 runbook resolution on-device.
- **Rationale**: Regex cannot detect contextual PHI, M&A codenames, or natural-language credentials, and resolving P2/P3 tickets locally saves `100%` of cloud calls rather than just redacting.

## 3. Surgical Diff Without Small-LLM Paraphrasing
- **Decision**: Extract `{type, value}` entity JSON from Gemini Nano 4 (`ONLY_ON_DEVICE`), validate with length + `\b` word-boundary guards, merge overlapping `[start, end]` intervals with regex spans, and replace right-to-left.
- **Rationale**: Prevents short-word poisoning (`"May"` -> `api.may.com`), index shifting, and whitespace drift.

## 4. Non-Blocking Offline & Nano Download Resilience
- **Decision**: Hardcode `remoteConfig.defaultConfig`, race `fetchAndActivate()` against a `1500ms` timeout, chunk inputs `<1,500` chars, and wrap `ONLY_ON_DEVICE` in an `8000ms` timeout + defensive JSON extractor.
- **Rationale**: Guarantees Airplane/Offline Mode never hangs and fresh judge browsers in `"after-download"` state degrade cleanly.

## 5. Client Persistence Without Open Firestore Quota Risk
- **Decision**: Use browser `IndexedDB` instead of unauthenticated Firestore writes.
- **Rationale**: Prevents public Spark `20k writes/day` exhaustion during judging while still hitting 4+ Firebase products (`AI Logic`, `App Check`, `Remote Config`, `Hosting`).
