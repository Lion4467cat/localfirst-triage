package com.localfirst.triage.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.localfirst.triage.model.CloudSyncStatus
import com.localfirst.triage.model.SourcePlatform
import com.localfirst.triage.model.TriageResult
import com.localfirst.triage.ui.MainUiState
import com.localfirst.triage.ui.theme.LocalFirstThemeTokens

@Composable
private fun PlatformBadge(platform: SourcePlatform) {
    val tokens = LocalFirstThemeTokens.colors
    val (label, bg, border, text) = when (platform) {
        SourcePlatform.ANDROID -> listOf("ANDROID", tokens.safeBg, tokens.safeBorder, tokens.safeText)
        SourcePlatform.CHROME_EXTENSION -> listOf("EXTENSION", tokens.infoBg, tokens.infoBorder, tokens.infoText)
        SourcePlatform.WEB -> listOf("WEB", tokens.accentSoftBg, tokens.accentSoftBorder, tokens.accentSoftText)
    }
    Surface(
        color = bg as androidx.compose.ui.graphics.Color,
        border = BorderStroke(1.dp, border as androidx.compose.ui.graphics.Color),
        shape = RoundedCornerShape(6.dp),
    ) {
        Text(
            text = label as String,
            color = text as androidx.compose.ui.graphics.Color,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Bold,
            fontSize = 10.sp,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}

@Composable
fun SyncedFeedScreen(
    state: MainUiState,
    onSignInAnonymous: () -> Unit,
    onSignInGoogle: () -> Unit,
    onSignOut: () -> Unit,
    onGenerateBrief: () -> Unit,
    onOpenTicket: (TriageResult) -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalFirstThemeTokens.colors

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Cloud Sync & Auth Card
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            border = BorderStroke(1.dp, tokens.borderSubtle),
        ) {
            Column(modifier = Modifier.padding(14.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = if (state.authUser != null) Icons.Default.CloudDone else Icons.Default.CloudOff,
                            contentDescription = null,
                            tint = if (state.authUser != null) tokens.safeText else tokens.textMuted,
                            modifier = Modifier.padding(end = 8.dp),
                        )
                        Text(
                            text = "Cloud Sync (Safe Summaries)",
                            color = MaterialTheme.colorScheme.onSurface,
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp,
                        )
                    }
                    Surface(
                        color = if (state.cloudSyncStatus == CloudSyncStatus.SYNCED) tokens.safeBg else tokens.subtleSurface,
                        border = BorderStroke(
                            1.dp,
                            if (state.cloudSyncStatus == CloudSyncStatus.SYNCED) tokens.safeBorder else tokens.borderSubtle,
                        ),
                        shape = RoundedCornerShape(999.dp),
                    ) {
                        Text(
                            text = when (state.cloudSyncStatus) {
                                CloudSyncStatus.SYNCED -> "Connected"
                                CloudSyncStatus.SIGNING_IN -> "Signing in..."
                                CloudSyncStatus.OFFLINE -> "Offline"
                                CloudSyncStatus.ERROR -> "Sync Error"
                                CloudSyncStatus.DISCONNECTED -> "Not Signed In"
                            },
                            color = if (state.cloudSyncStatus == CloudSyncStatus.SYNCED) tokens.safeText else MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                        )
                    }
                }

                if (state.cloudSyncMessage != null) {
                    Text(
                        text = state.cloudSyncMessage,
                        color = tokens.warnText,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }

                Spacer(modifier = Modifier.padding(top = 8.dp))

                if (state.authUser == null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = onSignInAnonymous,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.primary,
                                contentColor = MaterialTheme.colorScheme.onPrimary,
                            ),
                        ) {
                            Text("Sync as Guest", fontSize = 12.sp)
                        }
                        OutlinedButton(onClick = onSignInGoogle) {
                            Text("Sign In with Google", fontSize = 12.sp)
                        }
                    }
                } else {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = if (state.authUser.isAnonymous) {
                                "Guest Workspace (${state.authUser.uid.take(8)}...)"
                            } else {
                                state.authUser.email ?: state.authUser.displayName ?: "Signed-in Workspace"
                            },
                            color = tokens.safeText,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium,
                        )
                        OutlinedButton(onClick = onSignOut) {
                            Text("Sign Out", fontSize = 12.sp)
                        }
                    }
                }
            }
        }

        // Leadership & Team Update Card
        if (state.currentResult != null) {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.dp, tokens.borderSubtle),
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                Icons.Default.AutoAwesome,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.padding(end = 6.dp),
                            )
                            Text(
                                text = "Leadership & Team Update",
                                color = MaterialTheme.colorScheme.onSurface,
                                fontWeight = FontWeight.Bold,
                                fontSize = 14.sp,
                            )
                        }
                        Button(
                            onClick = onGenerateBrief,
                            enabled = !state.isGeneratingBrief,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.primary,
                                contentColor = MaterialTheme.colorScheme.onPrimary,
                            ),
                        ) {
                            Text(
                                text = if (state.isGeneratingBrief) "Writing..." else "Draft Update",
                                fontSize = 12.sp,
                            )
                        }
                    }
                    val brief = state.currentResult.hybridBrief
                    if (brief != null) {
                        Spacer(modifier = Modifier.padding(top = 8.dp))
                        Text(
                            text = "${brief.inferenceSource} · ${brief.latencyMs}ms",
                            color = tokens.safeText,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.sp,
                        )
                        Text(
                            text = brief.summary,
                            color = MaterialTheme.colorScheme.onSurface,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                        Text(
                            text = brief.stakeholderDraft,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(top = 6.dp),
                        )
                    }
                }
            }
        }

        Text(
            text = "Synced Workspace Tickets (${state.syncedTickets.size})",
            color = MaterialTheme.colorScheme.onBackground,
            fontWeight = FontWeight.Bold,
            fontSize = 14.sp,
        )

        if (state.syncedTickets.isEmpty()) {
            Card(
                colors = CardDefaults.cardColors(containerColor = tokens.subtleSurface),
                border = BorderStroke(1.dp, tokens.borderSubtle),
            ) {
                Text(
                    text = "Sign in as Guest or Google above and tap Sync on any redacted ticket to view shared Zero-PII reports across devices.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(14.dp),
                )
            }
        } else {
            state.syncedTickets.forEach { item ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onOpenTicket(item) },
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    border = BorderStroke(1.dp, tokens.borderSubtle),
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = item.title,
                                color = MaterialTheme.colorScheme.onSurface,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 13.sp,
                                modifier = Modifier.weight(1f),
                            )
                            PlatformBadge(item.sourcePlatform)
                        }
                        Text(
                            text = "${item.severity} · ${item.resolutionMode} · Zero-PII Stored",
                            color = tokens.safeText,
                            fontSize = 11.sp,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                        Text(
                            text = item.sanitizedText.take(140),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.sp,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                }
            }
        }
    }
}
