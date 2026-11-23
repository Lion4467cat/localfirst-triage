@file:OptIn(PublicPreviewAPI::class)

package com.localfirst.triage.ai

import com.google.firebase.Firebase
import com.google.firebase.ai.DownloadStatus
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.ai.InferenceMode
import com.google.firebase.ai.InferenceSource as SdkInferenceSource
import com.google.firebase.ai.OnDeviceConfig
import com.google.firebase.ai.OnDeviceModelOption
import com.google.firebase.ai.OnDeviceModelStatus
import com.google.firebase.ai.ai
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.PublicPreviewAPI
import com.google.firebase.ai.type.content
import com.google.firebase.ai.type.generationConfig
import com.localfirst.triage.firewall.LocalFirewallEngine
import com.localfirst.triage.model.CustomRunbook
import com.localfirst.triage.model.HybridBriefResult
import com.localfirst.triage.model.InferenceSource
import com.localfirst.triage.model.NanoStatus
import com.localfirst.triage.model.PrivacyPolicy
import com.localfirst.triage.model.ProtectionLevel
import com.localfirst.triage.model.RedactionSpan
import com.localfirst.triage.model.ResolutionMode
import com.localfirst.triage.model.RuntimeConfigValues
import com.localfirst.triage.model.SemanticExtractionItem
import com.localfirst.triage.model.Severity
import com.localfirst.triage.model.SourcePlatform
import com.localfirst.triage.model.Stage2Source
import com.localfirst.triage.model.TriageResult
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await

interface HybridAiTransport {
    suspend fun checkOnDeviceStatus(cloudModelName: String): NanoStatus
    fun downloadOnDeviceModel(cloudModelName: String): Flow<Int>
    suspend fun generateOnDeviceOnly(prompt: String, cloudModelName: String): Pair<String, InferenceSource>
    fun streamCloudEscalation(
        prompt: String,
        modelName: String,
        systemInstruction: String,
    ): Flow<Pair<String, InferenceSource>>

    suspend fun generateCloudUnary(
        prompt: String,
        modelName: String,
        systemInstruction: String,
    ): Pair<String, InferenceSource>

    suspend fun generateHybridBrief(prompt: String, cloudModelName: String): Pair<String, InferenceSource>
}

class FirebaseHybridAiTransport : HybridAiTransport {
    private fun backend() = Firebase.ai(backend = GenerativeBackend.googleAI())

    /**
     * Firebase AI Logic attaches an auth token to every cloud request, so an anonymous session
     * must exist before the first call. Without it the SDK throws
     * FirebaseNoSignedInUserException and escalation fails even when App Check is valid.
     */
    private suspend fun ensureAuth() {
        val auth = runCatching { FirebaseAuth.getInstance() }.getOrNull() ?: return
        if (auth.currentUser != null) return
        runCatching { auth.signInAnonymously().await() }
    }

    private fun mapInferenceSource(
        raw: SdkInferenceSource?,
        fallback: InferenceSource,
    ): InferenceSource = when (raw) {
        SdkInferenceSource.ON_DEVICE -> InferenceSource.ON_DEVICE
        SdkInferenceSource.IN_CLOUD -> InferenceSource.IN_CLOUD
        else -> fallback
    }

    private fun mapOnDeviceStatus(status: OnDeviceModelStatus?): NanoStatus = when (status) {
        OnDeviceModelStatus.AVAILABLE -> NanoStatus.READY
        OnDeviceModelStatus.DOWNLOADABLE -> NanoStatus.DOWNLOADABLE
        OnDeviceModelStatus.DOWNLOADING -> NanoStatus.MODEL_DOWNLOADING
        else -> NanoStatus.UNAVAILABLE
    }

    override suspend fun checkOnDeviceStatus(cloudModelName: String): NanoStatus = runCatching {
        val model = backend().generativeModel(
            modelName = cloudModelName,
            onDeviceConfig = OnDeviceConfig(
                mode = InferenceMode.ONLY_ON_DEVICE,
                modelOption = OnDeviceModelOption.PREVIEW,
            ),
        )
        mapOnDeviceStatus(model.onDeviceExtension?.checkStatus())
    }.getOrDefault(NanoStatus.UNAVAILABLE)

