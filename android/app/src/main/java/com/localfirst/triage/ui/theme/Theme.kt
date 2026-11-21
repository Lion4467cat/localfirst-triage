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
    subtleSurface = Color(0xFFF4F4F5),
    borderSubtle = Color(0xFFE4E4E7),
    textMuted = Color(0xFF71717A),
    safeBg = Color(0xFFECFDF5),
    safeBorder = Color(0xFF10B981),
    safeText = Color(0xFF047857),
    maskBg = Color(0xFFFEF2F2),
    maskBorder = Color(0xFFEF4444),
    maskText = Color(0xFFB91C1C),
    warnBg = Color(0xFFFFFBEB),
    warnBorder = Color(0xFFF59E0B),
    warnText = Color(0xFFB45309),
    infoBg = Color(0xFFF4F4F5),
    infoBorder = Color(0xFFD4D4D8),
    infoText = Color(0xFF27272A),
    accentSoftBg = Color(0xFFF4F4F5),
    accentSoftBorder = Color(0xFFD4D4D8),
    accentSoftText = Color(0xFF09090B),
)

private val DarkSemanticColors = LocalSemanticColors(
    subtleSurface = Color(0xFF18181B),
    borderSubtle = Color(0xFF27272A),
    textMuted = Color(0xFF71717A),
    safeBg = Color(0xFF064E3B),
    safeBorder = Color(0xFF10B981),
    safeText = Color(0xFF34D399),
    maskBg = Color(0xFF450A0A),
    maskBorder = Color(0xFFEF4444),
    maskText = Color(0xFFF87171),
    warnBg = Color(0xFF451A03),
    warnBorder = Color(0xFFF59E0B),
    warnText = Color(0xFFFBBF24),
    infoBg = Color(0xFF18181B),
    infoBorder = Color(0xFF3F3F46),
    infoText = Color(0xFFE4E4E7),
    accentSoftBg = Color(0xFF18181B),
    accentSoftBorder = Color(0xFF3F3F46),
    accentSoftText = Color(0xFFFAFAFA),
)

private val LightLocalFirstColorScheme = lightColorScheme(
    primary = Color(0xFF09090B),
    onPrimary = Color(0xFFFAFAFA),
    primaryContainer = Color(0xFFF4F4F5),
    onPrimaryContainer = Color(0xFF09090B),
    secondary = Color(0xFF27272A),
    onSecondary = Color(0xFFFAFAFA),
    tertiary = Color(0xFF059669),
    onTertiary = Color.White,
    background = Color(0xFFFAFAFA),
    onBackground = Color(0xFF09090B),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF09090B),
    surfaceVariant = Color(0xFFF4F4F5),
    onSurfaceVariant = Color(0xFF52525B),
    outline = Color(0xFFD4D4D8),
    error = Color(0xFFDC2626),
)

private val DarkLocalFirstColorScheme = darkColorScheme(
    primary = Color(0xFFFAFAFA),
    onPrimary = Color(0xFF09090B),
    primaryContainer = Color(0xFF18181B),
    onPrimaryContainer = Color(0xFFFAFAFA),
    secondary = Color(0xFFA1A1AA),
    onSecondary = Color(0xFF09090B),
    tertiary = Color(0xFF10B981),
    onTertiary = Color(0xFF09090B),
    background = Color(0xFF09090B),
    onBackground = Color(0xFFFAFAFA),
    surface = Color(0xFF111114),
    onSurface = Color(0xFFFAFAFA),
    surfaceVariant = Color(0xFF18181B),
    onSurfaceVariant = Color(0xFFA1A1AA),
    outline = Color(0xFF27272A),
    error = Color(0xFFEF4444),
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
