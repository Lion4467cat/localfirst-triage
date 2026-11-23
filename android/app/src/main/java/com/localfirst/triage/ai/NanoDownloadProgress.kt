package com.localfirst.triage.ai

import java.util.Locale

/**
 * Live AICore download telemetry. The SDK reports byte counts, so everything the card shows —
 * percentage, size, speed and ETA — is derived from those numbers rather than a timer.
 */
data class NanoDownloadState(
    val modelName: String? = null,
    val bytesDownloaded: Long = 0L,
    val totalBytes: Long = 0L,
    val bytesPerSecond: Long = 0L,
    val etaSeconds: Long? = null,
    val stalled: Boolean = false,
    val failed: Boolean = false,
    val completed: Boolean = false,
) {
    val percent: Int
        get() = when {
            completed -> 100
            totalBytes <= 0L -> 0
            else -> ((bytesDownloaded.coerceAtLeast(0L) * 100L) / totalBytes).toInt().coerceIn(0, 100)
        }

    val sizeLabel: String
        get() = if (totalBytes <= 0L) {
            formatBytes(bytesDownloaded)
        } else {
            "${formatBytes(bytesDownloaded)} / ${formatBytes(totalBytes)}"
        }

    val detailLabel: String
        get() = when {
            failed -> "Download failed — tap Retry to resume"
            stalled -> "Waiting for unmetered Wi-Fi / AICore…"
            completed -> "Ready"
            bytesPerSecond <= 0L -> sizeLabel
            etaSeconds == null -> "$sizeLabel · ${formatSpeed(bytesPerSecond)}"
            else -> "$sizeLabel · ${formatSpeed(bytesPerSecond)} · ~${formatDuration(etaSeconds)} left"
        }
}

fun formatBytes(bytes: Long): String = when {
    bytes <= 0L -> "0 MB"
    bytes >= 1_000_000_000L -> String.format(Locale.US, "%.2f GB", bytes / 1_000_000_000.0)
    bytes >= 1_000_000L -> String.format(Locale.US, "%.0f MB", bytes / 1_000_000.0)
    else -> String.format(Locale.US, "%.0f KB", bytes / 1_000.0)
}

fun formatSpeed(bytesPerSecond: Long): String = when {
    bytesPerSecond <= 0L -> "0 MB/s"
    bytesPerSecond >= 1_000_000L -> String.format(Locale.US, "%.1f MB/s", bytesPerSecond / 1_000_000.0)
    else -> String.format(Locale.US, "%.0f KB/s", bytesPerSecond / 1_000.0)
}

fun formatDuration(seconds: Long): String {
    if (seconds <= 0L) return "0s"
    val minutes = seconds / 60
    val remainder = seconds % 60
    return when {
        minutes >= 60 -> "${minutes / 60}h ${minutes % 60}m"
        minutes > 0 -> "${minutes}m ${remainder}s"
        else -> "${remainder}s"
    }
}

/**
 * Sliding-window transfer rate. AICore emits bursts, so a per-emission delta reads as 0 or 80 MB/s;
 * averaging over the last few seconds is what makes the number look like a real download.
 */
class TransferRateMeter(private val windowMs: Long = 4_000L) {
    private val samples = ArrayDeque<Pair<Long, Long>>()

    fun sample(nowMs: Long, bytes: Long): Long {
        samples.addLast(nowMs to bytes)
        while (samples.size > 2 && nowMs - samples.first().first > windowMs) samples.removeFirst()
        val (startedAt, startedBytes) = samples.first()
        val elapsed = nowMs - startedAt
        if (elapsed <= 0L) return 0L
        return (((bytes - startedBytes) * 1000L) / elapsed).coerceAtLeast(0L)
    }
}
