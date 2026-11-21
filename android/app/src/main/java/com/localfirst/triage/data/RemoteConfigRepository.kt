package com.localfirst.triage.data

import com.google.firebase.remoteconfig.FirebaseRemoteConfig
import com.google.firebase.remoteconfig.FirebaseRemoteConfigSettings
import com.localfirst.triage.model.RemoteConfigSource
import com.localfirst.triage.model.RuntimeConfigValues
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.math.roundToInt

class RemoteConfigRepository(
    private val remoteConfigProvider: () -> FirebaseRemoteConfig? = {
        runCatching { FirebaseRemoteConfig.getInstance() }.getOrNull()
    },
) {
    private var defaultsConfigured = false

    suspend fun loadRuntimeConfig(
        forceRefresh: Boolean = false,
        isOnline: Boolean = true,
        timeoutMs: Long = 3_500L,
    ): RuntimeConfigValues {
        if (!isOnline) {
            return RuntimeConfigValues(source = RemoteConfigSource.DEFAULT_FALLBACK)
        }
        val rc = remoteConfigProvider()
            ?: return RuntimeConfigValues(source = RemoteConfigSource.DEFAULT_FALLBACK)

        if (!defaultsConfigured) {
            runCatching {
                rc.setConfigSettingsAsync(
                    FirebaseRemoteConfigSettings.Builder()
                        .setMinimumFetchIntervalInSeconds(DEFAULT_MIN_FETCH_INTERVAL_SECONDS)
                        .build(),
                ).await()
                rc.setDefaultsAsync(DEFAULT_CONFIG_MAP).await()
                defaultsConfigured = true
            }
        }

        return try {
            if (forceRefresh) {
                rc.setConfigSettingsAsync(
                    FirebaseRemoteConfigSettings.Builder()
                        .setMinimumFetchIntervalInSeconds(0L)
                        .build(),
                ).await()
            }

            val activated = withTimeoutOrNull(timeoutMs) {
                rc.fetchAndActivate().await()
            }

            val primary = rc.getString("cloud_primary_model").trim()
            val legacy = rc.getString("cloud_model").trim()
            val fallback = rc.getString("cloud_fallback_model").trim()
            val enableCloud = rc.getBoolean("enable_cloud_escalation")
            val entropyRaw = rc.getDouble("entropy_threshold")
            val termsRaw = rc.getString("enterprise_blocked_terms")

            RuntimeConfigValues(
                cloudModel = primary.ifEmpty { legacy.ifEmpty { RuntimeConfigValues.DEFAULT_CLOUD_PRIMARY_MODEL } },
                cloudFallbackModel = fallback.ifEmpty { RuntimeConfigValues.DEFAULT_CLOUD_FALLBACK_MODEL },
                enableCloudEscalation = enableCloud,
                entropyThreshold = clampEntropyThreshold(entropyRaw),
                enterpriseBlockedTerms = parseEnterpriseBlockedTerms(termsRaw),
                source = if (activated == null) RemoteConfigSource.TIMEOUT else RemoteConfigSource.LOADED,
            )
        } catch (_: Exception) {
            RuntimeConfigValues(source = RemoteConfigSource.DEFAULT_FALLBACK)
        } finally {
            if (forceRefresh) {
                runCatching {
                    rc.setConfigSettingsAsync(
                        FirebaseRemoteConfigSettings.Builder()
                            .setMinimumFetchIntervalInSeconds(DEFAULT_MIN_FETCH_INTERVAL_SECONDS)
                            .build(),
                    ).await()
                }
            }
        }
    }

    companion object {
        const val DEFAULT_MIN_FETCH_INTERVAL_SECONDS = 60L

        private val DEFAULT_CONFIG_MAP: Map<String, Any> = mapOf(
            "cloud_primary_model" to RuntimeConfigValues.DEFAULT_CLOUD_PRIMARY_MODEL,
            "cloud_model" to RuntimeConfigValues.DEFAULT_CLOUD_PRIMARY_MODEL,
            "cloud_fallback_model" to RuntimeConfigValues.DEFAULT_CLOUD_FALLBACK_MODEL,
            "enable_cloud_escalation" to true,
            "entropy_threshold" to RuntimeConfigValues.DEFAULT_ENTROPY_THRESHOLD,
            "enterprise_blocked_terms" to """["Project-Apollo","Project-Valkyrie"]""",
        )

        fun clampEntropyThreshold(raw: Double): Double {
            if (!raw.isFinite() || raw < 2.0 || raw > 5.5) {
                return RuntimeConfigValues.DEFAULT_ENTROPY_THRESHOLD
            }
            return (raw * 100.0).roundToInt() / 100.0
        }

        fun parseEnterpriseBlockedTerms(raw: String): List<String> {
            val trimmed = raw.trim()
            if (trimmed.isEmpty()) return RuntimeConfigValues.DEFAULT_ENTERPRISE_BLOCKED_TERMS
            if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
                return RuntimeConfigValues.DEFAULT_ENTERPRISE_BLOCKED_TERMS
            }
            val inner = trimmed.substring(1, trimmed.length - 1).trim()
            if (inner.isEmpty()) return emptyList()

            val parsed = LinkedHashSet<String>()
            var i = 0
            while (i < inner.length) {
                while (i < inner.length && (inner[i].isWhitespace() || inner[i] == ',')) i++
                if (i >= inner.length) break
                if (inner[i] != '"') {
                    return RuntimeConfigValues.DEFAULT_ENTERPRISE_BLOCKED_TERMS
                }
                i++
                val token = StringBuilder()
                var closed = false
                while (i < inner.length) {
                    val ch = inner[i]
                    if (ch == '\\' && i + 1 < inner.length) {
                        token.append(inner[i + 1])
                        i += 2
                        continue
                    }
                    if (ch == '"') {
                        closed = true
                        i++
                        break
                    }
                    token.append(ch)
                    i++
                }
                if (!closed) return RuntimeConfigValues.DEFAULT_ENTERPRISE_BLOCKED_TERMS
                val clean = token.toString().trim()
                if (clean.length >= 3) {
                    parsed.add(clean)
                }
            }
            return parsed.take(200)
        }
    }
}
