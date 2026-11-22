package com.localfirst.triage.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

enum class AppThemeMode(val shortLabel: String) {
    SYSTEM("Auto"),
    LIGHT("Light"),
    DARK("Dark");

    fun next(): AppThemeMode = when (this) {
        SYSTEM -> LIGHT
        LIGHT -> DARK
        DARK -> SYSTEM
    }
}

object SrePalette {
    val Slate950 = Color(0xFF090D16)
    val Slate900 = Color(0xFF111827)
    val Slate800 = Color(0xFF1E293B)
    val Slate700 = Color(0xFF334155)
    val Slate300 = Color(0xFFCBD5E1)
    val Slate400 = Color(0xFF94A3B8)
    val Indigo500 = Color(0xFF4F46E5)
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

@Immutable
data class LocalSemanticColors(
    val subtleSurface: Color,
    val borderSubtle: Color,
    val textMuted: Color,
    val safeBg: Color,
    val safeBorder: Color,
    val safeText: Color,
    val maskBg: Color,
    val maskBorder: Color,
    val maskText: Color,
    val warnBg: Color,
    val warnBorder: Color,
    val warnText: Color,
    val infoBg: Color,
    val infoBorder: Color,
    val infoText: Color,
    val accentSoftBg: Color,
    val accentSoftBorder: Color,
    val accentSoftText: Color,
)

private val LightSemanticColors = LocalSemanticColors(
    subtleSurface = Color(0xFFF1F5F9),
    borderSubtle = Color(0xFFE2E8F0),
    textMuted = Color(0xFF64748B),
    safeBg = Color(0xFFECFDF5),
    safeBorder = Color(0xFF059669),
    safeText = Color(0xFF047857),
    maskBg = Color(0xFFFEF2F2),
    maskBorder = Color(0xFFDC2626),
    maskText = Color(0xFFB91C1C),
    warnBg = Color(0xFFFFFBEB),
    warnBorder = Color(0xFFD97706),
    warnText = Color(0xFFB45309),
    infoBg = Color(0xFFF0F9FF),
    infoBorder = Color(0xFF0284C7),
    infoText = Color(0xFF0369A1),
    accentSoftBg = Color(0xFFECFDF5),
    accentSoftBorder = Color(0xFF059669),
    accentSoftText = Color(0xFF047857),
)

private val DarkSemanticColors = LocalSemanticColors(
    subtleSurface = Color(0xFF181C26),
    borderSubtle = Color(0xFF242B3A),
    textMuted = Color(0xFF94A3B8),
    safeBg = Color(0xFF063B2C),
    safeBorder = Color(0xFF00E5A3),
    safeText = Color(0xFF00E5A3),
    maskBg = Color(0xFF450D12),
    maskBorder = Color(0xFFFF4D5A),
    maskText = Color(0xFFFF6B76),
    warnBg = Color(0xFF451A03),
    warnBorder = Color(0xFFF59E0B),
    warnText = Color(0xFFFBBF24),
    infoBg = Color(0xFF082F49),
    infoBorder = Color(0xFF38BDF8),
    infoText = Color(0xFF38BDF8),
    accentSoftBg = Color(0xFF063B2C),
    accentSoftBorder = Color(0xFF00E5A3),
    accentSoftText = Color(0xFF00E5A3),
)

private val LightLocalFirstColorScheme = lightColorScheme(
    primary = Color(0xFF059669),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFECFDF5),
    onPrimaryContainer = Color(0xFF047857),
    secondary = Color(0xFF0284C7),
    onSecondary = Color.White,
    tertiary = Color(0xFF059669),
    onTertiary = Color.White,
    background = Color(0xFFF8FAFC),
    onBackground = Color(0xFF0F172A),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF0F172A),
    surfaceVariant = Color(0xFFF1F5F9),
    onSurfaceVariant = Color(0xFF475569),
    outline = Color(0xFFCBD5E1),
    error = Color(0xFFDC2626),
)

private val DarkLocalFirstColorScheme = darkColorScheme(
    primary = Color(0xFF00E5A3),
    onPrimary = Color(0xFF07090D),
    primaryContainer = Color(0xFF063B2C),
    onPrimaryContainer = Color(0xFF00E5A3),
    secondary = Color(0xFF38BDF8),
    onSecondary = Color(0xFF07090D),
    tertiary = Color(0xFF00E5A3),
    onTertiary = Color(0xFF07090D),
    background = Color(0xFF090B0E),
    onBackground = Color(0xFFF8FAFC),
    surface = Color(0xFF11141B),
    onSurface = Color(0xFFF8FAFC),
    surfaceVariant = Color(0xFF181C26),
    onSurfaceVariant = Color(0xFF94A3B8),
    outline = Color(0xFF242B3A),
    error = Color(0xFFFF4D5A),
)

private val LocalSemanticColorsProvider = staticCompositionLocalOf { LightSemanticColors }

object LocalFirstThemeTokens {
    val colors: LocalSemanticColors
        @Composable get() = LocalSemanticColorsProvider.current
}

@Composable
fun LocalFirstTriageTheme(
    themeMode: AppThemeMode = AppThemeMode.SYSTEM,
    content: @Composable () -> Unit,
) {
    val useDark = when (themeMode) {
        AppThemeMode.SYSTEM -> isSystemInDarkTheme()
        AppThemeMode.DARK -> true
        AppThemeMode.LIGHT -> false
    }

    val colorScheme = if (useDark) DarkLocalFirstColorScheme else LightLocalFirstColorScheme
    val semanticColors = if (useDark) DarkSemanticColors else LightSemanticColors

    CompositionLocalProvider(LocalSemanticColorsProvider provides semanticColors) {
        MaterialTheme(
            colorScheme = colorScheme,
            content = content,
        )
    }
}
