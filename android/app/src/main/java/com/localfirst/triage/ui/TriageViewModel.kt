package com.localfirst.triage.ui

import android.app.Activity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.localfirst.triage.AppCheckInitializer
import com.localfirst.triage.ai.HybridAiClient
import com.localfirst.triage.data.FirestoreSyncRepository
import com.localfirst.triage.data.RemoteConfigRepository
import com.localfirst.triage.firewall.LocalFirewallEngine
import com.localfirst.triage.firewall.RiskRouter
import com.localfirst.triage.model.AuthUserSummary
import com.localfirst.triage.model.CloudSyncStatus
import com.localfirst.triage.model.CustomRunbook
import com.localfirst.triage.model.DemoScenario
import com.localfirst.triage.model.NanoStatus
import com.localfirst.triage.model.PrivacyPolicy
import com.localfirst.triage.model.RedactionSpan
import com.localfirst.triage.model.ResolutionMode
import com.localfirst.triage.model.RuntimeConfigValues
import com.localfirst.triage.model.TriageResult
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class MainUiState(
    val titleInput: String = LocalFirewallEngine.DEMO_SCENARIOS[0].title,
    val rawTextInput: String = LocalFirewallEngine.DEMO_SCENARIOS[0].rawText,
    val offlineMode: Boolean = false,
    val isRunning: Boolean = false,
    val isGeneratingBrief: Boolean = false,
    val isRefreshingPolicy: Boolean = false,
    val nanoStatus: NanoStatus = NanoStatus.UNAVAILABLE,
    val downloadProgress: Int? = null,
    val runtimeConfig: RuntimeConfigValues = RuntimeConfigValues(),
    val policy: PrivacyPolicy = PrivacyPolicy(),
    val runbooks: List<CustomRunbook> = LocalFirewallEngine.DEFAULT_RUNBOOKS,
    val currentResult: TriageResult? = null,
    val syncedTickets: List<TriageResult> = emptyList(),
    val authUser: AuthUserSummary? = null,
    val cloudSyncStatus: CloudSyncStatus = CloudSyncStatus.DISCONNECTED,
    val cloudSyncMessage: String? = null,
    val totalRuns: Int = 0,
    val localResolvedCount: Int = 0,
    val appCheckLabel: String = AppCheckInitializer.PROVIDER_LABEL,
)

