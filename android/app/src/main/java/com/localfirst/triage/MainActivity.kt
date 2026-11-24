package com.localfirst.triage

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.database.ContentObserver
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
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
import com.localfirst.triage.data.InstalledAppCatalog
import com.localfirst.triage.data.ShieldStore
import com.localfirst.triage.ui.TriageViewModel
import com.localfirst.triage.ui.screens.FirstRunSetupScreen
import com.localfirst.triage.ui.screens.HistoryScreen
import com.localfirst.triage.ui.screens.SettingsScreen
import com.localfirst.triage.ui.screens.ShieldScreen
import com.localfirst.triage.ui.theme.AppThemeMode
import com.localfirst.triage.ui.theme.LocalFirstTriageTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    private val pendingSharedText = mutableStateOf<Pair<String, String?>?>(null)
    private val windowFocusTick = mutableIntStateOf(0)

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            windowFocusTick.intValue++
        }
    }

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
                var installedPackages by remember { mutableStateOf<Set<String>?>(null) }

                LaunchedEffect(Unit) {
                    installedPackages = withContext(Dispatchers.IO) {
                        InstalledAppCatalog.load(this@MainActivity).map { it.packageName }.toSet()
                    }
                }

                // A default entry for an app that is not installed is not a guarded app.
                val guardedAppCount = installedPackages?.let { installed ->
                    guardedAppsState.count { (pkg, enabled) -> enabled && pkg in installed }
                } ?: guardedAppsState.count { it.value }

                fun refreshLocalShieldState() {
                    isAccessibilityEnabled = ShieldStore.isAccessibilityServiceEnabled(this@MainActivity)
                    isShieldPaused = ShieldStore.isShieldPaused(this@MainActivity)
                    totalSecretsBlocked = ShieldStore.getTotalBlocked(this@MainActivity)
                    historyEntries = ShieldStore.getHistory(this@MainActivity)
                    guardedAppsState = ShieldStore.getGuardedAppsState(this@MainActivity)
                }

                val focusTick by windowFocusTick
                LaunchedEffect(focusTick) {
                    if (focusTick > 0) {
                        refreshLocalShieldState()
                    }
                }

                val lifecycleOwner = LocalLifecycleOwner.current
                DisposableEffect(lifecycleOwner, prefs) {
                    val mainHandler = Handler(Looper.getMainLooper())
                    val delayedRecheck = Runnable { refreshLocalShieldState() }
                    val scheduleSettledRecheck = {
                        refreshLocalShieldState()
                        mainHandler.removeCallbacks(delayedRecheck)
                        mainHandler.postDelayed(delayedRecheck, 250L)
                    }
                    val observer = LifecycleEventObserver { _, event ->
                        if (event == Lifecycle.Event.ON_START || event == Lifecycle.Event.ON_RESUME) {
                            scheduleSettledRecheck()
                        }
                    }
                    val prefListener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ ->
                        refreshLocalShieldState()
                    }
                    val settingsObserver = object : ContentObserver(mainHandler) {
                        override fun onChange(selfChange: Boolean) {
                            scheduleSettledRecheck()
                        }
                    }
                    val accessibilityManager =
                        getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
                    val a11yStateListener = AccessibilityManager.AccessibilityStateChangeListener {
                        scheduleSettledRecheck()
                    }

                    lifecycleOwner.lifecycle.addObserver(observer)
                    prefs.registerOnSharedPreferenceChangeListener(prefListener)
                    runCatching {
                        contentResolver.registerContentObserver(
                            Settings.Secure.getUriFor(Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES),
                            false,
                            settingsObserver,
                        )
                        contentResolver.registerContentObserver(
                            Settings.Secure.getUriFor(Settings.Secure.ACCESSIBILITY_ENABLED),
                            false,
                            settingsObserver,
                        )
                    }
                    runCatching {
                        accessibilityManager?.addAccessibilityStateChangeListener(a11yStateListener)
                    }

                    onDispose {
                        mainHandler.removeCallbacks(delayedRecheck)
                        lifecycleOwner.lifecycle.removeObserver(observer)
                        prefs.unregisterOnSharedPreferenceChangeListener(prefListener)
                        runCatching { contentResolver.unregisterContentObserver(settingsObserver) }
                        runCatching {
                            accessibilityManager?.removeAccessibilityStateChangeListener(a11yStateListener)
                        }
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
                                Surface(
                                    onClick = {
                                        val nextMode = themeMode.next()
                                        themeMode = nextMode
                                        prefs.edit().putString("theme_mode", nextMode.name).apply()
                                    },
                                    shape = RoundedCornerShape(50),
                                    color = MaterialTheme.colorScheme.surfaceVariant,
                                    contentColor = MaterialTheme.colorScheme.onSurface,
                                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                                    modifier = Modifier.padding(end = 8.dp),
                                ) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                                    ) {
                                        Icon(
                                            imageVector = when (themeMode) {
                                                AppThemeMode.SYSTEM -> Icons.Default.BrightnessAuto
                                                AppThemeMode.LIGHT -> Icons.Default.LightMode
                                                AppThemeMode.DARK -> Icons.Default.DarkMode
                                            },
                                            contentDescription = "Theme: ${themeMode.shortLabel}",
                                            modifier = Modifier.size(14.dp),
                                        )
                                        Text(
                                            text = themeMode.shortLabel,
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            modifier = Modifier.padding(start = 5.dp),
                                        )
                                    }
                                }
                            },
                        )
                    },
                    bottomBar = {
                        if (!showSetupScreen) {
                            NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                                val itemColors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = MaterialTheme.colorScheme.onSurface,
                                    selectedTextColor = MaterialTheme.colorScheme.onSurface,
                                    indicatorColor = MaterialTheme.colorScheme.surfaceVariant,
                                    unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                    unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                NavigationBarItem(
                                    selected = activeTab == 0,
                                    onClick = { activeTab = 0 },
                                    icon = { Icon(Icons.Default.Shield, contentDescription = null) },
                                    label = { Text("Shield", fontSize = 11.sp) },
                                    colors = itemColors,
                                )
                                NavigationBarItem(
                                    selected = activeTab == 1,
                                    onClick = { activeTab = 1 },
                                    icon = { Icon(Icons.Default.History, contentDescription = null) },
                                    label = { Text("History", fontSize = 11.sp) },
                                    colors = itemColors,
                                )
                                NavigationBarItem(
                                    selected = activeTab == 2,
                                    onClick = { activeTab = 2 },
                                    icon = { Icon(Icons.Default.Settings, contentDescription = null) },
                                    label = { Text("Settings", fontSize = 11.sp) },
                                    colors = itemColors,
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
                                    guardedAppCount = guardedAppCount,
                                    onEnableAccessibility = ::openAccessibilitySettingsSafely,
                                    onResumeShield = {
                                        ShieldStore.setShieldPaused(this@MainActivity, false)
                                        refreshLocalShieldState()
                                    },
                                    onSelectProtectionLevel = { level ->
                                        ShieldStore.setProtectionLevel(this@MainActivity, level)
                                        vm.setProtectionLevel(level)
                                        refreshLocalShieldState()
                                    },
                                    onScanSandbox = { rawText -> vm.scanSandbox(rawText) },
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
                                        vm.runSandboxTriageAndEscalate(sanitizedText)
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
                                    nanoDownload = state.nanoDownload,
                                    nanoModelName = state.nanoModelName,
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
