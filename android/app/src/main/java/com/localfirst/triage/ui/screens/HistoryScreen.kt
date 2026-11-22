package com.localfirst.triage.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.localfirst.triage.data.BlockHistoryEntry
import com.localfirst.triage.ui.theme.LocalFirstThemeTokens
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun HistoryScreen(
    entries: List<BlockHistoryEntry>,
    onClearHistory: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalFirstThemeTokens.colors
    val formatter = remember { SimpleDateFormat("MMM d, HH:mm", Locale.getDefault()) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text(
                    text = "History",
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = "Zero-PII · metadata only",
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            OutlinedButton(
                onClick = onClearHistory,
                enabled = entries.isNotEmpty(),
                contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
            ) {
                Icon(Icons.Default.DeleteOutline, contentDescription = null, modifier = Modifier.size(14.dp))
                Text(
                    text = "Clear History",
                    fontSize = 11.5.sp,
                    modifier = Modifier.padding(start = 4.dp),
                )
            }
        }

        if (entries.isEmpty()) {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.dp, tokens.borderSubtle),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
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
                        text = "Events appear automatically when secrets are scrubbed or held. Raw secrets are never stored.",
                        fontSize = 11.5.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        } else {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                items(entries, key = { it.id }) { entry ->
                    val isOverride = entry.actionType == BlockHistoryEntry.ACTION_OVERRIDE
                    Card(
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        border = BorderStroke(1.dp, if (isOverride) tokens.warnBorder else tokens.borderSubtle),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(
                            modifier = Modifier.padding(10.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.VerifiedUser,
                                        contentDescription = null,
                                        tint = if (isOverride) tokens.warnText else tokens.safeText,
                                        modifier = Modifier.size(14.dp),
                                    )
                                    Text(
                                        text = entry.appName,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 13.5.sp,
                                        color = MaterialTheme.colorScheme.onSurface,
                                    )
                                    Text(
                                        text = formatter.format(Date(entry.timestampMs)),
                                        fontFamily = FontFamily.Monospace,
                                        fontSize = 10.5.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Surface(
                                    color = if (isOverride) tokens.warnBg else tokens.safeBg,
                                    border = BorderStroke(1.dp, if (isOverride) tokens.warnBorder else tokens.safeBorder),
                                    shape = RoundedCornerShape(5.dp),
                                ) {
                                    Text(
                                        text = "${entry.totalBlocked} caught",
                                        fontFamily = FontFamily.Monospace,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 9.5.sp,
                                        color = if (isOverride) tokens.warnText else tokens.safeText,
                                        modifier = Modifier.padding(horizontal = 5.dp, vertical = 1.dp),
                                    )
                                }
                            }

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    text = entry.formatSummary(),
                                    fontSize = 11.5.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = if (isOverride) tokens.warnText else tokens.safeText,
                                    modifier = Modifier.weight(1f),
                                )
                                Surface(
                                    color = tokens.subtleSurface,
                                    border = BorderStroke(1.dp, tokens.borderSubtle),
                                    shape = RoundedCornerShape(5.dp),
                                ) {
                                    Text(
                                        text = entry.engineUsed,
                                        fontSize = 9.5.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.padding(horizontal = 5.dp, vertical = 1.dp),
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
