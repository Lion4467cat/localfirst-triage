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
    val actionType: String = ACTION_SCRUBBED,
) {
    val usedNanoEngine: Boolean get() = engineUsed == ShieldStore.ENGINE_NANO

    companion object {
        const val ACTION_SCRUBBED = "scrubbed"
        const val ACTION_OVERRIDE = "override"
    }

    fun formatSummary(): String {
        val statusSuffix = if (actionType == ACTION_OVERRIDE) "Unsafe Override" else "0 Leaked"
        val parts = ShieldStore.chipLine(categoryCounts)
        if (parts.isEmpty()) {
            return "$totalBlocked ${Pluralize.of(totalBlocked, "Secret")} · $statusSuffix"
        }
        return (parts + statusSuffix).joinToString(" · ")
    }
}

object ShieldStore {
    const val PREFS_NAME = "localfirst_ui_prefs"
    private const val KEY_HISTORY = "cordon_zero_pii_history"
    private const val KEY_TOTAL_BLOCKED = "cordon_total_blocked"
    private const val KEY_SHIELD_PAUSED = "cordon_background_shield_paused"
    private const val KEY_GUARDED_PREFIX = "cordon_guarded_"
    private const val MAX_HISTORY_ENTRIES = 100

    const val ENGINE_ON_DEVICE = "On-Device Rules"
    const val ENGINE_NANO = "Gemini Nano (AICore)"

