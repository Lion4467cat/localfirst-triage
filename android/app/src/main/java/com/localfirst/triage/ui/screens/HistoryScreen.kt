package com.localfirst.triage.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.localfirst.triage.data.BlockHistoryEntry
import com.localfirst.triage.data.Pluralize
import com.localfirst.triage.data.ShieldStore
import com.localfirst.triage.ui.theme.LocalFirstThemeTokens
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private enum class HistoryFilter(val label: String) {
    ALL("All"),
    SCRUBBED("Scrubbed"),
    OVERRIDES("Overrides"),
}

@Composable
fun HistoryScreen(
    entries: List<BlockHistoryEntry>,
    onClearHistory: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalFirstThemeTokens.colors
    val formatter = remember { SimpleDateFormat("MMM d, HH:mm", Locale.getDefault()) }
    var filter by remember { mutableStateOf(HistoryFilter.ALL) }
    var showClearDialog by remember { mutableStateOf(false) }

    val scrubbedSecrets = entries
        .filter { it.actionType == BlockHistoryEntry.ACTION_SCRUBBED }
        .sumOf { it.totalBlocked }
    val overrideCount = entries.count { it.actionType == BlockHistoryEntry.ACTION_OVERRIDE }
    val visible = when (filter) {
        HistoryFilter.ALL -> entries
        HistoryFilter.SCRUBBED -> entries.filter { it.actionType == BlockHistoryEntry.ACTION_SCRUBBED }
        HistoryFilter.OVERRIDES -> entries.filter { it.actionType == BlockHistoryEntry.ACTION_OVERRIDE }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "History",
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = "Zero-PII audit log · metadata only",
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            OutlinedButton(
                onClick = { showClearDialog = true },
                enabled = entries.isNotEmpty(),
                contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                border = BorderStroke(1.dp, tokens.borderSubtle),
                modifier = Modifier.height(34.dp),
            ) {
                Icon(
                    Icons.Default.DeleteOutline,
                    contentDescription = null,
                    tint = tokens.textMuted,
                    modifier = Modifier.size(14.dp),
                )
                Text(
                    text = "Clear",
                    fontSize = 11.5.sp,
                    color = tokens.textMuted,
                    modifier = Modifier.padding(start = 4.dp),
                )
            }
        }

        Surface(
            color = tokens.subtleSurface,
            border = BorderStroke(1.dp, tokens.borderSubtle),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                modifier = Modifier.padding(vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                SummaryStat(
                    value = scrubbedSecrets.toString(),
                    label = "Total Scrubbed",
                    valueColor = tokens.safeText,
                    modifier = Modifier.weight(1f),
                )
                SummaryDivider()
                SummaryStat(
                    value = overrideCount.toString(),
                    label = "Overrides",
                    valueColor = if (overrideCount > 0) tokens.warnText else MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f),
                )
                SummaryDivider()
                SummaryStat(
                    value = "0",
                    label = "Raw PII Stored",
                    valueColor = tokens.safeText,
                    modifier = Modifier.weight(1f),
                )
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HistoryFilter.entries.forEach { option ->
                FilterChip(
                    selected = filter == option,
                    onClick = { filter = option },
                    label = { Text(option.label, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = tokens.safeBg,
                        selectedLabelColor = tokens.safeText,
                    ),
                )
            }
        }

        if (entries.isEmpty()) {
            EmptyHistoryCard()
        } else if (visible.isEmpty()) {
            Surface(
                color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, tokens.borderSubtle),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text = if (filter == HistoryFilter.OVERRIDES) {
                        "No unsafe overrides. Every secret was scrubbed."
                    } else {
                        "Nothing scrubbed yet."
                    },
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(18.dp),
                )
            }
        } else {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                items(visible, key = { it.id }) { entry ->
                    HistoryRow(
                        entry = entry,
                        timestamp = formatter.format(Date(entry.timestampMs)),
                    )
                }
            }
        }
    }

    if (showClearDialog) {
        AlertDialog(
            onDismissRequest = { showClearDialog = false },
            title = { Text("Clear history?") },
            text = {
                Text(
                    "This removes ${entries.size} metadata-only " +
                        Pluralize.of(entries.size, "entry") +
                        ". Raw text was never stored, so nothing sensitive is kept.",
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showClearDialog = false
                        onClearHistory()
                    },
                ) {
                    Text("Clear", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showClearDialog = false }) { Text("Cancel") }
            },
        )
    }
}

