package com.localfirst.triage.accessibility

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.util.Log
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
import com.localfirst.triage.model.ProtectionLevel
import com.localfirst.triage.model.RedactionSpan
import kotlin.math.abs

/**
 * Pure burst/secret-trigger detector retained for compatibility.
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
 * Pure selector for picking the best available editable text from event, node, or tree fallback.
 */
object ActiveTextExtractor {
    fun pickBestText(
        nodeText: String?,
        eventText: String?,
        treeFallbackText: String?,
        preferEventText: Boolean = false,
    ): String {
        val e = eventText?.trimEnd().orEmpty()
        val n = nodeText?.trimEnd().orEmpty()
        if (preferEventText && e.isNotBlank()) return eventText.orEmpty()
        if (n.isNotBlank()) return nodeText.orEmpty()
        if (e.isNotBlank()) return eventText.orEmpty()
        val t = treeFallbackText?.trimEnd().orEmpty()
        if (t.isNotBlank()) return treeFallbackText.orEmpty()
        return ""
    }
}

/**
 * Pure heuristic matcher for Send / Submit / Post / Reply / Ask / Generate / Run controls
 * in guarded AI & chat apps, plus nearest-to-editable fallback.
 */
object SendButtonMatcher {
    private val SEND_TOKEN_REGEX = Regex(
        """(?:^|[\s_:/.-])(?:send|submit|post|dispatch|reply|ask|generate|run)(?:$|[\s_:/.-])""",
        RegexOption.IGNORE_CASE,
    )

    private val SEND_ID_SUFFIX_REGEX = Regex(
        """(?:send|submit|post|dispatch|reply|ask|generate|run)(?:_?(?:btn|button|msg|message|prompt|action|icon))?|(?:btn|button|composer|action|chat)_(?:send|submit|ask|reply|generate|run)""",
        RegexOption.IGNORE_CASE,
    )

    private val NON_SEND_CONTROL_REGEX = Regex(
        """(?:back|close|cancel|dismiss|menu|settings|attach|upload|camera|photo|gallery|mic|voice|record|copy|paste|clear|delete|emoji|sticker|search|new_chat|drawer)""",
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

    fun isNonSendControl(
        text: String?,
        contentDescription: String?,
        viewIdResourceName: String?,
    ): Boolean {
        val combined = listOfNotNull(text, contentDescription, viewIdResourceName)
            .joinToString(" ")
            .trim()
        return combined.isNotEmpty() && NON_SEND_CONTROL_REGEX.containsMatchIn(combined)
    }

    fun isLikelyNearEditableSendClick(
        isClickable: Boolean,
        isEditable: Boolean,
        hasTrackedSecret: Boolean,
        text: String?,
        contentDescription: String?,
        viewIdResourceName: String?,
        sharesContainerWithEditable: Boolean,
    ): Boolean {
        if (!hasTrackedSecret || !isClickable || isEditable || !sharesContainerWithEditable) {
            return false
        }
        return !isNonSendControl(text, contentDescription, viewIdResourceName)
    }
}

/**
 * Pure geometry helper to pick the send button candidate from screen bounds when
 * regex matching does not find an explicit send label.
 */
data class ClickableBoundsCandidate(
    val index: Int,
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int,
    val isRegexMatch: Boolean,
    val isNonSend: Boolean,
) {
    val width: Int get() = right - left
    val height: Int get() = bottom - top
    val centerX: Int get() = (left + right) / 2
    val centerY: Int get() = (top + bottom) / 2
}

object SendBoundsSelector {
    fun pickBestCandidate(
        candidates: List<ClickableBoundsCandidate>,
        editableLeft: Int,
        editableTop: Int,
        editableRight: Int,
        editableBottom: Int,
    ): ClickableBoundsCandidate? {
        val valid = candidates.filter { it.width > 4 && it.height > 4 }
        if (valid.isEmpty()) return null

        val regexMatch = valid.firstOrNull { it.isRegexMatch }
        if (regexMatch != null) return regexMatch

        val editableCenterY = (editableTop + editableBottom) / 2
        val fallbackPool = valid.filter { !it.isNonSend }
        return fallbackPool.minByOrNull { c ->
            val dx = if (c.centerX >= editableRight - 24) {
                abs(c.left - editableRight)
            } else {
                // Penalize controls to the left of the editable field's right edge
                abs(c.centerX - editableRight) + 500
            }
            val dy = abs(c.centerY - editableCenterY) * 2
            dx + dy
        }
    }
}

/**
 * Volatile in-memory state for a send-time prompt.
 * Never persisted to disk (Zero-PII invariant).
 */
data class PendingSendPromptState(
    val packageName: String,
    val appName: String,
    val rawText: String,
    val sanitizedText: String,
    val spans: List<RedactionSpan>,
    val summaryText: String,
)

/**
 * Pure state machine enforcing:
 * - Zero popups while typing or pasting
 * - Touch shield armed over Send button only while unredacted secrets/PII exist
 * - Single-prompt override memory so "Reject & Send Anyway" never loops on the same text
 */
class SendPromptStateMachine {
    var trackedState: PendingSendPromptState? = null
        private set
    var isPromptVisible: Boolean = false
        private set
    var overriddenTextHash: Int? = null
        private set

