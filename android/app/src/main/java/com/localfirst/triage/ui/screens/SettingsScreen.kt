package com.localfirst.triage.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.Security
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.localfirst.triage.data.GuardedAppSpec
import com.localfirst.triage.data.ShieldStore
import com.localfirst.triage.model.NanoStatus
import com.localfirst.triage.model.ProtectionLevel
import com.localfirst.triage.ui.theme.AppThemeMode
import com.localfirst.triage.ui.theme.LocalFirstThemeTokens

@Composable
fun SettingsScreen(
    isAccessibilityEnabled: Boolean,
    isShieldPaused: Boolean,
    guardedAppsState: Map<String, Boolean>,
    protectionLevel: ProtectionLevel,
    themeMode: AppThemeMode,
    nanoStatus: NanoStatus,
    onOpenAccessibilitySettings: () -> Unit,
    onToggleShieldPaused: (Boolean) -> Unit,
    onToggleGuardedApp: (packageName: String, enabled: Boolean) -> Unit,
    onSelectProtectionLevel: (ProtectionLevel) -> Unit,
    onSelectThemeMode: (AppThemeMode) -> Unit,
    onOpenModelSetup: () -> Unit,
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
        // 1. Background Shield (Accessibility Service)
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            border = BorderStroke(1.dp, tokens.borderSubtle),
            shape = RoundedCornerShape(14.dp),
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
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
                            imageVector = Icons.Default.Security,
                            contentDescription = null,
                            tint = tokens.safeText,
                        )
                        Column {
                            Text(
                                text = "Background Shield",
                                fontWeight = FontWeight.Bold,
                                fontSize = 15.sp,
                            )
                            Text(
                                text = if (isAccessibilityEnabled) {
                                    "Accessibility Service enabled"
                                } else {
                                    "Accessibility Service not enabled"
                                },
                                fontSize = 11.5.sp,
                                color = if (isAccessibilityEnabled) tokens.safeText else tokens.warnText,
                            )
                        }
                    }

                    if (isAccessibilityEnabled) {
                        Switch(
                            checked = !isShieldPaused,
                            onCheckedChange = { active -> onToggleShieldPaused(!active) },
                        )
                    } else {
                        Surface(
                            color = tokens.warnBg,
                            border = BorderStroke(1.dp, tokens.warnBorder),
                            shape = RoundedCornerShape(6.dp),
                        ) {
                            Text(
                                text = "OFF",
                                color = tokens.warnText,
                                fontFamily = FontFamily.Monospace,
                                fontWeight = FontWeight.Bold,
                                fontSize = 10.sp,
                                modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp),
                            )
                        }
                    }
                }

                Surface(
                    color = tokens.subtleSurface,
                    border = BorderStroke(1.dp, tokens.borderSubtle),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(
                        modifier = Modifier.padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(
                            text = "2-Step Setup",
                            fontWeight = FontWeight.Bold,
                            fontSize = 11.5.sp,
                        )
                        Text(
                            text = "1. Tap Open Accessibility Settings below.\n2. Select Cordon Privacy Shield and toggle Use Cordon ON.",
                            fontSize = 11.5.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                Button(
                    onClick = onOpenAccessibilitySettings,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Open Accessibility Settings", fontWeight = FontWeight.Bold)
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.OpenInNew,
                        contentDescription = null,
                        modifier = Modifier
                            .padding(start = 6.dp)
                            .size(16.dp),
                    )
                }
            }
        }

        // 2. Guarded Apps
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            border = BorderStroke(1.dp, tokens.borderSubtle),
            shape = RoundedCornerShape(14.dp),
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    text = "Guarded Apps",
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                )
                Text(
                    text = "Cordon monitors only enabled apps and ignores password fields.",
                    fontSize = 11.5.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 4.dp),
                )

                ShieldStore.DEFAULT_GUARDED_APPS.forEachIndexed { idx: Int, app: GuardedAppSpec ->
                    val checked = guardedAppsState[app.packageName] ?: app.defaultEnabled
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column {
                            Text(
                                text = app.displayName,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 13.5.sp,
                            )
                            Text(
                                text = app.packageName,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 10.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Switch(
                            checked = checked,
                            onCheckedChange = { enabled -> onToggleGuardedApp(app.packageName, enabled) },
                        )
                    }
                    if (idx < ShieldStore.DEFAULT_GUARDED_APPS.lastIndex) {
                        HorizontalDivider(color = tokens.borderSubtle)
                    }
                }
            }
        }

        // 3. Protection Dial
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
                    text = "Protection Dial",
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                )
                Text(
                    text = "Controls sensitivity for Quick Sandbox, Text Selection, and Background Shield.",
                    fontSize = 11.5.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    ProtectionLevel.entries.forEach { level ->
                        FilterChip(
                            selected = protectionLevel == level,
                            onClick = { onSelectProtectionLevel(level) },
                            label = {
                                Text(
                                    text = level.name.lowercase().replaceFirstChar { it.uppercase() },
                                    fontWeight = FontWeight.SemiBold,
                                )
                            },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }

        // 4. Appearance
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
                    text = "Appearance",
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    AppThemeMode.entries.forEach { mode ->
                        val label = when (mode) {
                            AppThemeMode.SYSTEM -> "System"
                            AppThemeMode.LIGHT -> "Light"
                            AppThemeMode.DARK -> "Dark"
                        }
                        FilterChip(
                            selected = themeMode == mode,
                            onClick = { onSelectThemeMode(mode) },
                            label = { Text(label, fontWeight = FontWeight.SemiBold) },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }

        // 5. On-Device Model Setup
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            border = BorderStroke(1.dp, tokens.borderSubtle),
            shape = RoundedCornerShape(14.dp),
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(Icons.Default.Memory, contentDescription = null, tint = tokens.infoText)
                    Column {
                        Text(
                            text = "On-Device Model Setup",
                            fontWeight = FontWeight.Bold,
                            fontSize = 15.sp,
                        )
                        Text(
                            text = if (nanoStatus == NanoStatus.READY) {
                                "Gemini Nano (AICore) is Ready"
                            } else {
                                "Status: ${nanoStatus.name}"
                            },
                            fontSize = 11.5.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                OutlinedButton(
                    onClick = onOpenModelSetup,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Open First-Run Setup / AICore Check", fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}
