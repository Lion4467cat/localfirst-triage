package com.localfirst.triage.ui.screens

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.util.Log
import android.util.LruCache
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Apps
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.PauseCircle
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.localfirst.triage.BuildConfig
import com.localfirst.triage.data.InstalledApp
import com.localfirst.triage.data.InstalledAppCatalog
import com.localfirst.triage.data.ShieldStore
import com.localfirst.triage.ai.NanoDownloadState
import com.localfirst.triage.model.NanoStatus
import com.localfirst.triage.model.ProtectionLevel
import com.localfirst.triage.ui.protectionLevelExplanation
import com.localfirst.triage.ui.theme.AppThemeMode
import com.localfirst.triage.ui.theme.LocalFirstThemeTokens
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** User-facing wording for the on-device model state; never the raw enum name. */
private fun nanoStatusSentence(
    status: NanoStatus,
    download: NanoDownloadState?,
    modelName: String?,
): String = when (status) {
    NanoStatus.READY -> (modelName ?: download?.modelName)?.let { "Gemini Nano (AICore) ready · $it" }
        ?: "Gemini Nano (AICore) is ready"
    NanoStatus.DOWNLOADABLE -> "On-device AI is available to download"
    NanoStatus.MODEL_DOWNLOADING -> download?.detailLabel ?: "AI model downloading…"
    NanoStatus.UNAVAILABLE -> "On-device AI unavailable — using deterministic rules"
}

@Composable
fun SettingsScreen(
    isAccessibilityEnabled: Boolean,
    isShieldPaused: Boolean,
    guardedAppsState: Map<String, Boolean>,
    protectionLevel: ProtectionLevel,
    themeMode: AppThemeMode,
    nanoStatus: NanoStatus,
    nanoDownload: NanoDownloadState? = null,
    nanoModelName: String? = null,
    onOpenAccessibilitySettings: () -> Unit,
    onToggleShieldPaused: (Boolean) -> Unit,
    onToggleGuardedApp: (packageName: String, enabled: Boolean) -> Unit,
    onSelectProtectionLevel: (ProtectionLevel) -> Unit,
    onSelectThemeMode: (AppThemeMode) -> Unit,
    onOpenModelSetup: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalFirstThemeTokens.colors
    val context = LocalContext.current

    var installedApps by remember { mutableStateOf<List<InstalledApp>?>(null) }
    var query by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        installedApps = withContext(Dispatchers.IO) { InstalledAppCatalog.load(context) }
    }

    val apps = installedApps.orEmpty()
    val visibleApps = remember(apps, query, guardedAppsState) {
        InstalledAppCatalog.filter(apps, query) { guardedAppsState[it] == true }
    }
    // Only installed apps count: a default entry for an app the user does not have is not guarded.
    val enabledCount = apps.count { guardedAppsState[it.packageName] == true }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (isAccessibilityEnabled) {
            CompactShieldStatusCard(
                paused = isShieldPaused,
                onTogglePaused = onToggleShieldPaused,
                onManage = onOpenAccessibilitySettings,
            )
        } else {
            EnableShieldCard(onEnable = onOpenAccessibilitySettings)
        }

        GuardedAppsCard(
            enabledCount = enabledCount,
            query = query,
            onQueryChange = { query = it },
            appsLoaded = installedApps != null,
            visibleApps = visibleApps,
            totalApps = apps.size,
            guardedAppsState = guardedAppsState,
            onToggleGuardedApp = onToggleGuardedApp,
        )

        ProtectionDialCard(
            selected = protectionLevel,
            onSelect = onSelectProtectionLevel,
        )

        AppearanceCard(themeMode = themeMode, onSelect = onSelectThemeMode)

        ModelSetupCard(
            nanoStatus = nanoStatus,
            nanoDownload = nanoDownload,
            nanoModelName = nanoModelName,
            onOpenModelSetup = onOpenModelSetup,
        )

        AboutCard()
    }
}

@Composable
private fun EnableShieldCard(onEnable: () -> Unit) {
    val tokens = LocalFirstThemeTokens.colors
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.5.dp, tokens.maskBorder),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    color = tokens.maskBg,
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Icon(
                        imageVector = Icons.Default.Security,
                        contentDescription = null,
                        tint = tokens.maskText,
                        modifier = Modifier.padding(7.dp).size(20.dp),
                    )
                }
                Column(modifier = Modifier.padding(start = 10.dp)) {
                    Text(
                        text = "Accessibility Shield is off",
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = "Cordon cannot watch message fields until Android allows it.",
                        fontSize = 11.5.sp,
                        lineHeight = 15.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Text(
                text = "1. Tap Enable and find Cordon Privacy Shield.\n" +
                    "2. Turn Cordon Privacy Shield on, then come back here.",
                fontSize = 11.5.sp,
                lineHeight = 17.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Button(
                onClick = onEnable,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ),
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 10.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Enable Accessibility Shield", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.OpenInNew,
                    contentDescription = null,
                    modifier = Modifier.padding(start = 6.dp).size(15.dp),
                )
            }
        }
    }
}

