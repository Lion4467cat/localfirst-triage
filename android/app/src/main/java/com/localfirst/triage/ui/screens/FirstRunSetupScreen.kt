package com.localfirst.triage.ui.screens

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.localfirst.triage.model.NanoStatus
import com.localfirst.triage.ui.MainUiState
import com.localfirst.triage.ui.theme.LocalFirstThemeTokens

@Composable
fun FirstRunSetupScreen(
    state: MainUiState,
    onRecheckNano: () -> Unit,
    onWarmupNano: () -> Unit,
    onCompleteSetup: () -> Unit,
    onConfirmDeterministicOnly: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalFirstThemeTokens.colors
    val haptic = LocalHapticFeedback.current
    val view = LocalView.current
    var showOptOutWarning by remember { mutableStateOf(false) }

    val (statusLabel, statusBg, statusBorder, statusFg) = when (state.nanoStatus) {
        NanoStatus.READY -> listOf("AVAILABLE", tokens.safeBg, tokens.safeBorder, tokens.safeText)
        NanoStatus.DOWNLOADABLE -> listOf("DOWNLOADABLE", tokens.infoBg, tokens.infoBorder, tokens.infoText)
        NanoStatus.MODEL_DOWNLOADING -> listOf("DOWNLOADING", tokens.warnBg, tokens.warnBorder, tokens.warnText)
        NanoStatus.UNAVAILABLE -> listOf("UNAVAILABLE", tokens.subtleSurface, tokens.borderSubtle, tokens.textMuted)
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
            .animateContentSize(animationSpec = spring(stiffness = Spring.StiffnessMediumLow)),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Intro Header Card
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            border = BorderStroke(1.dp, tokens.safeBorder),
        ) {
            Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.Shield,
                        contentDescription = null,
                        tint = tokens.safeText,
                        modifier = Modifier.padding(end = 8.dp),
                    )
                    Text(
                        text = "WELCOME TO CORDON",
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.sp,
                        color = tokens.safeText,
                    )
                }
                Text(
                    text = "Set Up Your On-Device Privacy Firewall",
                    fontWeight = FontWeight.Bold,
                    fontSize = 17.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = "Cordon traps secrets and PII locally before anything leaves your device. Check your on-device AI model below or opt into Deterministic-Only mode.",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // Step 1: On-Device AI Check & Download
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            border = BorderStroke(1.dp, tokens.borderSubtle),
        ) {
            Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "STEP 1 · ON-DEVICE AI MODEL",
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 11.sp,
                        color = tokens.infoText,
                    )
                    Surface(
                        color = statusBg as androidx.compose.ui.graphics.Color,
                        border = BorderStroke(1.dp, statusBorder as androidx.compose.ui.graphics.Color),
                        shape = RoundedCornerShape(6.dp),
                    ) {
                        Text(
                            text = statusLabel as String,
                            color = statusFg as androidx.compose.ui.graphics.Color,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                            fontSize = 10.sp,
                            modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp),
                        )
                    }
                }

                Text(
                    text = "Gemini Nano / AICore enables contextual detection of unstructured medical, family, and confidential deal details completely offline.",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                if (state.nanoStatus == NanoStatus.MODEL_DOWNLOADING) {
                    LinearProgressIndicator(
                        progress = { (state.downloadProgress ?: 15).coerceIn(5, 100) / 100f },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(
                        text = "Downloading on-device model (${state.downloadProgress ?: 0}%)…",
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        color = tokens.warnText,
                    )
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onRecheckNano) {
                        Icon(Icons.Default.Refresh, contentDescription = null)
                        Text("Check Model", modifier = Modifier.padding(start = 4.dp), fontSize = 12.sp)
                    }
                    if (state.nanoStatus == NanoStatus.DOWNLOADABLE) {
                        Button(
                            onClick = onWarmupNano,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.secondary,
                                contentColor = MaterialTheme.colorScheme.onSecondary,
                            ),
                        ) {
                            Icon(Icons.Default.Download, contentDescription = null)
                            Text("Download Model", modifier = Modifier.padding(start = 4.dp), fontSize = 12.sp)
                        }
                    }
                }
            }
        }

        // Step 2: OS Integrations & How to Use
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            border = BorderStroke(1.dp, tokens.borderSubtle),
        ) {
            Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    text = "STEP 2 · HOW TO USE CORDON",
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    fontSize = 11.sp,
                    color = tokens.safeText,
                )
                Text(
                    text = "1. Paste or type in Cordon: Instant local detection flags secrets before you tap Protect & Analyze.",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = "2. Highlight text → Scrub with Cordon: Select text in any Android app and choose Scrub with Cordon from the text menu.",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = "3. Share text to Cordon: Use the Android Share Sheet to send logs or messages directly into Cordon.",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Spacer(modifier = Modifier.height(2.dp))

        // Primary CTA
        Button(
            onClick = {
                if (view.isHapticFeedbackEnabled) {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                }
                onCompleteSetup()
            },
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
                text = "Complete Setup & Start",
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(start = 6.dp),
            )
        }

        // Opt-Out Path
        TextButton(
            onClick = {
                if (view.isHapticFeedbackEnabled) {
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                }
                showOptOutWarning = true
            },
            modifier = Modifier.align(Alignment.CenterHorizontally),
        ) {
            Text(
                text = "I don't want to do this · Use Deterministic Only",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        if (showOptOutWarning) {
            Card(
                colors = CardDefaults.cardColors(containerColor = tokens.warnBg),
                border = BorderStroke(1.dp, tokens.warnBorder),
            ) {
                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Default.Warning,
                            contentDescription = null,
                            tint = tokens.warnText,
                            modifier = Modifier.padding(end = 6.dp),
                        )
                        Text(
                            text = "Deterministic-Only Mode Warning",
                            fontWeight = FontWeight.Bold,
                            fontSize = 12.sp,
                            color = tokens.warnText,
                        )
                    }
                    Text(
                        text = "Without the on-device AI model, Cordon will run in Deterministic-Only mode without model-assisted inference. Contextual coverage for unstructured PII will be lower, while instant deterministic rules remain active.",
                        fontSize = 11.5.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Button(
                        onClick = {
                            if (view.isHapticFeedbackEnabled) {
                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            }
                            onConfirmDeterministicOnly()
                        },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = tokens.warnBorder,
                            contentColor = MaterialTheme.colorScheme.onPrimary,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Confirm Deterministic Mode", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}
