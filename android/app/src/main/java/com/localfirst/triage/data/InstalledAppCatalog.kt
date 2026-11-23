package com.localfirst.triage.data

import android.content.Context
import android.content.Intent
import android.content.pm.ResolveInfo
import com.localfirst.triage.accessibility.GuardExclusions

/** One launchable app on this phone, as shown in the "Guard any app" list. */
data class InstalledApp(
    val packageName: String,
    val label: String,
)

/**
 * Discovers every launchable app so the shield is not limited to a hardcoded list.
 *
 * Loading is deliberately separated from ordering/filtering: the PackageManager query must run
 * off the main thread, while ordering and search are pure and unit-testable.
 */
object InstalledAppCatalog {
    /** AI / chat / browser apps pinned to the top of the list when they are installed. */
    val PINNED_PACKAGES = listOf(
        "com.openai.chatgpt",
        "com.anthropic.claude",
        "com.google.android.apps.bard",
        "com.whatsapp",
        "com.android.chrome",
        "com.Slack",
        "com.discord",
        "org.telegram.messenger",
        "org.mozilla.firefox",
        "com.brave.browser",
    )

    /** Apps that must never be offered: Cordon itself and the system surfaces we never lock. */
    private val NEVER_GUARDED = GuardExclusions.EXACT_PACKAGES

    fun isPinned(packageName: String): Boolean = packageName in PINNED_PACKAGES

    fun order(apps: List<InstalledApp>): List<InstalledApp> {
        val rank = PINNED_PACKAGES.withIndex().associate { (index, pkg) -> pkg to index }
        return apps.sortedWith(
            compareBy<InstalledApp> { rank[it.packageName] ?: Int.MAX_VALUE }
                .thenBy { it.label.lowercase() }
                .thenBy { it.packageName },
        )
    }

    fun filter(apps: List<InstalledApp>, query: String): List<InstalledApp> {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) return order(apps)
        val needle = trimmed.lowercase()
        return order(
            apps.filter {
                it.label.lowercase().contains(needle) || it.packageName.lowercase().contains(needle)
            },
        )
    }

    /** Blocking; call from a background dispatcher. */
    fun load(context: Context): List<InstalledApp> {
        val pm = context.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val resolved: List<ResolveInfo> = runCatching { pm.queryIntentActivities(intent, 0) }
            .getOrDefault(emptyList())
        val apps = LinkedHashMap<String, InstalledApp>()
        for (info in resolved) {
            val pkg = info.activityInfo?.packageName?.takeIf { it.isNotBlank() } ?: continue
            if (pkg in NEVER_GUARDED) continue
            if (apps.containsKey(pkg)) continue
            val label = runCatching { info.loadLabel(pm).toString() }
                .getOrNull()
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
                ?: pkg.substringAfterLast('.').replaceFirstChar { it.uppercase() }
            apps[pkg] = InstalledApp(pkg, label)
        }
        return order(apps.values.toList())
    }
}
