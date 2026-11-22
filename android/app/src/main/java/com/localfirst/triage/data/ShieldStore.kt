package com.localfirst.triage.data

import android.content.ComponentName
import android.content.Context
import android.content.SharedPreferences
import android.provider.Settings
import com.localfirst.triage.accessibility.CordonAccessibilityService
import com.localfirst.triage.model.ProtectionLevel
import com.localfirst.triage.model.RedactionSpan
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.UUID

data class GuardedAppSpec(
    val packageName: String,
    val displayName: String,
    val defaultEnabled: Boolean = true,
)

data class BlockHistoryEntry(
    val id: String,
    val timestampMs: Long,
    val appName: String,
    val categoryCounts: Map<String, Int>,
    val totalBlocked: Int,
    val engineUsed: String,
) {
    fun formatSummary(): String {
        if (categoryCounts.isEmpty()) {
            return "$totalBlocked Secret(s) · 0 Leaked"
        }
        val parts = categoryCounts.entries
            .sortedByDescending { it.value }
            .take(3)
            .map { (category, count) -> "$count ${ShieldStore.friendlyCategoryName(category)}" }
        return (parts + "0 Leaked").joinToString(" · ")
    }
}

object ShieldStore {
    const val PREFS_NAME = "localfirst_ui_prefs"
    private const val KEY_HISTORY = "cordon_zero_pii_history"
    private const val KEY_TOTAL_BLOCKED = "cordon_total_blocked"
    private const val KEY_SHIELD_PAUSED = "cordon_background_shield_paused"
    private const val KEY_GUARDED_PREFIX = "cordon_guarded_"
    private const val MAX_HISTORY_ENTRIES = 100

    val DEFAULT_GUARDED_APPS = listOf(
        GuardedAppSpec("com.openai.chatgpt", "ChatGPT", true),
        GuardedAppSpec("com.anthropic.claude", "Claude", true),
        GuardedAppSpec("com.google.android.apps.bard", "Gemini", true),
        GuardedAppSpec("com.Slack", "Slack", true),
        GuardedAppSpec("com.whatsapp", "WhatsApp", true),
        GuardedAppSpec("com.discord", "Discord", true),
        GuardedAppSpec("com.android.chrome", "Chrome", true),
    )

    fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getProtectionLevel(context: Context): ProtectionLevel {
        val raw = prefs(context).getString("protection_level", ProtectionLevel.MEDIUM.name)
            ?: ProtectionLevel.MEDIUM.name
        return runCatching { ProtectionLevel.valueOf(raw) }.getOrDefault(ProtectionLevel.MEDIUM)
    }

    fun setProtectionLevel(context: Context, level: ProtectionLevel) {
        prefs(context).edit().putString("protection_level", level.name).apply()
    }

    fun isShieldPaused(context: Context): Boolean =
        prefs(context).getBoolean(KEY_SHIELD_PAUSED, false)

    fun setShieldPaused(context: Context, paused: Boolean) {
        prefs(context).edit().putBoolean(KEY_SHIELD_PAUSED, paused).apply()
    }