    fun onFieldTextObserved(
        pkg: String,
        appName: String,
        rawText: String,
        protectionLevel: ProtectionLevel,
    ) {
        if (rawText.isBlank()) {
            trackedState = null
            return
        }

        if (overriddenTextHash != null && rawText.hashCode() != overriddenTextHash) {
            overriddenTextHash = null
        }

        val (sanitizedText, spans) = LocalFirewallEngine.scrub(rawText, protectionLevel)
        val activeSpans = spans.filter { it.masked }
        if (activeSpans.isEmpty()) {
            trackedState = null
            return
        }

        trackedState = PendingSendPromptState(
            packageName = pkg,
            appName = appName,
            rawText = rawText,
            sanitizedText = sanitizedText,
            spans = activeSpans,
            summaryText = formatCategoryCountsSummary(activeSpans),
        )
    }

    fun shouldArmTouchShield(pkg: String): Boolean {
        val state = trackedState ?: return false
        if (isPromptVisible) return false
        if (state.packageName != pkg) return false
        return state.rawText.hashCode() != overriddenTextHash
    }

    fun onSendClicked(pkg: String): PendingSendPromptState? {
        val state = trackedState ?: return null
        if (state.packageName != pkg) return null
        if (state.rawText.hashCode() == overriddenTextHash) return null
        isPromptVisible = true
        return state
    }

    fun acceptScrub(): PendingSendPromptState? {
        val state = trackedState
        trackedState = null
        isPromptVisible = false
        overriddenTextHash = null
        return state
    }

    fun rejectAndSendAnyway(): PendingSendPromptState? {
        val state = trackedState
        if (state != null) {
            overriddenTextHash = state.rawText.hashCode()
        }
        trackedState = null
        isPromptVisible = false
        return state
    }

    fun reset() {
        trackedState = null
        isPromptVisible = false
    }

    companion object {
        fun formatCategoryCountsSummary(spans: List<RedactionSpan>): String {
            val counts = LinkedHashMap<String, Int>()
            for (span in spans) {
                counts[span.category] = (counts[span.category] ?: 0) + 1
            }
            return counts.entries
                .sortedByDescending { it.value }
                .take(3)
                .joinToString(" · ") { (cat, count) -> "$count ${ShieldStore.friendlyCategoryName(cat)}" }
        }
    }
}

class CordonAccessibilityService : AccessibilityService() {
    companion object {
        private const val TAG = "CordonA11y"
        private const val MAX_TREE_SCAN_NODES = 120
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var windowManager: WindowManager? = null
    private var touchShieldView: View? = null
    private var touchShieldBounds: Rect? = null
    private var promptOverlayView: View? = null

    private val stateMachine = SendPromptStateMachine()
    private var heldInputNode: AccessibilityNodeInfo? = null
    private var armedSendNode: AccessibilityNodeInfo? = null
    private var activePackage: String? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        windowManager = getSystemService(Context.WINDOW_SERVICE) as? WindowManager
        Log.d(TAG, "serviceConnected=true")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val pkg = event.packageName?.toString()

        if (pkg == null || pkg == packageName || ShieldStore.isShieldPaused(this) || !ShieldStore.isPackageGuarded(this, pkg)) {
            if (pkg != null && pkg != activePackage && !stateMachine.isPromptVisible) {
                clearAllStateAndOverlays()
            }
            return
        }

        if (activePackage != null && activePackage != pkg) {
            clearAllStateAndOverlays()
        }
        activePackage = pkg

        val eventType = event.eventType
        val source = event.source

        when (eventType) {
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED,
            AccessibilityEvent.TYPE_VIEW_FOCUSED,
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED,
            AccessibilityEvent.TYPE_WINDOWS_CHANGED,
            AccessibilityEvent.TYPE_VIEW_SCROLLED,
            -> {
                refreshTrackedFromActiveWindow(pkg, source, event, eventType)
                syncTouchShieldWithActiveWindow(pkg)
            }
        }
    }

