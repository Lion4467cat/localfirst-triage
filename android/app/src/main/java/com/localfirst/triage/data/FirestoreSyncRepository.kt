package com.localfirst.triage.data

import android.app.Activity
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthUserCollisionException
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.OAuthProvider
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
import com.localfirst.triage.firewall.LocalFirewallEngine
import com.localfirst.triage.model.AuthUserSummary
import com.localfirst.triage.model.CustomRunbook
import com.localfirst.triage.model.InferenceSource
import com.localfirst.triage.model.NanoStatus
import com.localfirst.triage.model.PrivacyPolicy
import com.localfirst.triage.model.ResolutionMode
import com.localfirst.triage.model.Severity
import com.localfirst.triage.model.SourcePlatform
import com.localfirst.triage.model.Stage2Source
import com.localfirst.triage.model.TriageResult
import com.localfirst.triage.model.ZeroLeakageAudit
import kotlinx.coroutines.tasks.await

sealed class ZeroPiiPayloadResult {
    data class Valid(val data: Map<String, Any?>) : ZeroPiiPayloadResult()
    data class Blocked(val reason: String, val blockedByZeroLeakage: Boolean = true) : ZeroPiiPayloadResult()
}

data class AuthActionResult(
    val ok: Boolean,
    val user: AuthUserSummary? = null,
    val recoveredFromExistingAccount: Boolean = false,
    val error: String? = null,
)

data class CloudWriteResult(
    val ok: Boolean,
    val blockedByZeroLeakage: Boolean = false,
    val reason: String? = null,
)

