package com.localfirst.triage

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.CompareArrows
import androidx.compose.material.icons.filled.BrightnessAuto
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Sync
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.localfirst.triage.ui.TriageViewModel
import com.localfirst.triage.ui.screens.DiffEscalateScreen
import com.localfirst.triage.ui.screens.SyncedFeedScreen
import com.localfirst.triage.ui.screens.TriageScreen
import com.localfirst.triage.ui.theme.AppThemeMode
import com.localfirst.triage.ui.theme.LocalFirstTriageTheme

class MainActivity : ComponentActivity() {
    @OptIn(ExperimentalMaterial3Api::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val prefs = getSharedPreferences("localfirst_ui_prefs", Context.MODE_PRIVATE)
        val initialMode = runCatching {
            AppThemeMode.valueOf(prefs.getString("theme_mode", AppThemeMode.SYSTEM.name) ?: AppThemeMode.SYSTEM.name)
        }.getOrDefault(AppThemeMode.SYSTEM)

        setContent {
            var themeMode by remember { mutableStateOf(initialMode) }

            LocalFirstTriageTheme(themeMode = themeMode) {
                val vm: TriageViewModel = viewModel()
                val state by vm.uiState.collectAsStateWithLifecycle()
                var activeTab by remember { mutableIntStateOf(0) }

                Scaffold(
                    containerColor = MaterialTheme.colorScheme.background,
                    topBar = {
                        TopAppBar(
                            colors = TopAppBarDefaults.topAppBarColors(
                                containerColor = MaterialTheme.colorScheme.surface,
                                titleContentColor = MaterialTheme.colorScheme.onSurface,
                            ),
                            title = {
                                Column {
                                    Text(
                                        text = "LocalFirst Triage",
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 17.sp,
                                    )
                                    Text(
                                        text = "On-Device Privacy Firewall · Zero-PII",
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        fontSize = 11.sp,
                                    )
                                }
                            },
                            actions = {
                                TextButton(
                                    onClick = {
                                        val nextMode = themeMode.next()
                                        themeMode = nextMode
                                        prefs.edit().putString("theme_mode", nextMode.name).apply()
                                    },
                                ) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
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
                        NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                            NavigationBarItem(
                                selected = activeTab == 0,
                                onClick = { activeTab = 0 },
                                icon = { Icon(Icons.Default.Security, contentDescription = null) },
                                label = { Text("Triage", fontSize = 11.sp) },
                            )
                            NavigationBarItem(
                                selected = activeTab == 1,
                                onClick = { activeTab = 1 },
                                icon = {
                                    Icon(
                                        Icons.AutoMirrored.Filled.CompareArrows,
                                        contentDescription = null,
                                    )
                                },
                                label = { Text("Diff & Proof", fontSize = 11.sp) },
                            )
                            NavigationBarItem(
                                selected = activeTab == 2,
                                onClick = { activeTab = 2 },
                                icon = { Icon(Icons.Default.Sync, contentDescription = null) },
                                label = { Text("Synced Feed", fontSize = 11.sp) },
                            )
                        }
                    },
                ) { innerPadding ->
                    when (activeTab) {
                        0 -> TriageScreen(
                            state = state,
                            onSelectScenario = vm::selectScenario,
                            onTitleChange = vm::updateTitle,
                            onRawTextChange = vm::updateRawText,
                            onAddCustomTerm = vm::addCustomPolicyTerm,
                            onToggleOffline = vm::toggleOfflineMode,
                            onRefreshRemoteConfig = { vm.refreshRemoteConfig(force = true) },
                            onRecheckNano = vm::refreshNanoStatus,
                            onWarmupNano = vm::downloadAndWarmUpNano,
                            onRunTriage = {
                                vm.runHybridTriage()
                                activeTab = 1
                            },
                            modifier = Modifier.padding(innerPadding),
                        )

                        1 -> DiffEscalateScreen(
                            state = state,
                            onToggleSpan = vm::toggleSpanMask,
                            onApproveEscalate = vm::approveAndEscalateToCloud,
                            onSyncToFirestore = vm::syncCurrentTicketToFirestore,
                            modifier = Modifier.padding(innerPadding),
                        )

                        else -> SyncedFeedScreen(
                            state = state,
                            onSignInAnonymous = vm::signInAnonymously,
                            onSignInGoogle = { vm.signInWithGoogle(this@MainActivity) },
                            onSignOut = vm::signOut,
                            onGenerateBrief = vm::generateHybridBrief,
                            onOpenTicket = { item ->
                                vm.openSyncedTicket(item)
                                activeTab = 1
                            },
                            modifier = Modifier.padding(innerPadding),
                        )
                    }
                }
            }
        }
    }
}
