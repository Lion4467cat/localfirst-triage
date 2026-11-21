package com.localfirst.triage.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.localfirst.triage.firewall.LocalFirewallEngine
import com.localfirst.triage.model.DetectorSource
import com.localfirst.triage.model.RedactionSpan
import com.localfirst.triage.ui.MainUiState
import com.localfirst.triage.ui.theme.SrePalette

private fun colorForDetector(detector: DetectorSource): Color = when (detector) {
    DetectorSource.NANO_SEMANTIC_FIREWALL -> SrePalette.Cyan400
    DetectorSource.REGEX_FIREWALL -> SrePalette.Amber400
    DetectorSource.ENTROPY_SCANNER -> SrePalette.Fuchsia400
    DetectorSource.HEURISTIC_GUARD -> Color(0xFFFB923C)
    DetectorSource.POLICY_TERM -> SrePalette.Violet400
    DetectorSource.MANUAL_MASK -> SrePalette.Rose400
}

@Composable
private fun buildHighlightedSanitized(
    rawText: String,
    sanitizedText: String,
    spans: List<RedactionSpan>,
    loadedFromZeroPiiStore: Boolean,
) = buildAnnotatedString {
    if (loadedFromZeroPiiStore || spans.isEmpty() || rawText == LocalFirewallEngine.PURGED_PLACEHOLDER) {
        append(sanitizedText)
        return@buildAnnotatedString
    }
    val ordered = spans
        .filter { it.start >= 0 && it.end <= rawText.length && it.start < it.end }
        .sortedBy { it.start }

    var cursor = 0
    for (span in ordered) {
        if (span.start < cursor) continue
        if (span.start > cursor) {
            append(rawText.substring(cursor, span.start))
        }
        val color = colorForDetector(span.detector)
        val token = if (span.masked) span.placeholder else rawText.substring(span.start, span.end)
        withStyle(
            SpanStyle(
                color = if (span.masked) color else SrePalette.Slate400,
                background = color.copy(alpha = 0.16f),
                fontWeight = FontWeight.SemiBold,
            ),
        ) {
            append(token)
        }
        cursor = span.end
    }
    if (cursor < rawText.length) {
        append(rawText.substring(cursor))
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DiffEscalateScreen(
    state: MainUiState,
    onToggleSpan: (Int) -> Unit,
    onApproveEscalate: () -> Unit,
    onSyncToFirestore: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val result = state.currentResult

    if (result == null) {
        Column(
            modifier = modifier
                .fillMaxSize()
                .padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(Icons.Default.Shield, contentDescription = null, tint = SrePalette.Indigo300)
            Spacer(Modifier.height(8.dp))
            Text(
                text = "Run Hybrid Triage on Screen 1 first to inspect the Redaction Diff, Zero-Leakage Proof, and Cloud Escalation.",
                color = SrePalette.Slate300,
                fontSize = 13.sp,
            )
        }
        return
    }

    val audit = LocalFirewallEngine.verifyZeroLeakage(result.sanitizedText, result.spans)
    val outboundPreview = LocalFirewallEngine.buildOutboundCloudPrompt(
        result.severity,
        result.category,
        result.sanitizedText,
    )

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Stage Summary Card
        Card(
            colors = CardDefaults.cardColors(containerColor = SrePalette.Slate900),
            border = BorderStroke(1.dp, SrePalette.Slate800),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = "${result.severity.name} · ${result.title}",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                )
                Text(
                    text = "Stage 1: ${result.stage1Source} (${result.stage1LatencyMs}ms)",
                    color = SrePalette.Cyan400,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                )
                Text(
                    text = "Stage 2: ${result.stage2Source.name} · Mode: ${result.resolutionMode.name}",
                    color = SrePalette.Indigo300,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                )
            }
        }

        // Interactive Sanitized Payload Diff + Mask Toggle Chips
        Card(
            colors = CardDefaults.cardColors(containerColor = SrePalette.Slate900),
            border = BorderStroke(1.dp, SrePalette.Emerald400.copy(alpha = 0.4f)),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.Default.Lock, contentDescription = null, tint = SrePalette.Emerald400)
                    Text(
                        text = "Sanitized Outbound Payload (${result.spans.count { it.masked }} active masks)",
                        color = SrePalette.Emerald400,
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.sp,
                    )
                }
                Text(
                    text = buildHighlightedSanitized(
                        rawText = result.rawText,
                        sanitizedText = result.sanitizedText,
                        spans = result.spans,
                        loadedFromZeroPiiStore = result.loadedFromZeroPiiStore,
                    ),
                    color = SrePalette.Slate300,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 12.sp,
                )

                if (!result.loadedFromZeroPiiStore && result.spans.isNotEmpty()) {
                    Text(
                        text = "Tap mask chips to toggle redaction:",
                        color = SrePalette.Slate400,
                        fontSize = 11.sp,
                    )
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        result.spans.forEachIndexed { idx, span ->
                            FilterChip(
                                selected = span.masked,
                                onClick = { onToggleSpan(idx) },
                                label = {
                                    Text(
                                        text = "${span.category} (${span.detector.name.take(6)})",
                                        fontSize = 10.sp,
                                        color = colorForDetector(span.detector),
                                    )
                                },
                            )
                        }
                    }
                }
            }
        }

        // Zero-Leakage Proof Card
        Card(
            colors = CardDefaults.cardColors(
                containerColor = if (audit.verified) SrePalette.Emerald950 else SrePalette.Rose950,
            ),
            border = BorderStroke(
                1.dp,
                if (audit.verified) SrePalette.Emerald400 else SrePalette.Rose400,
            ),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(
                        imageVector = Icons.Default.VerifiedUser,
                        contentDescription = null,
                        tint = if (audit.verified) SrePalette.Emerald400 else SrePalette.Rose400,
                    )
                    Text(
                        text = if (audit.verified) {
                            "ZERO-LEAKAGE VERIFIED: 0 / ${audit.checkedSpansCount} raw secrets leaked"
                        } else {
                            "LEAK GUARD TRIGGERED: ${audit.leakedSpansCount} unredacted spans blocked!"
                        },
                        color = if (audit.verified) SrePalette.Emerald400 else SrePalette.Rose400,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 12.sp,
                    )
                }
                Text(
                    text = outboundPreview.take(420),
                    color = SrePalette.Slate300,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 10.sp,
                )
            }
        }

        // Action Buttons: Cloud Escalate & Sync Sanitized to Firestore
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(
                onClick = onApproveEscalate,
                enabled = !state.isRunning && !state.offlineMode && audit.verified,
                colors = ButtonDefaults.buttonColors(containerColor = SrePalette.Indigo500),
                modifier = Modifier.weight(1f),
            ) {
                Text(
                    text = if (state.isRunning) "Streaming Cloud RCA..." else "Approve & Escalate",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                )
            }

            OutlinedButton(
                onClick = onSyncToFirestore,
                enabled = audit.verified && !state.offlineMode,
                border = BorderStroke(1.dp, SrePalette.Emerald400),
                modifier = Modifier.weight(1f),
            ) {
                Icon(Icons.Default.CloudUpload, contentDescription = null, tint = SrePalette.Emerald400)
                Spacer(Modifier.padding(2.dp))
                Text(
                    text = "Sync Zero-PII",
                    color = SrePalette.Emerald400,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
        }

        if (state.cloudSyncMessage != null) {
            Text(state.cloudSyncMessage, color = SrePalette.Cyan400, fontSize = 11.sp)
        }

        // Streaming / Local Resolution Output
        Card(
            colors = CardDefaults.cardColors(containerColor = SrePalette.Slate900),
            border = BorderStroke(1.dp, SrePalette.Slate800),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    text = "TRIAGE RESOLUTION (${result.inferenceSource.name})",
                    color = SrePalette.Indigo300,
                    fontWeight = FontWeight.Bold,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                )
                Text(
                    text = result.resolution,
                    color = Color(0xFFE2E8F0),
                    fontSize = 13.sp,
                )
            }
        }
    }
}
