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

/**
 * Pure burst/secret-trigger detector retained for compatibility.
 * Note: CordonAccessibilityService operates in Send-Only Prompt mode (0 popups while typing/pasting).
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
 * Pure selector for picking the best available editable text from node, event, or tree fallback.
 */
object ActiveTextExtractor {
    fun pickBestText(
        nodeText: String?,
        eventText: String?,
        treeFallbackText: String?,
    ): String {
        val n = nodeText?.trimEnd().orEmpty()
        if (n.isNotBlank()) return nodeText.orEmpty()
        val e = eventText?.trimEnd().orEmpty()
        if (e.isNotBlank()) return eventText.orEmpty()
        val t = treeFallbackText?.trimEnd().orEmpty()
        if (t.isNotBlank()) return treeFallbackText.orEmpty()
        return ""
    }
}

/**
 * Pure heuristic matcher for Send / Submit / Post / Reply / Ask / Generate / Run controls
 * in guarded AI & chat apps, plus safe sibling-to-editable fallback.
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
        val combined = listOfNotNull(text, contentDescription, viewIdResourceName)
            .joinToString(" ")
            .trim()
        if (combined.isNotEmpty() && NON_SEND_CONTROL_REGEX.containsMatchIn(combined)) {
            return false
        }
        return true
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
 * - Prompt only on Send click when unredacted secrets/PII exist
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
        // Ignore self-triggered empty text event caused by clearing the field during an active send hold.
        if (isPromptVisible && rawText.isBlank()) {
            return
        }

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
        private const val MAX_TREE_SCAN_NODES = 80
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var windowManager: WindowManager? = null
    private var overlayView: View? = null

    private val stateMachine = SendPromptStateMachine()
    private var heldInputNode: AccessibilityNodeInfo? = null
    private var lastSendNode: AccessibilityNodeInfo? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        windowManager = getSystemService(Context.WINDOW_SERVICE) as? WindowManager
        Log.d(TAG, "serviceConnected=true")
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

        // 1. Send-Only Trigger: intercept likely Send/Submit clicks
        if (eventType == AccessibilityEvent.TYPE_VIEW_CLICKED) {
            refreshTrackedFromActiveWindow(pkg, source, event)

            val hasSecret = stateMachine.trackedState?.packageName == pkg
            val isSend = source != null && isSendClickEvent(source, event, hasSecret)
            Log.d(
                TAG,
                "click pkg=$pkg isSend=$isSend hasSecret=$hasSecret clickable=${source?.isClickable} editable=${source?.isEditable} viewId=${source?.viewIdResourceName}",
            )

            if (isSend) {
                val promptState = stateMachine.onSendClicked(pkg)
                if (promptState != null) {
                    lastSendNode = source
                    val targetInput = heldInputNode ?: findActiveEditableNode(rootInActiveWindow)
                    if (targetInput != null && targetInput.isEditable && !isPasswordNode(targetInput)) {
                        heldInputNode = targetInput
                        // Temporarily clear the field so unredacted secret isn't dispatched while prompt is open
                        val clearArgs = Bundle().apply {
                            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "")
                        }
                        targetInput.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, clearArgs)
                        targetInput.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
                    }
                    showSendPromptOverlay(promptState)
                }
            }
            return
        }

        // 2. Silently track editable text in memory (0 popups while typing or pasting)
        if (
            eventType != AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED &&
            eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED &&
            eventType != AccessibilityEvent.TYPE_VIEW_FOCUSED
        ) {
            return
        }

        refreshTrackedFromActiveWindow(pkg, source, event)
        Log.d(
            TAG,
            "observe pkg=$pkg type=${AccessibilityEvent.eventTypeToString(eventType)} hasSecret=${stateMachine.trackedState?.packageName == pkg}",
        )
    }

    private fun refreshTrackedFromActiveWindow(
        pkg: String,
        source: AccessibilityNodeInfo?,
        event: AccessibilityEvent?,
    ) {
        if (stateMachine.isPromptVisible) return

        val editableFromSource = if (source != null && source.isEditable && !isPasswordNode(source)) source else null
        val editableFromTree = editableFromSource ?: findActiveEditableNode(rootInActiveWindow)

        val nodeText = editableFromTree?.text?.toString()
        val eventText = if (editableFromSource != null || source == null) {
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
        )

        if (editableFromTree != null) {
            heldInputNode = editableFromTree
        }

        if (resolvedText.isBlank() && editableFromTree == null && event?.eventType == AccessibilityEvent.TYPE_VIEW_CLICKED) {
            // Do not wipe tracked state on a Send click if the node text wasn't re-readable from the click event itself
            return
        }

        stateMachine.onFieldTextObserved(
            pkg = pkg,
            appName = ShieldStore.appDisplayNameForPackage(pkg),
            rawText = resolvedText,
            protectionLevel = ShieldStore.getProtectionLevel(this),
        )
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

    private fun isSendClickEvent(
        node: AccessibilityNodeInfo,
        event: AccessibilityEvent,
        hasTrackedSecret: Boolean,
    ): Boolean {
        val eventText = event.text.joinToString(" ").ifBlank { null }
        val eventDesc = event.contentDescription?.toString()

        // Check clicked node + child labels (for icon wrappers)
        val childDesc = (0 until node.childCount.coerceAtMost(4))
            .mapNotNull { idx -> node.getChild(idx)?.contentDescription?.toString() ?: node.getChild(idx)?.text?.toString() }
            .firstOrNull { it.isNotBlank() }

        if (SendButtonMatcher.isLikelySendControl(
                text = node.text?.toString() ?: eventText,
                contentDescription = node.contentDescription?.toString() ?: eventDesc ?: childDesc,
                viewIdResourceName = node.viewIdResourceName,
                isClickable = node.isClickable,
                isEditable = node.isEditable,
            )
        ) {
            return true
        }

        // Check up to 2 ancestor levels (e.g., ImageView inside clickable FrameLayout/Compose Box)
        var ancestor: AccessibilityNodeInfo? = node.parent
        var depth = 0
        while (ancestor != null && depth < 2) {
            if (SendButtonMatcher.isLikelySendControl(
                    text = ancestor.text?.toString(),
                    contentDescription = ancestor.contentDescription?.toString(),
                    viewIdResourceName = ancestor.viewIdResourceName,
                    isClickable = ancestor.isClickable,
                    isEditable = ancestor.isEditable,
                )
            ) {
                return true
            }
            ancestor = ancestor.parent
            depth++
        }

        // Sibling / near-editable fallback when holding a secret
        val parentContainer = node.parent
        val grandparentContainer = parentContainer?.parent
        val sharesContainerWithEditable = (parentContainer != null && findFirstEditable(parentContainer) != null) ||
            (grandparentContainer != null && findFirstEditable(grandparentContainer) != null)

        val clickableTarget = if (node.isClickable) node else node.parent
        return SendButtonMatcher.isLikelyNearEditableSendClick(
            isClickable = clickableTarget?.isClickable ?: false,
            isEditable = node.isEditable,
            hasTrackedSecret = hasTrackedSecret,
            text = node.text?.toString() ?: eventText,
            contentDescription = node.contentDescription?.toString() ?: eventDesc ?: childDesc,
            viewIdResourceName = clickableTarget?.viewIdResourceName ?: node.viewIdResourceName,
            sharesContainerWithEditable = sharesContainerWithEditable,
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

    private fun dp(value: Int): Int = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP,
        value.toFloat(),
        resources.displayMetrics,
    ).toInt()

    private fun showSendPromptOverlay(promptState: PendingSendPromptState) {
        mainHandler.post {
            dismissOverlayInternal()
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
                    dismissOverlay()
                    if (rejected != null) {
                        val targetNode = heldInputNode ?: findActiveEditableNode(rootInActiveWindow)
                        val restoreArgs = Bundle().apply {
                            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, rejected.rawText)
                        }
                        targetNode?.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, restoreArgs)
                        ShieldStore.recordOverrideEvent(
                            context = this@CordonAccessibilityService,
                            appName = rejected.appName,
                            spans = rejected.spans,
                            engineUsed = "Deterministic Rules",
                        )
                    }
                    heldInputNode = null
                    lastSendNode = null
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
                    dismissOverlay()
                    if (accepted != null) {
                        val targetNode = heldInputNode ?: findActiveEditableNode(rootInActiveWindow)
                        val scrubArgs = Bundle().apply {
                            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, accepted.sanitizedText)
                        }
                        val replaced = targetNode?.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, scrubArgs) ?: false
                        if (replaced) {
                            ShieldStore.recordBlockEvent(
                                context = this@CordonAccessibilityService,
                                appName = accepted.appName,
                                spans = accepted.spans,
                                engineUsed = "Deterministic Rules",
                            )
                            lastSendNode?.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                        }
                    }
                    heldInputNode = null
                    lastSendNode = null
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
        stateMachine.reset()
        heldInputNode = null
        lastSendNode = null
        dismissOverlay()
    }

    override fun onDestroy() {
        stateMachine.reset()
        heldInputNode = null
        lastSendNode = null
        dismissOverlay()
        super.onDestroy()
    }
}
