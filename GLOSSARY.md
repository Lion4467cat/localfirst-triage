# LocalFirst Triage (`v4.0`) — Domain Glossary

## Architectural & Hybrid AI Terms
- **Defense-in-Depth Union:** Stage 1 architectural guarantee across Web ([`pipeline.ts`](./src/firewall/pipeline.ts)) and Android ([`HybridAiClient.kt`](./android/app/src/main/java/com/localfirst/triage/ai/HybridAiClient.kt)) where deterministic `REGEX_FIREWALL`, `ENTROPY_SCANNER`, `POLICY_TERM`, and `HEURISTIC_GUARD` **always** execute in union with Gemini Nano 4 (`includeHeuristics = true`), preventing semantic leaks if Nano 4 under-extracts.
- **InferenceMode.ONLY_ON_DEVICE:** Firebase AI Logic mode strictly mandating local on-device execution (Gemini Nano 4 / AICore) with zero silent cloud fallback during sensitive Stage 1 PII extraction.
- **InferenceMode.PREFER_ON_DEVICE:** Firebase AI Logic mode used **exclusively after** `verifyZeroLeakage()` passes on already-sanitized text to draft stakeholder briefs on-device when available (`Source: ON_DEVICE`) and seamlessly fall back to Cloud Gemini when unavailable.
- **Pre-Cloud Countdown (`PRE_CLOUD_COUNTDOWN`):** Cancelable review window entered on P0/P1 incidents when Nano 4 is active, allowing interactive mask adjustments before Stage 2 Cloud streaming.
- **Fail-Closed Quarantine (`QUARANTINED_PENDING_APPROVAL`):** Safe hold state entered automatically when on-device Nano 4 is unavailable/downloading; zero outbound Cloud requests execute until an engineer explicitly clicks **Approve & Escalate**.
- **Hybrid Stakeholder Brief:** Executive Summary + Slack Incident Update generated from already-sanitized ticket payloads using `InferenceMode.PREFER_ON_DEVICE` (falling back cleanly to local deterministic fallback in Offline Mode).

## Redaction & Verification Primitives
- **RedactionSpan:** Typed range (`start`, `end`, `category`, `detector`, `placeholder`, `matchedText`, `masked`, `constituentTexts`). Stripped cleanly before disk/Firestore persistence.
- **Detector Priority Hierarchy:** Conflict-resolution precedence when merging overlapping spans in [`spanMerger.ts`](./src/firewall/spanMerger.ts) / [`LocalFirewallEngine.kt`](./android/app/src/main/java/com/localfirst/triage/firewall/LocalFirewallEngine.kt):
  `MANUAL_MASK (5)` > `NANO_SEMANTIC_FIREWALL (4)` > `POLICY_TERM (3)` > `REGEX_FIREWALL (2)` = `ENTROPY_SCANNER (2)` > `HEURISTIC_GUARD (1)`.
- **`constituentTexts`:** Audit array retained in memory on merged spans so `verifyZeroLeakage()` still rejects every underlying secret substring even after adjacent spans merge.
- **Zero-Leakage Proof (`verifyZeroLeakage`):** Outbound safety gate verifying zero active masked spans (including `constituentTexts`, URL-encoded, and JSON-escaped variants) and zero raw credential patterns appear in Cloud prompts or Firestore documents.
- **Purged Disk Marker (`[PURGED_FROM_DISK_FOR_PRIVACY]`):** Sentinel replacing `rawText` on every ticket persisted to IndexedDB or synced from Firestore.

## Runbooks & Policies
- **Built-in Local Runbooks (6):** On-device P2/P3 diagnostic playbooks resolved at `$0` cloud cost across Web and Android:
  `RB_LOCAL_TLS_CERT`, `RB_LOCAL_DEPENDENCY_CONFLICT`, `RB_LOCAL_CORS_DEV`, `RB_OAUTH_CLOCK_SKEW`, `RB_PORT_IN_USE`, `RB_OFFLINE_SW_CACHE`.
- **Firebase Remote Config Knobs:** Dynamic runtime settings (`cloudModel`, `cloudFallbackModel`, `enableCloudEscalation`, `entropyThreshold`, `enterpriseBlockedTerms`) fetched via `fetchAndActivate` without redeploying client builds.

## Multi-Platform Surfaces
- **SourcePlatform (`WEB` | `CHROME_EXTENSION` | `ANDROID`):** Origin badge stored on each Zero-PII ticket so synced feeds display which device triaged the incident.
- **Volatile RAM Session Map (`volatileSessionMap` / `volatileRawMap`):** In-memory-only map allowing immediate interactive unmasking/re-masking on live current-session tickets without ever touching IndexedDB, Logcat, `SavedStateHandle`, or Firestore.
- **Lazy Firestore Transport:** Code-split module ([`firestoreTransport.ts`](./src/storage/firestoreTransport.ts)) loaded strictly after Anonymous Guest or Google Sign-In, keeping initial unauthenticated PWA visits lighter and side-effect free.
