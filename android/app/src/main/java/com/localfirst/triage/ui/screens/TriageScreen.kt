package com.localfirst.triage.ui.screens

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
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
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.localfirst.triage.firewall.LocalFirewallEngine
import com.localfirst.triage.model.DemoScenario
import com.localfirst.triage.model.NanoStatus
import com.localfirst.triage.model.ProtectionLevel
import com.localfirst.triage.model.RemoteConfigSource
import com.localfirst.triage.model.Severity
import com.localfirst.triage.ui.MainUiState
import com.localfirst.triage.ui.theme.LocalFirstThemeTokens

private fun friendlyScenarioTitle(scenario: DemoScenario): String = when (scenario.id) {
    "scenario-p0-semantic-leak" -> "Hospital Checkout Alert"
    "scenario-p3-local-runbook" -> "Expired Local Certificate"
    "scenario-p1-billing-webhook" -> "Payment Webhook Outage"
    "scenario-p2-offline-oauth" -> "Warehouse Kiosk Login Error"
    else -> scenario.title
}

private fun friendlyScenarioSubtitle(scenario: DemoScenario): String = when (scenario.id) {
    "scenario-p0-semantic-leak" -> "Hides patient info, password clue & API key"
    "scenario-p3-local-runbook" -> "Instant fix on your device ($0 cloud)"
    "scenario-p1-billing-webhook" -> "Hides card, SSN, private key & AWS/Stripe keys"
    "scenario-p2-offline-oauth" -> "Offline clock-sync fix without cloud AI"
    else -> scenario.subtitle
}

