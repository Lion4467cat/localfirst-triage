package com.localfirst.triage.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import com.localfirst.triage.ui.theme.LocalFirstThemeTokens

private fun friendlyCategoryName(category: String): String = when (category) {
    "AWS_ACCESS_KEY" -> "AWS Key"
    "STRIPE_KEY" -> "Stripe Key"
    "FIREBASE_KEY" -> "Firebase Key"
    "WEBHOOK_SECRET" -> "Webhook Secret"
    "PEM_PRIVATE_KEY" -> "Private Key"
    "JWT_TOKEN", "BEARER_OR_JWT" -> "Auth Token"
    "DATABASE_URI", "DB_CONNECTION_URI" -> "Database Link"
    "CREDIT_CARD" -> "Card Number"
    "SSN", "US_SSN" -> "SSN"
    "EMAIL" -> "Email"
    "PHONE" -> "Phone Number"
    "MEDICAL_PHI", "CONTEXTUAL_PHI" -> "Medical Info"
    "PASSWORD_HINT", "NATURAL_SECRET" -> "Password Hint"
    "INTERNAL_CODENAME" -> "Project Codename"
    "M_AND_A_SECRET" -> "Confidential Deal Info"
    "PERSONAL_PII_LOCATION" -> "Personal Location"
    "HIGH_ENTROPY_SECRET" -> "Secret Key"
    "POLICY_TERM" -> "Company Rule"
    "MANUAL_MASK", "MANUAL_SECRET" -> "Hidden by You"
    else -> category.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }
}

