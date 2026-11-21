package com.localfirst.triage.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.FlightTakeoff
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.localfirst.triage.firewall.LocalFirewallEngine
import com.localfirst.triage.model.DemoScenario
import com.localfirst.triage.model.NanoStatus
import com.localfirst.triage.model.RemoteConfigSource
import com.localfirst.triage.model.Severity
import com.localfirst.triage.ui.MainUiState
import com.localfirst.triage.ui.theme.SrePalette

@Composable
fun TriageScreen(
    state: MainUiState,
    onSelectScenario: (DemoScenario) -> Unit,
    onTitleChange: (String) -> Unit,
    onRawTextChange: (String) -> Unit,
    onAddCustomTerm: (String) -> Unit,
    onToggleOffline: () -> Unit,
    onRefreshRemoteConfig: () -> Unit,
    onRecheckNano: () -> Unit,
    onWarmupNano: () -> Unit,
    onRunTriage: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var customTermDraft by remember { mutableStateOf("") }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Offline + App Check Header Row
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                color = SrePalette.Slate900,
                border = BorderStroke(1.dp, SrePalette.Slate700),
                shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Icon(
                        imageVector = Icons.Default.Shield,
                        contentDescription = null,
                        tint = SrePalette.Indigo300,
                    )
                    Text(
                        text = state.appCheckLabel,
                        color = SrePalette.Slate300,
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace,
                    )
                }
            }

            OutlinedButton(
                onClick = onToggleOffline,
                border = BorderStroke(
                    1.dp,
                    if (state.offlineMode) SrePalette.Amber400 else SrePalette.Emerald400,
                ),
            ) {
                Icon(
                    imageVector = if (state.offlineMode) Icons.Default.FlightTakeoff else Icons.Default.Wifi,
                    contentDescription = null,
                    tint = if (state.offlineMode) SrePalette.Amber400 else SrePalette.Emerald400,
                )
                Spacer(Modifier.padding(3.dp))
                Text(
                    text = if (state.offlineMode) "Airplane: ON" else "Hybrid Cloud Allowed",
                    color = if (state.offlineMode) SrePalette.Amber400 else SrePalette.Emerald400,
                    fontSize = 12.sp,
                )
            }
        }

        // AICore Gemini Nano 4 Status Banner
        val bannerBg = when (state.nanoStatus) {
            NanoStatus.READY -> SrePalette.Emerald950
            NanoStatus.DOWNLOADABLE, NanoStatus.MODEL_DOWNLOADING -> SrePalette.Cyan950
            NanoStatus.UNAVAILABLE -> SrePalette.Amber950
        }
        val bannerBorder = when (state.nanoStatus) {
            NanoStatus.READY -> SrePalette.Emerald400
            NanoStatus.DOWNLOADABLE, NanoStatus.MODEL_DOWNLOADING -> SrePalette.Cyan400
            NanoStatus.UNAVAILABLE -> SrePalette.Amber400
        }
        Card(
            colors = CardDefaults.cardColors(containerColor = bannerBg),
            border = BorderStroke(1.dp, bannerBorder.copy(alpha = 0.5f)),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = when (state.nanoStatus) {
                            NanoStatus.READY -> "AICore Gemini Nano 4 READY (ONLY_ON_DEVICE Active)"
                            NanoStatus.DOWNLOADABLE -> "Gemini Nano 4 DOWNLOADABLE via AICore"
                            NanoStatus.MODEL_DOWNLOADING -> "Downloading Gemini Nano 4 Weights..."
                            NanoStatus.UNAVAILABLE -> "Nano 4 Unavailable — Fail-Closed Local Firewall Active"
                        },
                        color = bannerBorder,
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.sp,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = onRecheckNano) {
                        Text("Re-check", fontSize = 11.sp, color = bannerBorder)
                    }
                }
                if (state.nanoStatus == NanoStatus.DOWNLOADABLE || state.nanoStatus == NanoStatus.MODEL_DOWNLOADING) {
                    if (state.downloadProgress != null) {
                        LinearProgressIndicator(
                            progress = { (state.downloadProgress.coerceIn(0, 100)) / 100f },
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 6.dp),
                        )
                    }
                    Button(
                        onClick = onWarmupNano,
                        colors = ButtonDefaults.buttonColors(containerColor = SrePalette.Cyan400),
                    ) {
                        Icon(Icons.Default.Download, contentDescription = null, tint = SrePalette.Slate950)
                        Spacer(Modifier.padding(4.dp))
                        Text(
                            text = if (state.downloadProgress != null) "Downloading (${state.downloadProgress}%)" else "Download & Warm Up Nano 4",
                            color = SrePalette.Slate950,
                            fontWeight = FontWeight.Bold,
                            fontSize = 12.sp,
                        )
                    }
                } else if (state.nanoStatus == NanoStatus.UNAVAILABLE) {
                    Text(
                        text = "9 Regex rules + Shannon Entropy (>=${"%.2f".format(state.runtimeConfig.entropyThreshold)}) + Heuristic Guard protect payloads with Fail-Closed Quarantine.",
                        color = SrePalette.Slate300,
                        fontSize = 11.sp,
                    )
                }
            }
        }

        // Live Remote Config Provenance Pill + Refresh Button
        Card(
            colors = CardDefaults.cardColors(containerColor = SrePalette.Slate900),
            border = BorderStroke(1.dp, SrePalette.Slate800),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    val rcSource =
                        if (state.runtimeConfig.source == RemoteConfigSource.DEFAULT_FALLBACK) "DEFAULT"
                        else state.runtimeConfig.source.name
                    Text(
                        text = "Remote Config: $rcSource · entropy>=${"%.2f".format(state.runtimeConfig.entropyThreshold)} · +${state.runtimeConfig.enterpriseBlockedTerms.size} org terms",
                        color = SrePalette.Indigo300,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                    )
                    Text(
                        text = "Model: ${state.runtimeConfig.cloudModel} -> fallback ${state.runtimeConfig.cloudFallbackModel}",
                        color = SrePalette.Slate400,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 10.sp,
                    )
                }
                OutlinedButton(
                    onClick = onRefreshRemoteConfig,
                    enabled = !state.isRefreshingPolicy,
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = null, tint = SrePalette.Indigo300)
                    Spacer(Modifier.padding(2.dp))
                    Text(
                        text = if (state.isRefreshingPolicy) "Syncing..." else "Refresh Policy",
                        fontSize = 11.sp,
                    )
                }
            }
        }

        // 1-Click Demo Scenarios (P0 - P3)
        Text(
            text = "1-CLICK DEMO SCENARIOS (P0-P3)",
            color = SrePalette.Slate400,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
        )
        LocalFirewallEngine.DEMO_SCENARIOS.forEach { scenario ->
            val sevColor = when (scenario.expectedSeverity) {
                Severity.P0 -> SrePalette.Rose400
                Severity.P1 -> SrePalette.Amber400
                Severity.P2 -> SrePalette.Cyan400
                Severity.P3 -> SrePalette.Emerald400
            }
            Card(
                colors = CardDefaults.cardColors(containerColor = SrePalette.Slate900),
                border = BorderStroke(1.dp, SrePalette.Slate800),
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onSelectScenario(scenario) },
            ) {
                Column(modifier = Modifier.padding(10.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(
                            text = scenario.title,
                            color = Color.White,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 12.sp,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            text = scenario.expectedSeverity.name,
                            color = sevColor,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                            fontSize = 11.sp,
                        )
                    }
                    Text(
                        text = scenario.subtitle,
                        color = SrePalette.Slate400,
                        fontSize = 11.sp,
                    )
                }
            }
        }

        // Custom Workspace Privacy Policy Term Quick-Add
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = customTermDraft,
                onValueChange = { customTermDraft = it },
                label = { Text("Add Policy Term (e.g. Project-Titan)", fontSize = 11.sp) },
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
            OutlinedButton(
                onClick = {
                    onAddCustomTerm(customTermDraft)
                    customTermDraft = ""
                },
            ) {
                Text("Block", fontSize = 12.sp)
            }
        }

        // RAM-only Incident Input
        OutlinedTextField(
            value = state.titleInput,
            onValueChange = onTitleChange,
            label = { Text("Incident Title", fontSize = 12.sp) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedTextField(
            value = state.rawTextInput,
            onValueChange = onRawTextChange,
            label = { Text("Raw Support / SRE Payload (RAM-only, never persisted raw)", fontSize = 12.sp) },
            minLines = 5,
            maxLines = 9,
            modifier = Modifier.fillMaxWidth(),
        )

        Button(
            onClick = onRunTriage,
            enabled = !state.isRunning && state.rawTextInput.isNotBlank(),
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp),
            colors = ButtonDefaults.buttonColors(containerColor = SrePalette.Indigo500),
        ) {
            Icon(Icons.Default.PlayArrow, contentDescription = null)
            Spacer(Modifier.padding(4.dp))
            Text(
                text = if (state.isRunning) "Running Local Privacy Firewall..." else "Run Hybrid Triage",
                fontWeight = FontWeight.Bold,
            )
        }

        if (state.cloudSyncMessage != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Default.Cloud, contentDescription = null, tint = SrePalette.Cyan400)
                Text(state.cloudSyncMessage, color = SrePalette.Cyan400, fontSize = 11.sp)
            }
        }
    }
}