class FirestoreSyncRepository(
    private val authProvider: () -> FirebaseAuth? = {
        runCatching { FirebaseAuth.getInstance() }.getOrNull()
    },
    private val firestoreProvider: () -> FirebaseFirestore? = {
        runCatching { FirebaseFirestore.getInstance() }.getOrNull()
    },
) {
    fun currentAuthUser(): AuthUserSummary? = toSummary(authProvider()?.currentUser)

    fun observeAuthState(onChange: (AuthUserSummary?) -> Unit): () -> Unit {
        val auth = authProvider() ?: return {}
        val listener = FirebaseAuth.AuthStateListener { firebaseAuth ->
            onChange(toSummary(firebaseAuth.currentUser))
        }
        auth.addAuthStateListener(listener)
        onChange(toSummary(auth.currentUser))
        return { auth.removeAuthStateListener(listener) }
    }

    suspend fun signInAnonymously(): AuthActionResult {
        val auth = authProvider()
            ?: return AuthActionResult(ok = false, error = "Firebase Auth not initialized.")
        return try {
            val result = auth.signInAnonymously().await()
            AuthActionResult(ok = true, user = toSummary(result.user))
        } catch (err: Exception) {
            AuthActionResult(ok = false, error = err.message ?: "Anonymous sign-in failed")
        }
    }

    suspend fun signInOrLinkWithGoogle(activity: Activity): AuthActionResult {
        val auth = authProvider()
            ?: return AuthActionResult(ok = false, error = "Firebase Auth not initialized.")
        val provider = OAuthProvider.newBuilder("google.com").build()
        val existingUser = auth.currentUser
        return try {
            if (existingUser != null && existingUser.isAnonymous) {
                try {
                    val linked = existingUser.startActivityForLinkWithProvider(activity, provider).await()
                    AuthActionResult(ok = true, user = toSummary(linked.user))
                } catch (collision: FirebaseAuthUserCollisionException) {
                    val recovered = auth.startActivityForSignInWithProvider(activity, provider).await()
                    AuthActionResult(
                        ok = true,
                        user = toSummary(recovered.user),
                        recoveredFromExistingAccount = true,
                    )
                }
            } else {
                val signedIn = auth.startActivityForSignInWithProvider(activity, provider).await()
                AuthActionResult(ok = true, user = toSummary(signedIn.user))
            }
        } catch (err: Exception) {
            val rawMsg = err.message ?: "Google sign-in failed"
            val friendlyMsg = if (
                rawMsg.contains("DEVELOPER_ERROR", ignoreCase = true) ||
                rawMsg.contains("10:", ignoreCase = true) ||
                rawMsg.contains("certificate", ignoreCase = true) ||
                rawMsg.contains("sign", ignoreCase = true) ||
                rawMsg.contains("browser", ignoreCase = true)
            ) {
                "Google Sign-In unavailable on unsigned/sideloaded APK ($rawMsg). Tap Enable Sync (Guest) instead — all Zero-PII Firestore features work identically."
            } else {
                "$rawMsg — or tap Enable Sync (Guest) for instant passwordless Zero-PII sync."
            }
            AuthActionResult(ok = false, error = friendlyMsg)
        }
    }

    fun signOut() {
        authProvider()?.signOut()
    }

    suspend fun syncTicket(uid: String, ticket: TriageResult): CloudWriteResult {
        val built = buildZeroPiiTicketPayload(uid, ticket)
        if (built is ZeroPiiPayloadResult.Blocked) {
            return CloudWriteResult(
                ok = false,
                blockedByZeroLeakage = built.blockedByZeroLeakage,
                reason = built.reason,
            )
        }
        val payload = (built as ZeroPiiPayloadResult.Valid).data
        val db = firestoreProvider()
            ?: return CloudWriteResult(ok = false, reason = "Cloud Firestore not initialized.")
        return try {
            db.collection("workspaces")
                .document(uid)
                .collection("tickets")
                .document(ticket.id)
                .set(payload)
                .await()
            CloudWriteResult(ok = true)
        } catch (err: Exception) {
            CloudWriteResult(ok = false, reason = err.message ?: "Firestore write failed")
        }
    }

    suspend fun syncPolicy(
        uid: String,
        policy: PrivacyPolicy,
        createdAt: Long = System.currentTimeMillis(),
    ): CloudWriteResult {
        if (uid.isBlank()) return CloudWriteResult(ok = false, reason = "Missing uid.")
        val db = firestoreProvider()
            ?: return CloudWriteResult(ok = false, reason = "Cloud Firestore not initialized.")
        val safeCreatedAt = if (createdAt > 0L) createdAt else System.currentTimeMillis()
        val updatedAt = maxOf(safeCreatedAt, System.currentTimeMillis())
        val payload = linkedMapOf<String, Any?>(
            "uid" to uid,
            "customTerms" to policy.customTerms.map { it.trim() }.filter { it.length >= 3 }.take(200),
            "enableEntropyScanner" to policy.enableEntropyScanner,
            "autoCountdownSeconds" to policy.autoCountdownSeconds.coerceIn(0, 60),
            "createdAt" to safeCreatedAt,
            "updatedAt" to updatedAt,
        )
        return try {
            db.collection("workspaces")
                .document(uid)
                .collection("policies")
                .document("default")
                .set(payload)
                .await()
            CloudWriteResult(ok = true)
        } catch (err: Exception) {
            CloudWriteResult(ok = false, reason = err.message ?: "Policy sync failed")
        }
    }

    fun subscribeWorkspace(
        uid: String,
        onTickets: (List<TriageResult>) -> Unit,
        onPolicy: (PrivacyPolicy, Long) -> Unit,
        onRunbooks: (List<CustomRunbook>) -> Unit,
        onError: (String) -> Unit,
    ): () -> Unit {
        val db = firestoreProvider() ?: return {}
        if (uid.isBlank()) return {}

        val registrations = mutableListOf<ListenerRegistration>()

        registrations += db.collection("workspaces")
            .document(uid)
            .collection("tickets")
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(50L)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    onError(error.message ?: "Tickets listener error")
                    return@addSnapshotListener
                }
                if (snapshot == null) return@addSnapshotListener
                val items = snapshot.documents.mapNotNull { doc ->
                    firestoreMapToLocalResult(doc.data)
                }
                onTickets(items)
            }

        registrations += db.collection("workspaces")
            .document(uid)
            .collection("policies")
            .document("default")
            .addSnapshotListener { doc, error ->
                if (error != null) {
                    onError(error.message ?: "Policy listener error")
                    return@addSnapshotListener
                }
                if (doc == null || !doc.exists()) return@addSnapshotListener
                val data = doc.data ?: return@addSnapshotListener
                val terms = (data["customTerms"] as? List<*>)
                    ?.filterIsInstance<String>()
                    ?.map { it.trim() }
                    ?.filter { it.length >= 3 }
                    ?: emptyList()
                val enableEntropy = data["enableEntropyScanner"] as? Boolean ?: true
                val countdown = (data["autoCountdownSeconds"] as? Number)?.toInt()?.coerceIn(0, 60) ?: 3
                val createdAt = (data["createdAt"] as? Number)?.toLong() ?: System.currentTimeMillis()
                onPolicy(PrivacyPolicy(terms, enableEntropy, countdown), createdAt)
            }

        registrations += db.collection("workspaces")
            .document(uid)
            .collection("runbooks")
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    onError(error.message ?: "Runbooks listener error")
                    return@addSnapshotListener
                }
                if (snapshot == null) return@addSnapshotListener
                val custom = snapshot.documents.mapNotNull { doc ->
                    val d = doc.data ?: return@mapNotNull null
                    val id = (d["id"] as? String)?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                    val title = (d["title"] as? String)?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                    val category = (d["category"] as? String) ?: "GENERAL"
                    val sev = if ((d["severity"] as? String) == "P2") Severity.P2 else Severity.P3
                    val keywords = (d["keywords"] as? List<*>)?.filterIsInstance<String>() ?: emptyList()
                    val resolution = (d["resolution"] as? String) ?: return@mapNotNull null
                    if (keywords.isEmpty()) return@mapNotNull null
                    CustomRunbook(id, title, category, sev, keywords, resolution, builtIn = false)
                }
                onRunbooks(custom)
            }

        return {
            registrations.forEach { it.remove() }
        }
    }

    companion object {
        val TICKET_ALLOWED_KEYS: Set<String> = setOf(
            "id",
            "uid",
            "title",
            "sanitizedText",
            "severity",
            "category",
            "runbookId",
            "resolution",
            "resolutionMode",
            "inferenceSource",
            "stage1Source",
            "stage1LatencyMs",
            "stage2Source",
            "stage2LatencyMs",
            "nanoStatus",
            "latencyMs",
            "estimatedTokensSaved",
            "activeCloudModel",
            "sourcePlatform",
            "zeroLeakageVerified",
            "activeMaskCount",
            "redactedCategories",
            "queuedForReconnect",
            "createdAt",
            "updatedAt",
        )

        fun buildZeroPiiTicketPayload(
            uid: String,
            result: TriageResult,
            nowMs: Long = System.currentTimeMillis(),
        ): ZeroPiiPayloadResult {
            if (uid.isBlank() || result.id.isBlank()) {
                return ZeroPiiPayloadResult.Blocked("Missing uid or ticket ID.", blockedByZeroLeakage = false)
            }
            if (result.sanitizedText.isBlank()) {
                return ZeroPiiPayloadResult.Blocked("Cannot sync blank sanitizedText to Firestore.")
            }

            val audit = LocalFirewallEngine.verifyZeroLeakage(result.sanitizedText, result.spans, nowMs)
            if (!audit.verified) {
                return ZeroPiiPayloadResult.Blocked(
                    "Zero-Leakage gate blocked Firestore write: ${audit.leakedSpansCount} leaked span(s) (${audit.leakedCategories.joinToString(", ")}).",
                )
            }

            if (LocalFirewallEngine.containsRawCredentialGuard(result.sanitizedText)) {
                return ZeroPiiPayloadResult.Blocked("Raw credential detected inside sanitizedText.")
            }
            if (LocalFirewallEngine.containsRawCredentialGuard(result.resolution)) {
                return ZeroPiiPayloadResult.Blocked("Raw credential detected inside resolution.")
            }

            val activeSpans = result.spans.filter { it.masked }
            val categories = activeSpans.map { it.category }.distinct().take(100)
            val createdAt = if (result.createdAt > 0L) result.createdAt else nowMs
            val updatedAt = maxOf(createdAt, result.updatedAt, nowMs)

            val docMap = linkedMapOf<String, Any?>(
                "id" to result.id.take(128),
                "uid" to uid,
                "title" to result.title.trim().ifEmpty { "Untitled Incident" }.take(200),
                "sanitizedText" to result.sanitizedText.take(50_000),
                "severity" to result.severity.name,
                "category" to result.category.ifBlank { "GENERAL_INCIDENT" }.take(100),
                "runbookId" to result.runbookId?.take(100),
                "resolution" to result.resolution.take(50_000),
                "resolutionMode" to result.resolutionMode.name.take(64),
                "inferenceSource" to result.inferenceSource.name.take(64),
                "stage1Source" to result.stage1Source.take(64),
                "stage1LatencyMs" to maxOf(0L, result.stage1LatencyMs),
                "stage2Source" to result.stage2Source.name.take(64),
                "stage2LatencyMs" to maxOf(0L, result.stage2LatencyMs),
                "nanoStatus" to result.nanoStatus.name.take(32),
                "latencyMs" to maxOf(0L, result.latencyMs),
                "estimatedTokensSaved" to maxOf(0, result.estimatedTokensSaved),
                "activeCloudModel" to result.activeCloudModel?.take(100),
                "sourcePlatform" to result.sourcePlatform.name,
                "zeroLeakageVerified" to true,
                "activeMaskCount" to activeSpans.size.coerceIn(0, 5000),
                "redactedCategories" to categories,
                "queuedForReconnect" to result.queuedForReconnect,
                "createdAt" to createdAt,
                "updatedAt" to updatedAt,
            )

            return ZeroPiiPayloadResult.Valid(docMap)
        }

        fun firestoreMapToLocalResult(raw: Map<String, Any?>?): TriageResult? {
            if (raw == null) return null
            val id = (raw["id"] as? String)?.takeIf { it.isNotBlank() } ?: return null
            val sanitizedText = raw["sanitizedText"] as? String ?: return null
            val verified = raw["zeroLeakageVerified"] as? Boolean ?: false
            if (!verified) return null

            val platformStr = raw["sourcePlatform"] as? String
            val platform = runCatching {
                SourcePlatform.valueOf(platformStr ?: SourcePlatform.WEB.name)
            }.getOrDefault(SourcePlatform.WEB)

            val severityStr = raw["severity"] as? String
            val severity = runCatching {
                Severity.valueOf(severityStr ?: Severity.P2.name)
            }.getOrDefault(Severity.P2)

            val resModeStr = raw["resolutionMode"] as? String
            val resolutionMode = runCatching {
                ResolutionMode.valueOf(resModeStr ?: ResolutionMode.QUARANTINED_PENDING_APPROVAL.name)
            }.getOrDefault(ResolutionMode.QUARANTINED_PENDING_APPROVAL)

            val infSourceStr = raw["inferenceSource"] as? String
            val inferenceSource = runCatching {
                InferenceSource.valueOf(infSourceStr ?: InferenceSource.LOCAL_REGEX_FALLBACK.name)
            }.getOrDefault(InferenceSource.LOCAL_REGEX_FALLBACK)

            val stage2Str = raw["stage2Source"] as? String
            val stage2Source = runCatching {
                Stage2Source.valueOf(stage2Str ?: Stage2Source.HELD_QUARANTINE.name)
            }.getOrDefault(Stage2Source.HELD_QUARANTINE)

            val nanoStr = raw["nanoStatus"] as? String
            val nanoStatus = runCatching {
                NanoStatus.valueOf(nanoStr ?: NanoStatus.UNAVAILABLE.name)
            }.getOrDefault(NanoStatus.UNAVAILABLE)

            val updatedAt = (raw["updatedAt"] as? Number)?.toLong() ?: System.currentTimeMillis()
            val createdAt = (raw["createdAt"] as? Number)?.toLong() ?: updatedAt
            val maskCount = (raw["activeMaskCount"] as? Number)?.toInt() ?: 0
            val cats = (raw["redactedCategories"] as? List<*>)?.filterIsInstance<String>() ?: emptyList()

            return TriageResult(
                id = id,
                title = (raw["title"] as? String)?.takeIf { it.isNotBlank() } ?: "Synced Ticket",
                rawText = LocalFirewallEngine.PURGED_PLACEHOLDER,
                sanitizedText = sanitizedText,
                severity = severity,
                category = (raw["category"] as? String) ?: "GENERAL_INCIDENT",
                runbookId = raw["runbookId"] as? String,
                spans = emptyList(),
                resolution = (raw["resolution"] as? String) ?: "",
                resolutionMode = resolutionMode,
                inferenceSource = inferenceSource,
                stage1Source = (raw["stage1Source"] as? String) ?: "HEURISTIC_GUARD",
                stage1LatencyMs = (raw["stage1LatencyMs"] as? Number)?.toLong() ?: 1L,
                stage2Source = stage2Source,
                stage2LatencyMs = (raw["stage2LatencyMs"] as? Number)?.toLong() ?: 0L,
                nanoStatus = nanoStatus,
                latencyMs = (raw["latencyMs"] as? Number)?.toLong() ?: 1L,
                estimatedTokensSaved = (raw["estimatedTokensSaved"] as? Number)?.toInt() ?: 40,
                createdAt = createdAt,
                updatedAt = updatedAt,
                activeCloudModel = raw["activeCloudModel"] as? String,
                cloudError = null,
                zeroLeakageAudit = ZeroLeakageAudit(
                    verified = true,
                    checkedSpansCount = maskCount,
                    leakedSpansCount = 0,
                    leakedCategories = cats,
                    outboundPromptPreview = sanitizedText,
                    verifiedAt = updatedAt,
                ),
                hybridBrief = null,
                sourcePlatform = platform,
                queuedForReconnect = raw["queuedForReconnect"] as? Boolean ?: false,
                loadedFromZeroPiiStore = true,
            )
        }

        private fun toSummary(user: FirebaseUser?): AuthUserSummary? {
            if (user == null || user.uid.isBlank()) return null
            return AuthUserSummary(
                uid = user.uid,
                isAnonymous = user.isAnonymous,
                displayName = user.displayName,
                email = user.email,
            )
        }
    }
}
