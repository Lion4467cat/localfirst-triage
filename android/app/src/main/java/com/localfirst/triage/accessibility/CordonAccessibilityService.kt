package com.localfirst.triage.accessibility

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.localfirst.triage.data.ShieldStore
import com.localfirst.triage.firewall.LocalFirewallEngine

/**
 * Pure burst/secret-trigger detector so background scanning never pops up mid-typing
 * on normal words, mirroring the Chrome Extension's 0-mid-typing-popups rule.
 */
object AccessibilityBurstDetector {
    private const val PASTE_BURST_CHAR_DELTA = 8

    private val HIGH_CONFIDENCE_PREFIX_REGEX = Regex(
        """(?:AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9]{12,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._-]{20,})""",
    )

    fun shouldScanImmediately(previousLength: Int, currentText: String): Boolean {
        if (currentText.length < 8) return false
        val delta = currentText.length - previousLength
        if (delta >= PASTE_BURST_CHAR_DELTA) return true
        return HIGH_CONFIDENCE_PREFIX_REGEX.containsMatchIn(currentText)
    }
}

class CordonAccessibilityService : AccessibilityService() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var windowManager: WindowManager? = null
    private var overlayView: View? = null

    private var lastObservedLength: Int = 0
    private var lastObservedPackage: String? = null
    private var dismissedTextHash: Int? = null
    private var pendingDebounceRunnable: Runnable? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        windowManager = getSystemService(Context.WINDOW_SERVICE) as? WindowManager
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val pkg = event.packageName?.toString() ?: return

        // Never inspect Cordon itself or unguarded apps, and respect user Pause toggle.
        if (pkg == packageName || ShieldStore.isShieldPaused(this) || !ShieldStore.isPackageGuarded(this, pkg)) {
            return
        }

        val eventType = event.eventType
        if (
            eventType != AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED &&
            eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
        ) {
            return
        }

        val source = event.source ?: return
        if (!source.isEditable || isPasswordNode(source)) {
            return
        }

        val currentText = source.text?.toString().orEmpty()
        if (currentText.isBlank()) {
            lastObservedLength = 0
            lastObservedPackage = pkg
            dismissOverlay()
            return
        }

        if (currentText.hashCode() == dismissedTextHash) {
            return
        }

        val prevLen = if (lastObservedPackage == pkg) lastObservedLength else 0
        lastObservedLength = currentText.length
        lastObservedPackage = pkg

        if (eventType == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED &&
            AccessibilityBurstDetector.shouldScanImmediately(prevLen, currentText)
        ) {
            pendingDebounceRunnable?.let { mainHandler.removeCallbacks(it) }
            scanNodeAndShowOverlay(source, pkg, currentText)
            return
        }

        // For non-burst changes, wait for a pause (650ms) so typing is never interrupted.
        pendingDebounceRunnable?.let { mainHandler.removeCallbacks(it) }
        val textSnapshot = currentText
        val pkgSnapshot = pkg
        val runnable = Runnable {
            val activeRoot = rootInActiveWindow ?: return@Runnable
            val focused = activeRoot.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return@Runnable
            if (focused.isEditable && !isPasswordNode(focused)) {
                val latestText = focused.text?.toString().orEmpty()
                if (latestText == textSnapshot && latestText.hashCode() != dismissedTextHash) {
                    scanNodeAndShowOverlay(focused, pkgSnapshot, latestText)
                }
            }
        }
        pendingDebounceRunnable = runnable
        mainHandler.postDelayed(runnable, 650L)
    }

    private fun isPasswordNode(node: AccessibilityNodeInfo): Boolean {
        if (node.isPassword) return true
        val inputType = node.inputType
        val variation = inputType and InputType.TYPE_MASK_VARIATION
        return variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
            variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
            variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
            variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
    }

    private fun scanNodeAndShowOverlay(
        node: AccessibilityNodeInfo,
        pkg: String,
        rawText: String,
    ) {
        val level = ShieldStore.getProtectionLevel(this)
        val (sanitizedText, spans) = LocalFirewallEngine.scrub(rawText, level)
        val activeSpans = spans.filter { it.masked }
        if (activeSpans.isEmpty()) {
            dismissOverlay()
            return
        }

        val categoriesPreview = activeSpans
            .map { ShieldStore.friendlyCategoryName(it.category) }
            .distinct()
            .take(3)
            .joinToString(", ")

        showFloatingPill(
            appName = ShieldStore.appDisplayNameForPackage(pkg),
            count = activeSpans.size,
            categoriesPreview = categoriesPreview,
            onScrub = {
                val args = Bundle().apply {
                    putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, sanitizedText)
                }
                val replaced = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
                if (replaced) {
                    ShieldStore.recordBlockEvent(
                        context = this,
                        appName = ShieldStore.appDisplayNameForPackage(pkg),
                        spans = activeSpans,
                        engineUsed = "Deterministic Rules",
                    )
                    lastObservedLength = sanitizedText.length
                }
                dismissOverlay()
            },
            onDismiss = {
                dismissedTextHash = rawText.hashCode()
                dismissOverlay()
            },
        )
    }

    private fun dp(value: Int): Int = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP,
        value.toFloat(),
        resources.displayMetrics,
    ).toInt()

    private fun showFloatingPill(
        appName: String,
        count: Int,
        categoriesPreview: String,
        onScrub: () -> Unit,
        onDismiss: () -> Unit,
    ) {
        mainHandler.post {
            dismissOverlayInternal()
            val wm = windowManager ?: return@post

            val container = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(14), dp(10), dp(14), dp(10))
                background = GradientDrawable().apply {
                    setColor(Color.parseColor("#11141B"))
                    setStroke(dp(1), Color.parseColor("#00E5A3"))
                    cornerRadius = dp(16).toFloat()
                }
                elevation = dp(8).toFloat()
            }

            val title = TextView(this).apply {
                text = "Cordon Shield · $count secret(s) in $appName"
                setTextColor(Color.parseColor("#00E5A3"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            }

            val subtitle = TextView(this).apply {
                text = "Detected: $categoriesPreview"
                setTextColor(Color.parseColor("#CBD5E1"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
                setPadding(0, dp(2), 0, dp(8))
            }

            val actionsRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.END
            }

            val dismissBtn = Button(this).apply {
                text = "Dismiss"
                setTextColor(Color.parseColor("#94A3B8"))
                setBackgroundColor(Color.TRANSPARENT)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                setOnClickListener { onDismiss() }
            }

            val scrubBtn = Button(this).apply {
                text = "Scrub in Field"
                setTextColor(Color.parseColor("#07090D"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                setPadding(dp(12), dp(6), dp(12), dp(6))
                background = GradientDrawable().apply {
                    setColor(Color.parseColor("#00E5A3"))
                    cornerRadius = dp(10).toFloat()
                }
                setOnClickListener { onScrub() }
            }

            actionsRow.addView(dismissBtn)
            actionsRow.addView(scrubBtn)
            container.addView(title)
            container.addView(subtitle)
            container.addView(actionsRow)

            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT,
            ).apply {
                gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
                y = dp(72)
            }

            runCatching {
                wm.addView(container, params)
                overlayView = container
            }
        }
    }

    private fun dismissOverlay() {
        mainHandler.post { dismissOverlayInternal() }
    }

    private fun dismissOverlayInternal() {
        val current = overlayView ?: return
        overlayView = null
        runCatching { windowManager?.removeView(current) }
    }

    override fun onInterrupt() {
        pendingDebounceRunnable?.let { mainHandler.removeCallbacks(it) }
        dismissOverlay()
    }

    override fun onDestroy() {
        pendingDebounceRunnable?.let { mainHandler.removeCallbacks(it) }
        dismissOverlay()
        super.onDestroy()
    }
}