    override fun downloadOnDeviceModel(cloudModelName: String): Flow<Int> = flow {
        val model = backend().generativeModel(
            modelName = cloudModelName,
            onDeviceConfig = OnDeviceConfig(
                mode = InferenceMode.ONLY_ON_DEVICE,
                modelOption = OnDeviceModelOption.PREVIEW,
            ),
        )
        val ext = model.onDeviceExtension ?: error("OnDeviceExtension unavailable on this device")
        var pct = 5
        emit(pct)
        ext.download().collect { status ->
            when (status) {
                is DownloadStatus.DownloadInProgress -> {
                    pct = (pct + 10).coerceAtMost(95)
                    emit(pct)
                }
                is DownloadStatus.DownloadCompleted -> {
                    ext.warmUp()
                    emit(100)
                }
                is DownloadStatus.DownloadFailed -> {
                    throw status.exception
                }
            }
        }
    }

    override suspend fun generateOnDeviceOnly(
        prompt: String,
        cloudModelName: String,
    ): Pair<String, InferenceSource> {
        val model = backend().generativeModel(
            modelName = cloudModelName,
            generationConfig = generationConfig {
                temperature = 0.1f
                maxOutputTokens = 512
            },
            onDeviceConfig = OnDeviceConfig(
                mode = InferenceMode.ONLY_ON_DEVICE,
                temperature = 0.1f,
                maxOutputTokens = 512,
                modelOption = OnDeviceModelOption.PREVIEW,
            ),
        )
        val response = model.generateContent(prompt)
        return (response.text ?: "") to mapInferenceSource(response.inferenceSource, InferenceSource.ON_DEVICE)
    }

    override fun streamCloudEscalation(
        prompt: String,
        modelName: String,
        systemInstruction: String,
    ): Flow<Pair<String, InferenceSource>> = flow {
        ensureAuth()
        val model = backend().generativeModel(
            modelName = modelName,
            systemInstruction = content("system") { text(systemInstruction) },
            onDeviceConfig = OnDeviceConfig(mode = InferenceMode.ONLY_IN_CLOUD),
        )
        model.generateContentStream(prompt).collect { chunk ->
            emit((chunk.text ?: "") to mapInferenceSource(chunk.inferenceSource, InferenceSource.IN_CLOUD))
        }
    }

    override suspend fun generateCloudUnary(
        prompt: String,
        modelName: String,
        systemInstruction: String,
    ): Pair<String, InferenceSource> {
        ensureAuth()
        val model = backend().generativeModel(
            modelName = modelName,
            systemInstruction = content("system") { text(systemInstruction) },
            onDeviceConfig = OnDeviceConfig(mode = InferenceMode.ONLY_IN_CLOUD),
        )
        val response = model.generateContent(prompt)
        return (response.text ?: "") to mapInferenceSource(response.inferenceSource, InferenceSource.IN_CLOUD)
    }

    override suspend fun generateHybridBrief(
        prompt: String,
        cloudModelName: String,
    ): Pair<String, InferenceSource> {
        val model = backend().generativeModel(
            modelName = cloudModelName,
            onDeviceConfig = OnDeviceConfig(
                mode = InferenceMode.PREFER_ON_DEVICE,
                modelOption = OnDeviceModelOption.PREVIEW_FAST,
            ),
        )
        val response = model.generateContent(prompt)
        return (response.text ?: "") to mapInferenceSource(response.inferenceSource, InferenceSource.IN_CLOUD)
    }
}