    private fun refreshTrackedFromActiveWindow(
        pkg: String,
        source: AccessibilityNodeInfo?,
        event: AccessibilityEvent?,
        eventType: Int,
    ) {
        if (stateMachine.isPromptVisible) return

        val editableFromSource = if (source != null && source.isEditable && !isPasswordNode(source)) source else null
        val editableFromTree = editableFromSource ?: findActiveEditableNode(rootInActiveWindow)

        val nodeText = editableFromTree?.text?.toString()
        val eventText = if (eventType == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED || editableFromSource != null) {
            event?.text?.joinToString("")
        } else {
            null
        }
        val treeText = if (nodeText.isNullOrBlank() && eventText.isNullOrBlank()) {
            findFirstEditableWithText(rootInActiveWindow)?.let { node ->
                if (editableFromTree == null) heldInputNode = node
                node.text?.toString()
            }
        } else {
            null
        }

        val resolvedText = ActiveTextExtractor.pickBestText(
            nodeText = nodeText,
            eventText = eventText,
            treeFallbackText = treeText,
            preferEventText = (eventType == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED),
        )

        if (editableFromTree != null) {
            heldInputNode = editableFromTree
        }

        if (resolvedText.isBlank() && editableFromTree == null) {
            return
        }

        stateMachine.onFieldTextObserved(
            pkg = pkg,
            appName = ShieldStore.appDisplayNameForPackage(pkg),
            rawText = resolvedText,
            protectionLevel = ShieldStore.getProtectionLevel(this),
        )
    }

    private fun syncTouchShieldWithActiveWindow(pkg: String) {
        if (stateMachine.isPromptVisible) return

        if (!stateMachine.shouldArmTouchShield(pkg)) {
            removeTouchShield()
            return
        }

        val root = rootInActiveWindow
        if (root == null) {
            removeTouchShield()
            return
        }

        val editableNode = heldInputNode ?: findActiveEditableNode(root)
        val editableBounds = Rect()
        if (editableNode != null) {
            editableNode.getBoundsInScreen(editableBounds)
        }

        val clickableNodes = collectClickableNodes(root)
        val candidates = clickableNodes.mapIndexed { index, node ->
            val rect = Rect()
            node.getBoundsInScreen(rect)
            val childDesc = (0 until node.childCount.coerceAtMost(4))
                .mapNotNull { idx -> node.getChild(idx)?.contentDescription?.toString() ?: node.getChild(idx)?.text?.toString() }
                .firstOrNull { it.isNotBlank() }
            val text = node.text?.toString()
            val desc = node.contentDescription?.toString() ?: childDesc
            val viewId = node.viewIdResourceName
            ClickableBoundsCandidate(
                index = index,
                left = rect.left,
                top = rect.top,
                right = rect.right,
                bottom = rect.bottom,
                isRegexMatch = SendButtonMatcher.isLikelySendControl(
                    text = text,
                    contentDescription = desc,
                    viewIdResourceName = viewId,
                    isClickable = node.isClickable,
                    isEditable = node.isEditable,
                ),
                isNonSend = SendButtonMatcher.isNonSendControl(text, desc, viewId),
            )
        }

        val chosen = SendBoundsSelector.pickBestCandidate(
            candidates = candidates,
            editableLeft = editableBounds.left,
            editableTop = editableBounds.top,
            editableRight = editableBounds.right,
            editableBottom = editableBounds.bottom,
        )

        if (chosen == null) {
            removeTouchShield()
            return
        }

        val sendNode = clickableNodes[chosen.index]
        val shieldRect = Rect(chosen.left, chosen.top, chosen.right, chosen.bottom)
        if (shieldRect.isEmpty) {
            removeTouchShield()
            return
        }

        armedSendNode = sendNode
        showOrRepositionTouchShield(pkg, shieldRect, chosen.isRegexMatch)
    }

