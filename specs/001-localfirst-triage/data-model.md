# Data Model: LocalFirst Triage

## Entities

### `RedactionSpan`
- `start: number` (inclusive UTF-16 offset in original text)
- `end: number` (exclusive UTF-16 offset)
- `category: string` (e.g. `API_KEY`, `JWT`, `EMAIL`, `CONTEXTUAL_PHI`, `NATURAL_SECRET`, `INTERNAL_CODENAME`)
- `detector: "REGEX_FIREWALL" | "NANO_SEMANTIC_FIREWALL"`
- `placeholder: string` (e.g. `[REDACTED:CONTEXTUAL_PHI_1]`)
- `matchedText: string`

### `TriageResult`
- `id: string`
- `title: string`
- `rawText: string`
- `sanitizedText: string`
- `severity: "P0" | "P1" | "P2" | "P3"`
- `category: string`
- `spans: RedactionSpan[]`
- `resolution: string`
- `resolutionMode: "LOCAL_RUNBOOK" | "CLOUD_ESCALATION" | "LOCAL_FALLBACK_ONLY"`
- `inferenceSource: "ON_DEVICE" | "LOCAL_REGEX_FALLBACK" | "IN_CLOUD" | "OFFLINE_BLOCKED"`
- `nanoStatus: "READY" | "MODEL_DOWNLOADING" | "UNAVAILABLE"`
- `latencyMs: number`
- `estimatedTokensSaved: number`
- `createdAt: number`

### `HybridTelemetry`
- `nanoStatus: "READY" | "MODEL_DOWNLOADING" | "UNAVAILABLE"`
- `totalRuns: number`
- `localResolvedCount: number`
- `cloudEscalatedCount: number`
- `estimatedTokensSaved: number`
- `lastLatencyMs: number`
- `offlineMode: boolean`
- `activeCloudModel: string`
