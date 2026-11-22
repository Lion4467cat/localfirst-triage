package com.localfirst.triage.ui.screens

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
    var showDeterministicWarning by remember { mutableStateOf(false) }

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
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            border = BorderStroke(1.dp, if (state.nanoStatus == NanoStatus.READY) tokens.safeBorder else tokens.borderSubtle),
        ) {
            Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Default.Shield,
                            contentDescription = null,
                            tint = tokens.safeText,
                            modifier = Modifier.padding(end = 6.dp),
                        )
                        Text(
                            text = "CORDON SETUP",
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                            fontSize = 11.5.sp,
                            color = tokens.safeText,
                        )
                    }
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

                if (state.nanoStatus == NanoStatus.READY) {
                    Text(
                        text = "On-Device AI Ready",
                        fontWeight = FontWeight.Bold,
                        fontSize = 17.sp,
                        color = tokens.safeText,
                    )
                    Text(
                        text = "Gemini Nano is active on this device. All secret & PII detection runs locally.",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
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
                            text = "Enter Cordon →",
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(start = 6.dp),
                        )
                    }
                } else {
                    Text(
                        text = when (state.nanoStatus) {
                            NanoStatus.DOWNLOADABLE -> "On-Device AI Downloadable"
                            NanoStatus.MODEL_DOWNLOADING -> "Downloading On-Device AI…"
                            else -> "On-Device AI Unavailable"
                        },
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                    )

                    Text(
                        text = when (state.nanoStatus) {
                            NanoStatus.DOWNLOADABLE -> "Download Gemini Nano for higher contextual accuracy on unstructured PII."
                            NanoStatus.MODEL_DOWNLOADING -> "Downloading on-device model (${state.downloadProgress ?: 0}%)…"
                            else -> "On-device AI is not available on this device. Cordon can run in Deterministic-Only mode."
                        },
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    if (state.nanoStatus == NanoStatus.MODEL_DOWNLOADING) {
                        LinearProgressIndicator(
                            progress = { (state.downloadProgress ?: 15).coerceIn(5, 100) / 100f },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }

                    if (state.nanoStatus == NanoStatus.DOWNLOADABLE) {
                        Button(
                            onClick = {
                                if (view.isHapticFeedbackEnabled) {
                                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                }
                                onWarmupNano()
                            },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.primary,
                                contentColor = MaterialTheme.colorScheme.onPrimary,
                            ),
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(46.dp),
                        ) {
                            Icon(Icons.Default.Download, contentDescription = null)
                            Text("Download On-Device Model", fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 6.dp))
                        }
                    } else if (state.nanoStatus == NanoStatus.UNAVAILABLE) {
                        OutlinedButton(
                            onClick = onRecheckNano,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Icon(Icons.Default.Refresh, contentDescription = null)
                            Text("Check Again", modifier = Modifier.padding(start = 6.dp))
                        }
                    }

                    TextButton(
                        onClick = {
                            if (view.isHapticFeedbackEnabled) {
                                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                            }
                            showDeterministicWarning = true
                        },
                        modifier = Modifier.align(Alignment.CenterHorizontally),
                    ) {
                        Text(
                            text = "Continue in Deterministic Mode",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }

                    if (showDeterministicWarning) {
                        Card(
                            colors = CardDefaults.cardColors(containerColor = tokens.warnBg),
                            border = BorderStroke(1.dp, tokens.warnBorder),
                        ) {
                            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(
                                    text = "Local rules only — lower accuracy on unstructured PII/medical context.",
                                    fontSize = 11.5.sp,
                                    color = tokens.warnText,
                                    fontWeight = FontWeight.SemiBold,
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
                                    Text("Continue Anyway", fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