    private fun collectClickableNodes(root: AccessibilityNodeInfo): List<AccessibilityNodeInfo> {
        val result = ArrayList<AccessibilityNodeInfo>()
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var visited = 0
        while (queue.isNotEmpty() && visited < MAX_TREE_SCAN_NODES) {
            val current = queue.removeFirst()
            visited++
            if (current.isClickable && !current.isEditable && current.isVisibleToUser) {
                result.add(current)
            }
            for (i in 0 until current.childCount) {
                current.getChild(i)?.let { queue.add(it) }
            }
        }
        return result
    }

    private fun findActiveEditableNode(root: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (root == null) return null
        val focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        if (focused != null && focused.isEditable && !isPasswordNode(focused)) {
            return focused
        }
        return findFirstEditableWithText(root) ?: findFirstEditable(root)
    }

    private fun findFirstEditableWithText(root: AccessibilityNodeInfo?): AccessibilityNodeInfo? =
        bfsFindNode(root) { node ->
            node.isEditable && !isPasswordNode(node) && !node.text.isNullOrBlank()
        }

    private fun findFirstEditable(root: AccessibilityNodeInfo?): AccessibilityNodeInfo? =
        bfsFindNode(root) { node ->
            node.isEditable && !isPasswordNode(node)
        }

    private fun bfsFindNode(
        root: AccessibilityNodeInfo?,
        predicate: (AccessibilityNodeInfo) -> Boolean,
    ): AccessibilityNodeInfo? {
        if (root == null) return null
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var visited = 0
        while (queue.isNotEmpty() && visited < MAX_TREE_SCAN_NODES) {
            val current = queue.removeFirst()
            visited++
            if (predicate(current)) return current
            for (i in 0 until current.childCount) {
                current.getChild(i)?.let { queue.add(it) }
            }
        }
        return null
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

    private fun dp(value: Int): Int = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP,
        value.toFloat(),
        resources.displayMetrics,
    ).toInt()

    private fun showOrRepositionTouchShield(pkg: String, rect: Rect, isRegexMatch: Boolean) {
        mainHandler.post {
            val wm = windowManager ?: return@post
            val existing = touchShieldView
            val params = WindowManager.LayoutParams(
                rect.width().coerceAtLeast(dp(36)),
                rect.height().coerceAtLeast(dp(36)),
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                // FLAG_NOT_FOCUSABLE ONLY (NO FLAG_NOT_TOUCHABLE) so it intercepts and consumes the tap
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT,
            ).apply {
                gravity = Gravity.TOP or Gravity.START
                x = rect.left
                y = rect.top
            }

            if (existing != null) {
                if (touchShieldBounds != rect) {
                    touchShieldBounds = Rect(rect)
                    runCatching { wm.updateViewLayout(existing, params) }
                }
                return@post
            }

            val shield = View(this).apply {
                contentDescription = "Cordon Send Shield"
                background = GradientDrawable().apply {
                    setColor(Color.argb(18, 245, 158, 11))
                    setStroke(dp(1), Color.argb(180, 245, 158, 11))
                    cornerRadius = dp(18).toFloat()
                }
                setOnClickListener {
                    val promptState = stateMachine.onSendClicked(pkg)
                    Log.d(
                        TAG,
                        "shieldTapped pkg=$pkg armed=${promptState != null} regexMatch=$isRegexMatch",
                    )
                    if (promptState != null) {
                        removeTouchShieldInternal()
                        showSendPromptOverlay(promptState)
                    } else {
                        removeTouchShieldInternal()
                    }
                }
            }

            runCatching {
                wm.addView(shield, params)
                touchShieldView = shield
                touchShieldBounds = Rect(rect)
                Log.d(
                    TAG,
                    "shieldArmed pkg=$pkg bounds=[${rect.left},${rect.top},${rect.right},${rect.bottom}] regexMatch=$isRegexMatch",
                )
            }
        }
    }

