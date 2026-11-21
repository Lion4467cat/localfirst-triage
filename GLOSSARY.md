# LocalFirst Triage (`v3.0`) — Domain & Architecture Glossary

This glossary defines the ubiquitous domain language for **LocalFirst Triage** and pairs with the `/codebase-design` vocabulary (**module**, **interface**, **implementation**, **depth**, **seam**, **adapter**, **leverage**, **locality**).

## Domain Terms

- **RawPayload (`rawText`)**: Unredacted incident log, stack trace, or customer support message held strictly in volatile browser session memory and never persisted to disk or sent to the cloud.
- **SanitizedPayload (`sanitizedText`)**: Incident text after all active `RedactionSpan` intervals have been replaced right-to-left with numbered `[REDACTED:<CATEGORY>_<N>]` placeholders.
- **RedactionSpan**: A UTF-16 `[start, end)` interval in `RawPayload` identified by a `DetectorSource`, carrying its replacement `placeholder`, `masked` toggle state, and `constituentTexts` for merged overlapping intervals.
- **LocalFirewall (Stage 1)**: The on-device privacy scrub combining deterministic `scanAndRedactLocal()` (`REGEX_FIREWALL` across 9 rules + Luhn check, `ENTROPY_SCANNER` at `shannonEntropy >= 3.25 bits/char`, `HEURISTIC_GUARD` across 4 contextual rules, `POLICY_TERM`) with Chrome Built-in Gemini Nano 4 / Gemma 4 (`NANO_SEMANTIC_FIREWALL` via `InferenceMode.ONLY_ON_DEVICE`).
- **LocalRunbook**: One of the **5** built-in offline Markdown resolution guides (`RB_CERT_EXPIRED`, `RB_OAUTH_CLOCK_SKEW`, `RB_NPM_ERESOLVE`, `RB_CORS_ORIGIN`, `RB_INDEXEDDB_QUOTA`) or user-created custom runbooks (`P2`/`P3`) matched on-device so routine dev/client incidents resolve with `$0` cloud tokens.
- **DemoScenario**: One of the **4** built-in incident presets spanning all 4 severity tiers (`P0`, `P3`, `P1`, `P2`) in `src/config/demoScenarios.ts`.
- **FailClosedQuarantine (`QUARANTINED_PENDING_APPROVAL`)**: Security hold triggered whenever Gemini Nano 4 is not `READY` on a `P0`/`P1` ticket, requiring explicit human review of the inline diff before cloud dispatch.
- **ZeroLeakageGate (`verifyZeroLeakage`)**: Programmatic pre-cloud assertion verifying that `0` active masked substrings (including constituent overlapped secrets and URL/JSON-encoded variants) appear in the outbound cloud prompt.
- **CloudEscalation (Stage 2)**: Streaming root-cause analysis via Firebase AI Logic (`InferenceMode.PREFER_IN_CLOUD`, `inCloudParams.model: "gemini-3.5-flash-lite"` with unary retry and `"gemini-2.5-flash"` fallback) protected by Firebase App Check (`ReCaptchaEnterpriseProvider`).
- **HybridBrief**: Executive summary and Slack/Jira stakeholder update generated from `SanitizedPayload` via `InferenceMode.PREFER_ON_DEVICE`.
- **ZeroPiiStore**: Browser `IndexedDB` v2 store where `stripRawTextForStorage()` permanently replaces `rawText` with `"[PURGED_FROM_DISK_FOR_PRIVACY]"` and strips `matchedText`/`constituentTexts` before disk write.
- **ExtensionHandoff (`#handoff=<base64url>`)**: Strict UTF-8 base64url envelope transferring sanitized captures from the Manifest V3 Chrome Extension Side Panel (`extension/`) to `https://para-1-2e22b.web.app/` with automatic deterministic re-scrubbing on import.
