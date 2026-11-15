# LocalFirst Triage

**Zero-Leakage Hybrid AI Incident & Support Copilot** built for **#BuildHybridAI 2026** using **Firebase AI Logic (`firebase/ai`)**, **Chrome Gemini Nano 4 (`ONLY_ON_DEVICE`)**, and **Firebase Spark Free Tier**.

## Architecture

1. **Stage 1 — Local Privacy Firewall (`$0` Cloud Cost)**
   - **Deterministic Regex Scrubber (`[REGEX_FIREWALL]`):** Instant extraction of API keys (`AIza...`, `sk-...`, `ghp_...`), JWTs, Bearer tokens, emails, and phone numbers.
   - **Chrome Gemini Nano 4 (`[NANO_SEMANTIC_FIREWALL]`):** Enforces `InferenceMode.ONLY_ON_DEVICE` (never silently falls back to cloud with unredacted text) to extract unstructured contextual PHI, natural-language passwords, and internal codenames/valuations.
   - **Surgical Interval Merger:** Word-boundary (`\b`) guards + interval merging + right-to-left UTF-16 replacement.
   - **Local P2/P3 Runbook Resolution:** Common local dev/client issues resolve 100% on-device with `0` cloud tokens.
2. **Stage 2 — Sanitized Cloud Escalation (`InferenceMode.PREFER_IN_CLOUD`)**
   - Only sanitized P0/P1 payloads escalate to `gemini-3.8-flash` (configured via non-blocking Firebase Remote Config with `1500ms` timeout).
   - Protected by Firebase App Check (`ReCaptchaV3Provider` on `*.web.app`, `FIREBASE_APPCHECK_DEBUG_TOKEN` strictly on `localhost`/`127.0.0.1`).
3. **Offline-First & Zero-Cost Persistence**
   - Sanitized history is stored in browser `IndexedDB` (raw unredacted PII is purged before storage).

## Local Development

```bash
npm install
cp .env.example .env.local # fill in your Firebase Spark project config
npm test
npm run dev
npm run build
```

## Enabling Gemini Nano 4 in Chrome

1. Open `chrome://flags/#optimization-guide-on-device-model` -> **Enabled BypassPerfRequirement**
2. Open `chrome://flags/#prompt-api-for-gemini-nano` -> **Enabled**
3. Restart Chrome and verify `window.LanguageModel.availability()` in DevTools.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