@Composable
private fun SummaryStat(
    value: String,
    label: String,
    valueColor: androidx.compose.ui.graphics.Color,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(1.dp),
    ) {
        Text(text = value, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = valueColor)
        Text(
            text = label,
            fontSize = 9.5.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
        )
    }
}

@Composable
private fun SummaryDivider() {
    val tokens = LocalFirstThemeTokens.colors
    Box(
        modifier = Modifier
            .width(1.dp)
            .height(26.dp),
    ) {
        Surface(color = tokens.borderSubtle, modifier = Modifier.fillMaxSize()) {}
    }
}

@Composable
private fun EmptyHistoryCard() {
    val tokens = LocalFirstThemeTokens.colors
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, tokens.borderSubtle),
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(
                imageVector = Icons.Default.History,
                contentDescription = null,
                tint = tokens.safeText,
                modifier = Modifier.size(24.dp),
            )
            Text(
                text = "No Events Yet",
                fontWeight = FontWeight.Bold,
                fontSize = 14.sp,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = "Events appear automatically when secrets are scrubbed or released. Raw secrets are never stored.",
                fontSize = 11.5.sp,
                lineHeight = 16.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun HistoryRow(entry: BlockHistoryEntry, timestamp: String) {
    val tokens = LocalFirstThemeTokens.colors
    val isOverride = entry.actionType == BlockHistoryEntry.ACTION_OVERRIDE
    val accent = if (isOverride) tokens.warnText else tokens.safeText

    Surface(
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, if (isOverride) tokens.warnBorder else tokens.borderSubtle),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier
                        .size(7.dp)
                        .background(accent, CircleShape),
                )
                Icon(
                    imageVector = Icons.Default.Shield,
                    contentDescription = null,
                    tint = accent,
                    modifier = Modifier
                        .padding(start = 6.dp)
                        .size(14.dp),
                )
                Text(
                    text = entry.appName,
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.5.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    modifier = Modifier.padding(start = 5.dp),
                )
                Text(
                    text = timestamp,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 10.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 6.dp),
                )
                Spacer(Modifier.weight(1f))
                Surface(
                    color = if (isOverride) tokens.warnBg else tokens.safeBg,
                    border = BorderStroke(1.dp, if (isOverride) tokens.warnBorder else tokens.safeBorder),
                    shape = RoundedCornerShape(50),
                ) {
                    Text(
                        text = "${entry.totalBlocked} caught",
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 9.5.sp,
                        color = accent,
                        modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                    )
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = findingsLine(entry),
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = accent,
                    maxLines = 1,
                    modifier = Modifier.weight(1f),
                )
                if (entry.engineUsed.contains("Nano", ignoreCase = true)) {
                    Surface(
                        color = tokens.infoBg,
                        border = BorderStroke(1.dp, tokens.infoBorder),
                        shape = RoundedCornerShape(50),
                        modifier = Modifier.padding(start = 6.dp),
                    ) {
                        Text(
                            text = "Nano",
                            fontSize = 9.sp,
                            fontWeight = FontWeight.Bold,
                            color = tokens.infoText,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 1.dp),
                        )
                    }
                }
            }
        }
    }
}

/** "2 AWS Keys · 1 Email" - pluralised, never a raw value. */
private fun findingsLine(entry: BlockHistoryEntry): String {
    if (entry.categoryCounts.isEmpty()) {
        return Pluralize.of(entry.totalBlocked, "Secret")
    }
    return entry.categoryCounts.entries
        .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
        .take(3)
        .joinToString(" · ") { (category, count) -> ShieldStore.categoryChip(category, count) }
}