    val DEFAULT_GUARDED_APPS = listOf(
        GuardedAppSpec("com.openai.chatgpt", "ChatGPT", true),
        GuardedAppSpec("com.anthropic.claude", "Claude", true),
        GuardedAppSpec("com.google.android.apps.bard", "Gemini", true),
        GuardedAppSpec("com.Slack", "Slack", true),
        GuardedAppSpec("com.whatsapp", "WhatsApp", true),
        GuardedAppSpec("com.discord", "Discord", true),
        // Every major mobile browser, so "OS-wide" is not Chrome-only.
        GuardedAppSpec("com.android.chrome", "Chrome", true),
        GuardedAppSpec("org.mozilla.firefox", "Firefox", true),
        GuardedAppSpec("com.brave.browser", "Brave", true),
        GuardedAppSpec("com.microsoft.emmx", "Edge", true),
        GuardedAppSpec("com.sec.android.app.sbrowser", "Samsung Internet", true),
        GuardedAppSpec("com.opera.browser", "Opera", true),
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

    fun getGuardedAppsState(context: Context): Map<String, Boolean> {
        val p = prefs(context)
        val state = LinkedHashMap<String, Boolean>()
        DEFAULT_GUARDED_APPS.forEach { app ->
            state[app.packageName] = p.getBoolean("$KEY_GUARDED_PREFIX${app.packageName}", app.defaultEnabled)
        }
        // Every app the user enabled from the dynamic "Guard any app" list also lives here.
        p.all.forEach { (key, value) ->
            if (key.startsWith(KEY_GUARDED_PREFIX) && value is Boolean) {
                val pkg = key.removePrefix(KEY_GUARDED_PREFIX)
                if (pkg.isNotBlank()) state[pkg] = value
            }
        }
        return state
    }

    fun setGuardedAppEnabled(context: Context, packageName: String, enabled: Boolean) {
        prefs(context).edit().putBoolean("$KEY_GUARDED_PREFIX$packageName", enabled).apply()
    }

    fun isPackageGuarded(context: Context, packageName: String?): Boolean {
        if (packageName.isNullOrBlank()) return false
        val p = prefs(context)
        val key = "$KEY_GUARDED_PREFIX$packageName"
        if (p.contains(key)) return p.getBoolean(key, false)
        val exact = DEFAULT_GUARDED_APPS.firstOrNull { it.packageName == packageName }
        if (exact != null) return exact.defaultEnabled
        // Match closely related variants when their corresponding Guarded App toggle is enabled
        val aliasTarget = when {
            packageName.startsWith("com.chrome.") -> "com.android.chrome"
            packageName == "com.google.android.googlequicksearchbox" -> "com.google.android.apps.bard"
            else -> null
        } ?: return false
        val spec = DEFAULT_GUARDED_APPS.firstOrNull { it.packageName == aliasTarget } ?: return false
        return p.getBoolean("$KEY_GUARDED_PREFIX${spec.packageName}", spec.defaultEnabled)
    }

    fun appDisplayNameForPackage(context: Context?, packageName: String?): String {
        if (packageName.isNullOrBlank()) return "Unknown App"
        DEFAULT_GUARDED_APPS.firstOrNull { it.packageName == packageName }?.let { return it.displayName }
        if (context != null) {
            val label = runCatching {
                val pm = context.packageManager
                pm.getApplicationLabel(pm.getApplicationInfo(packageName, 0)).toString()
            }.getOrNull()
            if (!label.isNullOrBlank()) return label
        }
        return packageName.substringAfterLast('.')
            .replaceFirstChar { it.uppercase() }
            .ifBlank { "Unknown App" }
    }

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
        actionType: String = BlockHistoryEntry.ACTION_SCRUBBED,
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
            actionType = actionType,
        )
        val existing = getHistory(context)
        val updated = (listOf(entry) + existing).take(MAX_HISTORY_ENTRIES)
        val newTotal = if (actionType == BlockHistoryEntry.ACTION_SCRUBBED) {
            getTotalBlocked(context) + activeSpans.size
        } else {
            getTotalBlocked(context)
        }
        prefs(context).edit()
            .putString(KEY_HISTORY, serializeHistory(updated))
            .putInt(KEY_TOTAL_BLOCKED, newTotal)
            .apply()
    }

    fun recordOverrideEvent(
        context: Context,
        appName: String,
        spans: List<RedactionSpan>,
        engineUsed: String,
        timestampMs: Long = System.currentTimeMillis(),
    ) {
        recordBlockEvent(
            context = context,
            appName = appName,
            spans = spans,
            engineUsed = engineUsed,
            timestampMs = timestampMs,
            actionType = BlockHistoryEntry.ACTION_OVERRIDE,
        )
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
                enc(entry.actionType),
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
                    actionType = parts.getOrNull(6)?.let { dec(it) } ?: BlockHistoryEntry.ACTION_SCRUBBED,
                )
            }
            .toList()
    }.getOrDefault(emptyList())

    fun friendlyCategoryName(category: String): String = when (category.uppercase()) {
        "API_KEY" -> "API Key"
        "AWS_ACCESS_KEY" -> "AWS Key"
        "AWS_SECRET_KEY" -> "AWS Secret Key"
        "PRIVATE_KEY", "PEM_PRIVATE_KEY" -> "Private Key"
        "BEARER_OR_JWT" -> "Bearer/JWT"
        "DB_URI", "DB_CONNECTION_URI" -> "DB URI"
        "CREDIT_CARD" -> "Card Number"
        "CARD_EXPIRY" -> "Card Expiry"
        "CVV" -> "CVV"
        "UPI_ID" -> "UPI ID"
        "PAN_ID" -> "PAN"
        "IFSC" -> "IFSC"
        "GOV_ID", "US_SSN" -> "Gov ID"
        "PHONE" -> "Phone"
        "EMAIL" -> "Email"
        "PASSWORD" -> "Password"
        "SECRET", "NATURAL_SECRET" -> "Secret"
        "M_AND_A_SECRET" -> "Deal Secret"
        "HIGH_ENTROPY", "HIGH_ENTROPY_SECRET" -> "Token"
        "IP_ADDRESS" -> "IP"
        "IBAN" -> "IBAN"
        "PERSON" -> "Name"
        "ADDRESS" -> "Address"
        "PHI", "CONTEXTUAL_PHI" -> "Health Info"
        "ORG_TERM" -> "Org Term"
        "POSTAL_CODE" -> "Postal Code"
        "ACCOUNT_NUMBER" -> "Account"
        "PERSONAL_PII_LOCATION" -> "Location"
        "POLICY_TERM", "REMOTE_POLICY" -> "Policy Term"
        else -> category.replace('_', ' ').lowercase().replaceFirstChar { it.uppercase() }
    }

    /** "1 AWS Key" / "2 AWS Keys" - the chip copy used by the modal and History. */
    fun categoryChip(category: String, count: Int): String =
        "$count ${Pluralize.of(count, friendlyCategoryName(category))}"

    /** Counts only masked spans, so a span the engine kept never inflates a "blocked" number. */
    fun categoryCounts(spans: List<RedactionSpan>): Map<String, Int> {
        val counts = LinkedHashMap<String, Int>()
        for (span in spans) {
            if (span.masked) counts[span.category] = (counts[span.category] ?: 0) + 1
        }
        return counts
    }

    /** Most frequent first, ties alphabetical. Every chip row uses this one ordering. */
    fun orderedCategories(counts: Map<String, Int>): List<Pair<String, Int>> =
        counts.entries
            .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
            .map { it.key to it.value }

    /**
     * The chip row under a History entry. When more categories were caught than fit, the last
     * chip says "+N more" so the row never contradicts the "N caught" badge beside it.
     */
    fun chipLine(counts: Map<String, Int>, limit: Int = 3): List<String> {
        val ordered = orderedCategories(counts)
        val chips = ordered.take(limit).map { (category, count) -> categoryChip(category, count) }
        val hidden = ordered.size - chips.size
        return if (hidden > 0) chips + "+$hidden more" else chips
    }
}