    private fun showSendPromptOverlay(promptState: PendingSendPromptState) {
        mainHandler.post {
            dismissPromptOverlayInternal()
            val wm = windowManager ?: return@post

            val container = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(16), dp(14), dp(16), dp(14))
                background = GradientDrawable().apply {
                    setColor(Color.parseColor("#11141B"))
                    setStroke(dp(2), Color.parseColor("#F59E0B"))
                    cornerRadius = dp(16).toFloat()
                }
                elevation = dp(12).toFloat()
            }

            val title = TextView(this).apply {
                text = "Are you sure? Use the scrub instead"
                setTextColor(Color.parseColor("#FBBF24"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            }

            val subtitle = TextView(this).apply {
                text = "${promptState.summaryText} found in ${promptState.appName}"
                setTextColor(Color.parseColor("#E2E8F0"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                setPadding(0, dp(4), 0, dp(12))
            }

            val actionsRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.END
            }

            val rejectBtn = Button(this).apply {
                text = "Reject & Send Anyway"
                setTextColor(Color.parseColor("#FDA4AF"))
                setBackgroundColor(Color.TRANSPARENT)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
                setOnClickListener {
                    val rejected = stateMachine.rejectAndSendAnyway()
                    dismissPromptOverlayInternal()
                    removeTouchShieldInternal()
                    if (rejected != null) {
                        ShieldStore.recordOverrideEvent(
                            context = this@CordonAccessibilityService,
                            appName = rejected.appName,
                            spans = rejected.spans,
                            engineUsed = "Deterministic Rules",
                        )
                        val sendTarget = armedSendNode
                        Log.d(TAG, "rejectAndSendAnyway pkg=${rejected.packageName} hasSendTarget=${sendTarget != null}")
                        mainHandler.postDelayed({
                            sendTarget?.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                        }, 40L)
                    }
                    armedSendNode = null
                }
            }

            val acceptBtn = Button(this).apply {
                text = "Use Scrub & Send"
                setTextColor(Color.parseColor("#07090D"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                setPadding(dp(14), dp(6), dp(14), dp(6))
                background = GradientDrawable().apply {
                    setColor(Color.parseColor("#00E5A3"))
                    cornerRadius = dp(10).toFloat()
                }
                setOnClickListener {
                    val accepted = stateMachine.acceptScrub()
                    dismissPromptOverlayInternal()
                    removeTouchShieldInternal()
                    if (accepted != null) {
                        val targetNode = heldInputNode ?: findActiveEditableNode(rootInActiveWindow)
                        val scrubArgs = Bundle().apply {
                            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, accepted.sanitizedText)
                        }
                        val replaced = targetNode?.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, scrubArgs) ?: false
                        val sendTarget = armedSendNode
                        Log.d(
                            TAG,
                            "useScrubAndSend pkg=${accepted.packageName} replaced=$replaced hasSendTarget=${sendTarget != null}",
                        )
                        if (replaced) {
                            ShieldStore.recordBlockEvent(
                                context = this@CordonAccessibilityService,
                                appName = accepted.appName,
                                spans = accepted.spans,
                                engineUsed = "Deterministic Rules",
                            )
                            mainHandler.postDelayed({
                                sendTarget?.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                            }, 60L)
                        }
                    }
                    heldInputNode = null
                    armedSendNode = null
                }
            }

            actionsRow.addView(rejectBtn)
            actionsRow.addView(acceptBtn)
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
                gravity = Gravity.CENTER_HORIZONTAL or Gravity.TOP
                y = dp(72)
            }

            runCatching {
                wm.addView(container, params)
                promptOverlayView = container
            }
        }
    }

    private fun clearAllStateAndOverlays() {
        stateMachine.reset()
        heldInputNode = null
        armedSendNode = null
        activePackage = null
        removeTouchShield()
        mainHandler.post { dismissPromptOverlayInternal() }
    }

    private fun removeTouchShield() {
        mainHandler.post { removeTouchShieldInternal() }
    }

    private fun removeTouchShieldInternal() {
        val current = touchShieldView ?: return
        touchShieldView = null
        touchShieldBounds = null
        runCatching { windowManager?.removeView(current) }
    }

    private fun dismissPromptOverlayInternal() {
        val current = promptOverlayView ?: return
        promptOverlayView = null
        runCatching { windowManager?.removeView(current) }
    }

    override fun onInterrupt() {
        clearAllStateAndOverlays()
    }

    override fun onDestroy() {
        clearAllStateAndOverlays()
        super.onDestroy()
    }
}
