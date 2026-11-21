# LocalFirst Triage v4.0 — Demo Video Script (2:45)

- **Target Runtime:** `2:45` (`165` seconds, strictly under the 3:00 Hackathon limit)
- **Voiceover Pace:** ~130–140 WPM, crisp engineering clarity, zero filler.
- **Companion Subtitles:** [`DEMO_CAPTIONS.srt`](./DEMO_CAPTIONS.srt)

---

### [0:00 – 0:25] Hook & The Incident Leak Problem
**Visual:** Split screen: left shows a P0 production log containing a Firebase API key, JWT, `Manipal ICU Floor 3` clinical PHI, `dog's name followed by 2026exclamation` password hint, and `Project-Chimera $42M valuation`; right shows `https://para-1-2e22b.web.app/` with Chrome 158 `ON_DEVICE (Nano 4)` Ready badge.  
**Voiceover:**
> "Pasting a live incident log into a cloud LLM leaks API keys, medical notes, password hints, and M&A secrets before anyone notices. LocalFirst Triage v4 is a zero-leakage hybrid AI incident copilot built on the $0 Firebase Spark tier across Web PWA, a Chrome Extension, and Native Android."

---

### [0:25 – 1:05] Stage 1 `ONLY_ON_DEVICE` + Defense-in-Depth Union (Scenario 1)
**Visual:** Click **Scenario 1 (`P0: Semantic PHI + Natural Secret + OAuth Trace`)** and click **Run Hybrid Triage**. Highlight Stage 1 badge (`ON_DEVICE (Nano 4)`), color-coded diff pills (`NANO_SEMANTIC_FIREWALL`, `HEURISTIC_GUARD`, `REGEX_FIREWALL`), interactive toggle/drag-to-mask, and Cancel Countdown pause button.  
**Voiceover:**
> "Look at Scenario 1 on Chrome 158 with Gemini Nano 4 running via Firebase AI Logic `ONLY_ON_DEVICE`. Even if an on-device model extracts only the person name, our Defense-in-Depth Union always runs deterministic regex, Shannon entropy, Remote Config policy terms, and heuristic guards underneath. That catches clinical ICU notes, apostrophe-containing password hints, and M&A valuations with zero bytes touching the cloud until the pre-cloud countdown completes—or fails closed into Quarantine on standard browsers."

---

### [1:05 – 1:35] Zero-Leakage Proof, Streaming Cloud RCA & `PREFER_ON_DEVICE` Brief
**Visual:** Switch to **Zero-Leakage Proof** tab showing `ZERO-LEAKAGE VERIFIED: 0 / N`, scroll to streamed Cloud RCA (`gemini-3.5-flash-lite`), then click **Generate Hybrid Stakeholder Brief** showing `Source: ON_DEVICE` via `InferenceMode.PREFER_ON_DEVICE`.  
**Voiceover:**
> "Before Stage 2 Cloud Gemini streams Root Cause Analysis, our Zero-Leakage Proof audits every masked span, URL-encoded variant, and merged constituent string. Then `InferenceMode.PREFER_ON_DEVICE` drafts our executive and Slack brief right on Gemini Nano 4, automatically falling back to Cloud Gemini when offline or unavailable."

---

### [1:35 – 2:10] Offline Mode + 6 Local Runbooks + Chrome Extension + Remote Config
**Visual:** Toggle **Airplane / Offline Mode**, select **Scenario 4 (`RB_OAUTH_CLOCK_SKEW`)** or **Scenario 2 (`RB_LOCAL_TLS_CERT`)** resolving instantly with `0` cloud tokens, briefly flash **Runbooks & Policy** (`6` built-in runbooks) + **Refresh Policy** Remote Config pill, and highlight Chrome Extension Side Panel scrubbing raw selection before `#handoff=` transfer.  
**Voiceover:**
> "Switch to Airplane Mode and all six built-in P2 and P3 runbooks resolve completely offline at zero token cost, while Firebase Remote Config tunes cloud models, entropy thresholds, and blocked enterprise terms live. Engineers can also highlight any web ticket in our Manifest V3 Extension Side Panel, pre-scrubbing secrets before handoff."

---

### [2:10 – 2:45] Native Android Companion & Zero-PII Cross-Platform Sync
**Visual:** Show Android Emulator / Device running `com.localfirst.triage` (`Triage`, `Diff & Proof`, `Synced Feed` tabs), tap **Enable Sync (Guest)** on Web + Android showing Zero-PII synced ticket in Firestore feed with `[PURGED_FROM_DISK_FOR_PRIVACY]`.  
**Voiceover:**
> "And on Native Android—built with Jetpack Compose, `firebase-ai-ondevice`, and Play Integrity App Check—incidents share the exact same Defense-in-Depth firewall and six runbooks. Signing in as a Guest lazy-loads Firestore and syncs strictly sanitized records across devices, verified by hardened RE2 Security Rules and over 80 automated Web, Playwright, and Android tests."