@Composable
private fun buildHighlightedSafePreview(
    rawText: String,
    sanitizedText: String,
    spans: List<RedactionSpan>,
    loadedFromZeroPiiStore: Boolean,
) = buildAnnotatedString {
    val tokens = LocalFirstThemeTokens.colors
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
        val content = if (span.masked) span.placeholder else rawText.substring(span.start, span.end)
        withStyle(
            SpanStyle(
                color = if (span.masked) tokens.safeText else tokens.warnText,
                fontWeight = FontWeight.Bold,
            ),
        ) {
            append(content)
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
    val tokens = LocalFirstThemeTokens.colors
    val result = state.currentResult
    var showProofDetails by remember { mutableStateOf(false) }

    if (result == null) {
        Column(
            modifier = modifier
                .fillMaxSize()
                .padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(
                Icons.Default.Shield,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
            )
            Spacer(modifier = Modifier.height(10.dp))
            Text(
                text = "Run Protect & Analyze in Triage",
                color = MaterialTheme.colorScheme.onBackground,
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp,
            )
            Text(
                text = "Masked secrets, Zero-Leakage proof, and safe AI fixes appear here.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 13.sp,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
        return
    }

    val unmaskedCount = result.spans.count { !it.masked }
    val audit = result.zeroLeakageAudit
    val leakedCount = audit?.leakedSpansCount ?: unmaskedCount
    val checkedCount = audit?.checkedSpansCount ?: result.spans.size

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Scannable Trust Summary Bar
        Card(
            colors = CardDefaults.cardColors(
                containerColor = if (unmaskedCount > 0) tokens.warnBg else tokens.safeBg,
            ),
            border = BorderStroke(
                1.dp,
                if (unmaskedCount > 0) tokens.warnBorder else tokens.safeBorder,
            ),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    imageVector = Icons.Default.VerifiedUser,
                    contentDescription = null,
                    tint = if (unmaskedCount > 0) tokens.warnText else tokens.safeText,
                )
                Text(
                    text = if (unmaskedCount > 0) {
                        "Action needed: $unmaskedCount secret(s) exposed · Cloud AI paused"
                    } else {
                        "Protected On-Device (${result.stage1Source}) · $leakedCount / $checkedCount secrets leaked · ${result.latencyMs}ms"
                    },
                    color = if (unmaskedCount > 0) tokens.warnText else tokens.safeText,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 12.sp,
                )
            }
        }

        // Step 2: Review Hidden Secrets
        Text(
            text = "2. Review Hidden Secrets (Tap to Toggle)",
            color = MaterialTheme.colorScheme.onBackground,
            fontWeight = FontWeight.Bold,
            fontSize = 14.sp,
        )

        if (result.spans.isNotEmpty()) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                result.spans.forEachIndexed { idx, span ->
                    FilterChip(
                        selected = span.masked,
                        onClick = { onToggleSpan(idx) },
                        leadingIcon = {
                            Icon(
                                imageVector = if (span.masked) Icons.Default.Lock else Icons.Default.LockOpen,
                                contentDescription = null,
                            )
                        },
                        label = {
                            val verb = if (span.masked) "Hidden" else "Exposed"
                            Text(
                                text = "$verb: ${friendlyCategoryName(span.category)}",
                                fontSize = 12.sp,
                            )
                        },
                    )
                }
            }
        }

        // Safe Preview Card
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            border = BorderStroke(1.dp, tokens.borderSubtle),
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                Text(
                    text = "Safe Version Sent to AI",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 12.sp,
                )
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = buildHighlightedSafePreview(
                        rawText = result.rawText,
                        sanitizedText = result.sanitizedText,
                        spans = result.spans,
                        loadedFromZeroPiiStore = result.loadedFromZeroPiiStore,
                    ),
                    color = MaterialTheme.colorScheme.onSurface,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 12.sp,
                    lineHeight = 17.sp,
                )
            }
        }

        // Action Buttons
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(
                onClick = onApproveEscalate,
                enabled = !state.isRunning && !state.offlineMode && unmaskedCount == 0,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ),
                modifier = Modifier
                    .weight(1f)
                    .height(46.dp),
            ) {
                Text(
                    text = "Send Safe Text to AI",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }

            OutlinedButton(
                onClick = onSyncToFirestore,
                enabled = state.authUser != null && !state.offlineMode,
                modifier = Modifier.height(46.dp),
            ) {
                Icon(Icons.Default.CloudUpload, contentDescription = null)
                Text("Sync", modifier = Modifier.padding(start = 6.dp), fontSize = 13.sp)
            }
        }

        // Step 3: Safe AI Solution
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            border = BorderStroke(1.dp, tokens.borderSubtle),
        ) {
            Column(modifier = Modifier.padding(14.dp)) {
                Text(
                    text = "3. Safe AI Solution (${result.severity})",
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                )
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = result.resolution,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 13.sp,
                    lineHeight = 19.sp,
                )
            }
        }

        // Collapsible Technical Proof & SDK Details for Judges
        Card(
            colors = CardDefaults.cardColors(containerColor = tokens.subtleSurface),
            border = BorderStroke(1.dp, tokens.borderSubtle),
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { showProofDetails = !showProofDetails },
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Technical Proof & SDK Details",
                        color = MaterialTheme.colorScheme.onSurface,
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp,
                    )
                    Icon(
                        imageVector = if (showProofDetails) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                if (showProofDetails) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Stage 1 (ONLY_ON_DEVICE): ${result.stage1Source} · ${result.stage1LatencyMs}ms",
                        color = MaterialTheme.colorScheme.onSurface,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                    )
                    Text(
                        text = "Stage 2 (PREFER_IN_CLOUD): ${result.stage2Source} · ${result.stage2LatencyMs}ms · Model: ${result.activeCloudModel ?: "Local"}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                    val countsSummary = DetectorSource.entries.joinToString(" | ") { src ->
                        "${src.name}: ${result.spans.count { it.detector == src }}"
                    }
                    Text(
                        text = countsSummary,
                        color = tokens.textMuted,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 10.sp,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                    if (audit != null) {
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = "Outbound Zero-Leakage Preview:\n${audit.outboundPromptPreview}",
                            color = tokens.safeText,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.sp,
                        )
                    }
                }
            }
        }
    }
}