@Composable
private fun CompactShieldStatusCard(
    paused: Boolean,
    onTogglePaused: (Boolean) -> Unit,
    onManage: () -> Unit,
) {
    val tokens = LocalFirstThemeTokens.colors
    Surface(
        color = tokens.subtleSurface,
        border = BorderStroke(1.dp, tokens.borderSubtle),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = if (paused) Icons.Default.PauseCircle else Icons.Default.Shield,
                    contentDescription = null,
                    tint = if (paused) tokens.warnText else tokens.safeText,
                    modifier = Modifier.size(18.dp),
                )
                Text(
                    text = "Background Shield",
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.5.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(start = 8.dp),
                )
                Text(
                    text = "· ${if (paused) "Paused" else "Active"}",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = if (paused) tokens.warnText else tokens.safeText,
                )
                Spacer(Modifier.weight(1f))
                TextButton(
                    onClick = onManage,
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                    modifier = Modifier.height(28.dp),
                ) {
                    Text("Manage ↗", fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = if (paused) {
                        "Paused — messages are not being checked."
                    } else {
                        "Watching enabled apps in the background."
                    },
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                TextButton(
                    onClick = { onTogglePaused(!paused) },
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                    modifier = Modifier.height(26.dp),
                ) {
                    Text(
                        text = if (paused) "Resume" else "Pause",
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (paused) tokens.safeText else tokens.textMuted,
                    )
                }
            }
        }
    }
}

@Composable
private fun GuardedAppsCard(
    enabledCount: Int,
    query: String,
    onQueryChange: (String) -> Unit,
    appsLoaded: Boolean,
    visibleApps: List<InstalledApp>,
    totalApps: Int,
    guardedAppsState: Map<String, Boolean>,
    onToggleGuardedApp: (String, Boolean) -> Unit,
) {
    val tokens = LocalFirstThemeTokens.colors
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, tokens.borderSubtle),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "Guarded Apps",
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.weight(1f),
                    )
                    Surface(
                        color = tokens.safeBg,
                        border = BorderStroke(1.dp, tokens.safeBorder),
                        shape = RoundedCornerShape(50),
                    ) {
                        Text(
                            text = if (appsLoaded && totalApps > 0) "$enabledCount of $totalApps guarded" else "$enabledCount guarded",
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                            fontSize = 10.sp,
                            color = tokens.safeText,
                            modifier = Modifier.padding(horizontal = 9.dp, vertical = 3.dp),
                        )
                    }
                }
                Text(
                    text = "Guard any app · password fields are always ignored",
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            OutlinedTextField(
                value = query,
                onValueChange = onQueryChange,
                placeholder = { Text("Search installed apps…", fontSize = 12.5.sp) },
                leadingIcon = {
                    Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(18.dp))
                },
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    unfocusedBorderColor = tokens.borderSubtle,
                ),
                modifier = Modifier.fillMaxWidth(),
            )

            if (!appsLoaded) {
                Text(
                    text = "Loading installed apps…",
                    fontSize = 11.5.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 10.dp),
                )
            } else if (visibleApps.isEmpty()) {
                Text(
                    text = "No installed app matches “$query”.",
                    fontSize = 11.5.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 10.dp),
                )
            } else {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(360.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    items(visibleApps, key = { it.packageName }) { app ->
                        AppRow(
                            app = app,
                            checked = guardedAppsState[app.packageName] ?: false,
                            showPackage = query.isNotBlank(),
                            onToggle = { enabled -> onToggleGuardedApp(app.packageName, enabled) },
                        )
                    }
                }
                Text(
                    text = "Showing ${visibleApps.size} of $totalApps apps",
                    fontSize = 10.sp,
                    color = tokens.textMuted,
                )
            }
        }
    }
}

@Composable
private fun AppRow(
    app: InstalledApp,
    checked: Boolean,
    showPackage: Boolean,
    onToggle: (Boolean) -> Unit,
) {
    val tokens = LocalFirstThemeTokens.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AppIcon(packageName = app.packageName, size = 34.dp)
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = 10.dp),
        ) {
            Text(
                text = app.label,
                fontWeight = FontWeight.SemiBold,
                fontSize = 13.sp,
                maxLines = 1,
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (showPackage) {
                Text(
                    text = app.packageName,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 9.5.sp,
                    maxLines = 1,
                    color = tokens.textMuted,
                )
            }
        }
        Switch(checked = checked, onCheckedChange = onToggle)
    }
}

private object AppIconCache {
    private const val TAG = "CordonIcons"
    private val cache = LruCache<String, ImageBitmap>(96)

    fun peek(packageName: String): ImageBitmap? = synchronized(cache) { cache.get(packageName) }