class TriageViewModel(
    private val aiClient: HybridAiClient = HybridAiClient(),
    private val remoteConfigRepo: RemoteConfigRepository = RemoteConfigRepository(),
    private val syncRepo: FirestoreSyncRepository = FirestoreSyncRepository(),
) : ViewModel() {

    private val _uiState = MutableStateFlow(MainUiState())
    val uiState: StateFlow<MainUiState> = _uiState.asStateFlow()

    private val volatileRawMap = HashMap<String, TriageResult>()
    private var unsubscribeAuth: (() -> Unit)? = null
    private var unsubscribeFirestore: (() -> Unit)? = null
    private var activeTriageJob: Job? = null
    private var activeBriefJob: Job? = null
    private var runGeneration: Long = 0L
    private var policyCreatedAt: Long = System.currentTimeMillis()

    init {
        refreshNanoStatus()
        refreshRemoteConfig(force = false)
        observeAuthentication()
    }

    private fun cancelActiveWork() {
        runGeneration++
        activeTriageJob?.cancel()
        activeTriageJob = null
        activeBriefJob?.cancel()
        activeBriefJob = null
        _uiState.update { it.copy(isRunning = false, isGeneratingBrief = false) }
    }

    private fun observeAuthentication() {
        unsubscribeAuth = syncRepo.observeAuthState { user ->
            _uiState.update { state ->
                state.copy(
                    authUser = user,
                    cloudSyncStatus = when {
                        user == null -> CloudSyncStatus.DISCONNECTED
                        state.offlineMode -> CloudSyncStatus.OFFLINE
                        else -> CloudSyncStatus.SYNCED
                    },
                    cloudSyncMessage = null,
                )
            }
            unsubscribeFirestore?.invoke()
            unsubscribeFirestore = null
            if (user != null && !_uiState.value.offlineMode) {
                attachFirestoreListeners(user.uid)
            }
        }
    }

    private fun attachFirestoreListeners(uid: String) {
        unsubscribeFirestore?.invoke()
        unsubscribeFirestore = syncRepo.subscribeWorkspace(
            uid = uid,
            onTickets = { remoteTickets ->
                val merged = LinkedHashMap<String, TriageResult>()
                remoteTickets.forEach { merged[it.id] = it }
                _uiState.value.syncedTickets.forEach { local ->
                    val existing = merged[local.id]
                    if (existing == null || local.updatedAt > existing.updatedAt) {
                        merged[local.id] = local
                    }
                }
                val sorted = merged.values.sortedByDescending { it.createdAt }.take(50)
                _uiState.update {
                    it.copy(
                        syncedTickets = sorted,
                        cloudSyncStatus = CloudSyncStatus.SYNCED,
                        cloudSyncMessage = null,
                    )
                }
            },
            onPolicy = { remotePolicy, createdAt ->
                policyCreatedAt = createdAt
                _uiState.update { it.copy(policy = remotePolicy) }
            },
            onRunbooks = { remoteCustom ->
                val customIds = remoteCustom.map { it.id }.toSet()
                val mergedRunbooks = remoteCustom + LocalFirewallEngine.DEFAULT_RUNBOOKS.filter { it.id !in customIds }
                _uiState.update { it.copy(runbooks = mergedRunbooks) }
            },
            onError = { msg ->
                _uiState.update {
                    it.copy(
                        cloudSyncStatus = CloudSyncStatus.ERROR,
                        cloudSyncMessage = msg,
                    )
                }
            },
        )
    }

    fun refreshNanoStatus() {
        viewModelScope.launch {
            val status = aiClient.checkNanoStatus(_uiState.value.runtimeConfig)
            _uiState.update { it.copy(nanoStatus = status) }
        }
    }

    fun downloadAndWarmUpNano() {
        viewModelScope.launch {
            _uiState.update { it.copy(nanoStatus = NanoStatus.MODEL_DOWNLOADING, downloadProgress = 5) }
            runCatching {
                aiClient.warmUpOnDevice(_uiState.value.runtimeConfig).collect { pct ->
                    _uiState.update {
                        it.copy(
                            nanoStatus = if (pct >= 100) NanoStatus.READY else NanoStatus.MODEL_DOWNLOADING,
                            downloadProgress = pct,
                        )
                    }
                }
            }.onFailure {
                _uiState.update { it.copy(downloadProgress = null) }
            }
            refreshNanoStatus()
        }
    }

    fun refreshRemoteConfig(force: Boolean) {
        viewModelScope.launch {
            _uiState.update { it.copy(isRefreshingPolicy = true) }
            val cfg = remoteConfigRepo.loadRuntimeConfig(
                forceRefresh = force,
                isOnline = !_uiState.value.offlineMode,
            )
            _uiState.update { it.copy(runtimeConfig = cfg, isRefreshingPolicy = false) }
        }
    }

    fun selectScenario(scenario: DemoScenario) {
        cancelActiveWork()
        _uiState.update {
            it.copy(
                titleInput = scenario.title,
                rawTextInput = scenario.rawText,
            )
        }
    }

    fun updateTitle(value: String) {
        _uiState.update { it.copy(titleInput = value) }
    }

    fun updateRawText(value: String) {
        _uiState.update { it.copy(rawTextInput = value) }
    }

    fun addCustomPolicyTerm(term: String) {
        val clean = term.trim()
        if (clean.length < 3 || clean in _uiState.value.policy.customTerms) return
        val updatedPolicy = _uiState.value.policy.copy(
            customTerms = _uiState.value.policy.customTerms + clean,
        )
        _uiState.update { it.copy(policy = updatedPolicy) }
        val uid = _uiState.value.authUser?.uid
        if (uid != null && !_uiState.value.offlineMode) {
            viewModelScope.launch {
                syncRepo.syncPolicy(uid, updatedPolicy, policyCreatedAt)
            }
        }
    }

    fun toggleOfflineMode() {
        val nextOffline = !_uiState.value.offlineMode
        if (nextOffline) {
            cancelActiveWork()
        }
        _uiState.update { state ->
            state.copy(
                offlineMode = nextOffline,
                cloudSyncStatus = when {
                    state.authUser == null -> CloudSyncStatus.DISCONNECTED
                    nextOffline -> CloudSyncStatus.OFFLINE
                    else -> CloudSyncStatus.SYNCED
                },
            )
        }
        val uid = _uiState.value.authUser?.uid
        if (nextOffline) {
            unsubscribeFirestore?.invoke()
            unsubscribeFirestore = null
        } else if (uid != null) {
            attachFirestoreListeners(uid)
        }
    }

    fun ingestSharedText(sharedText: String, sharedTitle: String? = null) {
        val clean = sharedText.trim()
        if (clean.isEmpty()) return
        _uiState.update {
            it.copy(
                titleInput = sharedTitle?.trim()?.ifEmpty { null } ?: "Shared Incident Alert",
                rawTextInput = clean,
            )
        }
        runHybridTriage()
    }

    fun runHybridTriage() {
        val state = _uiState.value
        if (state.rawTextInput.isBlank()) return
        cancelActiveWork()
        val gen = ++runGeneration
        activeTriageJob = viewModelScope.launch {
            _uiState.update { it.copy(isRunning = true) }
            val rawResult = aiClient.runStage1AndTriage(
                title = state.titleInput.trim().ifEmpty { "Untitled Incident" },
                rawText = state.rawTextInput,
                offlineMode = state.offlineMode,
                customRunbooks = state.runbooks,
                policy = state.policy,
                runtimeConfig = state.runtimeConfig,
            )
            val riskProfile = RiskRouter.computeRiskProfile(
                spans = rawResult.spans,
                isLocalRunbook = rawResult.resolutionMode == ResolutionMode.LOCAL_RUNBOOK,
            )
            val result = rawResult.copy(riskProfile = riskProfile)
            if (gen != runGeneration) return@launch
            volatileRawMap[result.id] = result
            val nextFeed = (listOf(result) + _uiState.value.syncedTickets.filter { it.id != result.id }).take(50)
            _uiState.update {
                it.copy(
                    isRunning = false,
                    currentResult = result,
                    syncedTickets = nextFeed,
                    totalRuns = it.totalRuns + 1,
                    localResolvedCount = it.localResolvedCount +
                        if (result.resolutionMode == ResolutionMode.LOCAL_RUNBOOK) 1 else 0,
                )
            }
        }
    }

    fun toggleSpanMask(index: Int) {
        val ticket = _uiState.value.currentResult ?: return
        if (ticket.loadedFromZeroPiiStore || index !in ticket.spans.indices) return
        val updatedSpans: List<RedactionSpan> = ticket.spans.mapIndexed { i, span ->
            if (i == index) span.copy(masked = !span.masked) else span
        }
        val updatedSanitized = LocalFirewallEngine.applyMaskedSpans(ticket.rawText, updatedSpans)
        val updatedAudit = LocalFirewallEngine.verifyZeroLeakage(updatedSanitized, updatedSpans)
        val updatedRisk = RiskRouter.computeRiskProfile(
            spans = updatedSpans,
            isLocalRunbook = ticket.resolutionMode == ResolutionMode.LOCAL_RUNBOOK,
        )
        val updated = ticket.copy(
            spans = updatedSpans,
            sanitizedText = updatedSanitized,
            zeroLeakageAudit = updatedAudit,
            riskProfile = updatedRisk,
            updatedAt = System.currentTimeMillis(),
        )
        volatileRawMap[updated.id] = updated
        _uiState.update { it.copy(currentResult = updated) }
    }

    fun approveAndEscalateToCloud() {
        val ticket = _uiState.value.currentResult ?: return
        val sourceTicket = volatileRawMap[ticket.id] ?: ticket
        cancelActiveWork()
        val gen = ++runGeneration

        activeTriageJob = viewModelScope.launch {
            _uiState.update { it.copy(isRunning = true) }
            val escalated = aiClient.escalateApprovedTicket(
                ticket = sourceTicket,
                updatedSpans = sourceTicket.spans,
                runtimeConfig = _uiState.value.runtimeConfig,
                offlineMode = _uiState.value.offlineMode,
                onStreamChunk = { partial ->
                    _uiState.update { cur ->
                        val active = cur.currentResult
                        if (gen == runGeneration && active != null && active.id == sourceTicket.id) {
                            cur.copy(currentResult = active.copy(resolution = partial))
                        } else {
                            cur
                        }
                    }
                },
            )
            if (gen != runGeneration) return@launch
            volatileRawMap[escalated.id] = escalated
            val nextFeed = (listOf(escalated) + _uiState.value.syncedTickets.filter { it.id != escalated.id }).take(50)
            _uiState.update {
                it.copy(
                    isRunning = false,
                    currentResult = escalated,
                    syncedTickets = nextFeed,
                )
            }
        }
    }

    fun generateHybridBrief() {
        val ticket = _uiState.value.currentResult ?: return
        activeBriefJob?.cancel()
        val gen = runGeneration
        activeBriefJob = viewModelScope.launch {
            _uiState.update { it.copy(isGeneratingBrief = true) }
            val brief = aiClient.generateSanitizedHybridBrief(
                ticket = ticket,
                runtimeConfig = _uiState.value.runtimeConfig,
                offlineMode = _uiState.value.offlineMode,
            )
            if (gen != runGeneration || _uiState.value.currentResult?.id != ticket.id) return@launch
            val updated = ticket.copy(hybridBrief = brief)
            volatileRawMap[updated.id] = updated
            val nextFeed = _uiState.value.syncedTickets.map { if (it.id == updated.id) updated else it }
            _uiState.update {
                it.copy(
                    isGeneratingBrief = false,
                    currentResult = updated,
                    syncedTickets = nextFeed,
                )
            }
        }
    }

    fun syncCurrentTicketToFirestore() {
        val ticket = _uiState.value.currentResult ?: return
        val uid = _uiState.value.authUser?.uid
        if (uid == null) {
            _uiState.update { it.copy(cloudSyncMessage = "Enable Guest or Google Cloud Sync first.") }
            return
        }
        if (_uiState.value.offlineMode) {
            _uiState.update { it.copy(cloudSyncMessage = "Offline Mode active — disable Airplane Mode to sync.") }
            return
        }
        viewModelScope.launch {
            val res = syncRepo.syncTicket(uid, ticket)
            _uiState.update {
                it.copy(
                    cloudSyncStatus = if (res.ok) CloudSyncStatus.SYNCED else CloudSyncStatus.ERROR,
                    cloudSyncMessage = if (res.ok) "Synced Zero-PII ticket (${ticket.id}) cleanly!" else res.reason,
                )
            }
        }
    }

    fun openSyncedTicket(item: TriageResult) {
        cancelActiveWork()
        val selected = volatileRawMap[item.id] ?: item
        _uiState.update {
            it.copy(
                titleInput = selected.title,
                // Security invariant: never leave previous ticket's raw secret sitting in input box when opening a purged synced record
                rawTextInput = if (selected.loadedFromZeroPiiStore) selected.sanitizedText else selected.rawText,
                currentResult = selected,
            )
        }
    }

    fun signInAnonymously() {
        viewModelScope.launch {
            _uiState.update { it.copy(cloudSyncStatus = CloudSyncStatus.SIGNING_IN, cloudSyncMessage = null) }
            val res = syncRepo.signInAnonymously()
            if (!res.ok) {
                _uiState.update {
                    it.copy(
                        cloudSyncStatus = CloudSyncStatus.ERROR,
                        cloudSyncMessage = res.error ?: "Anonymous sign-in failed",
                    )
                }
            }
        }
    }

    fun signInWithGoogle(activity: Activity) {
        viewModelScope.launch {
            _uiState.update { it.copy(cloudSyncStatus = CloudSyncStatus.SIGNING_IN, cloudSyncMessage = null) }
            val res = syncRepo.signInOrLinkWithGoogle(activity)
            if (!res.ok) {
                _uiState.update {
                    it.copy(
                        cloudSyncStatus = if (it.authUser != null) CloudSyncStatus.SYNCED else CloudSyncStatus.DISCONNECTED,
                        cloudSyncMessage = res.error ?: "Google sign-in failed",
                    )
                }
            }
        }
    }

    fun signOut() {
        cancelActiveWork()
        unsubscribeFirestore?.invoke()
        unsubscribeFirestore = null
        syncRepo.signOut()
        _uiState.update {
            it.copy(
                authUser = null,
                cloudSyncStatus = CloudSyncStatus.DISCONNECTED,
                cloudSyncMessage = "Signed out — Local-Only RAM mode active.",
            )
        }
    }

    override fun onCleared() {
        super.onCleared()
        cancelActiveWork()
        unsubscribeAuth?.invoke()
        unsubscribeFirestore?.invoke()
    }
}