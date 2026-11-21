# LocalFirst Triage — Demo Video Shot List & Narration (`2:45` / Max `3:00`)

> **Rule Check:** Public YouTube video, **`<= 3:00`**, English audio (or burned-in English captions), **must show the idea, audience, and live hybrid features in the first 30 seconds**.

---

## 0:00 – 0:30 | Hook, Audience & Instant Live Hybrid Proof *(Critical First 30s!)*
- **Screen:** Split view — start directly on the live hosted app (`https://para-1-2e22b.web.app`) in Chrome with Gemini Nano 4 `READY` (green banner visible).
- **Action:** Scenario 1 (`P0: Semantic PHI + Natural Secret + OAuth Trace`) is selected. Click **Run Hybrid Triage**.
- **Narration:**
  > "Engineering and SRE teams want Gemini to debug P0 outages—but pasting logs into the cloud leaks API keys, medical PHI, and passwords. I'm Gokula, and this is **LocalFirst Triage**: a zero-leakage Hybrid AI Incident Copilot built with **Firebase AI Logic**. Watch what happens when I triage a messy P0 outage: **Gemini Nano 4 (`ONLY_ON_DEVICE`)** catches unstructured medical PHI and natural-language password hints locally—things regex can never see—while **Cloud Gemini (`PREFER_IN_CLOUD`)** only ever sees the sanitized placeholders."

## 0:30 – 1:05 | Inline Diff, Manual Masking & Zero-Leakage Proof
- **Screen:** Highlighted **Inline Redaction Diff Viewer** + Resolution Panel.
- **Action:**
  1. Point out color-coded `[REGEX_FIREWALL]` vs `[NANO_SEMANTIC_FIREWALL]` inline spans.
  2. Click one span pill to pause the 3.0s countdown gate, toggle a span back on, or highlight an extra phrase and click **Mask Selection**.
  3. Click **Escalate Now** -> show live **streaming Cloud Gemini RCA** rendering Markdown!
  4. Switch to the **Zero-Leakage Proof** tab showing `VERIFIED: 0 / N raw secrets in outbound Cloud prompt`.
- **Narration:**
  > "Every detected secret is color-coded inline by detector. We can inspect, toggle, or manually mask custom phrases before escalation. A programmatic Zero-Leakage Gate verifies zero raw secrets remain in the outbound prompt before **Firebase AI Logic (`PREFER_IN_CLOUD`)** streams root-cause analysis from Gemini Flash—configured dynamically via **Firebase Remote Config** and protected by **App Check**."

## 1:05 – 1:40 | 100% Local P2/P3 Runbooks & Airplane / Offline Mode
- **Screen:** Click **Airplane / Offline Mode: ON** (or open DevTools Offline), click **P3: Expired Local Dev TLS Cert** -> **Run Hybrid Triage**. Then run a P0 ticket while offline to show **Offline Queue**.
- **Narration:**
  > "Routine P2 and P3 tickets don't touch the cloud at all. Even in Airplane Mode, Stage 1 classifies severity on-device and resolves against local Markdown runbooks in milliseconds—saving 100% of cloud tokens. If a critical P0 arrives while offline, outbound cloud escalation is strictly blocked and queued safely in zero-PII IndexedDB until connectivity returns."

## 1:40 – 2:15 | Chrome Extension Side Panel Companion & Hybrid Brief (`PREFER_ON_DEVICE`)
- **Screen:** Open a GitHub issue tab with a synthetic leaked AWS key (`AKIA...`) & customer note. Highlight -> Right-click -> **"Sanitize & Triage with LocalFirst"**.
- **Action:** Chrome Extension Side Panel opens automatically, sanitizes on-device with Chrome's built-in `LanguageModel` API, then click **Escalate Sanitized to Cloud Workbench** (shows the `#handoff=` sanitized import in the Web app!). Click **Generate Hybrid Stakeholder Brief** (`InferenceMode.PREFER_ON_DEVICE`).
- **Narration:**
  > "Our **Manifest V3 Chrome Extension** brings this privacy firewall directly into GitHub, Jira, Zendesk, and PagerDuty. Right-clicking any stack trace sanitizes it inside the Side Panel first, then hands off only the scrubbed payload to the Web workbench—where **`PREFER_ON_DEVICE`** drafts a safe executive Slack update."

## 2:15 – 2:45 | Worst-Case Resilience & Architecture Wrap
- **Screen:** Briefly show custom **Runbooks & Policy** modal + **Zero-PII IndexedDB** history reload (`[PURGED_FROM_DISK_FOR_PRIVACY]`) + Architecture slide / GitHub repo (`Apache-2.0`).
- **Narration:**
  > "Even on browsers without Gemini Nano flags enabled, LocalFirst Triage fails closed into quarantine using regex, Luhn card checks, Shannon entropy, and heuristic guards—and purges raw PII before touching IndexedDB. All running at **$0.00** on Firebase Spark with Apache-2.0 source code linked below. Thanks for watching!"

---

## Pre-Recording Checklist
- [ ] Confirm browser zoom is clean (`110%` or `125%` for legible text on 1080p recording).
- [ ] Verify Chrome Nano 4 flag is enabled so the first 30s show **real `ON_DEVICE (Nano 4)`** + **real `IN_CLOUD`** streaming!
- [ ] Double-check total runtime stays strictly **`<= 2:55`** before uploading publicly to YouTube.
