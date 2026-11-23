package com.localfirst.triage.ui.screens

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.util.Log
import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PauseCircle
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.localfirst.triage.data.ShieldStore
import com.localfirst.triage.firewall.LocalFirewallEngine
import com.localfirst.triage.model.NanoStatus
import com.localfirst.triage.model.ProtectionLevel
import com.localfirst.triage.model.RedactionSpan
import com.localfirst.triage.ui.MainUiState
import com.localfirst.triage.ui.protectionLevelExplanation
import com.localfirst.triage.ui.theme.LocalFirstThemeTokens

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ShieldScreen(
    state: MainUiState,
    isAccessibilityEnabled: Boolean,
    isShieldPaused: Boolean,
    totalSecretsBlocked: Int,
    guardedAppCount: Int,
    onEnableAccessibility: () -> Unit,
    onResumeShield: () -> Unit,
    onSelectProtectionLevel: (ProtectionLevel) -> Unit,
    onScrubSandbox: (rawText: String, sanitizedText: String, spans: List<RedactionSpan>, engineUsed: String) -> Unit,
    onSendScrubbedToCloud: (sanitizedText: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val nanoReady = state.nanoStatus == NanoStatus.READY
    val engineName = if (nanoReady) ShieldStore.ENGINE_NANO else ShieldStore.ENGINE_ON_DEVICE

    var sandboxExpanded by remember { mutableStateOf(true) }
    var sandboxInput by remember { mutableStateOf("") }
    var lastSanitized by remember { mutableStateOf<String?>(null) }
    var lastSpans by remember { mutableStateOf<List<RedactionSpan>>(emptyList()) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ProtectionHeroCard(
            isAccessibilityEnabled = isAccessibilityEnabled,
            isShieldPaused = isShieldPaused,
            totalSecretsBlocked = totalSecretsBlocked,
            guardedAppCount = guardedAppCount,
            nanoReady = nanoReady,
            onEnableAccessibility = onEnableAccessibility,
            onResumeShield = onResumeShield,
        )

        ProtectionDialStrip(
            selected = state.protectionLevel,
            onSelect = onSelectProtectionLevel,
        )

        ThreeStepFlowStrip()

        SandboxCard(
            expanded = sandboxExpanded,
            onToggleExpanded = { sandboxExpanded = !sandboxExpanded },
            input = sandboxInput,
            onInputChange = { sandboxInput = it },
            sanitizedOutput = lastSanitized,
            spans = lastSpans,
            onLoadSample = {
                sandboxInput = "My Stripe key is " + "sk_live_" + "51NxMockSecret9988776655 and call +1-415-555-0199"
            },
            onScrub = {
                if (sandboxInput.isBlank()) return@SandboxCard
                val (sanitized, spans) = LocalFirewallEngine.scrub(
                    rawText = sandboxInput,
                    protectionLevel = state.protectionLevel,
                )
                lastSanitized = sanitized
                lastSpans = spans
                onScrubSandbox(sandboxInput, sanitized, spans, engineName)
            },
            onChooseApp = { scrubbed ->
                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                clipboard?.setPrimaryClip(ClipData.newPlainText("Cordon Safe Text", scrubbed))
                Toast.makeText(
                    context,
                    "Scrubbed text copied — pick an app to paste",
                    Toast.LENGTH_SHORT,
                ).show()
                val sendIntent = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, scrubbed)
                }
                val chooser = Intent.createChooser(sendIntent, "Choose App to Paste Into").apply {
                    if (context !is Activity) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                runCatching { context.startActivity(chooser) }
                    .onFailure { err ->
                        Log.e("CordonSandbox", "chooserLaunchFailed err=${err.message}")
                        Toast.makeText(context, "No app accepted the text", Toast.LENGTH_SHORT).show()
                    }
            },
            onSendToCloud = onSendScrubbedToCloud,
            cloudResult = state.currentResult?.resolution,
            inferenceSource = state.currentResult?.inferenceSource?.name,
            isRunning = state.isRunning,
            offlineMode = state.offlineMode,
        )
    }
}

