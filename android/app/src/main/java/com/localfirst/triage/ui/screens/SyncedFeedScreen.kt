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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.localfirst.triage.model.CloudSyncStatus
import com.localfirst.triage.model.SourcePlatform
import com.localfirst.triage.model.TriageResult
import com.localfirst.triage.ui.MainUiState
import com.localfirst.triage.ui.theme.SrePalette

@Composable
private fun PlatformBadge(platform: SourcePlatform) {
    val (label, color) = when (platform) {
        SourcePlatform.ANDROID -> "ANDROID" to SrePalette.Emerald400
        SourcePlatform.CHROME_EXTENSION -> "EXT" to SrePalette.Cyan400
        SourcePlatform.WEB -> "WEB" to SrePalette.Indigo300
    }
    Surface(
        color = color.copy(alpha = 0.14f),
        border = BorderStroke(1.dp, color.copy(alpha = 0.5f)),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(6.dp),
    ) {
        Text(
            text = label,
            color = color,
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
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Cloud Sync & Auth Card
        Card(
            colors = CardDefaults.cardColors(containerColor = SrePalette.Slate900),
            border = BorderStroke(1.dp, SrePalette.Slate800),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(
                        imageVector = if (state.authUser != null) Icons.Default.CloudDone else Icons.Default.CloudOff,
                        contentDescription = null,
                        tint = if (state.authUser != null) SrePalette.Emerald400 else SrePalette.Slate400,
                    )
                    Text(
                        text = when {
                            state.authUser == null -> "Cloud Sync: Local RAM Only"
                            state.cloudSyncStatus == CloudSyncStatus.OFFLINE -> "Synced Account (Offline Mode)"
                            else -> "Cloud Sync Active (${state.authUser.email ?: state.authUser.displayName ?: "Guest ${state.authUser.uid.take(6)}"})"
                        },
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp,
                    )
                }

                if (state.cloudSyncMessage != null) {
                    Text(state.cloudSyncMessage, color = SrePalette.Cyan400, fontSize = 11.sp)
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (state.authUser == null) {
                        OutlinedButton(
                            onClick = onSignInAnonymous,
                            enabled = !state.offlineMode && state.cloudSyncStatus != CloudSyncStatus.SIGNING_IN,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text("Enable Sync (Guest)", fontSize = 11.sp)
                        }
                        Button(
                            onClick = onSignInGoogle,
                            enabled = !state.offlineMode && state.cloudSyncStatus != CloudSyncStatus.SIGNING_IN,
                            colors = ButtonDefaults.buttonColors(containerColor = SrePalette.Indigo500),
                            modifier = Modifier.weight(1f),
                        ) {
                            Text("Google Sign-In", fontSize = 11.sp)
                        }
                    } else {
                        if (state.authUser.isAnonymous) {
                            Button(
                                onClick = onSignInGoogle,
                                enabled = !state.offlineMode,
                                colors = ButtonDefaults.buttonColors(containerColor = SrePalette.Indigo500),
                                modifier = Modifier.weight(1f),
                            ) {
                                Text("Link Google Account", fontSize = 11.sp)
                            }
                        }
                        OutlinedButton(
                            onClick = onSignOut,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text("Sign Out", fontSize = 11.sp)
                        }
                    }
                }
            }
        }

        // PREFER_ON_DEVICE Hybrid Stakeholder Brief Card
        val activeTicket = state.currentResult
        Card(
            colors = CardDefaults.cardColors(containerColor = SrePalette.Slate900),
            border = BorderStroke(1.dp, SrePalette.Cyan400.copy(alpha = 0.4f)),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "HYBRID STAKEHOLDER BRIEF (InferenceMode.PREFER_ON_DEVICE)",
                    color = SrePalette.Cyan400,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                )
                Button(
                    onClick = onGenerateBrief,
                    enabled = activeTicket != null && !state.isGeneratingBrief,
                    colors = ButtonDefaults.buttonColors(containerColor = SrePalette.Cyan400),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Default.AutoAwesome, contentDescription = null, tint = SrePalette.Slate950)
                    Spacer(Modifier.padding(3.dp))
                    Text(
                        text = if (state.isGeneratingBrief) "Generating Brief..." else "Generate Hybrid Stakeholder Brief",
                        color = SrePalette.Slate950,
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.sp,
                    )
                }

                val brief = activeTicket?.hybridBrief
                if (brief != null) {
                    Text(
                        text = "Source: ${brief.inferenceSource} · ${brief.latencyMs}ms",
                        color = SrePalette.Emerald400,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 11.sp,
                    )
                    Text(
                        text = brief.stakeholderDraft,
                        color = SrePalette.Slate300,
                        fontSize = 12.sp,
                    )
                }
            }
        }

        // Cross-Platform Synced Sanitized Ticket Feed
        Text(
            text = "CROSS-PLATFORM SANITIZED FEED (${state.syncedTickets.size} ZERO-PII TICKETS)",
            color = SrePalette.Slate400,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
        )

        if (state.syncedTickets.isEmpty()) {
            Text(
                text = "No tickets yet. Run Hybrid Triage or sign in with Google/Guest to live-sync sanitized tickets across Web, Chrome Extension, and Android.",
                color = SrePalette.Slate400,
                fontSize = 12.sp,
            )
        } else {
            state.syncedTickets.forEach { item ->
                Card(
                    colors = CardDefaults.cardColors(containerColor = SrePalette.Slate900),
                    border = BorderStroke(1.dp, SrePalette.Slate800),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onOpenTicket(item) },
                ) {
                    Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = item.title,
                                color = Color.White,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 13.sp,
                                modifier = Modifier.weight(1f),
                            )
                            PlatformBadge(item.sourcePlatform)
                        }
                        Text(
                            text = "${item.severity.name} · ${item.inferenceSource.name} · ${item.resolutionMode.name}",
                            color = SrePalette.Emerald400,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 10.sp,
                        )
                        Text(
                            text = item.sanitizedText.take(140),
                            color = SrePalette.Slate300,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.sp,
                        )
                    }
                }
            }
        }
    }
}
