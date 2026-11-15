# Quickstart: LocalFirst Triage

## 1. Local Setup (Zero-Cost)
1. Copy `.env.example` to `.env.local` and fill in public Firebase Web App config (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, etc.) plus optional `VITE_RECAPTCHA_V3_SITE_KEY`.
2. On `localhost` / `127.0.0.1`, `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` is enabled automatically for development.
3. Install & run:
   ```bash
   npm install
   npm test
   npm run dev
   ```

## 2. Chrome Gemini Nano 4 Flags (For Full On-Device Mode)
- Enable `chrome://flags/#optimization-guide-on-device-model` (`Enabled BypassPerfRequirement`)
- Enable `chrome://flags/#prompt-api-for-gemini-nano` (`Enabled`)
- If flags are not enabled, Stage 1 runs `[REGEX_FIREWALL]` locally and displays *"Nano 4 unavailable — Local Regex Firewall active + Cloud Fallback"* before any sanitized cloud escalation.
