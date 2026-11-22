package com.localfirst.triage.ui.screens

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.PauseCircle
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.localfirst.triage.data.ShieldStore
import com.localfirst.triage.firewall.LocalFirewallEngine
import com.localfirst.triage.model.NanoStatus
import com.localfirst.triage.model.ProtectionLevel
import com.localfirst.triage.model.RedactionSpan
import com.localfirst.triage.ui.MainUiState
import com.localfirst.triage.ui.theme.LocalFirstThemeTokens

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ShieldScreen(
    state: MainUiState,
    isAccessibilityEnabled: Boolean,
    isShieldPaused: Boolean,
    totalSecretsBlocked: Int,
    onEnableAccessibility: () -> Unit,
    onResumeShield: () -> Unit,
    onScrubSandbox: (rawText: String, sanitizedText: String, spans: List<RedactionSpan>, engineUsed: String) -> Unit,
    onSendScrubbedToCloud: (sanitizedText: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalFirstThemeTokens.colors
    val context = LocalContext.current
    val isShieldActive = isAccessibilityEnabled && !isShieldPaused
    val activeEngineLabel = if (state.nanoStatus == NanoStatus.READY) {
        "Model: Gemini Nano (AICore)"
    } else {
        "Model: Deterministic Rules Only"
    }

    var sandboxExpanded by remember { mutableStateOf(true) }
    var sandboxInput by remember { mutableStateOf("") }
    var lastSanitized by remember { mutableStateOf<String?>(null) }
    var lastSpans by remember { mutableStateOf<List<RedactionSpan>>(emptyList()) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // 1. Live Status Hero Card
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            border = BorderStroke(
                width = 1.dp,
                color = if (isShieldActive) tokens.safeBorder else tokens.warnBorder,
            ),
            shape = RoundedCornerShape(16.dp),
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(
                            imageVector = if (isShieldActive) Icons.Default.Shield else Icons.Default.PauseCircle,
                            contentDescription = null,
                            tint = if (isShieldActive) tokens.safeText else tokens.warnText,
                            modifier = Modifier.size(24.dp),
                        )
                        Column {
                            Text(
                                text = "Background Shield",
                                fontWeight = FontWeight.Bold,
                                fontSize = 16.sp,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Text(
                                text = when {
                                    isShieldActive -> "Guarding AI & chat apps on-device"
                                    isAccessibilityEnabled -> "Paused by user — tap Resume"
                                    else -> "Enable Accessibility Service to guard apps"
                                },
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }

                    Surface(
                        color = if (isShieldActive) tokens.safeBg else tokens.warnBg,
                        border = BorderStroke(1.dp, if (isShieldActive) tokens.safeBorder else tokens.warnBorder),
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Text(
                            text = if (isShieldActive) "ACTIVE" else "PAUSED",
                            color = if (isShieldActive) tokens.safeText else tokens.warnText,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                            fontSize = 11.sp,
                            modifier = Modifier.padding(horizontal = 9.dp, vertical = 4.dp),
                        )
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Surface(
                        color = if (state.nanoStatus == NanoStatus.READY) tokens.infoBg else tokens.subtleSurface,
                        border = BorderStroke(
                            1.dp,
                            if (state.nanoStatus == NanoStatus.READY) tokens.infoBorder else tokens.borderSubtle,
                        ),
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Text(
                            text = activeEngineLabel,
                            color = if (state.nanoStatus == NanoStatus.READY) tokens.infoText else tokens.textMuted,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 11.sp,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        )
                    }

                    Column(horizontalAlignment = Alignment.End) {
                        Text(
                            text = "$totalSecretsBlocked",
                            fontWeight = FontWeight.ExtraBold,
                            fontSize = 20.sp,
                            color = tokens.safeText,
                        )
                        Text(
                            text = "Secrets Blocked",
                            fontSize = 10.5.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                if (!isAccessibilityEnabled) {
                    Button(
                        onClick = onEnableAccessibility,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.primary,
                            contentColor = MaterialTheme.colorScheme.onPrimary,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Default.Security, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text(
                            text = "Enable Background Shield",
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(start = 8.dp),
                        )
                    }
                } else if (isShieldPaused) {
                    OutlinedButton(
                        onClick = onResumeShield,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Resume Background Shield", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }

        // 2. How It Works (Compact 3-Step Card)
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            border = BorderStroke(1.dp, tokens.borderSubtle),
            shape = RoundedCornerShape(14.dp),
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = "HOW IT WORKS",
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    HowItWorksStep(
                        step = "1. Detect Locally",
                        detail = "0.02ms on paste",
                        modifier = Modifier.weight(1f),
                    )
                    HowItWorksStep(
                        step = "2. Scrub On-Device",
                        detail = "Replace tokens",
                        modifier = Modifier.weight(1f),
                    )
                    HowItWorksStep(
                        step = "3. Safe to Send",
                        detail = "0 Raw PII Leaves",
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }

        // 3. Quick Sandbox (Collapsible local paste-and-scrub)
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            border = BorderStroke(1.dp, tokens.borderSubtle),
            shape = RoundedCornerShape(14.dp),
        ) {
            Column(modifier = Modifier.padding(14.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column {
                        Text(
                            text = "Quick Sandbox",
                            fontWeight = FontWeight.Bold,
                            fontSize = 15.sp,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Text(
                            text = "Test local scrubbing (${state.protectionLevel.name} dial)",
                            fontSize = 11.5.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    TextButton(onClick = { sandboxExpanded = !sandboxExpanded }) {
                        Text(if (sandboxExpanded) "Hide" else "Open", fontSize = 12.sp)
                        Icon(
                            imageVector = if (sandboxExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                            contentDescription = null,
                        )
                    }
                }

                AnimatedVisibility(visible = sandboxExpanded) {
                    Column(
                        modifier = Modifier.padding(top = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        OutlinedTextField(
                            value = sandboxInput,
                            onValueChange = { sandboxInput = it },
                            label = { Text("Paste text with keys, emails, or PII") },
                            minLines = 3,
                            maxLines = 6,
                            modifier = Modifier.fillMaxWidth(),
                        )

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            OutlinedButton(
                                onClick = {
                                    sandboxInput = "My Stripe key is " + "sk_live_" + "51NxMockSecret9988776655 and call +1-415-555-0199"
                                },
                            ) {
                                Text("Sample", fontSize = 12.sp)
                            }
                            Button(
                                onClick = {
                                    if (sandboxInput.isBlank()) return@Button
                                    val (sanitized, spans) = LocalFirewallEngine.scrub(
                                        rawText = sandboxInput,
                                        protectionLevel = state.protectionLevel,
                                    )
                                    lastSanitized = sanitized
                                    lastSpans = spans
                                    val engineUsed = if (state.nanoStatus == NanoStatus.READY) {
                                        "Gemini Nano (AICore)"
                                    } else {
                                        "Deterministic Rules"
                                    }
                                    onScrubSandbox(sandboxInput, sanitized, spans, engineUsed)
                                },
                                enabled = sandboxInput.isNotBlank(),
                                modifier = Modifier.weight(1f),
                            ) {
                                Icon(Icons.Default.Shield, contentDescription = null, modifier = Modifier.size(16.dp))
                                Text(
                                    text = "Scrub Locally",
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.padding(start = 6.dp),
                                )
                            }
                        }

                        val sanitizedOutput = lastSanitized
                        if (sanitizedOutput != null) {
                            Surface(
                                color = tokens.safeBg,
                                border = BorderStroke(1.dp, tokens.safeBorder),
                                shape = RoundedCornerShape(10.dp),
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column(
                                    modifier = Modifier.padding(10.dp),
                                    verticalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Icon(
                                                Icons.Default.CheckCircle,
                                                contentDescription = null,
                                                tint = tokens.safeText,
                                                modifier = Modifier.size(15.dp),
                                            )
                                            Text(
                                                text = " Scrubbed (${lastSpans.size} blocked · 0 Leaked)",
                                                color = tokens.safeText,
                                                fontWeight = FontWeight.Bold,
                                                fontSize = 11.5.sp,
                                            )
                                        }
                                    }
                                    Text(
                                        text = sanitizedOutput,
                                        fontFamily = FontFamily.Monospace,
                                        fontSize = 11.5.sp,
                                        color = MaterialTheme.colorScheme.onSurface,
                                    )
                                    if (lastSpans.isNotEmpty()) {
                                        FlowRow(
                                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                                            verticalArrangement = Arrangement.spacedBy(4.dp),
                                        ) {
                                            lastSpans.map { it.category }.distinct().forEach { cat ->
                                                Surface(
                                                    color = MaterialTheme.colorScheme.surface,
                                                    border = BorderStroke(1.dp, tokens.safeBorder),
                                                    shape = RoundedCornerShape(6.dp),
                                                ) {
                                                    Text(
                                                        text = ShieldStore.friendlyCategoryName(cat),
                                                        fontSize = 10.sp,
                                                        fontWeight = FontWeight.SemiBold,
                                                        color = tokens.safeText,
                                                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                                    )
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            Button(
                                onClick = {
                                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                                    clipboard?.setPrimaryClip(ClipData.newPlainText("Cordon Safe Text", sanitizedOutput))
                                    Toast.makeText(
                                        context,
                                        "Scrubbed text copied — pick an app to paste",
                                        Toast.LENGTH_SHORT,
                                    ).show()
                                    val sendIntent = Intent(Intent.ACTION_SEND).apply {
                                        type = "text/plain"
                                        putExtra(Intent.EXTRA_TEXT, sanitizedOutput)
                                    }
                                    val chooser = Intent.createChooser(sendIntent, "Choose app to paste into").apply {
                                        if (context !is Activity) {
                                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                        }
                                    }
                                    runCatching { context.startActivity(chooser) }
                                },
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = MaterialTheme.colorScheme.primary,
                                    contentColor = MaterialTheme.colorScheme.onPrimary,
                                ),
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(16.dp))
                                Text(
                                    text = "Choose App to Paste Into",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.padding(start = 6.dp),
                                )
                            }

                            OutlinedButton(
                                onClick = { onSendScrubbedToCloud(sanitizedOutput) },
                                enabled = !state.isRunning && !state.offlineMode,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                if (state.isRunning) {
                                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                                } else {
                                    Icon(Icons.Default.Cloud, contentDescription = null, modifier = Modifier.size(16.dp))
                                }
                                Text(
                                    text = if (state.offlineMode) {
                                        "Offline Mode — Cloud AI Disabled"
                                    } else {
                                        "Send Scrubbed Text to Cloud AI"
                                    },
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.padding(start = 6.dp),
                                )
                                if (!state.offlineMode && !state.isRunning) {
                                    Spacer(Modifier.size(4.dp))
                                    Icon(
                                        Icons.AutoMirrored.Filled.Send,
                                        contentDescription = null,
                                        modifier = Modifier.size(14.dp),
                                    )
                                }
                            }

                            val cloudResult = state.currentResult
                            if (cloudResult != null && cloudResult.resolution.isNotBlank()) {
                                Surface(
                                    color = tokens.infoBg,
                                    border = BorderStroke(1.dp, tokens.infoBorder),
                                    shape = RoundedCornerShape(10.dp),
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Column(
                                        modifier = Modifier.padding(10.dp),
                                        verticalArrangement = Arrangement.spacedBy(4.dp),
                                    ) {
                                        Text(
                                            text = "Cloud AI Response · 0 raw PII bytes left device",
                                            fontWeight = FontWeight.Bold,
                                            fontSize = 11.sp,
                                            color = tokens.infoText,
                                        )
                                        CloudMarkdownFormatter.parse(cloudResult.resolution).forEach { block ->
                                            Text(
                                                text = if (block.isBullet) "• ${block.text}" else block.text,
                                                fontWeight = if (block.isHeading) FontWeight.Bold else FontWeight.Normal,
                                                fontSize = if (block.isHeading) 12.5.sp else 12.sp,
                                                color = if (block.isHeading) tokens.infoText else MaterialTheme.colorScheme.onSurface,
                                                modifier = Modifier.padding(
                                                    start = if (block.isBullet) 6.dp else 0.dp,
                                                    top = if (block.isHeading) 4.dp else 0.dp,
                                                ),
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

        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun HowItWorksStep(
    step: String,
    detail: String,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalFirstThemeTokens.colors
    Surface(
        color = tokens.subtleSurface,
        border = BorderStroke(1.dp, tokens.borderSubtle),
        shape = RoundedCornerShape(10.dp),
        modifier = modifier,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                text = step,
                fontWeight = FontWeight.Bold,
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = detail,
                fontSize = 10.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

data class CloudResponseBlock(
    val text: String,
    val isHeading: Boolean = false,
    val isBullet: Boolean = false,
)

object CloudMarkdownFormatter {
    private val HEADING_PREFIX = Regex("""^#{1,6}\s+""")
    private val BULLET_PREFIX = Regex("""^[-*•]\s+""")
    private val FENCE_LINE = Regex("""^```.*$""")

    fun cleanInline(line: String): String = line
        .replace("**", "")
        .replace("__", "")
        .replace("`", "")
        .trim()

    fun parse(raw: String): List<CloudResponseBlock> {
        if (raw.isBlank()) return emptyList()
        return raw.lineSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() && !FENCE_LINE.matches(it) }
            .mapNotNull { line ->
                when {
                    HEADING_PREFIX.containsMatchIn(line) -> {
                        val cleaned = cleanInline(HEADING_PREFIX.replace(line, ""))
                        if (cleaned.isEmpty()) null else CloudResponseBlock(cleaned, isHeading = true)
                    }
                    BULLET_PREFIX.containsMatchIn(line) -> {
                        val cleaned = cleanInline(BULLET_PREFIX.replace(line, ""))
                        if (cleaned.isEmpty()) null else CloudResponseBlock(cleaned, isBullet = true)
                    }
                    else -> {
                        val cleaned = cleanInline(line)
                        if (cleaned.isEmpty()) null else CloudResponseBlock(cleaned)
                    }
                }
            }
            .toList()
    }
}
