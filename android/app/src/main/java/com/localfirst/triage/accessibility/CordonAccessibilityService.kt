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
import com.localfirst.triage.model.RedactionSpan

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

/**
 * Pure heuristic matcher for Send / Submit / Post buttons in guarded AI & chat apps.
 */
object SendButtonMatcher {
    private val SEND_TOKEN_REGEX = Regex(
        """(?:^|[\s_:/.-])(?:send|submit|post|dispatch)(?:$|[\s_:/.-])""",
        RegexOption.IGNORE_CASE,
    )

    private val SEND_ID_SUFFIX_REGEX = Regex(
        """(?:send_button|btn_send|composer_send|submit_button|action_send|send_msg|send_message|chat_send)""",
        RegexOption.IGNORE_CASE,
    )

    fun isLikelySendControl(
        text: String?,
        contentDescription: String?,
        viewIdResourceName: String?,
        isClickable: Boolean,
        isEditable: Boolean,
    ): Boolean {
        if (isEditable) return false
        val candidates = listOfNotNull(text, contentDescription, viewIdResourceName)
            .map { it.trim() }
            .filter { it.isNotEmpty() }
        if (candidates.isEmpty()) return false
        return candidates.any { candidate ->
            SEND_TOKEN_REGEX.containsMatchIn(candidate) ||
                (isClickable && SEND_ID_SUFFIX_REGEX.containsMatchIn(candidate))
        }
    }
}

/**
 * Volatile in-memory hold state for unredacted secrets in the active composer.
 * Never persisted to disk (Zero-PII invariant).
 */
data class ProtectedHoldState(
    val packageName: String,
    val appName: String,
    val rawTextHash: Int,
    val sanitizedText: String,
    val spans: List<RedactionSpan>,
    val summaryText: String,
    val isEmphasized: Boolean = false,
)

