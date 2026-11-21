# LocalFirst Triage — Domain & Architecture Glossary

This glossary defines the ubiquitous domain language for **LocalFirst Triage** and pairs with the `/codebase-design` vocabulary (**module**, **interface**, **implementation**, **depth**, **seam**, **adapter**, **leverage**, **locality**).

## Domain Terms

- **RawPayload (`rawText`)**: Unredacted incident log, stack trace, or customer support message held strictly in volatile browser session memory and never persisted to disk or sent to the cloud.
- **SanitizedPayload (`sanitizedText`)**: Incident text after all active `RedactionSpan` intervals have been replaced right-to-left with numbered `[REDACTED:<CATEGORY>_<N>]` placeholders.
- **RedactionSpan**: A UTF-16 `[start, end)` interval in `RawPayload` identified by a `DetectorSource`, carrying its replacement `placeholder`, `masked` toggle state, and `constituentTexts` for merged overlapping intervals.
- **LocalFirewall (Stage 1)**: The on-device privacy scrub combining deterministic `scanAndRedactLocal()` (`REGEX_FIREWALL`, `ENTROPY_SCANNER`, `HEURISTIC_GUARD`, `POLICY_TERM`) with Chrome Built-in Gemini Nano 4 (`NANO_SEMANTIC_FIREWALL` via `InferenceMode.ONLY_ON_DEVICE`).
- **LocalRunbook**: An offline Markdown resolution guide (`P2`/`P3`) matched on-device so routine dev/client incidents resolve with `$0` cloud tokens.
- **FailClosedQuarantine (`QUARANTINED_PENDING_APPROVAL`)**: Security hold triggered whenever Gemini Nano 4 is not `READY` on a `P0`/`P1` ticket, requiring explicit human review of the inline diff before cloud dispatch.
- **ZeroLeakageGate (`verifyZeroLeakage`)**: Programmatic pre-cloud assertion verifying that `0` active masked substrings (including constituent overlapped secrets and URL/JSON-encoded variants) appear in the outbound cloud prompt.
- **CloudEscalation (Stage 2)**: Streaming root-cause analysis via Firebase AI Logic (`InferenceMode.PREFER_IN_CLOUD`, `inCloudParams.model`) protected by Firebase App Check (`ReCaptchaEnterpriseProvider`).
- **HybridBrief**: Executive summary and Slack/Jira stakeholder update generated from `SanitizedPayload` via `InferenceMode.PREFER_ON_DEVICE`.
- **ZeroPiiStore**: Browser `IndexedDB` store where `stripRawTextForStorage()` permanently replaces `rawText` with `"[PURGED_FROM_DISK_FOR_PRIVACY]"` and strips `matchedText`/`constituentTexts` before disk write.
- **ExtensionHandoff (`#handoff=<base64url>`)**: Strict UTF-8 base64url envelope transferring sanitized captures from the Manifest V3 Chrome Extension Side Panel into the Web Workbench with automatic deterministic re-scrubbing on import.