@Composable
fun TriageScreen(
    state: MainUiState,
    onSelectScenario: (DemoScenario) -> Unit,
    onTitleChange: (String) -> Unit,
    onRawTextChange: (String) -> Unit,
    onSelectProtectionLevel: (ProtectionLevel) -> Unit = {},
    onAddCustomTerm: (String) -> Unit,
    onToggleOffline: () -> Unit,
    onRefreshRemoteConfig: () -> Unit,
    onRecheckNano: () -> Unit,
    onWarmupNano: () -> Unit,
    onRunTriage: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalFirstThemeTokens.colors
    val haptic = LocalHapticFeedback.current
    val view = LocalView.current
    var customTermDraft by remember { mutableStateOf("") }
    var showSdkControls by remember { mutableStateOf(false) }
    val liveLocalSpans = remember(state.rawTextInput, state.protectionLevel) {
        if (state.rawTextInput.isBlank()) {
            emptyList()
        } else {
            LocalFirewallEngine.scrub(state.rawTextInput, state.protectionLevel).second
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // 3-Level Protection Dial (Low / Medium / High)
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            border = BorderStroke(1.dp, tokens.borderSubtle),
        ) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    ProtectionLevel.entries.forEach { level ->
                        val active = state.protectionLevel == level
                        val (bg, border, fg) = when {
                            !active -> Triple(tokens.subtleSurface, tokens.borderSubtle, tokens.textMuted)
                            level == ProtectionLevel.HIGH -> Triple(tokens.maskBg, tokens.maskBorder, tokens.maskText)
                            level == ProtectionLevel.MEDIUM -> Triple(tokens.safeBg, tokens.safeBorder, tokens.safeText)
                            else -> Triple(MaterialTheme.colorScheme.surface, tokens.borderSubtle, MaterialTheme.colorScheme.onSurface)
                        }
                        Surface(
                            onClick = {
                                if (view.isHapticFeedbackEnabled) {
                                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                }
                                onSelectProtectionLevel(level)
                            },
                            shape = RoundedCornerShape(8.dp),
                            color = bg,
                            border = BorderStroke(1.dp, border),
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(
                                text = when (level) {
                                    ProtectionLevel.LOW -> "Low"
                                    ProtectionLevel.MEDIUM -> "Medium"
                                    ProtectionLevel.HIGH -> "High"
                                },
                                color = fg,
                                fontFamily = FontFamily.Monospace,
                                fontWeight = if (active) FontWeight.Bold else FontWeight.Medium,
                                fontSize = 12.sp,
                                modifier = Modifier.padding(vertical = 8.dp, horizontal = 10.dp),
                            )
                        }
                    }
                }
                Text(
                    text = when (state.protectionLevel) {
                        ProtectionLevel.LOW -> "Secrets Only: traps API keys, JWT, PEM, DB URIs, Gov IDs & cards."
                        ProtectionLevel.MEDIUM -> "Balanced (Default): traps secrets + phones, emails, names, orgs & Nano 4 PHI."
                        ProtectionLevel.HIGH -> "Strict Zero-Trust: Medium + addresses, M&A, tight entropy & 50-pt lockdown."
                    },
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 11.sp,
                )
            }
        }

        // Verified On-Device Shield Specs Card
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            border = BorderStroke(1.dp, tokens.borderSubtle),
        ) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = "VERIFIED ON-DEVICE SHIELD",
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    fontSize = 11.sp,
                    color = tokens.safeText,
                )
                Text(
                    text = "Active Level: ${state.protectionLevel.name} · OS Integrations: Scrub with Cordon text menu, OS Share Sheet & Zero-PII Cloud Sync",
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = "100% Gitleaks Spec (42/42) · 70.8% Global PII Floor + Nano 4 · 0.02ms Sync · 0 Raw Bytes Cloud Egress · Firebase AI Logic hybrid inference",
                    fontFamily = FontFamily.Monospace,
                    fontSize = 10.5.sp,
                    style = TextStyle(fontFeatureSettings = "tnum"),
                    color = tokens.infoText,
                )
            }
        }

        // Offline + Status Strip
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedButton(
                onClick = onToggleOffline,
                border = BorderStroke(
                    1.dp,
                    if (state.offlineMode) tokens.warnBorder else tokens.safeBorder,
                ),
            ) {
                Icon(
                    imageVector = if (state.offlineMode) Icons.Default.FlightTakeoff else Icons.Default.Wifi,
                    contentDescription = null,
                    tint = if (state.offlineMode) tokens.warnText else tokens.safeText,
                    modifier = Modifier.padding(end = 6.dp),
                )
                Text(
                    text = if (state.offlineMode) "Offline Mode ($0 Local)" else "Hybrid Safe Online",
                    color = if (state.offlineMode) tokens.warnText else tokens.safeText,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }

            Surface(
                color = if (state.nanoStatus == NanoStatus.READY) tokens.safeBg else tokens.infoBg,
                border = BorderStroke(
                    1.dp,
                    if (state.nanoStatus == NanoStatus.READY) tokens.safeBorder else tokens.infoBorder,
                ),
                shape = RoundedCornerShape(999.dp),
            ) {
                Text(
                    text = when (state.nanoStatus) {
                        NanoStatus.READY -> "On-Device AI Ready"
                        NanoStatus.DOWNLOADABLE -> "Nano 4 Downloadable"
                        NanoStatus.MODEL_DOWNLOADING -> "Preparing AI..."
                        NanoStatus.UNAVAILABLE -> "Local Guard Active"
                    },
                    color = if (state.nanoStatus == NanoStatus.READY) tokens.safeText else tokens.infoText,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                )
            }
        }

        if (state.nanoStatus == NanoStatus.DOWNLOADABLE || state.nanoStatus == NanoStatus.MODEL_DOWNLOADING) {
            Card(
                colors = CardDefaults.cardColors(containerColor = tokens.infoBg),
                border = BorderStroke(1.dp, tokens.infoBorder),
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = if (state.nanoStatus == NanoStatus.MODEL_DOWNLOADING) {
                                "Downloading On-Device Nano 4 (${state.downloadProgress ?: 0}%)"
                            } else {
                                "Download On-Device Nano 4 for semantic masking"
                            },
                            color = tokens.infoText,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.weight(1f),
                        )
                        if (state.nanoStatus == NanoStatus.DOWNLOADABLE) {
                            OutlinedButton(onClick = onWarmupNano) {
                                Icon(Icons.Default.Download, contentDescription = null)
                                Text("Enable", modifier = Modifier.padding(start = 4.dp), fontSize = 12.sp)
                            }
                        }
                    }
                    if (state.nanoStatus == NanoStatus.MODEL_DOWNLOADING) {
                        Spacer(modifier = Modifier.height(6.dp))
                        LinearProgressIndicator(
                            progress = { (state.downloadProgress ?: 10).coerceIn(5, 100) / 100f },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
        }

        // Step 1: Starter Examples
        Text(
            text = "1. Paste or Pick Example",
            color = MaterialTheme.colorScheme.onBackground,
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
        )

        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            LocalFirewallEngine.DEMO_SCENARIOS.forEach { scenario ->
                val isSelected = scenario.rawText == state.rawTextInput
                val (sevBg, sevBorder, sevText) = when (scenario.expectedSeverity) {
                    Severity.P0 -> Triple(tokens.maskBg, tokens.maskBorder, tokens.maskText)
                    Severity.P1 -> Triple(tokens.warnBg, tokens.warnBorder, tokens.warnText)
                    Severity.P2 -> Triple(tokens.infoBg, tokens.infoBorder, tokens.infoText)
                    Severity.P3 -> Triple(tokens.safeBg, tokens.safeBorder, tokens.safeText)
                }

                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onSelectScenario(scenario) },
                    colors = CardDefaults.cardColors(
                        containerColor = if (isSelected) tokens.accentSoftBg else MaterialTheme.colorScheme.surface,
                    ),
                    border = BorderStroke(
                        1.dp,
                        if (isSelected) tokens.accentSoftBorder else tokens.borderSubtle,
                    ),
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = friendlyScenarioTitle(scenario),
                                color = MaterialTheme.colorScheme.onSurface,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 13.sp,
                                modifier = Modifier.weight(1f),
                            )
                            Surface(
                                color = sevBg,
                                border = BorderStroke(1.dp, sevBorder),
                                shape = RoundedCornerShape(6.dp),
                            ) {
                                Text(
                                    text = scenario.expectedSeverity.name,
                                    color = sevText,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                )
                            }
                        }
                        Text(
                            text = friendlyScenarioSubtitle(scenario),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                }
            }
        }

        // Inputs
        OutlinedTextField(
            value = state.titleInput,
            onValueChange = onTitleChange,
            label = { Text("Incident Title") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedTextField(
            value = state.rawTextInput,
            onValueChange = onRawTextChange,
            label = { Text("Incident Logs or Ticket Text (Stays on Device)") },
            minLines = 5,
            maxLines = 8,
            modifier = Modifier.fillMaxWidth(),
        )

        if (state.rawTextInput.isNotBlank()) {
            val foundCount = liveLocalSpans.size
            Surface(
                color = if (foundCount > 0) tokens.safeBg else tokens.subtleSurface,
                border = BorderStroke(1.dp, if (foundCount > 0) tokens.safeBorder else tokens.borderSubtle),
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .animateContentSize(animationSpec = spring(stiffness = Spring.StiffnessMediumLow)),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Default.Bolt,
                            contentDescription = null,
                            tint = if (foundCount > 0) tokens.safeText else tokens.textMuted,
                            modifier = Modifier.padding(end = 6.dp),
                        )
                        Text(
                            text = if (foundCount > 0) {
                                "$foundCount secret${if (foundCount == 1) "" else "s"} spotted locally · Ready to Airgap"
                            } else {
                                "0 secrets spotted locally · Clean"
                            },
                            color = if (foundCount > 0) tokens.safeText else tokens.textMuted,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            style = TextStyle(fontFeatureSettings = "tnum"),
                        )
                    }
                    Text(
                        text = state.protectionLevel.name,
                        color = tokens.textMuted,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }

        Button(
            onClick = {
                if (view.isHapticFeedbackEnabled) {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                }
                onRunTriage()
            },
            enabled = !state.isRunning && state.rawTextInput.isNotBlank(),
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp),
        ) {
            Icon(Icons.Default.PlayArrow, contentDescription = null)
            Text(
                text = if (state.isRunning) {
                    "Checking Secrets On-Device..."
                } else if (state.offlineMode) {
                    "Protect & Fix Offline"
                } else {
                    "Protect & Analyze"
                },
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(start = 6.dp),
            )
        }

        // Custom Blocked Rule
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = customTermDraft,
                onValueChange = { customTermDraft = it },
                label = { Text("Block company codename or word") },
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
            OutlinedButton(
                onClick = {
                    val trimmed = customTermDraft.trim()
                    if (trimmed.isNotEmpty()) {
                        onAddCustomTerm(trimmed)
                        customTermDraft = ""
                    }
                },
            ) {
                Text("Add Rule")
            }
        }

        // Collapsible Technical Proof & Policy Controls
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            border = BorderStroke(1.dp, tokens.borderSubtle),
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { showSdkControls = !showSdkControls },
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Default.Shield,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(end = 6.dp),
                        )
                        Text(
                            text = "SDK Telemetry & Remote Policy",
                            color = MaterialTheme.colorScheme.onSurface,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 13.sp,
                        )
                    }
                    Icon(
                        imageVector = if (showSdkControls) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                if (showSdkControls) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Remote Config: ${if (state.runtimeConfig.source == RemoteConfigSource.LOADED) "LOADED" else "DEFAULT"} · App Check: ${state.appCheckLabel}",
                        color = tokens.textMuted,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                    )
                    Text(
                        text = "Runs: ${state.totalRuns} · Local Fixed ($0): ${state.localResolvedCount} · Active Cloud: ${state.runtimeConfig.cloudModel}",
                        color = tokens.textMuted,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        TextButton(onClick = onRefreshRemoteConfig, enabled = !state.isRefreshingPolicy) {
                            Icon(Icons.Default.Cloud, contentDescription = null)
                            Text("Refresh Policy", modifier = Modifier.padding(start = 4.dp), fontSize = 12.sp)
                        }
                        TextButton(onClick = onRecheckNano) {
                            Icon(Icons.Default.Refresh, contentDescription = null)
                            Text("Recheck Nano 4", modifier = Modifier.padding(start = 4.dp), fontSize = 12.sp)
                        }
                    }
                }
            }
        }
    }
}
