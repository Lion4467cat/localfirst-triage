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
import android.os.SystemClock
import android.util.Log
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
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.produceIn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull

interface HybridAiTransport {
    suspend fun checkOnDeviceStatus(cloudModelName: String): NanoStatus
    suspend fun onDeviceModelName(cloudModelName: String): String?
    fun downloadOnDeviceModel(cloudModelName: String): Flow<NanoDownloadState>
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
    private companion object {
        const val TAG = "CordonNano"

        /** AICore emits nothing while it waits for unmetered Wi-Fi, so this drives the stalled state. */
        const val STALL_TIMEOUT_MS = 10_000L
        const val AUTH_TIMEOUT_MS = 8_000L
        const val PROBE_TIMEOUT_MS = 4_000L
    }

    /** Set by the first probe that finds a usable model, so download and inference agree on it. */
    @Volatile
    private var resolvedOption: OnDeviceModelOption? = null

    private fun backend() = Firebase.ai(backend = GenerativeBackend.googleAI())

    /**
     * Firebase AI Logic attaches an auth token to every cloud request, so an anonymous session
     * must exist before the first call. Without it the SDK throws
     * FirebaseNoSignedInUserException and escalation fails even when App Check is valid.
     */
    private suspend fun ensureAuth() {
        val auth = runCatching { FirebaseAuth.getInstance() }.getOrNull() ?: return
        if (auth.currentUser != null) return
        runCatching {
            withTimeoutOrNull(AUTH_TIMEOUT_MS) {
                auth.signInAnonymously().await()
            }
        }
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

    private fun onDeviceModel(cloudModelName: String, option: OnDeviceModelOption) =
        backend().generativeModel(
            modelName = cloudModelName,
            onDeviceConfig = OnDeviceConfig(
                mode = InferenceMode.ONLY_ON_DEVICE,
                modelOption = option,
            ),
        )

    /**
     * The stable Nano build is what a retail phone ships; the preview build only exists once the
     * AICore Developer Preview is enrolled. Probing stable first is what lets a fresh install offer
     * a download instead of reporting "not supported" on a device that can run Nano fine.
     */
    private suspend fun probeOnDevice(cloudModelName: String): Pair<OnDeviceModelOption, NanoStatus> {
        var bestOption: OnDeviceModelOption? = null
        var bestStatus = NanoStatus.UNAVAILABLE
        for (option in listOf(OnDeviceModelOption.STABLE, OnDeviceModelOption.PREVIEW)) {
            val status = try {
                val extension = onDeviceModel(cloudModelName, option).onDeviceExtension
                if (extension == null) {
                    Log.w(TAG, "onDeviceExtension is null option=$option model=$cloudModelName")
                    NanoStatus.UNAVAILABLE
                } else {
                    val rawStatus = withTimeoutOrNull(PROBE_TIMEOUT_MS) { extension.checkStatus() }
                    mapOnDeviceStatus(rawStatus)
                }
            } catch (err: Throwable) {
                // Swallowing this used to turn "needs a download" into "not supported".
                Log.w(TAG, "checkStatus failed option=$option model=$cloudModelName: ${err.javaClass.simpleName}: ${err.message}")
                NanoStatus.UNAVAILABLE
            }
            Log.i(TAG, "probe option=$option status=$status")
            if (status == NanoStatus.READY) return option to status
            if (status != NanoStatus.UNAVAILABLE && bestOption == null) {
                bestOption = option
                bestStatus = status
            }
        }
        return (bestOption ?: OnDeviceModelOption.STABLE) to bestStatus
    }

    override suspend fun checkOnDeviceStatus(cloudModelName: String): NanoStatus {
        val (option, status) = probeOnDevice(cloudModelName)
        if (status != NanoStatus.UNAVAILABLE) resolvedOption = option
        return status
    }

    /** The AICore build string, so the UI can name the exact model instead of guessing. */
    override suspend fun onDeviceModelName(cloudModelName: String): String? {
        val option = resolvedOption ?: probeOnDevice(cloudModelName).first
        val extension = onDeviceModel(cloudModelName, option).onDeviceExtension ?: return null
        return runCatching { extension.getModelName() }.getOrNull().also {
            Log.i(TAG, "onDevice modelName=$it option=$option")
        }
    }

    override fun downloadOnDeviceModel(cloudModelName: String): Flow<NanoDownloadState> = flow {
        val option = resolvedOption ?: probeOnDevice(cloudModelName).also { probe ->
            if (probe.second != NanoStatus.UNAVAILABLE) resolvedOption = probe.first
        }.first
        val extension = onDeviceModel(cloudModelName, option).onDeviceExtension
            ?: error("OnDeviceExtension unavailable on this device")
        val modelName = runCatching { extension.getModelName() }.getOrNull()
        Log.i(TAG, "download start option=$option model=$modelName")

        var totalBytes = 0L
        var downloaded = 0L
        val meter = TransferRateMeter()
        emit(NanoDownloadState(modelName = modelName))

        coroutineScope {
            val channel = extension.download().produceIn(this)
            while (isActive) {
                val status = withTimeoutOrNull(STALL_TIMEOUT_MS) {
                    channel.receiveCatching().getOrNull()
                }
                if (status == null) {
                    if (channel.isClosedForReceive) break
                    // No byte moved for the whole window: AICore is waiting on Wi-Fi or charging.
                    emit(
                        NanoDownloadState(
                            modelName = modelName,
                            bytesDownloaded = downloaded,
                            totalBytes = totalBytes,
                            stalled = true,
                        ),
                    )
                    continue
                }
                when (status) {
                    is DownloadStatus.DownloadStarted -> {
                        totalBytes = status.bytesToDownload
                        Log.i(TAG, "download started bytes=$totalBytes")
                        emit(NanoDownloadState(modelName, downloaded, totalBytes))
                    }

                    is DownloadStatus.DownloadInProgress -> {
                        downloaded = status.totalBytesDownloaded
                        val speed = meter.sample(SystemClock.elapsedRealtime(), downloaded)
                        val remaining = (totalBytes - downloaded).coerceAtLeast(0L)
                        val eta = if (speed > 0L && totalBytes > 0L) remaining / speed else null
                        emit(NanoDownloadState(modelName, downloaded, totalBytes, speed, eta))
                    }

                    is DownloadStatus.DownloadCompleted -> {
                        Log.i(TAG, "download completed bytes=$downloaded")
                        extension.warmUp()
                        resolvedOption = option
                        emit(
                            NanoDownloadState(
                                modelName = modelName,
                                bytesDownloaded = totalBytes.coerceAtLeast(downloaded),
                                totalBytes = totalBytes.coerceAtLeast(downloaded),
                                completed = true,
                            ),
                        )
                        channel.cancel()
                        break
                    }

                    is DownloadStatus.DownloadFailed -> {
                        Log.w(TAG, "download failed option=$option", status.exception)
                        throw status.exception
                    }
                }
            }
        }
    }

    override suspend fun generateOnDeviceOnly(
        prompt: String,
        cloudModelName: String,
    ): Pair<String, InferenceSource> {
        val option = resolvedOption ?: probeOnDevice(cloudModelName).first
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
                modelOption = option,
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
    private val onDeviceTimeoutMs: Long = DEFAULT_ON_DEVICE_TIMEOUT_MS,
    private val cloudTimeoutMs: Long = DEFAULT_CLOUD_TIMEOUT_MS,
    private val briefTimeoutMs: Long = DEFAULT_BRIEF_TIMEOUT_MS,
) {
    suspend fun checkNanoStatus(runtimeConfig: RuntimeConfigValues = RuntimeConfigValues()): NanoStatus =
        runCatching {
            withTimeoutOrNull(onDeviceTimeoutMs) {
                transport.checkOnDeviceStatus(runtimeConfig.cloudModel)
            } ?: NanoStatus.UNAVAILABLE
        }.getOrDefault(NanoStatus.UNAVAILABLE)

    suspend fun nanoModelName(runtimeConfig: RuntimeConfigValues = RuntimeConfigValues()): String? =
        runCatching {
            withTimeoutOrNull(onDeviceTimeoutMs) {
                transport.onDeviceModelName(runtimeConfig.cloudModel)
            }
        }.getOrNull()

    fun warmUpOnDevice(runtimeConfig: RuntimeConfigValues = RuntimeConfigValues()): Flow<NanoDownloadState> =
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
        val nanoStatus = checkNanoStatus(runtimeConfig)

        var usedNano = false
        val semanticItems = mutableListOf<SemanticExtractionItem>()
        var inferredSeverity = inferSeverityHeuristic(rawText)
        var inferredRunbookId: String? = null
        var inferredCategory = "GENERAL_INCIDENT"

        if (nanoStatus == NanoStatus.READY) {
            val semanticPrompt = buildStage1ExtractionPrompt(rawText, customRunbooks)
            val nanoAttempt = runCatching {
                withTimeout(onDeviceTimeoutMs) {
                    transport.generateOnDeviceOnly(semanticPrompt, runtimeConfig.cloudModel)
                }
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

    /**
     * Quick Sandbox pass. Runs Gemini Nano stage-1 extraction when the model is ready, then unions
     * the semantic spans with the deterministic rules so the sandbox shows what the shield would
     * actually do to the same text in a real app.
     */
    suspend fun scanSandbox(
        rawText: String,
        protectionLevel: ProtectionLevel = ProtectionLevel.MEDIUM,
        policy: PrivacyPolicy = PrivacyPolicy(),
        runtimeConfig: RuntimeConfigValues = RuntimeConfigValues(),
    ): SandboxScan {
        val startedNs = System.nanoTime()
        val nanoStatus = checkNanoStatus(runtimeConfig)

        val semanticItems = mutableListOf<SemanticExtractionItem>()
        var modelLabel: String? = null
        if (nanoStatus == NanoStatus.READY) {
            val attempt = runCatching {
                withTimeout(onDeviceTimeoutMs) {
                    transport.generateOnDeviceOnly(buildSandboxExtractionPrompt(rawText), runtimeConfig.cloudModel)
                }
            }.getOrNull()
            if (attempt != null && attempt.first.isNotBlank()) {
                modelLabel = nanoModelName(runtimeConfig)
                parseSandboxPhrases(attempt.first, semanticItems)
            }
        }

        val semanticSpans =
            if (semanticItems.isNotEmpty()) LocalFirewallEngine.buildSemanticSpans(rawText, semanticItems)
            else emptyList()

        val (sanitizedText, mergedSpans) = LocalFirewallEngine.scanAndRedactLocal(
            rawText = rawText,
            options = LocalFirewallEngine.ScanOptions(
                protectionLevel = protectionLevel,
                includeHeuristics = true,
                enableEntropyScanner = policy.enableEntropyScanner,
                entropyThreshold = when (protectionLevel) {
                    ProtectionLevel.LOW -> 3.8
                    ProtectionLevel.HIGH -> 2.9
                    ProtectionLevel.MEDIUM -> runtimeConfig.entropyThreshold
                },
                customTerms = policy.customTerms,
                remoteBlockedTerms = runtimeConfig.enterpriseBlockedTerms,
                extraSpans = if (protectionLevel == ProtectionLevel.LOW) emptyList() else semanticSpans,
            ),
        )

        return SandboxScan(
            rawText = rawText,
            sanitizedText = sanitizedText,
            spans = mergedSpans,
            inferenceSource = if (modelLabel != null) InferenceSource.ON_DEVICE else InferenceSource.LOCAL_REGEX_FALLBACK,
            modelName = modelLabel,
            semanticPhraseCount = semanticItems.size,
            latencyMs = maxOf(1L, (System.nanoTime() - startedNs) / 1_000_000L),
        ).also { scan ->
            Log.i(
                CLIENT_TAG,
                "sandbox status=$nanoStatus model=$modelLabel semantic=${scan.semanticPhraseCount} spans=${scan.spans.size} latency=${scan.latencyMs}ms",
            )
        }
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
                withTimeout(cloudTimeoutMs) {
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
            }

            val resolved = streamResult.getOrElse { err ->
                lastError = err.message ?: err::class.java.simpleName
                val unaryAttempt = runCatching {
                    withTimeout(cloudTimeoutMs) {
                        transport.generateCloudUnary(outboundPrompt, modelName, SRE_SYSTEM_INSTRUCTION)
                    }
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
            resolution = buildEmergencyLocalRca(sanitizedText.length, humanizeCloudError(lastError)),
            resolutionMode = ResolutionMode.CLOUD_ERROR,
            inferenceSource = InferenceSource.CLOUD_ERROR,
            stage2Source = Stage2Source.CLOUD_ERROR,
            stage2LatencyMs = stage2Ms,
            latencyMs = ticket.stage1LatencyMs + stage2Ms,
            activeCloudModel = runtimeConfig.cloudModel,
            cloudError = humanizeCloudError(lastError),
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
            withTimeout(briefTimeoutMs) {
                transport.generateHybridBrief(prompt, runtimeConfig.cloudModel)
            }
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
            withTimeout(briefTimeoutMs) {
                transport.generateCloudUnary(prompt, runtimeConfig.cloudModel, BRIEF_SYSTEM_INSTRUCTION)
            }
        }.recoverCatching {
            withTimeout(briefTimeoutMs) {
                transport.generateCloudUnary(prompt, runtimeConfig.cloudFallbackModel, BRIEF_SYSTEM_INSTRUCTION)
            }
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

    private fun buildEmergencyLocalRca(sanitizedLen: Int, errorReason: String): String = listOf(        "### Root Cause Hypothesis (Local Deterministic SRE Fallback)",
        "- **Zero-Leakage Guarantee Held:** Stage 1 scrubbed all secrets locally (`0` raw PII bytes left device).",
        "- **Cloud Status:** Outbound Cloud Gemini call reported `$errorReason`.",
        "- **Sideload / Debug APK Tip:** App Check binds debug builds to tokens registered for your own Firebase project, so a freshly sideloaded APK can be refused by the cloud while every on-device feature keeps working offline with no setup. To register this build, copy the UUID printed in Logcat (`DebugAppCheckProvider`) into Firebase Console -> App Check -> Apps -> Android -> Manage debug tokens. For a zero-setup cloud demo, open https://para-1-2e22b.web.app.",
        "### Immediate Mitigation",
        "1. Rotate any exposed API keys, tokens, or private keys flagged by Stage 1.",
        "2. Verify network & App Check connectivity, then tap Send Scrubbed Text to Cloud AI again.",
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

    private fun buildSandboxExtractionPrompt(rawText: String): String = listOf(
        "You extract sensitive spans from text so a firewall can redact them.",
        "Reply with ONE line per span, formatted PHRASE|CATEGORY.",
        "PHRASE must be copied verbatim from the text, 2-60 characters, no quotes and no commentary.",
        "CATEGORY is exactly one of: PERSON_PII, CONTEXTUAL_PHI, NATURAL_SECRET, M_AND_A_SECRET, ADDRESS, CREDIT_CARD, ACCOUNT_NUMBER, UPI_ID, PAN_ID, IFSC.",
        "Extract every person name, medical condition, clinic or hospital, street address, and neighbourhood or city that reveals where a named person will be.",
        "Use CREDIT_CARD for a card number even when it is grouped with spaces.",
        "If nothing is sensitive reply exactly NONE.",
        "Text:\n${rawText.take(2000)}",
    ).joinToString("\n")

    /**
     * Tolerant reader for the sandbox prompt. Handles markdown fences, bulleted lines, phrases with
     * internal pipes, and JSON-shaped fallback outputs without throwing on malformed model text.
     */
    internal fun parseSandboxPhrases(raw: String, itemsOut: MutableList<SemanticExtractionItem>) {
        val cleaned = raw
            .replace(CONTROL_CHARS_REGEX, "")
            .replace(CODE_FENCE_REGEX, "")
            .trim()
        if (cleaned.isEmpty()) return

        var parsedAnyPipe = false
        for (line in cleaned.lines()) {
            val trimmed = line.trim().trimStart('-', '*', '•').trim()
            if (trimmed.isEmpty() || trimmed.equals("NONE", ignoreCase = true)) continue
            val sep = trimmed.lastIndexOf('|')
            if (sep <= 0 || sep >= trimmed.lastIndex) continue
            val phrase = trimmed.substring(0, sep).trim().trim('"', '\'', '`')
            val category = trimmed.substring(sep + 1).trim().substringBefore(' ').trim('"', '\'', '`', ',', '}').uppercase()
            if (phrase.length < 3 || category.isEmpty() || phrase.contains("[REDACTED:")) continue
            parsedAnyPipe = true
            if (itemsOut.none { it.phrase.equals(phrase, ignoreCase = true) }) {
                itemsOut.add(SemanticExtractionItem(phrase, category))
            }
        }
        if (!parsedAnyPipe && cleaned.contains('{')) {
            extractFallbackJsonEntities(cleaned, itemsOut)
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

    internal fun parseStage1Response(
        raw: String,
        itemsOut: MutableList<SemanticExtractionItem>,
    ): Triple<Severity, String, String?>? {
        val cleaned = raw
            .replace(CONTROL_CHARS_REGEX, "")
            .replace(CODE_FENCE_REGEX, "")
            .trim()
        val lines = cleaned.lines().map { it.trim() }.filter { it.isNotEmpty() }
        if (lines.isEmpty()) return null
        val header = lines.first().split("|")
        val sev = runCatching { Severity.valueOf(header.getOrNull(0)?.trim()?.uppercase() ?: "") }
            .getOrNull()
        if (sev == null) {
            if (!cleaned.contains('{')) return null
            extractFallbackJsonEntities(cleaned, itemsOut)
            val jsonSev = JSON_SEVERITY_REGEX.find(cleaned)?.groupValues?.getOrNull(1)?.uppercase()
                ?.let { runCatching { Severity.valueOf(it) }.getOrNull() }
                ?: return null
            val jsonRb = JSON_RUNBOOK_REGEX.find(cleaned)?.groupValues?.getOrNull(1)?.trim()
                ?.takeUnless { it.isBlank() || it.equals("null", ignoreCase = true) || it.equals("none", ignoreCase = true) }
            return Triple(jsonSev, jsonRb ?: "GENERAL_INCIDENT", jsonRb)
        }
        val cat = header.getOrNull(1)?.trim()?.takeIf { it.isNotBlank() } ?: "GENERAL_INCIDENT"
        val rb = header.getOrNull(2)?.trim()?.takeUnless { it.isBlank() || it.equals("NONE", ignoreCase = true) }

        for (line in lines.drop(1)) {
            val sep = line.lastIndexOf('|')
            if (sep <= 0 || sep >= line.lastIndex) continue
            val phrase = line.substring(0, sep).trim().trim('"', '\'', '`')
            val itemCat = line.substring(sep + 1).trim()
            if (phrase.length >= 3 && itemCat.isNotEmpty() && !phrase.contains("[REDACTED:")) {
                itemsOut.add(SemanticExtractionItem(phrase, itemCat))
            }
        }
        return Triple(sev, cat, rb)
    }

    private fun extractFallbackJsonEntities(cleaned: String, itemsOut: MutableList<SemanticExtractionItem>) {
        for (objMatch in JSON_OBJECT_REGEX.findAll(cleaned)) {
            val block = objMatch.value
            val phrase = JSON_VALUE_FIELD_REGEX.find(block)?.groupValues?.getOrNull(1)
                ?.replace("\\\"", "\"")
                ?.replace("\\\\", "\\")
                ?.trim()
                .orEmpty()
            val category = JSON_TYPE_FIELD_REGEX.find(block)?.groupValues?.getOrNull(1)
                ?.trim()
                ?.uppercase()
                .orEmpty()
                .ifEmpty { "SENSITIVE" }
            if (phrase.length >= 3 && !phrase.contains("[REDACTED:") &&
                itemsOut.none { it.phrase.equals(phrase, ignoreCase = true) }
            ) {
                itemsOut.add(SemanticExtractionItem(phrase, category))
            }
        }
    }

    companion object {
        const val CLIENT_TAG = "CordonNano"
        const val DEFAULT_ON_DEVICE_TIMEOUT_MS = 12_000L
        const val DEFAULT_CLOUD_TIMEOUT_MS = 25_000L
        const val DEFAULT_BRIEF_TIMEOUT_MS = 15_000L
        private val CONTROL_CHARS_REGEX = Regex("""[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]""")
        private val CODE_FENCE_REGEX = Regex("""```(?:json)?""", RegexOption.IGNORE_CASE)
        private val JSON_OBJECT_REGEX = Regex("""\{[^{}]{1,400}\}""")
        private val JSON_VALUE_FIELD_REGEX = Regex(""""(?:value|phrase)"\s*:\s*"((?:\\.|[^"\\]){1,180})"""")
        private val JSON_TYPE_FIELD_REGEX = Regex(""""(?:type|category)"\s*:\s*"([A-Za-z0-9_ -]{1,40})"""")
        private val JSON_SEVERITY_REGEX = Regex(""""severity"\s*:\s*"(P[0-3])"""", RegexOption.IGNORE_CASE)
        private val JSON_RUNBOOK_REGEX = Regex(""""runbookId"\s*:\s*"([^"]{1,80})"""")
        const val SRE_SYSTEM_INSTRUCTION =
            "You are a Principal SRE Incident Triage Assistant. Produce concise Markdown with sections: ### Root Cause Hypothesis, ### Immediate Mitigation, and ### Verification Checklist. Never ask for or echo redacted PII. Preserve exact [REDACTED:...] tokens verbatim and omit horizontal --- rules."
        const val BRIEF_SYSTEM_INSTRUCTION =
            "Start directly with **Executive Summary:** (2 sentences, no conversational intro or ---/*** rules) followed by **Slack Incident Update:** (1 paragraph), preserving exact [REDACTED:...] tokens verbatim."
    }
}

internal fun humanizeCloudError(raw: String?): String {
    val message = raw?.trim().orEmpty()
    if (message.isEmpty()) return "the cloud call did not complete"
    val lower = message.lowercase()
    return when {
        lower.contains("no signed in user") || lower.contains("nosignedinuser") ->
            "AI Logic rejected the request because no signed-in session existed"
        lower.contains("app check") || lower.contains("appcheck") || lower.contains("permission_denied") ->
            "App Check rejected this build — register its debug token in Firebase Console"
        lower.contains("unable to resolve host") || lower.contains("timeout") ||
            lower.contains("timed out") || lower.contains("network") || lower.contains("unexpected") ->
            "no network route to the cloud (offline, DNS blocked, or request timed out)"
        lower.contains("not configured") || lower.contains("firebaseapp") || lower.contains("no app") ->
            "Firebase is not configured in this build"
        else -> message.trimEnd('.', ' ')
    }
}