class CordonAccessibilityService : AccessibilityService() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var windowManager: WindowManager? = null
    private var overlayView: View? = null

    private var lastObservedLength: Int = 0
    private var lastObservedPackage: String? = null
    private var overriddenTextHash: Int? = null
    private var activeHold: ProtectedHoldState? = null
    private var heldInputNode: AccessibilityNodeInfo? = null
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
        val source = event.source

        // 1. Active Send Interception: if user taps a likely Send/Submit control while a hold is armed
        if (eventType == AccessibilityEvent.TYPE_VIEW_CLICKED && source != null) {
            val hold = activeHold
            if (hold != null && hold.packageName == pkg && isSendClickEvent(source, event)) {
                val emphasized = hold.copy(isEmphasized = true)
                activeHold = emphasized
                // Attempt to keep focus in the composer input node so unredacted text isn't sent unchallenged
                heldInputNode?.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
                renderHoldOverlay(emphasized)
                return
            }
        }

        if (
            eventType != AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED &&
            eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED &&
            eventType != AccessibilityEvent.TYPE_VIEW_FOCUSED
        ) {
            return
        }

        val targetNode = when {
            source != null && source.isEditable && !isPasswordNode(source) -> source
            eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
                val focused = rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
                if (focused != null && focused.isEditable && !isPasswordNode(focused)) focused else null
            }
            else -> null
        } ?: return

        val currentText = targetNode.text?.toString().orEmpty()
        if (currentText.isBlank()) {
            lastObservedLength = 0
            lastObservedPackage = pkg
            clearHoldAndOverlay()
            return
        }

        if (currentText.hashCode() == overriddenTextHash) {
            return
        }

        val prevLen = if (lastObservedPackage == pkg) lastObservedLength else 0
        lastObservedLength = currentText.length
        lastObservedPackage = pkg

        if (
            (eventType == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED &&
                AccessibilityBurstDetector.shouldScanImmediately(prevLen, currentText)) ||
            eventType == AccessibilityEvent.TYPE_VIEW_FOCUSED
        ) {
            pendingDebounceRunnable?.let { mainHandler.removeCallbacks(it) }
            scanNodeAndArmHold(targetNode, pkg, currentText)
            return
        }

        // For non-burst typing/content updates, wait for a 650ms pause so typing is never interrupted.
        pendingDebounceRunnable?.let { mainHandler.removeCallbacks(it) }
        val textSnapshot = currentText
        val pkgSnapshot = pkg
        val runnable = Runnable {
            val activeRoot = rootInActiveWindow ?: return@Runnable
            val focused = activeRoot.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return@Runnable
            if (focused.isEditable && !isPasswordNode(focused)) {
                val latestText = focused.text?.toString().orEmpty()
                if (latestText == textSnapshot && latestText.hashCode() != overriddenTextHash) {
                    scanNodeAndArmHold(focused, pkgSnapshot, latestText)
                }
            }
        }
        pendingDebounceRunnable = runnable
        mainHandler.postDelayed(runnable, 650L)
    }

    private fun isSendClickEvent(node: AccessibilityNodeInfo, event: AccessibilityEvent): Boolean {
        val eventText = event.text.joinToString(" ").ifBlank { null }
        val eventDesc = event.contentDescription?.toString()
        if (SendButtonMatcher.isLikelySendControl(
                text = node.text?.toString() ?: eventText,
                contentDescription = node.contentDescription?.toString() ?: eventDesc,
                viewIdResourceName = node.viewIdResourceName,
                isClickable = node.isClickable,
                isEditable = node.isEditable,
            )
        ) {
            return true
        }
        val parent = node.parent ?: return false
        return SendButtonMatcher.isLikelySendControl(
            text = parent.text?.toString(),
            contentDescription = parent.contentDescription?.toString(),
            viewIdResourceName = parent.viewIdResourceName,
            isClickable = parent.isClickable,
            isEditable = parent.isEditable,
        )
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

    private fun formatCategoryCountsSummary(spans: List<RedactionSpan>): String {
        val counts = LinkedHashMap<String, Int>()
        for (span in spans) {
            counts[span.category] = (counts[span.category] ?: 0) + 1
        }
        return counts.entries
            .sortedByDescending { it.value }
            .take(3)
            .joinToString(" · ") { (cat, count) -> "$count ${ShieldStore.friendlyCategoryName(cat)}" }
    }

    private fun scanNodeAndArmHold(
        node: AccessibilityNodeInfo,
        pkg: String,
        rawText: String,
    ) {
        val level = ShieldStore.getProtectionLevel(this)
        val (sanitizedText, spans) = LocalFirewallEngine.scrub(rawText, level)
        val activeSpans = spans.filter { it.masked }
        if (activeSpans.isEmpty()) {
            clearHoldAndOverlay()
            return
        }

        val hold = ProtectedHoldState(
            packageName = pkg,
            appName = ShieldStore.appDisplayNameForPackage(pkg),
            rawTextHash = rawText.hashCode(),
            sanitizedText = sanitizedText,
            spans = activeSpans,
            summaryText = formatCategoryCountsSummary(activeSpans),
            isEmphasized = activeHold?.rawTextHash == rawText.hashCode() && activeHold?.isEmphasized == true,
        )
        activeHold = hold
        heldInputNode = node
        renderHoldOverlay(hold)
    }

    private fun renderHoldOverlay(hold: ProtectedHoldState) {
        showHoldOverlay(
            hold = hold,
            onScrubAndInsert = {
                val targetNode = heldInputNode
                    ?: rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
                val args = Bundle().apply {
                    putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, hold.sanitizedText)
                }
                val replaced = targetNode?.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args) ?: false
                if (replaced) {
                    ShieldStore.recordBlockEvent(
                        context = this,
                        appName = hold.appName,
                        spans = hold.spans,
                        engineUsed = "Deterministic Rules",
                    )
                    lastObservedLength = hold.sanitizedText.length
                }
                clearHoldAndOverlay()
            },
            onSendAnywayUnsafe = {
                overriddenTextHash = hold.rawTextHash
                ShieldStore.recordOverrideEvent(
                    context = this,
                    appName = hold.appName,
                    spans = hold.spans,
                    engineUsed = "Deterministic Rules",
                )
                clearHoldAndOverlay()
            },
        )
    }

    private fun dp(value: Int): Int = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP,
        value.toFloat(),
        resources.displayMetrics,
    ).toInt()

    private fun showHoldOverlay(
        hold: ProtectedHoldState,
        onScrubAndInsert: () -> Unit,
        onSendAnywayUnsafe: () -> Unit,
    ) {
        mainHandler.post {
            dismissOverlayInternal()
            val wm = windowManager ?: return@post

            val strokeColor = if (hold.isEmphasized) Color.parseColor("#FF4D5A") else Color.parseColor("#F59E0B")
            val titleColor = if (hold.isEmphasized) Color.parseColor("#FF6B76") else Color.parseColor("#FBBF24")

            val container = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(14), dp(12), dp(14), dp(12))
                background = GradientDrawable().apply {
                    setColor(Color.parseColor("#11141B"))
                    setStroke(dp(2), strokeColor)
                    cornerRadius = dp(16).toFloat()
                }
                elevation = dp(10).toFloat()
            }

            val title = TextView(this).apply {
                text = if (hold.isEmphasized) {
                    "HOLD ARMED · Scrub Before Sending?"
                } else {
                    "Scrub Before Sending?"
                }
                setTextColor(titleColor)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f)
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            }

            val subtitle = TextView(this).apply {
                text = "${hold.summaryText} detected in ${hold.appName}"
                setTextColor(Color.parseColor("#E2E8F0"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                setPadding(0, dp(3), 0, dp(10))
            }

            val actionsRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.END
            }

            val overrideBtn = Button(this).apply {
                text = "Send Anyway (Unsafe)"
                setTextColor(Color.parseColor("#FDA4AF"))
                setBackgroundColor(Color.TRANSPARENT)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
                setOnClickListener { onSendAnywayUnsafe() }
            }

            val scrubBtn = Button(this).apply {
                text = "Scrub & Insert"
                setTextColor(Color.parseColor("#07090D"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                setPadding(dp(14), dp(6), dp(14), dp(6))
                background = GradientDrawable().apply {
                    setColor(Color.parseColor("#00E5A3"))
                    cornerRadius = dp(10).toFloat()
                }
                setOnClickListener { onScrubAndInsert() }
            }

            actionsRow.addView(overrideBtn)
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
                y = dp(64)
            }

            runCatching {
                wm.addView(container, params)
                overlayView = container
            }
        }
    }

    private fun clearHoldAndOverlay() {
        activeHold = null
        heldInputNode = null
        dismissOverlay()
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
        clearHoldAndOverlay()
    }

    override fun onDestroy() {
        pendingDebounceRunnable?.let { mainHandler.removeCallbacks(it) }
        clearHoldAndOverlay()
        super.onDestroy()
    }
}