@Composable
private fun ProtectionHeroCard(
    isAccessibilityEnabled: Boolean,
    isShieldPaused: Boolean,
    totalSecretsBlocked: Int,
    guardedAppCount: Int,
    nanoReady: Boolean,
    onEnableAccessibility: () -> Unit,
    onResumeShield: () -> Unit,
) {
    val tokens = LocalFirstThemeTokens.colors
    val isActive = isAccessibilityEnabled && !isShieldPaused
    val engineLabel = if (nanoReady) ShieldStore.ENGINE_NANO else ShieldStore.ENGINE_ON_DEVICE
    val engineColor = if (nanoReady) tokens.infoText else tokens.textMuted
    val accent = when {
        isActive -> tokens.safeBorder
        isAccessibilityEnabled -> tokens.warnBorder
        else -> tokens.maskBorder
    }
    val statusText = when {
        isActive -> "Protection Active"
        isAccessibilityEnabled -> "Shield Paused"
        else -> "Shield Off"
    }
    val subtitle = when {
        isActive -> "Watching $guardedAppCount apps · secrets are blocked before they leave"
        isAccessibilityEnabled -> "Paused · your next message is not protected"
        else -> "Turn on Accessibility to guard $guardedAppCount apps"
    }

    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.5.dp, accent),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier.size(42.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Surface(
                        color = if (isActive) tokens.safeBg else tokens.warnBg,
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxSize(),
                    ) {}
                    Icon(
                        imageVector = if (isActive) Icons.Default.Shield else Icons.Default.PauseCircle,
                        contentDescription = null,
                        tint = if (isActive) tokens.safeText else tokens.warnText,
                        modifier = Modifier.size(22.dp),
                    )
                }
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .padding(start = 12.dp),
                ) {
                    Text(
                        text = statusText,
                        fontWeight = FontWeight.Bold,
                        fontSize = 17.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = subtitle,
                        fontSize = 11.5.sp,
                        lineHeight = 15.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Surface(
                    color = if (isActive) tokens.safeBg else tokens.warnBg,
                    border = BorderStroke(1.dp, accent),
                    shape = RoundedCornerShape(50),
                ) {
                    Text(
                        text = if (isActive) "ON" else "OFF",
                        color = if (isActive) tokens.safeText else tokens.warnText,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 10.sp,
                        modifier = Modifier.padding(horizontal = 9.dp, vertical = 4.dp),
                    )
                }
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    color = if (nanoReady) tokens.infoBg else tokens.subtleSurface,
                    border = BorderStroke(
                        1.dp,
                        if (nanoReady) tokens.infoBorder else tokens.borderSubtle,
                    ),
                    shape = RoundedCornerShape(50),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(horizontal = 9.dp, vertical = 4.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Default.Security,
                            contentDescription = null,
                            tint = engineColor,
                            modifier = Modifier.size(12.dp),
                        )
                        Text(
                            text = engineLabel,
                            color = engineColor,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 10.5.sp,
                            modifier = Modifier.padding(start = 5.dp),
                        )
                    }
                }
            }

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(1.dp),
            ) {
                Surface(
                    color = tokens.borderSubtle,
                    modifier = Modifier.fillMaxSize(),
                ) {}
            }

            Row(modifier = Modifier.fillMaxWidth()) {
                KpiColumn(
                    value = totalSecretsBlocked.toString(),
                    label = "Blocked",
                    valueColor = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f),
                )
                KpiDivider()
                KpiColumn(
                    value = guardedAppCount.toString(),
                    label = "Guarded Apps",
                    valueColor = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f),
                )
                KpiDivider()
                KpiColumn(
                    value = "0",
                    label = "Leaked",
                    valueColor = tokens.safeText,
                    modifier = Modifier.weight(1f),
                )
            }

            when {
                !isAccessibilityEnabled -> Button(
                    onClick = onEnableAccessibility,
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Default.Security, contentDescription = null, modifier = Modifier.size(16.dp))
                    Text(
                        text = "Enable Accessibility Shield",
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(start = 6.dp),
                    )
                }

                isShieldPaused -> OutlinedButton(
                    onClick = onResumeShield,
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Resume Shield", fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun KpiColumn(
    value: String,
    label: String,
    valueColor: Color,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(1.dp),
    ) {
        Text(
            text = value,
            fontWeight = FontWeight.Bold,
            fontSize = 19.sp,
            color = valueColor,
        )
        Text(
            text = label,
            fontSize = 10.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun KpiDivider() {
    val tokens = LocalFirstThemeTokens.colors
    Box(
        modifier = Modifier
            .width(1.dp)
            .height(28.dp),
    ) {
        Surface(color = tokens.borderSubtle, modifier = Modifier.fillMaxSize()) {}
    }
}

@Composable
private fun ProtectionDialStrip(
    selected: ProtectionLevel,
    onSelect: (ProtectionLevel) -> Unit,
) {
    val tokens = LocalFirstThemeTokens.colors
    Surface(
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, tokens.borderSubtle),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Protection Dial",
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = selected.name,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    fontSize = 10.sp,
                    color = tokens.safeText,
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                ProtectionLevel.entries.forEach { level ->
                    val isSelected = level == selected
                    Surface(
                        onClick = { onSelect(level) },
                        color = if (isSelected) tokens.safeBg else tokens.subtleSurface,
                        contentColor = if (isSelected) tokens.safeText else MaterialTheme.colorScheme.onSurfaceVariant,
                        border = BorderStroke(1.dp, if (isSelected) tokens.safeBorder else tokens.borderSubtle),
                        shape = RoundedCornerShape(50),
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(
                            text = level.name.lowercase().replaceFirstChar { it.uppercase() },
                            fontSize = 11.5.sp,
                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(vertical = 7.dp),
                        )
                    }
                }
            }
            Text(
                text = protectionLevelExplanation(selected),
                fontSize = 10.5.sp,
                lineHeight = 14.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ThreeStepFlowStrip() {
    val tokens = LocalFirstThemeTokens.colors
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        FlowStepPill(
            step = "1",
            label = "Detect",
            icon = { tint -> Icon(Icons.Default.Search, contentDescription = null, tint = tint, modifier = Modifier.size(14.dp)) },
            tint = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
        FlowStepPill(
            step = "2",
            label = "Lock & Scrub",
            icon = { tint -> Icon(Icons.Default.Lock, contentDescription = null, tint = tint, modifier = Modifier.size(14.dp)) },
            tint = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
        FlowStepPill(
            step = "3",
            label = "Zero-PII",
            icon = { tint -> Icon(Icons.Default.VerifiedUser, contentDescription = null, tint = tint, modifier = Modifier.size(14.dp)) },
            tint = tokens.safeText,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun FlowStepPill(
    step: String,
    label: String,
    icon: @Composable (Color) -> Unit,
    tint: Color,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalFirstThemeTokens.colors
    Surface(
        color = tokens.subtleSurface,
        border = BorderStroke(1.dp, tokens.borderSubtle),
        shape = RoundedCornerShape(10.dp),
        modifier = modifier,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            icon(tint)
            Text(
                text = "$step $label",
                fontSize = 10.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = tint,
                maxLines = 1,
                modifier = Modifier.padding(start = 5.dp),
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SandboxCard(
    expanded: Boolean,
    onToggleExpanded: () -> Unit,
    input: String,
    onInputChange: (String) -> Unit,
    sanitizedOutput: String?,
    spans: List<RedactionSpan>,
    onLoadSample: () -> Unit,
    onScrub: () -> Unit,
    onChooseApp: (String) -> Unit,
    onSendToCloud: (String) -> Unit,
    cloudResult: String?,
    inferenceSource: String?,
    isRunning: Boolean,
    offlineMode: Boolean,
) {
    val tokens = LocalFirstThemeTokens.colors
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, tokens.borderSubtle),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Quick Sandbox",
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = "Try the scrubber without leaving the app",
                        fontSize = 11.5.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                TextButton(onClick = onToggleExpanded) {
                    Text(if (expanded) "Hide" else "Open", fontSize = 12.sp)
                    Icon(
                        imageVector = if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }

            AnimatedVisibility(visible = expanded) {
                Column(
                    modifier = Modifier.padding(top = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    OutlinedTextField(
                        value = input,
                        onValueChange = onInputChange,
                        label = { Text("Paste text with keys, emails, or PII") },
                        minLines = 3,
                        maxLines = 6,
                        shape = RoundedCornerShape(12.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = MaterialTheme.colorScheme.primary,
                            unfocusedBorderColor = tokens.borderSubtle,
                            focusedLabelColor = MaterialTheme.colorScheme.primary,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        OutlinedButton(
                            onClick = onLoadSample,
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                            modifier = Modifier.heightIn(min = 40.dp),
                        ) {
                            Text("Load Sample", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        }
                        Button(
                            onClick = onScrub,
                            enabled = input.isNotBlank(),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.primary,
                                contentColor = MaterialTheme.colorScheme.onPrimary,
                            ),
                            modifier = Modifier
                                .weight(1f)
                                .heightIn(min = 40.dp),
                        ) {
                            Icon(Icons.Default.Shield, contentDescription = null, modifier = Modifier.size(16.dp))
                            Text(
                                text = "Scrub Locally",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(start = 6.dp),
                            )
                        }
                    }

                    if (sanitizedOutput != null) {
                        Surface(
                            color = tokens.safeBg,
                            border = BorderStroke(1.dp, tokens.safeBorder),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(
                                modifier = Modifier.padding(12.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(
                                        Icons.Default.CheckCircle,
                                        contentDescription = null,
                                        tint = tokens.safeText,
                                        modifier = Modifier.size(15.dp),
                                    )
                                    Text(
                                        text = " Scrubbed · ${ShieldStore.categoryCounts(spans).values.sum()} blocked · 0 Leaked",
                                        color = tokens.safeText,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 11.5.sp,
                                    )
                                }
                                Text(
                                    text = sanitizedOutput,
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 11.5.sp,
                                    lineHeight = 16.sp,
                                    color = MaterialTheme.colorScheme.onSurface,
                                )
                                if (spans.isNotEmpty()) {
                                    FlowRow(
                                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                                        verticalArrangement = Arrangement.spacedBy(4.dp),
                                    ) {
                                        ShieldStore.orderedCategories(ShieldStore.categoryCounts(spans)).forEach { (category, count) ->
                                            Surface(
                                                color = MaterialTheme.colorScheme.surface,
                                                border = BorderStroke(1.dp, tokens.safeBorder),
                                                shape = RoundedCornerShape(6.dp),
                                            ) {
                                                Text(
                                                    text = ShieldStore.categoryChip(category, count),
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
                            onClick = { onChooseApp(sanitizedOutput) },
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.primary,
                                contentColor = MaterialTheme.colorScheme.onPrimary,
                            ),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(15.dp))
                            Text(
                                text = "Choose App to Paste Into",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(start = 6.dp),
                            )
                        }

                        OutlinedButton(
                            onClick = { onSendToCloud(sanitizedOutput) },
                            enabled = !isRunning && !offlineMode,
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            if (isRunning) {
                                CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                            } else {
                                Icon(Icons.Default.Cloud, contentDescription = null, modifier = Modifier.size(16.dp))
                            }
                            Text(
                                text = if (offlineMode) {
                                    "Offline Mode — Cloud AI Disabled"
                                } else {
                                    "Send Scrubbed Text to Cloud AI"
                                },
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.padding(start = 6.dp),
                            )
                            if (!offlineMode && !isRunning) {
                                Spacer(Modifier.size(4.dp))
                                Icon(
                                    Icons.AutoMirrored.Filled.Send,
                                    contentDescription = null,
                                    modifier = Modifier.size(14.dp),
                                )
                            }
                        }

                        if (cloudResult != null && cloudResult.isNotBlank()) {
                            CloudResponseCard(text = cloudResult, inferenceSource = inferenceSource)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CloudResponseCard(text: String, inferenceSource: String?) {
    val tokens = LocalFirstThemeTokens.colors
    Surface(
        color = tokens.infoBg,
        border = BorderStroke(1.dp, tokens.infoBorder),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = "Cloud AI Response · 0 raw PII left device",
                    fontWeight = FontWeight.Bold,
                    fontSize = 11.sp,
                    color = tokens.infoText,
                    modifier = Modifier.weight(1f),
                )
                if (inferenceSource != null) {
                    val servedInCloud = inferenceSource == "IN_CLOUD"
                    Surface(
                        color = if (servedInCloud) tokens.infoBg else tokens.safeBg,
                        border = BorderStroke(1.dp, if (servedInCloud) tokens.infoBorder else tokens.safeBorder),
                        shape = RoundedCornerShape(6.dp),
                    ) {
                        Text(
                            text = inferenceSource,
                            fontSize = 9.5.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (servedInCloud) tokens.infoText else tokens.safeText,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                        )
                    }
                }
            }
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 220.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                CloudMarkdownFormatter.parse(text).forEach { block ->
                    Text(
                        text = if (block.isBullet) "• ${block.text}" else block.text,
                        fontWeight = if (block.isHeading) FontWeight.Bold else FontWeight.Normal,
                        fontSize = if (block.isHeading) 12.sp else 11.5.sp,
                        lineHeight = 16.sp,
                        color = if (block.isHeading) tokens.infoText else MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.padding(
                            start = if (block.isBullet) 6.dp else 0.dp,
                            top = if (block.isHeading) 3.dp else 0.dp,
                        ),
                    )
                }
            }
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
