# LocalFirst Triage (`v3.0`) — Demo Video Shot List & Narration (`2:45` / Max `3:00`)

> **Rule Check:** Public YouTube video, **`<= 3:00`**, English audio (or burned-in English captions), **must show the idea, audience, and live hybrid features in the first 30 seconds**.

---

## 0:00 – 0:30 | Hook, Audience & Instant Live Hybrid Proof *(Critical First 30s!)*
- **Screen:** Start directly on the live hosted app (`https://para-1-2e22b.web.app`) in Chrome Desktop with the green **`Chrome Gemini Nano 4 is READY`** banner visible.
- **Action:** Scenario 1 (`P0: Semantic PHI + Natural Secret + OAuth Trace`, 1 of 4 severity-tier scenarios: `P0`, `P3`, `P1`, `P2`) is selected. Click **Run Hybrid Triage**.
- **Narration:**
  > "Engineering and SRE teams want Gemini to debug P0 outages—but pasting raw logs into the cloud leaks API keys, medical PHI, and passwords. I'm Gokula, and this is **LocalFirst Triage v3.0**: a zero-leakage Hybrid AI Incident Copilot built with **Firebase AI Logic**. Watch what happens when I triage a messy P0 outage: **Chrome Gemini Nano 4 / Gemma 4 (`InferenceMode.ONLY_ON_DEVICE`)** and our deterministic regex + Shannon entropy (`>=3.25 bits/char`) firewall scrub unstructured medical PHI, natural-language password hints, and API tokens locally—so **Cloud Gemini (`gemini-3.5-flash-lite` via `PREFER_IN_CLOUD`)** only ever sees verified placeholders."

## 0:30 – 1:05 | Inline Diff, Manual Masking, Streaming Cloud RCA & Zero-Leakage Proof
- **Screen:** Highlighted **Inline Redaction Diff Viewer** + **Triage Resolution & Routing** panel.
- **Action:**
  1. Point out the color-coded detector badges (`[REGEX_FIREWALL]`, `[NANO_SEMANTIC_FIREWALL]` / `[HEURISTIC_GUARD]`).
  2. Click one span pill to toggle mask/unmask, or highlight a custom phrase and click **Mask Selection**.
  3. Click **Escalate Now** (or **Approve & Escalate Sanitized Payload to Cloud**) -> show live **streaming Cloud Gemini (`gemini-3.5-flash-lite`) RCA** rendering Markdown!
  4. Switch to the **Zero-Leakage Proof** tab showing `ZERO-LEAKAGE VERIFIED: 0 / 9 raw secrets leaked (9 active mask(s))` alongside the exact literal outbound prompt.
- **Narration:**
  > "Every detected secret is color-coded inline. Engineers can toggle any pill or highlight custom text to add a manual mask. Before a single byte leaves the browser, our mathematical Zero-Leakage Gate asserts zero raw secrets remain in the outbound prompt—and only then does **Firebase AI Logic (`PREFER_IN_CLOUD`)** stream root-cause analysis from **`gemini-3.5-flash-lite`**, protected by **reCAPTCHA Enterprise App Check** and **Firebase Remote Config**."

## 1:05 – 1:40 | 100% Local P2/P3 Runbooks & Airplane / Offline Mode
- **Screen:** Click **Scenario 2 (`P3: Expired Local Dev TLS Cert`)** or **Scenario 4 (`P2: Field Scanner OAuth Clock Skew`)** -> **Run Hybrid Triage** (resolves via 1 of the **5** default local runbooks in `<10ms` with `$0` cloud tokens). Then toggle **Airplane / Offline Mode: ON** and run **Scenario 3 (`P1: Payment DB Deadlock + Stripe Key + Card`)** to show the **Offline Reconnect Queue**.
- **Narration:**
  > "Routine P2 and P3 tickets never touch the cloud. Stage 1 matches them on-device against 5 built-in and custom Markdown runbooks in milliseconds—saving 100% of cloud tokens. And if a P0 or P1 arrives in Airplane Mode, outbound escalation is strictly blocked and queued in zero-PII IndexedDB until connectivity returns."