class HybridAiClient(
    private val transport: HybridAiTransport = FirebaseHybridAiTransport(),
) {
    suspend fun checkNanoStatus(runtimeConfig: RuntimeConfigValues = RuntimeConfigValues()): NanoStatus =
        transport.checkOnDeviceStatus(runtimeConfig.cloudModel)

    fun warmUpOnDevice(runtimeConfig: RuntimeConfigValues = RuntimeConfigValues()): Flow<Int> =
        transport.downloadOnDeviceModel(runtimeConfig.cloudModel)

    suspend fun runStage1AndTriage(
        id: String = "ticket-${System.currentTimeMillis()}",
        title: String,
        rawText: String,
        offlineMode: Boolean,
        customRunbooks: List<CustomRunbook> = LocalFirewallEngine.DEFAULT_RUNBOOKS,
        policy: PrivacyPolicy = PrivacyPolicy(),
        protectionLevel: ProtectionLevel = ProtectionLevel.MEDIUM,
        runtimeConfig: RuntimeConfigValues = RuntimeConfigValues(),
        approveCloudEscalation: Boolean = false,
        onStreamChunk: ((String) -> Unit)? = null,
    ): TriageResult {
        val startedNs = System.nanoTime()
        val nanoStatus = transport.checkOnDeviceStatus(runtimeConfig.cloudModel)

        var usedNano = false
        val semanticItems = mutableListOf<SemanticExtractionItem>()
        var inferredSeverity = inferSeverityHeuristic(rawText)
        var inferredRunbookId: String? = null
        var inferredCategory = "GENERAL_INCIDENT"

        if (nanoStatus == NanoStatus.READY) {
            val semanticPrompt = buildStage1ExtractionPrompt(rawText, customRunbooks)
            val nanoAttempt = runCatching {
                transport.generateOnDeviceOnly(semanticPrompt, runtimeConfig.cloudModel)
            }.getOrNull()

            if (nanoAttempt != null && nanoAttempt.first.isNotBlank()) {
                usedNano = true
                parseStage1Response(
                    raw = nanoAttempt.first,
                    itemsOut = semanticItems,
                )?.let { parsedMeta ->
                    inferredSeverity = parsedMeta.first
                    inferredCategory = parsedMeta.second
                    inferredRunbookId = parsedMeta.third
                }
            }
        }

        val stage1Source = if (usedNano) "ON_DEVICE (Nano 4)" else "HEURISTIC_GUARD"
        val extraSemanticSpans =
            if (semanticItems.isNotEmpty()) LocalFirewallEngine.buildSemanticSpans(rawText, semanticItems)
            else emptyList()

        val (sanitizedText, mergedSpans) = LocalFirewallEngine.scanAndRedactLocal(
            rawText = rawText,
            options = LocalFirewallEngine.ScanOptions(
                protectionLevel = protectionLevel,
                // Defense-in-Depth Union: keep HEURISTIC_GUARD enabled even when Nano 4 is READY
                includeHeuristics = true,
                enableEntropyScanner = policy.enableEntropyScanner,
                entropyThreshold = when (protectionLevel) {
                    ProtectionLevel.LOW -> 3.8
                    ProtectionLevel.HIGH -> 2.9
                    ProtectionLevel.MEDIUM -> runtimeConfig.entropyThreshold
                },
                customTerms = policy.customTerms,
                remoteBlockedTerms = runtimeConfig.enterpriseBlockedTerms,
                extraSpans = if (protectionLevel == ProtectionLevel.LOW) emptyList() else extraSemanticSpans,
            ),
        )

        val stage1LatencyMs = maxOf(1L, (System.nanoTime() - startedNs) / 1_000_000L)
        val approxTokens = maxOf(40, (rawText.length + 3) / 4)
        val createdAt = System.currentTimeMillis()
        val activeRunbooks = customRunbooks.ifEmpty { LocalFirewallEngine.DEFAULT_RUNBOOKS }

        val matchedRunbook =
            if (inferredSeverity == Severity.P2 || inferredSeverity == Severity.P3) {
                LocalFirewallEngine.getRunbookById(inferredRunbookId, activeRunbooks)
                    ?: LocalFirewallEngine.matchLocalRunbook(sanitizedText, activeRunbooks)
            } else {
                null
            }

        if (matchedRunbook != null) {
            return TriageResult(
                id = id,
                title = title,
                rawText = rawText,
                sanitizedText = sanitizedText,
                severity = matchedRunbook.severity,
                category = matchedRunbook.category,
                runbookId = matchedRunbook.id,
                spans = mergedSpans,
                resolution = matchedRunbook.resolution,
                resolutionMode = ResolutionMode.LOCAL_RUNBOOK,
                inferenceSource = if (usedNano) InferenceSource.ON_DEVICE else InferenceSource.LOCAL_REGEX_FALLBACK,
                stage1Source = stage1Source,
                stage1LatencyMs = stage1LatencyMs,
                stage2Source = Stage2Source.SKIPPED_LOCAL_RUNBOOK,
                stage2LatencyMs = 0L,
                nanoStatus = nanoStatus,
                latencyMs = stage1LatencyMs,
                estimatedTokensSaved = approxTokens,
                createdAt = createdAt,
                updatedAt = createdAt,
                sourcePlatform = SourcePlatform.ANDROID,
                zeroLeakageAudit = LocalFirewallEngine.verifyZeroLeakage(sanitizedText, mergedSpans, createdAt),
            )
        }

        if (offlineMode) {
            return TriageResult(
                id = id,
                title = title,
                rawText = rawText,
                sanitizedText = sanitizedText,
                severity = inferredSeverity,
                category = inferredCategory,
                runbookId = inferredRunbookId,
                spans = mergedSpans,
                resolution = "AIRPLANE / OFFLINE QUEUE: Stage 1 Privacy Firewall sanitized all secrets on-device. Cloud escalation is blocked and ticket is queued for reconnect.",
                resolutionMode = ResolutionMode.OFFLINE_QUEUED,
                inferenceSource = InferenceSource.OFFLINE_BLOCKED,
                stage1Source = stage1Source,
                stage1LatencyMs = stage1LatencyMs,
                stage2Source = Stage2Source.OFFLINE_QUEUED,
                stage2LatencyMs = 0L,
                nanoStatus = nanoStatus,
                latencyMs = stage1LatencyMs,
                estimatedTokensSaved = approxTokens,
                createdAt = createdAt,
                updatedAt = createdAt,
                sourcePlatform = SourcePlatform.ANDROID,
                queuedForReconnect = true,
                zeroLeakageAudit = LocalFirewallEngine.verifyZeroLeakage(sanitizedText, mergedSpans, createdAt),
            )
        }

        if (!usedNano && !approveCloudEscalation) {
            return TriageResult(
                id = id,
                title = title,
                rawText = rawText,
                sanitizedText = sanitizedText,
                severity = inferredSeverity,
                category = inferredCategory,
                runbookId = inferredRunbookId,
                spans = mergedSpans,
                resolution = "FAIL-CLOSED QUARANTINE HOLD: On-device Gemini Nano 4 is not active on this device. Deterministic Regex + Entropy + Heuristic Guard pre-masked sensitive spans. Review the Diff & Zero-Leakage Proof before tapping 'Approve & Escalate to Cloud'.",
                resolutionMode = ResolutionMode.QUARANTINED_PENDING_APPROVAL,
                inferenceSource = InferenceSource.LOCAL_REGEX_FALLBACK,
                stage1Source = stage1Source,
                stage1LatencyMs = stage1LatencyMs,
                stage2Source = Stage2Source.HELD_QUARANTINE,
                stage2LatencyMs = 0L,
                nanoStatus = nanoStatus,
                latencyMs = stage1LatencyMs,
                estimatedTokensSaved = approxTokens,
                createdAt = createdAt,
                updatedAt = createdAt,
                sourcePlatform = SourcePlatform.ANDROID,
                zeroLeakageAudit = LocalFirewallEngine.verifyZeroLeakage(sanitizedText, mergedSpans, createdAt),
            )
        }

        if (!approveCloudEscalation) {
            return TriageResult(
                id = id,
                title = title,
                rawText = rawText,
                sanitizedText = sanitizedText,
                severity = inferredSeverity,
                category = inferredCategory,
                runbookId = inferredRunbookId,
                spans = mergedSpans,
                resolution = "Stage 1 (Gemini Nano 4 ONLY_ON_DEVICE) completed. Review sanitized spans and tap 'Approve & Escalate to Cloud' when ready.",
                resolutionMode = ResolutionMode.PRE_CLOUD_COUNTDOWN,
                inferenceSource = InferenceSource.ON_DEVICE,
                stage1Source = stage1Source,
                stage1LatencyMs = stage1LatencyMs,
                stage2Source = Stage2Source.PENDING_PRE_CLOUD,
                stage2LatencyMs = 0L,
                nanoStatus = nanoStatus,
                latencyMs = stage1LatencyMs,
                estimatedTokensSaved = approxTokens,
                createdAt = createdAt,
                updatedAt = createdAt,
                sourcePlatform = SourcePlatform.ANDROID,
                zeroLeakageAudit = LocalFirewallEngine.verifyZeroLeakage(sanitizedText, mergedSpans, createdAt),
            )
        }

        val initialDraft = TriageResult(
            id = id,
            title = title,
            rawText = rawText,
            sanitizedText = sanitizedText,
            severity = inferredSeverity,
            category = inferredCategory,
            runbookId = inferredRunbookId,
            spans = mergedSpans,
            resolution = "",
            resolutionMode = ResolutionMode.QUARANTINED_PENDING_APPROVAL,
            inferenceSource = if (usedNano) InferenceSource.ON_DEVICE else InferenceSource.LOCAL_REGEX_FALLBACK,
            stage1Source = stage1Source,
            stage1LatencyMs = stage1LatencyMs,
            stage2Source = Stage2Source.HELD_QUARANTINE,
            stage2LatencyMs = 0L,
            nanoStatus = nanoStatus,
            latencyMs = stage1LatencyMs,
            estimatedTokensSaved = approxTokens,
            createdAt = createdAt,
            updatedAt = createdAt,
            sourcePlatform = SourcePlatform.ANDROID,
        )

        return escalateApprovedTicket(
            ticket = initialDraft,
            updatedSpans = mergedSpans,
            runtimeConfig = runtimeConfig,
            offlineMode = false,
            onStreamChunk = onStreamChunk,
        )
    }

    suspend fun escalateApprovedTicket(
        ticket: TriageResult,
        updatedSpans: List<RedactionSpan>,
        runtimeConfig: RuntimeConfigValues = RuntimeConfigValues(),
        offlineMode: Boolean = false,
        onStreamChunk: ((String) -> Unit)? = null,
    ): TriageResult {
        val safeRawText = if (ticket.loadedFromZeroPiiStore) ticket.sanitizedText else ticket.rawText
        val effectiveSpans = if (ticket.loadedFromZeroPiiStore) emptyList() else updatedSpans
        val sanitizedText =
            if (ticket.loadedFromZeroPiiStore) ticket.sanitizedText
            else LocalFirewallEngine.applyMaskedSpans(safeRawText, effectiveSpans)

        if (offlineMode) {
            return ticket.copy(
                sanitizedText = sanitizedText,
                spans = effectiveSpans,
                resolution = "AIRPLANE / OFFLINE QUEUE: Outbound Cloud escalation blocked in Offline Mode. Sanitized ticket queued for reconnect.",
                resolutionMode = ResolutionMode.OFFLINE_QUEUED,
                inferenceSource = InferenceSource.OFFLINE_BLOCKED,
                stage2Source = Stage2Source.OFFLINE_QUEUED,
                stage2LatencyMs = 0L,
                queuedForReconnect = true,
                updatedAt = System.currentTimeMillis(),
            )
        }

        val outboundPrompt = LocalFirewallEngine.buildOutboundCloudPrompt(
            severity = ticket.severity,
            category = ticket.category,
            sanitizedText = sanitizedText,
        )
        val audit = LocalFirewallEngine.verifyZeroLeakage(outboundPrompt, effectiveSpans)
        if (!audit.verified) {
            return ticket.copy(
                sanitizedText = sanitizedText,
                spans = effectiveSpans,
                resolution = "ZERO-LEAKAGE GATE BLOCKED CLOUD CALL: Detected ${audit.leakedSpansCount} unredacted span(s) (${audit.leakedCategories.joinToString(", ")}). Mask offending tokens first.",
                resolutionMode = ResolutionMode.QUARANTINED_PENDING_APPROVAL,
                inferenceSource = InferenceSource.LOCAL_REGEX_FALLBACK,
                stage2Source = Stage2Source.HELD_QUARANTINE,
                stage2LatencyMs = 0L,
                zeroLeakageAudit = audit,
                updatedAt = System.currentTimeMillis(),
            )
        }

        if (!runtimeConfig.enableCloudEscalation) {
            return ticket.copy(
                sanitizedText = sanitizedText,
                spans = effectiveSpans,
                resolution = "Cloud escalation disabled via Firebase Remote Config; ticket held safely on-device.",
                resolutionMode = ResolutionMode.LOCAL_FALLBACK_ONLY,
                inferenceSource = InferenceSource.LOCAL_REGEX_FALLBACK,
                stage2Source = Stage2Source.CLOUD_DISABLED,
                stage2LatencyMs = 0L,
                activeCloudModel = runtimeConfig.cloudModel,
                zeroLeakageAudit = audit,
                updatedAt = System.currentTimeMillis(),
            )
        }

        val candidateModels = listOf(
            runtimeConfig.cloudModel,
            runtimeConfig.cloudFallbackModel,
            RuntimeConfigValues.DEFAULT_CLOUD_FALLBACK_MODEL,
        ).filter { it.isNotBlank() }.distinct()

        val cloudStartNs = System.nanoTime()
        var lastError = "Unknown cloud error"

        for (modelName in candidateModels) {
            val streamResult = runCatching {
                val acc = StringBuilder()
                var lastSource = InferenceSource.IN_CLOUD
                transport.streamCloudEscalation(outboundPrompt, modelName, SRE_SYSTEM_INSTRUCTION)
                    .catch { throw it }
                    .collect { (piece, source) ->
                        lastSource = source
                        if (piece.isNotEmpty()) {
                            acc.append(piece)
                            onStreamChunk?.invoke(acc.toString())
                        }
                    }
                val text = acc.toString().trim()
                if (text.isEmpty()) error("Empty stream response from $modelName")
                text to lastSource
            }

            val resolved = streamResult.getOrElse { err ->
                lastError = err.message ?: err::class.java.simpleName
                val unaryAttempt = runCatching {
                    transport.generateCloudUnary(outboundPrompt, modelName, SRE_SYSTEM_INSTRUCTION)
                }
                unaryAttempt.onFailure { uErr ->
                    lastError = uErr.message ?: lastError
                }.getOrNull()
            }

            if (resolved != null && resolved.first.isNotBlank()) {
                val stage2Ms = maxOf(1L, (System.nanoTime() - cloudStartNs) / 1_000_000L)
                onStreamChunk?.invoke(resolved.first)
                val maskCount = effectiveSpans.count { it.masked }.coerceAtLeast(1)
                return ticket.copy(
                    sanitizedText = sanitizedText,
                    spans = effectiveSpans,
                    resolution = resolved.first,
                    resolutionMode = ResolutionMode.CLOUD_ESCALATION,
                    inferenceSource = resolved.second,
                    stage2Source = if (resolved.second == InferenceSource.ON_DEVICE) Stage2Source.ON_DEVICE_FALLBACK else Stage2Source.IN_CLOUD,
                    stage2LatencyMs = stage2Ms,
                    latencyMs = ticket.stage1LatencyMs + stage2Ms,
                    estimatedTokensSaved = maskCount * 18,
                    activeCloudModel = modelName,
                    cloudError = null,
                    zeroLeakageAudit = audit,
                    queuedForReconnect = false,
                    updatedAt = System.currentTimeMillis(),
                )
            }
        }

        val stage2Ms = maxOf(1L, (System.nanoTime() - cloudStartNs) / 1_000_000L)
        return ticket.copy(
            sanitizedText = sanitizedText,
            spans = effectiveSpans,
            resolution = buildEmergencyLocalRca(sanitizedText.length, lastError),
            resolutionMode = ResolutionMode.CLOUD_ERROR,
            inferenceSource = InferenceSource.CLOUD_ERROR,
            stage2Source = Stage2Source.CLOUD_ERROR,
            stage2LatencyMs = stage2Ms,
            latencyMs = ticket.stage1LatencyMs + stage2Ms,
            activeCloudModel = runtimeConfig.cloudModel,
            cloudError = lastError,
            zeroLeakageAudit = audit,
            queuedForReconnect = false,
            updatedAt = System.currentTimeMillis(),
        )
    }

    suspend fun generateSanitizedHybridBrief(
        ticket: TriageResult,
        runtimeConfig: RuntimeConfigValues = RuntimeConfigValues(),
        offlineMode: Boolean = false,
    ): HybridBriefResult {
        val startedNs = System.nanoTime()
        val prompt = listOf(
            "Draft a concise 2-sentence executive summary and a 1-paragraph Slack incident update from this sanitized incident report.",
            "Preserve all [REDACTED:...] placeholders strictly.",
            "Title: ${ticket.title} | Severity: ${ticket.severity}",
            "Sanitized Input:\n${ticket.sanitizedText.take(1200)}",
            "Triage Resolution:\n${ticket.resolution.take(1200)}",
        ).joinToString("\n\n")

        val audit = LocalFirewallEngine.verifyZeroLeakage(prompt, ticket.spans)
        if (!audit.verified || offlineMode || !runtimeConfig.enableCloudEscalation) {
            val ms = maxOf(1L, (System.nanoTime() - startedNs) / 1_000_000L)
            return localFallbackBrief(ticket, ms)
        }

        val hybridAttempt = runCatching {
            transport.generateHybridBrief(prompt, runtimeConfig.cloudModel)
        }.getOrNull()

        if (hybridAttempt != null && hybridAttempt.first.isNotBlank()) {
            val ms = maxOf(1L, (System.nanoTime() - startedNs) / 1_000_000L)
            val sourceLabel = if (hybridAttempt.second == InferenceSource.ON_DEVICE) "ON_DEVICE" else "IN_CLOUD"
            return HybridBriefResult(
                summary = hybridAttempt.first,
                stakeholderDraft = hybridAttempt.first,
                inferenceSource = sourceLabel,
                latencyMs = ms,
                generatedAt = System.currentTimeMillis(),
            )
        }

        val cloudFallback = runCatching {
            transport.generateCloudUnary(prompt, runtimeConfig.cloudModel, BRIEF_SYSTEM_INSTRUCTION)
        }.recoverCatching {
            transport.generateCloudUnary(prompt, runtimeConfig.cloudFallbackModel, BRIEF_SYSTEM_INSTRUCTION)
        }.getOrNull()

        val ms = maxOf(1L, (System.nanoTime() - startedNs) / 1_000_000L)
        if (cloudFallback != null && cloudFallback.first.isNotBlank()) {
            return HybridBriefResult(
                summary = cloudFallback.first,
                stakeholderDraft = cloudFallback.first,
                inferenceSource = "IN_CLOUD",
                latencyMs = ms,
                generatedAt = System.currentTimeMillis(),
            )
        }

        return localFallbackBrief(ticket, ms)
    }

    private fun localFallbackBrief(ticket: TriageResult, latencyMs: Long): HybridBriefResult {
        val count = ticket.spans.count { it.masked }
        return HybridBriefResult(
            summary = "[${ticket.severity.name}] ${ticket.title} — $count sensitive spans redacted locally; status: ${ticket.resolutionMode.name}.",
            stakeholderDraft = "Incident Update (${ticket.severity.name}): Investigating \"${ticket.title}\". All sensitive PII/secrets remain redacted on-device ($count masks active). Mode: ${ticket.resolutionMode.name}.",
            inferenceSource = "LOCAL_FALLBACK",
            latencyMs = latencyMs,
            generatedAt = System.currentTimeMillis(),
        )
    }

    private fun buildEmergencyLocalRca(sanitizedLen: Int, errorReason: String): String = listOf(
        "### Root Cause Hypothesis (Local Deterministic SRE Fallback)",
        "- **Zero-Leakage Guarantee Held:** Stage 1 scrubbed all secrets locally (`0` raw PII bytes left device).",
        "- **Cloud Status:** Outbound Cloud Gemini call reported `$errorReason`.",
        "- **Sideload / Debug APK Tip:** App Check binds debug builds to tokens registered for your own Firebase project, so a freshly sideloaded APK can be refused by the cloud while every on-device feature keeps working offline with no setup. To register this build, copy the UUID printed in Logcat (`DebugAppCheckProvider`) into Firebase Console -> App Check -> Apps -> Android -> Manage debug tokens. For a zero-setup cloud demo, open https://para-1-2e22b.web.app.",
        "### Immediate Mitigation",
        "1. Rotate any exposed API keys, tokens, or private keys flagged by Stage 1.",
        "2. Verify network & App Check connectivity, then tap Retry Cloud Escalation.",
        "### Verification Checklist",
        "- Confirm all `[REDACTED:...]` tokens remain masked in Zero-Leakage Proof ($sanitizedLen sanitized chars verified).",
    ).joinToString("\n")

    private fun inferSeverityHeuristic(rawText: String): Severity {
        val lower = rawText.lowercase()
        return when {
            "p0" in lower || "outage" in lower || "icu" in lower || "seizure" in lower -> Severity.P0
            "p1" in lower || "deadlock" in lower || "private key" in lower -> Severity.P1
            "p3" in lower || "cert_has_expired" in lower || "err_cert_date_invalid" in lower -> Severity.P3
            "p2" in lower || "invalid_grant" in lower || "clock skew" in lower -> Severity.P2
            else -> Severity.P1
        }
    }

    private fun buildStage1ExtractionPrompt(rawText: String, runbooks: List<CustomRunbook>): String {
        val rbList = runbooks.joinToString(", ") { it.id }
        return listOf(
            "You are an on-device privacy & incident classifier.",
            "Line 1: SEVERITY|CATEGORY|RUNBOOK_ID (where SEVERITY is P0..P3; RUNBOOK_ID from [$rbList] or NONE).",
            "Subsequent lines: PHRASE|CATEGORY — extract EVERY sensitive substring across ALL categories (CONTEXTUAL_PHI medical/ICU/diagnosis, NATURAL_SECRET password hints/login phrases, M_AND_A_SECRET codenames/acquisitions/valuations, PERSON_PII names/addresses); never stop after the first person name.",
            "Text:\n${rawText.take(2500)}",
        ).joinToString("\n")
    }

    private fun parseStage1Response(
        raw: String,
        itemsOut: MutableList<SemanticExtractionItem>,
    ): Triple<Severity, String, String?>? {
        val lines = raw.lines().map { it.trim() }.filter { it.isNotEmpty() }
        if (lines.isEmpty()) return null
        val header = lines.first().split("|")
        val sev = runCatching { Severity.valueOf(header.getOrNull(0)?.trim()?.uppercase() ?: "") }
            .getOrNull() ?: return null
        val cat = header.getOrNull(1)?.trim()?.takeIf { it.isNotBlank() } ?: "GENERAL_INCIDENT"
        val rb = header.getOrNull(2)?.trim()?.takeUnless { it.isBlank() || it.equals("NONE", ignoreCase = true) }

        for (line in lines.drop(1)) {
            val parts = line.split("|")
            if (parts.size >= 2 && parts[0].trim().length >= 3) {
                itemsOut.add(SemanticExtractionItem(parts[0].trim(), parts[1].trim()))
            }
        }
        return Triple(sev, cat, rb)
    }

    companion object {
        const val SRE_SYSTEM_INSTRUCTION =
            "You are a Principal SRE Incident Triage Assistant. Produce concise Markdown with sections: ### Root Cause Hypothesis, ### Immediate Mitigation, and ### Verification Checklist. Never ask for or echo redacted PII. Preserve exact [REDACTED:...] tokens verbatim and omit horizontal --- rules."
        const val BRIEF_SYSTEM_INSTRUCTION =
            "Start directly with **Executive Summary:** (2 sentences, no conversational intro or ---/*** rules) followed by **Slack Incident Update:** (1 paragraph), preserving exact [REDACTED:...] tokens verbatim."
    }
}