    fun load(context: Context, packageName: String): ImageBitmap? {
        peek(packageName)?.let { return it }
        val icon = runCatching {
            val pm = context.packageManager
            val drawable = pm.getApplicationIcon(packageName)
            val size = 96
            val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            drawable.setBounds(0, 0, size, size)
            drawable.draw(canvas)
            bitmap.asImageBitmap()
        }.getOrNull()
        if (icon == null) {
            Log.w(TAG, "iconLoadFailed pkg=$packageName")
            return null
        }
        synchronized(cache) { cache.put(packageName, icon) }
        return icon
    }
}

@Composable
private fun AppIcon(packageName: String, size: Dp) {
    val tokens = LocalFirstThemeTokens.colors
    val context = LocalContext.current
    val icon by produceState<ImageBitmap?>(
        initialValue = AppIconCache.peek(packageName),
        key1 = packageName,
    ) {
        if (value == null) {
            value = withContext(Dispatchers.IO) { AppIconCache.load(context, packageName) }
        }
    }
    val shape = RoundedCornerShape(9.dp)
    val loaded = icon
    if (loaded != null) {
        Image(
            bitmap = loaded,
            contentDescription = null,
            modifier = Modifier
                .size(size)
                .clip(shape),
        )
    } else {
        Box(
            modifier = Modifier
                .size(size)
                .clip(shape)
                .background(tokens.subtleSurface),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Default.Apps,
                contentDescription = null,
                tint = tokens.textMuted,
                modifier = Modifier.size(size / 2),
            )
        }
    }
}

@Composable
private fun ProtectionDialCard(
    selected: ProtectionLevel,
    onSelect: (ProtectionLevel) -> Unit,
) {
    val tokens = LocalFirstThemeTokens.colors
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, tokens.borderSubtle),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "Protection Dial",
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = "Controls how aggressively Cordon scrubs in the sandbox and the background shield.",
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            ProtectionLevel.entries.forEach { level ->
                val isSelected = level == selected
                Surface(
                    onClick = { onSelect(level) },
                    color = if (isSelected) tokens.safeBg else tokens.subtleSurface,
                    border = BorderStroke(1.dp, if (isSelected) tokens.safeBorder else tokens.borderSubtle),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            imageVector = if (isSelected) Icons.Default.Check else Icons.Default.Shield,
                            contentDescription = null,
                            tint = if (isSelected) tokens.safeText else tokens.textMuted,
                            modifier = Modifier.size(15.dp),
                        )
                        Column(modifier = Modifier.padding(start = 8.dp)) {
                            Text(
                                text = level.name.lowercase().replaceFirstChar { it.uppercase() },
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 12.5.sp,
                                color = if (isSelected) tokens.safeText else MaterialTheme.colorScheme.onSurface,
                            )
                            Text(
                                text = protectionLevelExplanation(level),
                                fontSize = 10.5.sp,
                                lineHeight = 14.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AppearanceCard(
    themeMode: AppThemeMode,
    onSelect: (AppThemeMode) -> Unit,
) {
    val tokens = LocalFirstThemeTokens.colors
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, tokens.borderSubtle),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "Appearance",
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                AppThemeMode.entries.forEach { mode ->
                    val label = when (mode) {
                        AppThemeMode.SYSTEM -> "Auto"
                        AppThemeMode.LIGHT -> "Light"
                        AppThemeMode.DARK -> "Dark"
                    }
                    FilterChip(
                        selected = themeMode == mode,
                        onClick = { onSelect(mode) },
                        label = { Text(label, fontWeight = FontWeight.SemiBold, fontSize = 12.sp) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = tokens.safeBg,
                            selectedLabelColor = tokens.safeText,
                        ),
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}

@Composable
private fun ModelSetupCard(
    nanoStatus: NanoStatus,
    nanoDownload: NanoDownloadState?,
    nanoModelName: String?,
    onOpenModelSetup: () -> Unit,
) {
    val tokens = LocalFirstThemeTokens.colors
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, tokens.borderSubtle),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Memory, contentDescription = null, tint = tokens.infoText)
                Column(modifier = Modifier.padding(start = 8.dp)) {
                    Text(
                        text = "On-Device Model Setup",
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = nanoStatusSentence(nanoStatus, nanoDownload, nanoModelName),
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            OutlinedButton(
                onClick = onOpenModelSetup,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Open First-Run Setup / AICore Check", fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp)
            }
        }
    }
}

@Composable
private fun AboutCard() {
    val tokens = LocalFirstThemeTokens.colors
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, tokens.borderSubtle),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "About Cordon",
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f),
                )
                Surface(
                    color = tokens.subtleSurface,
                    border = BorderStroke(1.dp, tokens.borderSubtle),
                    shape = RoundedCornerShape(50),
                ) {
                    Text(
                        text = "v${BuildConfig.VERSION_NAME}",
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 10.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                    )
                }
            }
            HorizontalDivider(color = tokens.borderSubtle)
            Text(
                text = "1. Detect secrets on-device  ·  2. Lock and scrub  ·  3. Send the safe version.",
                fontSize = 11.5.sp,
                lineHeight = 16.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = "Raw text never leaves this phone. History stores category counts only.",
                fontSize = 11.5.sp,
                lineHeight = 16.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