## 1:40 – 2:15 | Chrome Extension Side Panel Companion & Hybrid Brief (`PREFER_ON_DEVICE`)
- **Screen:** Open a GitHub issue tab with a synthetic leaked AWS key (`AKIA...`) & customer note. Highlight -> Right-click -> **"Sanitize & Triage with LocalFirst"**.
- **Action:** Chrome Extension Side Panel (`v3.0.0`) opens automatically, sanitizes on-device with Chrome's `LanguageModel` API, then click **Escalate Sanitized to Cloud Workbench** (opens `https://para-1-2e22b.web.app/#handoff=<base64url>` with automatic re-scrubbing on import!). Back in the resolution panel, click **Generate Hybrid Stakeholder Brief** (`InferenceMode.PREFER_ON_DEVICE`).
- **Narration:**
  > "Our **Manifest V3 Chrome Extension** brings this privacy firewall directly into GitHub, Jira, Zendesk, PagerDuty, and Linear. Right-clicking any stack trace sanitizes it inside the Side Panel first, then hands off only the scrubbed payload to `para-1-2e22b.web.app`—where **`InferenceMode.PREFER_ON_DEVICE`** drafts an executive Slack update."

## 2:15 – 2:45 | Fail-Closed Resilience, Zero-PII Storage & Architecture Wrap
- **Screen:** Show the **Runbooks & Policy** modal + **Zero-PII IndexedDB** history (`[PURGED_FROM_DISK_FOR_PRIVACY]`) + GitHub repo (`https://github.com/Lion4467cat/localfirst-triage`, `Apache-2.0`).
- **Narration:**
  > "Even on browsers without Gemini Nano flags enabled, LocalFirst Triage fails closed into quarantine using regex, Luhn card checks, Shannon entropy, and heuristic guards—and purges raw PII before touching IndexedDB. All running at **$0.00** on Firebase Spark with 60+ automated tests and Apache-2.0 source code. Thanks for watching!"

---

## Linux Dual-GPU (`Intel iGPU + NVIDIA RTX dGPU`) Chrome Filming Notes

On hybrid Intel (`/dev/dri/renderD128`) + NVIDIA (`/dev/dri/renderD129`) Linux laptops, Chrome's default launcher passes `--render-node-override=/dev/dri/renderD128` (Intel iGPU) to `on_device_model.mojom.OnDeviceModelService`, which can cause Chrome 154's `libLiteRtWebGpuAccelerator.so` worker to crash when executing the 2.47 GB Gemma 4 (`gemma4_component`) weights.

To film with the **NVIDIA RTX dGPU (`/dev/dri/renderD129`)** and a clean crash counter:
1. Reset Chrome's on-device crash counter at `chrome://on-device-internals` (click **Reset crash count** in the **Model Status** tab), or reset `optimization_guide.on_device.model_crash_count` to `0` in `~/.config/google-chrome/Local State`.
2. Launch Chrome pointing `OnDeviceModelService` at the NVIDIA render node (`/dev/dri/renderD129`):
   ```bash
   __NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia __VK_LAYER_NV_optimus=NVIDIA_only \
     /opt/google/chrome/chrome --ozone-platform=wayland --render-node-override=/dev/dri/renderD129 \
     https://para-1-2e22b.web.app
   ```

## Pre-Recording Checklist
- [ ] Confirm browser zoom is clean (`110%` or `125%` for legible text on 1080p recording).
- [ ] Verify green **`Chrome Gemini Nano 4 is READY`** banner and live **`IN_CLOUD (gemini-3.5-flash-lite)`** streaming.
- [ ] Double-check total runtime stays strictly **`<= 2:55`** before uploading publicly to YouTube.
