package com.localfirst.triage.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object SrePalette {
    val Slate950 = Color(0xFF020617)
    val Slate900 = Color(0xFF0F172A)
    val Slate800 = Color(0xFF1E293B)
    val Slate700 = Color(0xFF334155)
    val Slate300 = Color(0xFFCBD5E1)
    val Slate400 = Color(0xFF94A3B8)
    val Indigo500 = Color(0xFF6366F1)
    val Indigo300 = Color(0xFFA5B4FC)
    val Emerald400 = Color(0xFF34D399)
    val Emerald950 = Color(0xFF022C22)
    val Cyan400 = Color(0xFF22D3EE)
    val Cyan950 = Color(0xFF083344)
    val Amber400 = Color(0xFFFBBF24)
    val Amber950 = Color(0xFF451A03)
    val Rose400 = Color(0xFFFB7185)
    val Rose950 = Color(0xFF4C0519)
    val Fuchsia400 = Color(0xFFE879F9)
    val Violet400 = Color(0xFFA78BFA)
}

private val DarkSreColorScheme = darkColorScheme(
    primary = SrePalette.Indigo500,
    onPrimary = Color.White,
    secondary = SrePalette.Cyan400,
    onSecondary = SrePalette.Slate950,
    tertiary = SrePalette.Emerald400,
    background = SrePalette.Slate950,
    onBackground = Color(0xFFF8FAFC),
    surface = SrePalette.Slate900,
    onSurface = Color(0xFFF1F5F9),
    surfaceVariant = SrePalette.Slate800,
    onSurfaceVariant = SrePalette.Slate300,
    outline = SrePalette.Slate700,
    error = SrePalette.Rose400,
)

@Composable
fun LocalFirstTriageTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkSreColorScheme,
        content = content,
    )
}
