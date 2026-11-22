package com.localfirst.triage

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BrightnessAuto
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.localfirst.triage.data.ShieldStore
import com.localfirst.triage.ui.TriageViewModel
import com.localfirst.triage.ui.screens.FirstRunSetupScreen
import com.localfirst.triage.ui.screens.HistoryScreen
import com.localfirst.triage.ui.screens.SettingsScreen
import com.localfirst.triage.ui.screens.ShieldScreen
import com.localfirst.triage.ui.theme.AppThemeMode
import com.localfirst.triage.ui.theme.LocalFirstTriageTheme

class MainActivity : ComponentActivity() {
    private val pendingSharedText = mutableStateOf<Pair<String, String?>?>(null)

    private fun extractSharedText(intent: Intent?) {
        if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            val shared = intent.getStringExtra(Intent.EXTRA_TEXT)
            val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)
            if (!shared.isNullOrBlank()) {
                pendingSharedText.value = shared to subject
            }
        }
    }

    private fun openAccessibilitySettingsSafely() {
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        runCatching {
            startActivity(intent)
        }.onFailure {
            runCatching {
                startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }.onFailure {
                Toast.makeText(this, "Open Android Settings > Accessibility > Cordon", Toast.LENGTH_LONG).show()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        extractSharedText(intent)
    }

    @OptIn(ExperimentalMaterial3Api::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        extractSharedText(intent)

        val prefs = ShieldStore.prefs(this)
        val initialMode = runCatching {
            AppThemeMode.valueOf(prefs.getString("theme_mode", AppThemeMode.SYSTEM.name) ?: AppThemeMode.SYSTEM.name)
        }.getOrDefault(AppThemeMode.SYSTEM)
        val initialLevel = ShieldStore.getProtectionLevel(this)

        setContent {
            var themeMode by remember { mutableStateOf(initialMode) }

            LocalFirstTriageTheme(themeMode = themeMode) {
                val vm: TriageViewModel = viewModel()
                val state by vm.uiState.collectAsStateWithLifecycle()
                var activeTab by rememberSaveable { mutableIntStateOf(0) }
                var showSetupScreen by rememberSaveable {
                    mutableStateOf(!prefs.getBoolean("cordon_setup_done", false))
                }
                val sharedPayload by pendingSharedText

                var isAccessibilityEnabled by remember {
                    mutableStateOf(ShieldStore.isAccessibilityServiceEnabled(this@MainActivity))
                }
                var isShieldPaused by remember {
                    mutableStateOf(ShieldStore.isShieldPaused(this@MainActivity))
                }
                var totalSecretsBlocked by remember {
                    mutableIntStateOf(ShieldStore.getTotalBlocked(this@MainActivity))
                }
                var historyEntries by remember {
                    mutableStateOf(ShieldStore.getHistory(this@MainActivity))
                }
                var guardedAppsState by remember {
                    mutableStateOf(ShieldStore.getGuardedAppsState(this@MainActivity))
                }

                fun refreshLocalShieldState() {
                    isAccessibilityEnabled = ShieldStore.isAccessibilityServiceEnabled(this@MainActivity)
                    isShieldPaused = ShieldStore.isShieldPaused(this@MainActivity)
                    totalSecretsBlocked = ShieldStore.getTotalBlocked(this@MainActivity)
                    historyEntries = ShieldStore.getHistory(this@MainActivity)
                    guardedAppsState = ShieldStore.getGuardedAppsState(this@MainActivity)
                }

                val lifecycleOwner = LocalLifecycleOwner.current
                DisposableEffect(lifecycleOwner, prefs) {
                    val observer = LifecycleEventObserver { _, event ->
                        if (event == Lifecycle.Event.ON_RESUME) {
                            refreshLocalShieldState()
                        }
                    }
                    val prefListener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ ->
                        refreshLocalShieldState()
                    }
                    lifecycleOwner.lifecycle.addObserver(observer)
                    prefs.registerOnSharedPreferenceChangeListener(prefListener)
                    onDispose {
                        lifecycleOwner.lifecycle.removeObserver(observer)
                        prefs.unregisterOnSharedPreferenceChangeListener(prefListener)
                    }
                }

                LaunchedEffect(Unit) {
                    if (vm.uiState.value.protectionLevel != initialLevel) {
                        vm.setProtectionLevel(initialLevel)
                    }
                }

                LaunchedEffect(sharedPayload) {
                    val payload = sharedPayload ?: return@LaunchedEffect
                    vm.ingestSharedText(payload.first, payload.second)
                    showSetupScreen = false
                    activeTab = 0
                    pendingSharedText.value = null
                }

                Scaffold(
                    containerColor = MaterialTheme.colorScheme.background,
                    topBar = {
                        TopAppBar(
                            colors = TopAppBarDefaults.topAppBarColors(
                                containerColor = MaterialTheme.colorScheme.surface,
                                titleContentColor = MaterialTheme.colorScheme.onSurface,
                            ),
                            title = {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Image(
                                        painter = painterResource(id = R.drawable.ic_brand_logo),
                                        contentDescription = "Cordon Airgap Logo",
                                        modifier = Modifier
                                            .padding(end = 10.dp)
                                            .size(28.dp),
                                    )
                                    Column {
                                        Text(
                                            text = "Cordon",
                                            fontWeight = FontWeight.Bold,
                                            fontSize = 17.sp,
                                        )
                                        Text(
                                            text = "On-Device Privacy Firewall · Zero-PII",
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            fontSize = 11.sp,
                                        )
                                    }
                                }
                            },
                            actions = {
                                if (showSetupScreen) {
                                    TextButton(onClick = { showSetupScreen = false }) {
                                        Text(
                                            text = "Close",
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.SemiBold,
                                        )
                                    }
                                }
                                TextButton(
                                    onClick = {
                                        val nextMode = themeMode.next()
                                        themeMode = nextMode
                                        prefs.edit().putString("theme_mode", nextMode.name).apply()
                                    },
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(
                                            imageVector = when (themeMode) {
                                                AppThemeMode.SYSTEM -> Icons.Default.BrightnessAuto
                                                AppThemeMode.LIGHT -> Icons.Default.LightMode
                                                AppThemeMode.DARK -> Icons.Default.DarkMode
                                            },
                                            contentDescription = "Cycle theme",
                                            modifier = Modifier.padding(end = 4.dp),
                                        )
                                        Text(
                                            text = themeMode.shortLabel,
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.SemiBold,
                                        )
                                    }
                                }
                            },
                        )
                    },
                    bottomBar = {
                        if (!showSetupScreen) {
                            NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                                NavigationBarItem(
                                    selected = activeTab == 0,
                                    onClick = { activeTab = 0 },
                                    icon = { Icon(Icons.Default.Shield, contentDescription = null) },
                                    label = { Text("Shield", fontSize = 11.sp) },
                                )
                                NavigationBarItem(
                                    selected = activeTab == 1,
                                    onClick = { activeTab = 1 },
                                    icon = { Icon(Icons.Default.History, contentDescription = null) },
                                    label = { Text("History", fontSize = 11.sp) },
                                )
                                NavigationBarItem(
                                    selected = activeTab == 2,
                                    onClick = { activeTab = 2 },
                                    icon = { Icon(Icons.Default.Settings, contentDescription = null) },
                                    label = { Text("Settings", fontSize = 11.sp) },
                                )
                            }
                        }
                    },
                ) { innerPadding ->
                    if (showSetupScreen) {
                        FirstRunSetupScreen(
                            state = state,
                            onRecheckNano = vm::refreshNanoStatus,
                            onWarmupNano = vm::downloadAndWarmUpNano,
                            onCompleteSetup = {
                                prefs.edit()
                                    .putBoolean("cordon_setup_done", true)
                                    .putBoolean("cordon_deterministic_only", false)
                                    .apply()
                                showSetupScreen = false
                            },
                            onConfirmDeterministicOnly = {
                                prefs.edit()
                                    .putBoolean("cordon_setup_done", true)
                                    .putBoolean("cordon_deterministic_only", true)
                                    .apply()
                                showSetupScreen = false
                            },
                            modifier = Modifier.padding(innerPadding),
                        )
                    } else {
                        Crossfade(
                            targetState = activeTab,
                            animationSpec = tween(durationMillis = 180),
                            label = "cordon-tab-crossfade",
                        ) { tab ->
                            when (tab) {
                                0 -> ShieldScreen(
                                    state = state,
                                    isAccessibilityEnabled = isAccessibilityEnabled,
                                    isShieldPaused = isShieldPaused,
                                    totalSecretsBlocked = totalSecretsBlocked,
                                    onEnableAccessibility = ::openAccessibilitySettingsSafely,
                                    onResumeShield = {
                                        ShieldStore.setShieldPaused(this@MainActivity, false)
                                        refreshLocalShieldState()
                                    },
                                    onScrubSandbox = { rawText, _, spans, engineUsed ->
                                        vm.updateTitle("Quick Sandbox")
                                        vm.updateRawText(rawText)
                                        if (spans.isNotEmpty()) {
                                            ShieldStore.recordBlockEvent(
                                                context = this@MainActivity,
                                                appName = "Quick Sandbox",
                                                spans = spans,
                                                engineUsed = engineUsed,
                                            )
                                            refreshLocalShieldState()
                                        }
                                    },
                                    onSendScrubbedToCloud = { sanitizedText ->
                                        vm.updateTitle("Quick Sandbox")
                                        vm.updateRawText(sanitizedText)
                                        vm.runHybridTriage()
                                        vm.approveAndEscalateToCloud()
                                    },
                                    modifier = Modifier.padding(innerPadding),
                                )

                                1 -> HistoryScreen(
                                    entries = historyEntries,
                                    onClearHistory = {
                                        ShieldStore.clearHistory(this@MainActivity)
                                        refreshLocalShieldState()
                                    },
                                    modifier = Modifier.padding(innerPadding),
                                )

                                else -> SettingsScreen(
                                    isAccessibilityEnabled = isAccessibilityEnabled,
                                    isShieldPaused = isShieldPaused,
                                    guardedAppsState = guardedAppsState,
                                    protectionLevel = state.protectionLevel,
                                    themeMode = themeMode,
                                    nanoStatus = state.nanoStatus,
                                    onOpenAccessibilitySettings = ::openAccessibilitySettingsSafely,
                                    onToggleShieldPaused = { paused ->
                                        ShieldStore.setShieldPaused(this@MainActivity, paused)
                                        refreshLocalShieldState()
                                    },
                                    onToggleGuardedApp = { pkg, enabled ->
                                        ShieldStore.setGuardedAppEnabled(this@MainActivity, pkg, enabled)
                                        refreshLocalShieldState()
                                    },
                                    onSelectProtectionLevel = { level ->
                                        ShieldStore.setProtectionLevel(this@MainActivity, level)
                                        vm.setProtectionLevel(level)
                                    },
                                    onSelectThemeMode = { nextMode ->
                                        themeMode = nextMode
                                        prefs.edit().putString("theme_mode", nextMode.name).apply()
                                    },
                                    onOpenModelSetup = { showSetupScreen = true },
                                    modifier = Modifier.padding(innerPadding),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