    fun isAccessibilityServiceEnabled(context: Context): Boolean {
        val enabled = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ) ?: return false
        val expectedFull = ComponentName(context, CordonAccessibilityService::class.java).flattenToString()
        val expectedShort = ComponentName(context, CordonAccessibilityService::class.java).flattenToShortString()
        return enabled.split(':').any { entry ->
            entry.equals(expectedFull, ignoreCase = true) ||
                entry.equals(expectedShort, ignoreCase = true)
        }
    }

    fun isBackgroundShieldActive(context: Context): Boolean =
        isAccessibilityServiceEnabled(context) && !isShieldPaused(context)

    fun getGuardedAppsState(context: Context): Map<String, Boolean> {
        val p = prefs(context)
        return DEFAULT_GUARDED_APPS.associate { app ->
            app.packageName to p.getBoolean("$KEY_GUARDED_PREFIX${app.packageName}", app.defaultEnabled)
        }
    }

    fun setGuardedAppEnabled(context: Context, packageName: String, enabled: Boolean) {
        prefs(context).edit().putBoolean("$KEY_GUARDED_PREFIX$packageName", enabled).apply()
    }

    fun isPackageGuarded(context: Context, packageName: String?): Boolean {
        if (packageName.isNullOrBlank()) return false
        val spec = DEFAULT_GUARDED_APPS.firstOrNull { it.packageName == packageName } ?: return false
        return prefs(context).getBoolean("$KEY_GUARDED_PREFIX${spec.packageName}", spec.defaultEnabled)
    }

    fun appDisplayNameForPackage(packageName: String?): String =
        DEFAULT_GUARDED_APPS.firstOrNull { it.packageName == packageName }?.displayName
            ?: packageName?.substringAfterLast('.')?.replaceFirstChar { it.uppercase() }
            ?: "Unknown App"

    fun getTotalBlocked(context: Context): Int =
        prefs(context).getInt(KEY_TOTAL_BLOCKED, 0)

    /**
     * Zero-PII invariant: persists ONLY metadata (timestamp, app name, category counts, engine).
     * Never accepts or persists raw text, matched tokens, or sanitized text.
     */
    fun recordBlockEvent(
        context: Context,
        appName: String,
        spans: List<RedactionSpan>,
        engineUsed: String,
        timestampMs: Long = System.currentTimeMillis(),
    ) {
        val activeSpans = spans.filter { it.masked }
        if (activeSpans.isEmpty()) return
        val counts = LinkedHashMap<String, Int>()
        for (span in activeSpans) {
            counts[span.category] = (counts[span.category] ?: 0) + 1
        }
        val entry = BlockHistoryEntry(
            id = UUID.randomUUID().toString(),
            timestampMs = timestampMs,
            appName = appName,
            categoryCounts = counts,
            totalBlocked = activeSpans.size,
            engineUsed = engineUsed,
        )
        val existing = getHistory(context)
        val updated = (listOf(entry) + existing).take(MAX_HISTORY_ENTRIES)
        val newTotal = getTotalBlocked(context) + activeSpans.size
        prefs(context).edit()
            .putString(KEY_HISTORY, serializeHistory(updated))
            .putInt(KEY_TOTAL_BLOCKED, newTotal)
            .apply()
    }

    fun getHistory(context: Context): List<BlockHistoryEntry> {
        val raw = prefs(context).getString(KEY_HISTORY, null) ?: return emptyList()
        return deserializeHistory(raw)
    }

    fun clearHistory(context: Context) {
        prefs(context).edit()
            .remove(KEY_HISTORY)
            .apply()
    }

    private fun enc(value: String): String = URLEncoder.encode(value, "UTF-8")
    private fun dec(value: String): String = URLDecoder.decode(value, "UTF-8")

    fun serializeHistory(entries: List<BlockHistoryEntry>): String {
        return entries.joinToString("\n") { entry ->
            val countsEncoded = entry.categoryCounts.entries.joinToString(",") { (k, v) ->
                "${enc(k)}:$v"
            }
            listOf(
                enc(entry.id),
                entry.timestampMs.toString(),
                enc(entry.appName),
                entry.totalBlocked.toString(),
                enc(entry.engineUsed),
                countsEncoded,
            ).joinToString("|")
        }
    }

    fun deserializeHistory(rawSerialized: String): List<BlockHistoryEntry> = runCatching {
        if (rawSerialized.isBlank()) return emptyList()
        rawSerialized.lineSequence()
            .filter { it.isNotBlank() }
            .mapNotNull { line ->
                val parts = line.split("|")
                if (parts.size < 5) return@mapNotNull null
                val counts = LinkedHashMap<String, Int>()
                val rawCounts = parts.getOrNull(5).orEmpty()
                if (rawCounts.isNotBlank()) {
                    for (pair in rawCounts.split(",")) {
                        val kv = pair.split(":")
                        if (kv.size == 2) {
                            val k = dec(kv[0])
                            val v = kv[1].toIntOrNull() ?: 0
                            if (v > 0) counts[k] = v
                        }
                    }
                }
                BlockHistoryEntry(
                    id = dec(parts[0]),
                    timestampMs = parts[1].toLongOrNull() ?: 0L,
                    appName = dec(parts[2]),
                    categoryCounts = counts,
                    totalBlocked = parts[3].toIntOrNull() ?: 0,
                    engineUsed = dec(parts[4]),
                )
            }
            .toList()
    }.getOrDefault(emptyList())

    fun friendlyCategoryName(category: String): String = when (category.uppercase()) {
        "API_KEY" -> "API Key"
        "AWS_ACCESS_KEY" -> "AWS Key"
        "PRIVATE_KEY", "PEM_PRIVATE_KEY" -> "Private Key"
        "BEARER_OR_JWT" -> "Bearer/JWT"
        "DB_URI", "DB_CONNECTION_URI" -> "DB URI"
        "CREDIT_CARD" -> "Card"
        "GOV_ID" -> "Gov ID"
        "PHONE" -> "Phone"
        "EMAIL" -> "Email"
        "PASSWORD" -> "Password"
        "SECRET" -> "Secret"
        "HIGH_ENTROPY" -> "Token"
        "IP_ADDRESS" -> "IP"
        "IBAN" -> "IBAN"
        "PERSON" -> "Name"
        "ADDRESS" -> "Address"
        "PHI" -> "Health Info"
        "ORG_TERM" -> "Org Term"
        else -> category.replace('_', ' ').lowercase().replaceFirstChar { it.uppercase() }
    }
}
