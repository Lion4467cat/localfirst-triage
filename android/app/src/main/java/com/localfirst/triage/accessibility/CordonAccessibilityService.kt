package com.localfirst.triage.accessibility

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.localfirst.triage.R
import com.localfirst.triage.data.ShieldStore
import com.localfirst.triage.firewall.LocalFirewallEngine
import com.localfirst.triage.model.ProtectionLevel
import com.localfirst.triage.model.RedactionSpan
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

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
 * Pure, token-based matcher for Send / Submit / Post / Reply / Ask / Generate / Run controls in
 * guarded AI and chat apps.
 *
 * Labels are tokenised (split on non-alphanumerics and camelCase) and compared as whole tokens, so
 * "Task", "Mask" or "Deposit" never match "ask" / "post" the way a substring regex would.
 */
object SendButtonMatcher {
    /** Exact, unambiguous send labels (short labels only - multi-word phrases use token matching). */
    private val EXACT_SEND_LABELS = setOf(
        "send", "submit", "send message", "send messages",
    )
    private val PRIMARY_TOKENS = setOf("send", "submit")
    private val SECONDARY_TOKENS = setOf("post", "dispatch", "reply", "ask", "generate", "run")

    private val NON_SEND_TOKENS = setOf(
        "back", "close", "cancel", "dismiss", "menu", "settings", "attach", "attachment", "upload",
        "camera", "photo", "gallery", "mic", "microphone", "voice", "speech", "dictate", "record",
        "copy", "paste", "clear", "delete", "emoji", "sticker", "search", "drawer", "incognito",
        "add", "plus", "more", "options", "share", "history", "profile", "stop",
    )
    private val NON_SEND_PHRASE_REGEX = Regex("""new[_\s]?chat|add\s+files""", RegexOption.IGNORE_CASE)
    private val CAMEL_BOUNDARY_REGEX = Regex("([a-z0-9])([A-Z])")
    private val SPLIT_REGEX = Regex("[^A-Za-z0-9]+")

    /** Visible labels longer than this are prose (e.g. a chat bubble), not a button label. */
    private const val MAX_LABEL_TOKENS = 4

    private fun tokenize(raw: String): List<String> =
        raw.replace(CAMEL_BOUNDARY_REGEX, "$1 $2")
            .split(SPLIT_REGEX)
            .map { it.lowercase() }
            .filter { it.isNotEmpty() }

    /**
     * 3 = exact send label, 2 = send/submit token, 1 = post/reply/ask/generate/run token, 0 = none.
     */
    fun labelStrength(
        text: String?,
        contentDescription: String?,
        viewIdResourceName: String?,
    ): Int {
        var best = 0
        val labelled = listOf(text, contentDescription).map { it to true } +
            listOf(viewIdResourceName to false)
        for ((raw, isVisibleLabel) in labelled) {
            val value = raw?.trim().orEmpty()
            if (value.isEmpty()) continue
            val tokens = tokenize(value)
            if (tokens.isEmpty()) continue
            if (isVisibleLabel && tokens.size > MAX_LABEL_TOKENS) continue
            val normalised = tokens.joinToString(" ")
            val strength = when {
                isVisibleLabel && normalised in EXACT_SEND_LABELS -> 3
                tokens.any { it in PRIMARY_TOKENS } -> 2
                tokens.any { it in SECONDARY_TOKENS } -> 1
                else -> 0
            }
            if (strength > best) best = strength
        }
        return best
    }

    fun isLikelySendControl(
        text: String?,
        contentDescription: String?,
        viewIdResourceName: String?,
        isClickable: Boolean,
        isEditable: Boolean,
    ): Boolean {
        if (isEditable) return false
        return labelStrength(text, contentDescription, viewIdResourceName) >= 1
    }

    fun isNonSendControl(
        text: String?,
        contentDescription: String?,
        viewIdResourceName: String?,
    ): Boolean {
        val combined = listOfNotNull(text, contentDescription, viewIdResourceName)
            .joinToString(" ")
            .trim()
        if (combined.isEmpty()) return false
        if (NON_SEND_PHRASE_REGEX.containsMatchIn(combined)) return true
        return tokenize(combined).any { it in NON_SEND_TOKENS }
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
 * Pure geometry helper to pick the send button candidate from screen bounds, combining label
 * strength with proximity to the composer.
 */
data class ClickableBoundsCandidate(
    val index: Int,
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int,
    val isRegexMatch: Boolean,
    val isNonSend: Boolean,
    val strengthOverride: Int? = null,
) {
    val width: Int get() = right - left
    val height: Int get() = bottom - top
    val centerX: Int get() = (left + right) / 2
    val centerY: Int get() = (top + bottom) / 2

    /** 0..3, see [SendButtonMatcher.labelStrength]. Falls back to the legacy boolean flag. */
    val labelStrength: Int get() = strengthOverride ?: if (isRegexMatch) 2 else 0
}

object SendBoundsSelector {
    private const val STRONG_LABEL = 3

    fun pickBestCandidate(
        candidates: List<ClickableBoundsCandidate>,
        editableLeft: Int,
        editableTop: Int,
        editableRight: Int,
        editableBottom: Int,
        minLabelStrength: Int = 0,
        screenWidth: Int = 0,
        screenHeight: Int = 0,
    ): ClickableBoundsCandidate? {
        val hasEditable = editableRight > editableLeft && editableBottom > editableTop
        val editableWidth = (editableRight - editableLeft).coerceAtLeast(100)
        val editableHeight = (editableBottom - editableTop).coerceAtLeast(60)
        val editableMidX = (editableLeft + editableRight) / 2
        val editableCenterY = (editableTop + editableBottom) / 2

        // Screen-size thresholds for filtering oversized containers
        val maxContainerWidth = if (screenWidth > 0) (screenWidth * 0.4).toInt() else Int.MAX_VALUE
        val maxContainerHeight = if (screenHeight > 0) (screenHeight * 0.25).toInt() else Int.MAX_VALUE

        val scored = candidates.mapNotNull { c ->
            if (c.width <= 4 || c.height <= 4) return@mapNotNull null
            if (c.labelStrength < minLabelStrength) return@mapNotNull null
            if (c.isNonSend && c.labelStrength < STRONG_LABEL) return@mapNotNull null

            // Filter out oversized containers that are likely full-screen wrappers (e.g., Gemini's wrapper)
            if (c.width > maxContainerWidth || c.height > maxContainerHeight) return@mapNotNull null

            var score = c.labelStrength * 10_000
            if (hasEditable) {
                // Exclude large container/backdrop nodes that enclose the editable field
                val enclosesEditable = c.left <= editableLeft && c.right >= editableRight &&
                    c.top <= editableTop && c.bottom >= editableBottom
                val isHugeContainer = c.width > (editableWidth * 0.85) && c.height > (editableHeight * 1.8)
                if (enclosesEditable || isHugeContainer) return@mapNotNull null

                if (c.labelStrength == 0) {
                    // Unlabelled: must sit right of the field's midpoint and next to the composer.
                    val plausible = c.centerX >= editableMidX &&
                        c.top >= editableTop - 40 &&
                        c.top <= editableBottom + 240
                    if (!plausible) return@mapNotNull null
                } else {
                    val nearComposer = c.centerY >= editableTop - 160 && c.centerY <= editableBottom + 320
                    // A labelled control far from the composer (feed "Post", header chip...) only
                    // qualifies when its label is unambiguous.
                    if (!nearComposer && c.labelStrength < STRONG_LABEL) return@mapNotNull null
                    if (!nearComposer) score -= 6_000
                }
                val distFromRight = abs(editableRight - c.right)
                val dy = abs(c.centerY - editableCenterY)
                score += 5_000 - (distFromRight + dy).coerceAtMost(4_999)
                if (c.centerX >= editableMidX) score += 500
            } else {
                // No editable bounds known: prefer labelled controls, then bottom-right-most.
                score += c.centerY / 10 + c.centerX / 10
            }
            c to score
        }
        return scored.maxByOrNull { it.second }?.first
    }
}

/**
 * Pure geometry for the touch shield: expand the send rect by a touch padding, clamp to the
 * screen, then clip every edge back out of the editable input box so the shield NEVER overlaps
 * the composer. Only the padding is allowed to intrude into the editable, so each edge is pulled
 * back only when the editable's own edge cuts into the padding zone (not the send rect itself).
 */
object ShieldGeometry {
    /** Pure-JVM rect so the geometry is unit-testable without Android framework stubs. */
    data class ShieldRect(val left: Int, val top: Int, val right: Int, val bottom: Int) {
        val width: Int get() = right - left
        val height: Int get() = bottom - top
        val centerX: Int get() = (left + right) / 2
        val centerY: Int get() = (top + bottom) / 2

        fun intersects(other: ShieldRect): Boolean =
            left < other.right && right > other.left && top < other.bottom && bottom > other.top

        fun toRect(): Rect = Rect(left, top, right, bottom)
    }

    fun expandAndClip(
        send: ShieldRect,
        editable: ShieldRect?,
        screen: ShieldRect,
        paddingPx: Int,
        minWidthPx: Int,
        minHeightPx: Int,
    ): ShieldRect {
        var out = ShieldRect(
            max(screen.left, send.left - paddingPx),
            max(screen.top, send.top - paddingPx),
            min(screen.right, send.right + paddingPx),
            min(screen.bottom, send.bottom + paddingPx),
        )
        if (editable != null && editable.intersects(out)) {
            var l = out.left
            var t = out.top
            var r = out.right
            var b = out.bottom
            if (editable.bottom > t && editable.bottom <= send.top) t = editable.bottom
            if (editable.top < b && editable.top >= send.bottom) b = editable.top
            if (editable.right > l && editable.right <= send.left) l = editable.right
            if (editable.left < r && editable.left >= send.right) r = editable.left
            out = ShieldRect(l, t, r, b)
        }
        // Guarantee a reliable touch target without overlapping the editable: grow around the
        // centre, clamped to the screen.
        if (out.width < minWidthPx) {
            var l = (out.centerX - minWidthPx / 2).coerceAtLeast(screen.left)
            var r = (l + minWidthPx).coerceAtMost(screen.right)
            l = (r - minWidthPx).coerceAtLeast(screen.left)
            out = ShieldRect(l, out.top, r, out.bottom)
        }
        if (out.height < minHeightPx) {
            var t = (out.centerY - minHeightPx / 2).coerceAtLeast(screen.top)
            var b = (t + minHeightPx).coerceAtMost(screen.bottom)
            t = (b - minHeightPx).coerceAtLeast(screen.top)
            out = ShieldRect(out.left, t, out.right, b)
        }
        return out
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
 * What a tap on the armed shield is allowed to do.
 */
enum class ShieldTapOutcome {
    /** A risky state is available: show the prompt and keep the shield. */
    SHOW_PROMPT,

    /** The composer read was readable and clean: let the tap reach the real Send. */
    SEND,

    /** The composer could not be proven clean: keep the shield and never send. */
    HOLD,
}

/** Result of [SendPromptStateMachine.onShieldTapped]. */
data class ShieldTapResult(
    val outcome: ShieldTapOutcome,
    val prompt: PendingSendPromptState?,
)

/**
 * Pure state machine enforcing:
 * - Zero popups while typing or pasting
 * - Touch shield armed over Send button only while unredacted secrets/PII exist
 * - Shield stays armed while the prompt is visible (a second tap can never leak the secret)
 * - Single-prompt override memory so "Reject & Send Anyway" never loops on the same text
 * - A short-lived memory of the last risky state so one transient blank/unreadable observation
 *   (apps like ChatGPT emit dozens of content-changed events per second) cannot open a gap
 */
class SendPromptStateMachine {
    var trackedState: PendingSendPromptState? = null
        private set
    var isPromptVisible: Boolean = false
        private set
    var overriddenTextHash: Int? = null
        private set

    private var recentState: PendingSendPromptState? = null
    private var recentAtMs: Long = 0L

    fun onFieldTextObserved(
        pkg: String,
        appName: String,
        rawText: String,
        protectionLevel: ProtectionLevel,
        nowMs: Long = System.currentTimeMillis(),
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
            // A readable, clean reading is proof the field no longer holds the secret, so the
            // fallback must not resurrect it later and scrub over what the user has typed since.
            recentState = null
            return
        }

        val state = PendingSendPromptState(
            packageName = pkg,
            appName = appName,
            rawText = rawText,
            sanitizedText = sanitizedText,
            spans = activeSpans,
            summaryText = formatCategoryCountsSummary(activeSpans),
        )
        trackedState = state
        recentState = state
        recentAtMs = nowMs
    }

    /** Legacy gate: shield is armed only while no prompt is showing. */
    fun shouldArmTouchShield(pkg: String): Boolean {
        if (isPromptVisible) return false
        return shouldHoldShield(pkg)
    }

    /** True while the shield must stay over Send, including while the prompt is visible. */
    fun shouldHoldShield(pkg: String): Boolean {
        val state = trackedState ?: return false
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

    /**
     * Single entry point for a tap on the armed shield.
     *
     * A blank or unreadable composer read is ambiguous (a recomposition flap looks exactly like a
     * cleared field), so it is never fed to [onFieldTextObserved] and never treated as proof that
     * the text is safe. Only a non-blank read may change the tracked risk; otherwise the tap
     * falls back to a risky state seen within [RECENT_STATE_TTL_MS], and failing that the shield
     * is held instead of letting the tap send raw text.
     */
    fun onShieldTapped(
        pkg: String,
        appName: String,
        fresh: String?,
        protectionLevel: ProtectionLevel,
        nowMs: Long = System.currentTimeMillis(),
    ): ShieldTapResult {
        val readable = !fresh.isNullOrBlank()
        if (!fresh.isNullOrBlank()) {
            onFieldTextObserved(pkg, appName, fresh, protectionLevel, nowMs)
        }
        val prompt = if (readable) onSendClicked(pkg) else onSendClickedRecent(pkg, nowMs)
        val outcome = when {
            prompt != null -> ShieldTapOutcome.SHOW_PROMPT
            !readable -> ShieldTapOutcome.HOLD
            else -> ShieldTapOutcome.SEND
        }
        return ShieldTapResult(outcome = outcome, prompt = prompt)
    }

    /**
     * Used only when the composer text could not be re-read at tap time: fail safe by trusting a
     * risky state seen within [RECENT_STATE_TTL_MS].
     */
    fun onSendClickedRecent(pkg: String, nowMs: Long = System.currentTimeMillis()): PendingSendPromptState? {
        onSendClicked(pkg)?.let { return it }
        val recent = recentState ?: return null
        if (recent.packageName != pkg) return null
        if (nowMs - recentAtMs > RECENT_STATE_TTL_MS) return null
        if (recent.rawText.hashCode() == overriddenTextHash) return null
        trackedState = recent
        isPromptVisible = true
        return recent
    }

    fun dismissPrompt() {
        isPromptVisible = false
    }

    fun acceptScrub(): PendingSendPromptState? {
        val state = trackedState
        trackedState = null
        recentState = null
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
        recentState = null
        isPromptVisible = false
        return state
    }

    fun reset() {
        trackedState = null
        recentState = null
        isPromptVisible = false
    }

    companion object {
        const val RECENT_STATE_TTL_MS = 1_500L

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

/**
 * Decides whether the shield should re-scan for the Send control.
 *
 * The first scan after typing can land while the IME is still animating (no window root)
 * or before the Send node is attached. Without a retry the user can tap Send before the
 * shield exists and the message leaves unredacted, so a missing tree is retried with a
 * short backoff instead of waiting for the next accessibility event.
 */
object ShieldArmRetryPolicy {
    const val MAX_ATTEMPTS = 8

    fun shouldRetry(attempt: Int, rootAvailable: Boolean, targetAvailable: Boolean): Boolean {
        if (attempt >= MAX_ATTEMPTS) return false
        return !(rootAvailable && targetAvailable)
    }

    /** 60ms, then ×1.5 up to a 250ms ceiling: total budget stays under 1.5s. */
    fun delayMs(attempt: Int): Long {
        var delay = 60L
        repeat(attempt.coerceAtLeast(0)) { delay = (delay * 3 / 2).coerceAtMost(250L) }
        return delay
    }
}

/**
 * Where the confirmation dialog sits: right above the Send control it is guarding, so the
 * choice appears next to the user's thumb instead of at the far end of the screen.
 */
object PromptPlacement {
    fun topFor(anchorTop: Int, promptHeight: Int, gapPx: Int, minTopPx: Int): Int =
        (anchorTop - promptHeight - gapPx).coerceAtLeast(minTopPx)
}

class CordonAccessibilityService : AccessibilityService() {
    companion object {
        private const val TAG = "CordonA11y"
        private const val MAX_TREE_SCAN_NODES = 800
        private const val MAX_COMPOSER_SCAN_NODES = 160
        private const val MAX_COMPOSER_ANCESTOR_HOPS = 4
        private const val EDITABLE_SEARCH_BUDGET = 1500
        private const val REFRESH_COALESCE_MS = 100L
        private const val SHIELD_REMOVE_GRACE_MS = 450L
        /** The trailing share of the composer row where every chat UI puts its Send control. */
        private const val SHIELD_WIDTH_FRACTION = 0.34f
        /** A little slack below the composer row for controls that hang off its bottom edge. */
        private const val SHIELD_EXTRA_BOTTOM_DP = 10
        /** Never cover more than this much of a tall editor (a full-page field would be unusable). */
        private const val SHIELD_MAX_HEIGHT_DP = 132
        private const val TYPING_HINT_HEIGHT_DP = 34
        private const val TYPING_HINT_GAP_DP = 10
        private const val TYPING_HINT_EDGE_DP = 10
        private const val TRANSCRIPT_SCAN_NODES = 600
        /** Placement drift above this many pixels is corrected once (split-screen, insets, folds). */
        private const val SHIELD_DRIFT_TOLERANCE_PX = 24
        private const val SYSTEM_UI_PACKAGE = "com.android.systemui"
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var windowManager: WindowManager? = null
    private var touchShieldView: View? = null
    private var touchShieldBounds: Rect? = null
    private var promptOverlayView: View? = null
    private var typingHintView: View? = null
    private var typingHintLabel: TextView? = null
    private var typingHintBounds: Rect? = null
    /** True while the blocker is reporting a send that already left; it must not self-dismiss. */
    private var promptIsEscaped = false

    private val stateMachine = SendPromptStateMachine()
    private var heldInputNode: AccessibilityNodeInfo? = null
    private var armedSendNode: AccessibilityNodeInfo? = null
    private var activePackage: String? = null

    private var refreshPending = false
    private var shieldRemovalPending = false
    private var pendingRemovalReason = "unspecified"
    private var lastLoggedArmed = false
    private var consecutiveBlankObservations = 0
    private var armRetryAttempt = 0
    private var armRetryPending = false

    private val delayedArmRetry = Runnable {
        armRetryPending = false
        val pkg = activePackage ?: return@Runnable
        if (!stateMachine.shouldHoldShield(pkg)) return@Runnable
        syncTouchShieldWithActiveWindow(pkg)
    }

    private fun cancelArmRetry() {
        armRetryPending = false
        armRetryAttempt = 0
        mainHandler.removeCallbacks(delayedArmRetry)
    }

    private fun scheduleArmRetry(pkg: String, rootAvailable: Boolean, targetAvailable: Boolean) {
        if (!ShieldArmRetryPolicy.shouldRetry(armRetryAttempt, rootAvailable, targetAvailable)) return
        if (armRetryPending) return
        val delay = ShieldArmRetryPolicy.delayMs(armRetryAttempt)
        armRetryPending = true
        armRetryAttempt++
        Log.d(TAG, "shieldArmRetry pkg=$pkg attempt=$armRetryAttempt delay=${delay}ms")
        mainHandler.postDelayed(delayedArmRetry, delay)
    }

    private val delayedShieldRemoval = Runnable {
        shieldRemovalPending = false
        if (touchShieldView != null) {
            Log.d(TAG, "shieldRemoved reason=$pendingRemovalReason pkg=$activePackage")
        }
        removeTouchShieldInternal()
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        windowManager = getSystemService(Context.WINDOW_SERVICE) as? WindowManager
        Log.d(TAG, "serviceConnected=true")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val pkg = event.packageName?.toString()

        if (pkg == null || pkg == packageName || ShieldStore.isShieldPaused(this) || !ShieldStore.isPackageGuarded(this, pkg)) {
            handleForeignEvent(event)
            return
        }

        if (activePackage != null && activePackage != pkg) {
            clearAllStateAndOverlays()
        }
        activePackage = pkg

        when (event.eventType) {
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED,
            AccessibilityEvent.TYPE_VIEW_FOCUSED,
            -> {
                // Typing / focus changes are rare enough to evaluate immediately.
                refreshAndSync(pkg, event.source, event, event.eventType)
            }

            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED,
            AccessibilityEvent.TYPE_WINDOWS_CHANGED,
            AccessibilityEvent.TYPE_VIEW_SCROLLED,
            -> scheduleCoalescedRefresh(pkg)
        }
    }

    /**
     * The one send path that can be stopped *before* the app sees it.
     *
     * With `flagRequestFilterKeyEvents` a hardware Enter arrives here first, so a physical
     * keyboard or a TV remote can never bypass the guard. Soft keyboards are deliberately not
     * handled here: the platform does not guarantee KeyEvents from an IME, so that path is
     * covered by the composer shield and, failing that, by the post-send blocker.
     */
    override fun onKeyEvent(event: KeyEvent): Boolean {
        val pkg = activePackage
        if (pkg == null || ShieldStore.isShieldPaused(this)) return super.onKeyEvent(event)
        val risky = stateMachine.shouldHoldShield(pkg)
        if (!EnterKeyPolicy.shouldConsume(event.keyCode, event.action, risky)) {
            return super.onKeyEvent(event)
        }
        if (event.action == KeyEvent.ACTION_DOWN && !stateMachine.isPromptVisible) {
            val prompt = stateMachine.onSendClicked(pkg)
            Log.d(TAG, "enterKeyConsumed pkg=$pkg keyCode=${event.keyCode} prompt=${prompt != null}")
            if (prompt != null) showSendPromptOverlay(prompt)
        }
        // Swallow both the down and the up, or the app sees a dangling key-up.
        return true
    }

    /** Events from other apps / our own UI / paused shield: only manage overlay lifecycle. */
    private fun handleForeignEvent(event: AccessibilityEvent) {
        val hasOverlays = activePackage != null || touchShieldView != null || promptOverlayView != null
        if (!hasOverlays) return

        if (ShieldStore.isShieldPaused(this)) {
            clearAllStateAndOverlays()
            return
        }

        val activeRootPkg = rootInActiveWindow?.packageName?.toString()
        val current = activePackage
        if (activeRootPkg != null && current != null && activeRootPkg == current) {
            // Same guarded app is still in front (e.g. keyboard opened/closed): keep shield aligned.
            if (event.eventType == AccessibilityEvent.TYPE_WINDOWS_CHANGED) {
                scheduleCoalescedRefresh(current)
            }
            return
        }

        if (
            activeRootPkg != null &&
            activeRootPkg != SYSTEM_UI_PACKAGE &&
            !ShieldStore.isPackageGuarded(this, activeRootPkg)
        ) {
            Log.d(TAG, "clearOnPackageSwitch activeRootPkg=$activeRootPkg prev=$current")
            clearAllStateAndOverlays()
        }
    }

    private fun scheduleCoalescedRefresh(pkg: String) {
        if (refreshPending) return
        refreshPending = true
        mainHandler.postDelayed({
            refreshPending = false
            if (activePackage == pkg && !ShieldStore.isShieldPaused(this)) {
                refreshAndSync(pkg, null, null, AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED)
            }
        }, REFRESH_COALESCE_MS)
    }

    private fun refreshAndSync(
        pkg: String,
        source: AccessibilityNodeInfo?,
        event: AccessibilityEvent?,
        eventType: Int,
    ) {
        refreshTrackedFromActiveWindow(pkg, source, event, eventType)
        syncTouchShieldWithActiveWindow(pkg)
    }

    private fun refreshTrackedFromActiveWindow(
        pkg: String,
        source: AccessibilityNodeInfo?,
        event: AccessibilityEvent?,
        eventType: Int,
    ) {
        // While the prompt is up, only an explicit user edit may change the tracked state.
        if (stateMachine.isPromptVisible && eventType != AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED) return
        // Never read password fields.
        if (source != null && isPasswordNode(source)) return

        val root = guardedRoot(pkg)
        val editableFromSource = if (source != null && source.isEditable) source else null
        val editable = editableFromSource ?: findActiveEditableNode(root)

        val nodeText = editable?.text?.toString()
        val eventText = if (eventType == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED || editableFromSource != null) {
            event?.text?.joinToString("")
        } else {
            null
        }
        val treeText = if (nodeText.isNullOrBlank() && eventText.isNullOrBlank()) {
            findFirstEditableWithText(root)?.let { node ->
                if (editable == null) heldInputNode = node
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

        if (editable != null && (editable.isFocused || !nodeText.isNullOrBlank() || heldInputNode == null)) {
            heldInputNode = editable
        }

        if (resolvedText.isBlank()) {
            // Unreadable node: keep the armed state, debounce handles the miss.
            if (editable == null) return
            // A single blank reading can be a recomposition flap. Only treat it as a
            // confirmed clear (immediate teardown) on a real text-changed event or a
            // second consecutive blank observation; otherwise hold the shield.
            consecutiveBlankObservations++
            val confirmedClear = eventType == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED ||
                consecutiveBlankObservations >= 2
            if (!confirmedClear) return
        } else {
            consecutiveBlankObservations = 0
        }

        val riskyBeforeClear = if (resolvedText.isBlank()) stateMachine.trackedState else null

        stateMachine.onFieldTextObserved(
            pkg = pkg,
            appName = ShieldStore.appDisplayNameForPackage(pkg),
            rawText = resolvedText,
            protectionLevel = ShieldStore.getProtectionLevel(this),
        )

        // The composer emptied while it held a secret: either the user deleted it, or the
        // message left through a path Android gives us no hook for (the soft keyboard's own
        // Send arrow). Only a transcript that now contains the secret proves the latter.
        if (riskyBeforeClear != null) {
            reportEscapedSendIfProven(pkg, riskyBeforeClear, root)
        }

        val armed = stateMachine.shouldHoldShield(pkg)
        if (armed != lastLoggedArmed) {
            lastLoggedArmed = armed
            Log.d(
                TAG,
                "textObserved pkg=$pkg type=${AccessibilityEvent.eventTypeToString(eventType)} len=${resolvedText.length} armed=$armed",
            )
        }

        // User edited the secret away while the prompt was open: nothing left to protect.
        // An escaped-send report is exempt: it describes a send that already happened, so the
        // empty composer must not dismiss it.
        if (!promptIsEscaped && stateMachine.isPromptVisible && stateMachine.trackedState == null) {
            Log.d(TAG, "promptDismissed reason=textNoLongerRisky pkg=$pkg")
            stateMachine.dismissPrompt()
            dismissPromptOverlayInternal()
        }
    }

    /**
     * Shows the stern "this already left" screen, but only on proof: the secret must reappear
     * in the conversation tree. Deleting a draft also empties the composer, and accusing that
     * user would destroy trust in every other warning.
     */
    private fun reportEscapedSendIfProven(
        pkg: String,
        before: PendingSendPromptState,
        root: AccessibilityNodeInfo?,
    ) {
        if (stateMachine.isPromptVisible || promptIsEscaped) return
        if (before.rawText.hashCode() == stateMachine.overriddenTextHash) return
        val transcript = collectVisibleTexts(root, TRANSCRIPT_SCAN_NODES)
        val leaked = EscapedSendDetector.isPresent(
            secretTexts = before.spans.map { it.matchedText },
            visibleTexts = transcript,
        )
        if (!leaked) {
            Log.d(TAG, "draftClearedWithoutSend pkg=$pkg summary=${before.summaryText}")
            return
        }
        Log.w(TAG, "sendEscaped pkg=$pkg summary=${before.summaryText}")
        // Deliberately not recorded as a block: nothing was blocked, and a "Blocked" entry in
        // History would be a lie about what happened.
        stateMachine.dismissPrompt()
        showSendPromptOverlay(before, escaped = true)
    }

    /** Text of every node in the tree, used only to prove a secret reached the transcript. */
    private fun collectVisibleTexts(root: AccessibilityNodeInfo?, limit: Int): List<String> {
        val out = ArrayList<String>()
        root ?: return out
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var visited = 0
        while (queue.isNotEmpty() && visited < limit) {
            val node = queue.removeFirst()
            visited++
            node.text?.toString()?.takeIf { it.isNotBlank() }?.let { out.add(it) }
            node.contentDescription?.toString()?.takeIf { it.isNotBlank() }?.let { out.add(it) }
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { queue.add(it) }
            }
        }
        return out
    }

    /** Real screen bounds (status bar / cutout included) matching getBoundsInScreen space. */
    private fun screenBounds(): Rect {
        val wm = windowManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && wm != null) {
            return Rect(wm.currentWindowMetrics.bounds)
        }
        @Suppress("DEPRECATION")
        return Rect(0, 0, resources.displayMetrics.widthPixels, resources.displayMetrics.heightPixels)
    }

    private fun syncTouchShieldWithActiveWindow(pkg: String) {
        if (!stateMachine.shouldHoldShield(pkg)) {
            // Confirmed clean / empty / overridden text: tear down IMMEDIATELY so the next
            // normal tap reaches Send. Only transient node misses get the debounced path below.
            cancelArmRetry()
            if (touchShieldView != null) {
                Log.d(TAG, "shieldRemoved reason=hold=false pkg=$pkg")
            }
            removeTouchShieldInternal()
            return
        }

        val root = guardedRoot(pkg)
        if (root == null) {
            Log.d(TAG, "shieldNoRoot pkg=$pkg")
            scheduleArmRetry(pkg, rootAvailable = false, targetAvailable = false)
            scheduleShieldRemoval("rootNull")
            return
        }

        val editable = heldInputNode?.takeIf { runCatching { it.refresh() }.getOrDefault(false) }
            ?: findActiveEditableNode(root)
        // The node tree is only used to *click* Send after a scrub. Placement never depends on
        // finding the control: an arrow-shaped or unlabelled button is invisible to the tree,
        // which is exactly what made node matching unreliable across devices.
        val target = locateSendTarget(root, editable)
        val composer = composerRect(editable, target)
        if (composer == null) {
            Log.d(TAG, "shieldNoComposer pkg=$pkg")
            scheduleArmRetry(pkg, rootAvailable = true, targetAvailable = false)
            scheduleShieldRemoval("noComposer")
            return
        }

        val region = shieldRegionFor(composer)
        if (region == null) {
            Log.d(TAG, "shieldNoRegion pkg=$pkg")
            scheduleArmRetry(pkg, rootAvailable = true, targetAvailable = false)
            scheduleShieldRemoval("rectEmpty")
            return
        }

        cancelArmRetry()
        armedSendNode = target?.node
        showOrRepositionTouchShield(pkg, region.toRect(), target?.candidate?.labelStrength ?: 0)
        syncTypingHint(pkg, composer)
    }

    private class SendTarget(val node: AccessibilityNodeInfo, val candidate: ClickableBoundsCandidate)

    /** The composer row the guard is anchored to: the editable itself, else the Send control. */
    private fun composerRect(editable: AccessibilityNodeInfo?, target: SendTarget?): Rect? {
        val r = Rect()
        if (editable != null) {
            editable.getBoundsInScreen(r)
            if (!r.isEmpty) return r
        }
        val c = target?.candidate ?: return null
        return Rect(c.left, c.top, c.right, c.bottom).takeIf { !it.isEmpty }
    }

    /**
     * The corner of the composer that holds Send, clamped to the screen, to a sane height and
     * to the top of the keyboard so no key is ever covered.
     */
    private fun shieldRegionFor(composer: Rect): ShieldGeometry.ShieldRect? {
        val screen = screenBounds()
        return ComposerTrailingRegion.forComposer(
            composer = ShieldGeometry.ShieldRect(composer.left, composer.top, composer.right, composer.bottom),
            screen = ShieldGeometry.ShieldRect(screen.left, screen.top, screen.right, screen.bottom),
            widthFraction = SHIELD_WIDTH_FRACTION,
            extraBottomPx = dp(SHIELD_EXTRA_BOTTOM_DP),
            edgeMarginPx = dp(2),
            maxHeightPx = dp(SHIELD_MAX_HEIGHT_DP),
            bottomLimitPx = keyboardTopOr(screen.bottom),
        )
    }

    /** Top of the soft keyboard when it is up, so the shield can never cover a key. */
    private fun keyboardTopOr(fallback: Int): Int {
        val list = runCatching { windows }.getOrNull() ?: return fallback
        for (window in list) {
            if (window.type != AccessibilityWindowInfo.TYPE_INPUT_METHOD) continue
            val r = Rect()
            window.getBoundsInScreen(r)
            if (!r.isEmpty) return r.top
        }
        return fallback
    }

    private class ScanLevel(
        val nodes: List<AccessibilityNodeInfo>,
        val candidates: List<ClickableBoundsCandidate>,
    )

    private fun scanLevel(scope: AccessibilityNodeInfo, budget: Int): ScanLevel {
        val nodes = collectClickableNodes(scope, budget)
        return ScanLevel(nodes, nodes.mapIndexed { index, node -> toCandidate(index, node) })
    }

    /**
     * Finds the Send control. Searches the composer's nearest containers first, scores label
     * strength + proximity to the editable (so a "Task" chip can never beat a real Send button),
     * and only then widens to the whole window.
     */
    private fun locateSendTarget(root: AccessibilityNodeInfo, editable: AccessibilityNodeInfo?): SendTarget? {
        val eb = Rect()
        editable?.getBoundsInScreen(eb)

        val screen = screenBounds()
        val screenWidth = screen.width()
        val screenHeight = screen.height()

        val levels = ArrayList<ScanLevel>()
        if (editable != null) {
            var ancestor: AccessibilityNodeInfo? = editable.parent
            var hops = 0
            while (ancestor != null && hops < MAX_COMPOSER_ANCESTOR_HOPS) {
                levels += scanLevel(ancestor, MAX_COMPOSER_SCAN_NODES)
                ancestor = ancestor.parent
                hops++
            }
        }
        val rootLevel by lazy(LazyThreadSafetyMode.NONE) { scanLevel(root, MAX_TREE_SCAN_NODES) }

        fun pick(scanLevels: List<ScanLevel>, minStrength: Int): SendTarget? {
            for (level in scanLevels) {
                val c = SendBoundsSelector.pickBestCandidate(
                    level.candidates, eb.left, eb.top, eb.right, eb.bottom, minStrength,
                    screenWidth, screenHeight,
                )
                if (c != null) return SendTarget(level.nodes[c.index], c)
            }
            return null
        }

        return pick(levels, 1)
            ?: pick(listOf(rootLevel), 1)
            ?: pick(levels, 0)
            ?: pick(listOf(rootLevel), 0)
    }

    private fun toCandidate(index: Int, node: AccessibilityNodeInfo): ClickableBoundsCandidate {
        val rect = Rect()
        node.getBoundsInScreen(rect)
        val text = node.text?.toString()
        val desc = node.contentDescription?.toString()?.ifBlank { null } ?: findDescendantLabel(node, maxDepth = 3)
        val viewId = node.viewIdResourceName
        val strength = SendButtonMatcher.labelStrength(text, desc, viewId)
        return ClickableBoundsCandidate(
            index = index,
            left = rect.left,
            top = rect.top,
            right = rect.right,
            bottom = rect.bottom,
            isRegexMatch = !node.isEditable && strength >= 1,
            isNonSend = SendButtonMatcher.isNonSendControl(text, desc, viewId),
            strengthOverride = if (node.isEditable) 0 else strength,
        )
    }

    private fun findDescendantLabel(node: AccessibilityNodeInfo, maxDepth: Int): String? {
        if (maxDepth <= 0) return null
        for (i in 0 until node.childCount.coerceAtMost(6)) {
            val child = node.getChild(i) ?: continue
            val direct = child.contentDescription?.toString()?.ifBlank { null }
                ?: child.text?.toString()?.ifBlank { null }
            if (direct != null) return direct
            val nested = findDescendantLabel(child, maxDepth - 1)
            if (nested != null) return nested
        }
        return null
    }

    private fun collectClickableNodes(scope: AccessibilityNodeInfo, budget: Int): List<AccessibilityNodeInfo> {
        val result = ArrayList<AccessibilityNodeInfo>()
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(scope)
        var visited = 0
        while (queue.isNotEmpty() && visited < budget) {
            val current = queue.removeFirst()
            visited++
            if (!current.isEditable && current.isVisibleToUser && isEffectivelyClickable(current)) {
                result.add(current)
            }
            for (i in 0 until current.childCount) {
                current.getChild(i)?.let { queue.add(it) }
            }
        }
        return result
    }

    private fun isEffectivelyClickable(node: AccessibilityNodeInfo): Boolean {
        if (node.isClickable) return true
        // Some toolkits (Compose / WebView) expose ACTION_CLICK without the clickable flag.
        val labelled = !node.contentDescription.isNullOrBlank() || !node.text.isNullOrBlank() ||
            !node.viewIdResourceName.isNullOrBlank()
        return labelled && node.actionList.any { it.id == AccessibilityNodeInfo.ACTION_CLICK }
    }

    /** Root of the guarded app's window, even if the active window is momentarily something else. */
    private fun guardedRoot(pkg: String): AccessibilityNodeInfo? {
        val active = rootInActiveWindow
        if (active != null && active.packageName?.toString() == pkg) return active
        val fromWindows = windows
            ?.filter { it.type == AccessibilityWindowInfo.TYPE_APPLICATION }
            ?.mapNotNull { it.root }
            ?.firstOrNull { it.packageName?.toString() == pkg }
        return fromWindows ?: active
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
        while (queue.isNotEmpty() && visited < EDITABLE_SEARCH_BUDGET) {
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

    /** Current composer text, or null when it cannot be read (caller then fails safe). */
    private fun readFreshComposerText(pkg: String): String? {
        val held = heldInputNode
        if (held != null && runCatching { held.refresh() }.getOrDefault(false) && held.isEditable && !isPasswordNode(held)) {
            return held.text?.toString().orEmpty()
        }
        val node = findActiveEditableNode(guardedRoot(pkg)) ?: return null
        heldInputNode = node
        return node.text?.toString().orEmpty()
    }

    /** Click the real Send control; if the cached node went stale, locate a fresh one. */
    private fun performSend(cached: AccessibilityNodeInfo?, pkg: String) {
        val clicked = cached?.let {
            runCatching { it.refresh() }
                .onFailure { err -> Log.e(TAG, "performSend nodeRefreshFailed pkg=$pkg err=${err.message}") }
            it.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        } ?: false
        if (clicked) return
        val root = guardedRoot(pkg)
        if (root == null) {
            Log.e(TAG, "performSend rootNull pkg=$pkg")
            return
        }
        val editable = findActiveEditableNode(root)
        val fresh = locateSendTarget(root, editable)?.node
        Log.d(TAG, "performSend staleRetry=${fresh != null} pkg=$pkg")
        val retryOk = fresh?.performAction(AccessibilityNodeInfo.ACTION_CLICK) ?: false
        if (!retryOk) Log.e(TAG, "performSend clickFailed pkg=$pkg")
    }

    private fun dp(value: Int): Int = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP,
        value.toFloat(),
        resources.displayMetrics,
    ).toInt()

    private fun showOrRepositionTouchShield(pkg: String, rect: Rect, labelStrength: Int) {
        if (!stateMachine.shouldHoldShield(pkg)) return
        val wm = windowManager ?: return
        cancelShieldRemoval()
        val existing = touchShieldView

        // The region already covers the Send corner of the composer and is clamped to the
        // screen, the keyboard top and a sane height, so it is used as-is: only a minimum
        // touch target is enforced here.
        val screen = screenBounds()
        val expandedRect = ShieldGeometry.expandAndClip(
            send = ShieldGeometry.ShieldRect(rect.left, rect.top, rect.right, rect.bottom),
            editable = null,
            screen = ShieldGeometry.ShieldRect(screen.left, screen.top, screen.right, screen.bottom),
            paddingPx = 0,
            minWidthPx = dp(44),
            minHeightPx = dp(44),
        ).toRect()

        val params = WindowManager.LayoutParams(
            expandedRect.width(),
            expandedRect.height(),
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            // Intercept touches reliably: NOT_FOCUSABLE | NOT_TOUCH_MODAL | LAYOUT_IN_SCREEN | LAYOUT_NO_LIMITS
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = expandedRect.left
            y = expandedRect.top
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                layoutInDisplayCutoutMode =
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    } else {
                        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                    }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                fitInsetsTypes = 0
            }
        }

        if (existing != null) {
            if (touchShieldBounds != expandedRect) {
                touchShieldBounds = Rect(expandedRect)
                runCatching { wm.updateViewLayout(existing, params) }
                    .onFailure { err ->
                        Log.e(TAG, "shieldUpdateFailed pkg=$pkg err=${err.message}")
                    }
                    .onSuccess { _ ->
                        verifyShieldPlacement(existing, expandedRect, pkg, "shieldMoved", params)
                    }
            }
            return
        }

        val shield = View(this).apply {
            contentDescription = "Cordon Send Shield"
            // Transparent but touchable background - critical for OEM touch reliability
            background = GradientDrawable().apply {
                setColor(Color.argb(18, 245, 158, 11))
                setStroke(dp(1), Color.argb(180, 245, 158, 11))
                cornerRadius = dp(18).toFloat()
            }
            setOnTouchListener { _, event ->
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN -> true // claim the gesture so nothing leaks below
                    MotionEvent.ACTION_UP -> {
                        onShieldTapped(pkg)
                        true
                    }
                    // Consume MOVE/CANCEL too: a shifted thumb must never leak to Send.
                    else -> true
                }
            }
        }

        runCatching {
            wm.addView(shield, params)
            touchShieldView = shield
            touchShieldBounds = Rect(expandedRect)
            Log.d(
                TAG,
                "shieldPlaced pkg=$pkg rect=[${expandedRect.left},${expandedRect.top},${expandedRect.right},${expandedRect.bottom}] labelStrength=$labelStrength",
            )
            verifyShieldPlacement(
                shield, expandedRect, pkg, "shieldArmed", params,
                "labelStrength=$labelStrength findingsCount=${stateMachine.trackedState?.spans?.size ?: 0}",
            )
        }.onFailure { err ->
            Log.e(TAG, "shieldAddViewFailed pkg=$pkg err=${err.message}")
        }
    }

    /**
     * Suggestion while typing: a small non-touchable banner in the gap above the composer.
     *
     * It is `FLAG_NOT_TOUCHABLE`, so it can never eat a keystroke, a cursor placement or a
     * scroll — it only informs, exactly as the brief requires. The shield over Send does the
     * stern part.
     */
    private fun syncTypingHint(pkg: String, composer: Rect) {
        val state = stateMachine.trackedState
        if (state == null || state.packageName != pkg || stateMachine.isPromptVisible) {
            removeTypingHint()
            return
        }
        val wm = windowManager ?: return
        val screen = screenBounds()
        val hintHeight = dp(TYPING_HINT_HEIGHT_DP)
        val top = TypingHintPlacement.topFor(
            composerTop = composer.top,
            hintHeight = hintHeight,
            gapPx = dp(TYPING_HINT_GAP_DP),
            screenTopPx = screen.top,
        )
        val edge = dp(TYPING_HINT_EDGE_DP)
        val bounds = Rect(0, top, screen.width(), top + hintHeight)
        val text = TypingHintCopy.text(state.summaryText)

        typingHintView?.let { existing ->
            typingHintLabel?.text = text
            if (typingHintBounds != bounds) {
                typingHintBounds = Rect(bounds)
                val params = hintLayoutParams(bounds, hintHeight, edge)
                runCatching { wm.updateViewLayout(existing, params) }
                    .onFailure { err -> Log.e(TAG, "typingHintUpdateFailed err=${err.message}") }
            }
            return
        }

        val label = TextView(this).apply {
            this.text = text
            setTextColor(Color.parseColor("#FBBF24"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            maxWidth = screen.width() - dp(72)
        }
        val pill = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), 0, dp(12), 0)
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#11141B"))
                setStroke(dp(1), Color.argb(200, 245, 158, 11))
                cornerRadius = dp(17).toFloat()
            }
            addView(
                ImageView(this@CordonAccessibilityService).apply {
                    setImageResource(R.drawable.ic_brand_logo)
                    contentDescription = null
                },
                LinearLayout.LayoutParams(dp(16), dp(16)),
            )
            addView(
                label,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                ).apply { marginStart = dp(6) },
            )
        }

        val params = hintLayoutParams(bounds, hintHeight, edge)
        runCatching {
            wm.addView(pill, params)
            typingHintView = pill
            typingHintLabel = label
            typingHintBounds = Rect(bounds)
            Log.d(TAG, "typingHintShown pkg=$pkg summary=${state.summaryText}")
        }.onFailure { err ->
            Log.e(TAG, "typingHintAddFailed err=${err.message}")
            typingHintView = null
            typingHintLabel = null
        }
    }

    private fun hintLayoutParams(bounds: Rect, height: Int, edge: Int): WindowManager.LayoutParams =
        WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            height,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            // NOT_TOUCHABLE is the whole point: the banner must never intercept typing.
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            x = edge
            y = bounds.top
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                fitInsetsTypes = 0
            }
        }

    private fun removeTypingHint() {
        val current = typingHintView ?: return
        typingHintView = null
        typingHintLabel = null
        typingHintBounds = null
        runCatching { windowManager?.removeView(current) }
            .onFailure { err -> Log.e(TAG, "typingHintRemoveFailed err=${err.message}") }
    }

    private fun verifyShieldPlacement(
        view: View,
        target: Rect,
        pkg: String,
        event: String,
        params: WindowManager.LayoutParams,
        extra: String = "",
        attemptsLeft: Int = 3,
        corrected: Boolean = false,
    ) {
        view.post {
            // A freshly added window reports (0,0) until it is attached and laid out; measuring
            // then would log a phantom drift, so wait for attachment before reporting.
            if (!view.isAttachedToWindow && attemptsLeft > 0) {
                verifyShieldPlacement(view, target, pkg, event, params, extra, attemptsLeft - 1, corrected)
                return@post
            }
            val loc = IntArray(2)
            view.getLocationOnScreen(loc)
            val actual = Rect(loc[0], loc[1], loc[0] + view.width, loc[1] + view.height)
            val dx = actual.centerX() - target.centerX()
            val dy = actual.centerY() - target.centerY()
            Log.d(
                TAG,
                "$event pkg=$pkg target=[${target.left},${target.top},${target.right},${target.bottom}] actual=[${actual.left},${actual.top},${actual.right},${actual.bottom}] drift=($dx,$dy)px $extra".trim(),
            )
            // Split-screen, foldables and inset changes can leave the guard off the Send button
            // while the log still says "placed". Correct it once, never in a loop.
            if (!corrected && (abs(dx) > SHIELD_DRIFT_TOLERANCE_PX || abs(dy) > SHIELD_DRIFT_TOLERANCE_PX)) {
                params.x = target.left
                params.y = target.top
                runCatching { windowManager?.updateViewLayout(view, params) }
                    .onSuccess {
                        Log.d(
                            TAG,
                            "shieldDriftCorrected pkg=$pkg before=[${actual.left},${actual.top}] after=[${target.left},${target.top}] drift=($dx,$dy)px",
                        )
                        verifyShieldPlacement(view, target, pkg, event, params, extra, attemptsLeft = 1, corrected = true)
                    }
                    .onFailure { err ->
                        Log.e(TAG, "shieldDriftCorrectFailed pkg=$pkg err=${err.message}")
                    }
            }
        }
    }

    private fun onShieldTapped(pkg: String) {
        // Re-read the composer at tap time so we judge the text that is about to be sent.
        val fresh = readFreshComposerText(pkg)
        val result = stateMachine.onShieldTapped(
            pkg = pkg,
            appName = ShieldStore.appDisplayNameForPackage(pkg),
            fresh = fresh,
            protectionLevel = ShieldStore.getProtectionLevel(this),
        )
        Log.d(TAG, "shieldTapped pkg=$pkg outcome=${result.outcome} freshLen=${fresh?.length ?: -1}")
        when (result.outcome) {
            ShieldTapOutcome.SHOW_PROMPT -> {
                // The shield deliberately stays in place so a second tap can never leak the secret.
                val prompt = result.prompt
                if (prompt != null) {
                    showSendPromptOverlay(prompt)
                } else {
                    Log.w(TAG, "shieldTapped held reason=missingPrompt pkg=$pkg")
                }
            }
            ShieldTapOutcome.HOLD -> {
                // Unreadable composer: we cannot prove it is clean, so the tap must not reach
                // Send and the existing guard stays armed.
                Log.w(TAG, "shieldTapped held reason=unreadableComposer pkg=$pkg")
            }
            ShieldTapOutcome.SEND -> {
                // Nothing risky is left in the field: let the user's tap through to the real button.
                removeTouchShieldInternal()
                val target = armedSendNode
                mainHandler.postDelayed({ performSend(target, pkg) }, 40L)
            }
        }
    }

    private fun showSendPromptOverlay(promptState: PendingSendPromptState, escaped: Boolean = false) {
        dismissPromptOverlayInternal()
        // The full-screen blocker replaces the typing suggestion; it is re-added on the next
        // sync if the user goes back to editing.
        removeTypingHint()
        promptIsEscaped = escaped
        val wm = windowManager ?: return

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(18), dp(20), dp(16))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#11141B"))
                setStroke(dp(2), Color.parseColor("#F59E0B"))
                cornerRadius = dp(18).toFloat()
            }
            elevation = dp(12).toFloat()
        }

        // Brand row: the logo makes the interruption legible at a glance, the way a system
        // blocker does, instead of a anonymous floating card.
        val brandRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val logo = ImageView(this).apply {
            setImageResource(R.drawable.ic_brand_logo)
            contentDescription = null
        }
        brandRow.addView(logo, LinearLayout.LayoutParams(dp(26), dp(26)))
        brandRow.addView(
            TextView(this).apply {
                text = "CORDON"
                setTextColor(Color.parseColor("#94A3B8"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
                letterSpacing = 0.12f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            },
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { marginStart = dp(8) },
        )
        container.addView(brandRow)

        val title = TextView(this).apply {
            text = if (escaped) {
                BlockerCopy.escapedHeadline(promptState.summaryText)
            } else {
                BlockerCopy.headline(promptState.summaryText)
            }
            setTextColor(Color.parseColor("#FBBF24"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(0, dp(10), 0, 0)
        }

        val subtitle = TextView(this).apply {
            text = if (escaped) {
                BlockerCopy.escapedSubtitle(promptState.appName)
            } else {
                BlockerCopy.subtitle(promptState.appName)
            }
            setTextColor(Color.parseColor("#E2E8F0"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setPadding(0, dp(4), 0, dp(10))
        }

        val preview = TextView(this).apply {
            text = promptState.sanitizedText.take(140)
            setTextColor(Color.parseColor("#00E5A3"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            setTypeface(android.graphics.Typeface.MONOSPACE)
            setBackgroundColor(Color.parseColor("#0B0E13"))
            setPadding(dp(10), dp(8), dp(10), dp(8))
            maxLines = 4
            ellipsize = android.text.TextUtils.TruncateAt.END
        }

        val actionsRow = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, dp(6), 0, 0)
        }

        val rejectBtn = Button(this).apply {
            text = BlockerCopy.SECONDARY
            setTextColor(Color.parseColor("#E2E8F0"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#1B202A"))
                setStroke(dp(1), Color.parseColor("#475569"))
                cornerRadius = dp(12).toFloat()
            }
            stateListAnimator = null
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(46),
            ).apply { topMargin = dp(8) }
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
                    // ALWAYS re-query fresh nodes after the dialog: pre-dialog references are stale.
                    val root = guardedRoot(rejected.packageName)
                    val sendTarget = root?.let { locateSendTarget(it, findActiveEditableNode(it))?.node }
                    val sendClickOk = sendTarget?.performAction(AccessibilityNodeInfo.ACTION_CLICK) ?: false
                    Log.d(TAG, "promptAction action=reject setTextOk=n/a sendClickOk=$sendClickOk pkg=${rejected.packageName}")
                    if (!sendClickOk) {
                        // Programmatic click unsupported: the shield is gone, so the user's next
                        // normal tap passes cleanly to the real Send button.
                        Log.w(TAG, "sendClickFailed pkg=${rejected.packageName} raw text left in composer for manual tap")
                    }
                }
                armedSendNode = null
            }
        }

        val acceptBtn = Button(this).apply {
            text = BlockerCopy.PRIMARY
            setTextColor(Color.parseColor("#07090D"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#00E5A3"))
                cornerRadius = dp(12).toFloat()
            }
            stateListAnimator = null
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(50),
            )
            setOnClickListener {
                val accepted = stateMachine.acceptScrub()
                if (accepted == null) {
                    dismissPromptOverlayInternal()
                    removeTouchShieldInternal()
                    heldInputNode = null
                    armedSendNode = null
                    return@setOnClickListener
                }
                // ALWAYS re-query fresh nodes after the dialog: pre-dialog references are stale.
                val root = guardedRoot(accepted.packageName)
                val targetNode = findActiveEditableNode(root)
                val sendTarget = root?.let { locateSendTarget(it, targetNode)?.node }
                val scrubArgs = Bundle().apply {
                    putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, accepted.sanitizedText)
                }
                val setTextOk = targetNode?.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, scrubArgs) ?: false
                if (!setTextOk) {
                    // WebView/Compose often reject ACTION_SET_TEXT. The composer still holds the
                    // raw secret, so fail closed: keep the shield up and re-open the prompt
                    // instead of leaving an unguarded field behind.
                    Log.e(TAG, "setTextFailed pkg=${accepted.packageName} action=failClosed")
                    restorePromptAfterFailedScrub(accepted)
                    return@setOnClickListener
                }

                // The scrub landed: only now may the guard come down.
                dismissPromptOverlayInternal()
                removeTouchShieldInternal()
                ShieldStore.recordBlockEvent(
                    context = this@CordonAccessibilityService,
                    appName = accepted.appName,
                    spans = accepted.spans,
                    engineUsed = "Deterministic Rules",
                )
                // Single programmatic click (never twice); if unsupported, the scrubbed text
                // stays cleanly in the box so one normal tap sends it.
                val sendClickOk = sendTarget?.performAction(AccessibilityNodeInfo.ACTION_CLICK) ?: false
                Log.d(TAG, "promptAction action=scrub setTextOk=$setTextOk sendClickOk=$sendClickOk pkg=${accepted.packageName}")
                if (!sendClickOk) {
                    Log.w(TAG, "sendClickFailed pkg=${accepted.packageName} scrubbed text left in composer for manual tap")
                }
                heldInputNode = null
                armedSendNode = null
            }
        }

        val keepEditing = TextView(this).apply {
            text = BlockerCopy.CANCEL
            setTextColor(Color.parseColor("#94A3B8"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            gravity = Gravity.CENTER
            setPadding(0, dp(14), 0, 0)
            isClickable = true
            setOnClickListener {
                Log.d(TAG, "promptDismissed reason=keepEditing pkg=${promptState.packageName}")
                stateMachine.dismissPrompt()
                dismissPromptOverlayInternal()
                syncTouchShieldWithActiveWindow(promptState.packageName)
            }
        }

        actionsRow.addView(acceptBtn)
        actionsRow.addView(rejectBtn)
        container.addView(title)
        container.addView(subtitle)
        if (!escaped) container.addView(preview)
        if (escaped) {
            // Nothing to send and nothing to scrub: the message is already out. The only
            // honest action is to acknowledge it.
            val gotIt = Button(this).apply {
                text = BlockerCopy.ESCAPED_DISMISS
                setTextColor(Color.parseColor("#07090D"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                background = GradientDrawable().apply {
                    setColor(Color.parseColor("#00E5A3"))
                    cornerRadius = dp(12).toFloat()
                }
                stateListAnimator = null
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    dp(50),
                )
                setOnClickListener {
                    Log.d(TAG, "promptDismissed reason=escapedAcknowledged pkg=${promptState.packageName}")
                    promptIsEscaped = false
                    dismissPromptOverlayInternal()
                    removeTouchShieldInternal()
                }
            }
            actionsRow.removeAllViews()
            actionsRow.addView(gotIt)
        }
        container.addView(actionsRow)
        if (!escaped) container.addView(keepEditing)

        // Full-screen scrim: a stern interruption, not a card the user can tap past. The
        // composer underneath stays shielded until an explicit choice is made.
        val scrim = FrameLayout(this).apply {
            setBackgroundColor(Color.argb(165, 0, 0, 0))
            isClickable = true
            addView(
                container,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    Gravity.CENTER,
                ).apply {
                    marginStart = dp(18)
                    marginEnd = dp(18)
                },
            )
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                fitInsetsTypes = 0
            }
        }

        runCatching {
            wm.addView(scrim, params)
            promptOverlayView = scrim
            Log.d(TAG, "promptShown pkg=${promptState.packageName} summary=${promptState.summaryText} escaped=$escaped")
            if (!escaped) {
                scrim.post {
                    val acceptLoc = IntArray(2)
                    val rejectLoc = IntArray(2)
                    acceptBtn.getLocationOnScreen(acceptLoc)
                    rejectBtn.getLocationOnScreen(rejectLoc)
                    Log.d(
                        TAG,
                        "promptButtons accept=[${acceptLoc[0]},${acceptLoc[1]},${acceptLoc[0] + acceptBtn.width},${acceptLoc[1] + acceptBtn.height}] reject=[${rejectLoc[0]},${rejectLoc[1]},${rejectLoc[0] + rejectBtn.width},${rejectLoc[1] + rejectBtn.height}]",
                    )
                }
            }
        }.onFailure { err ->
            // Never leave the state machine believing a prompt is up when it is not.
            Log.e(TAG, "promptAddViewFailed err=${err.message}")
            promptIsEscaped = false
            stateMachine.dismissPrompt()
        }
    }

    /**
     * Rebuild the guard after ACTION_SET_TEXT was rejected: the composer still holds the raw
     * secret, so tracking, the prompt and the shield must all come back up.
     */
    private fun restorePromptAfterFailedScrub(accepted: PendingSendPromptState) {
        stateMachine.onFieldTextObserved(
            pkg = accepted.packageName,
            appName = accepted.appName,
            rawText = accepted.rawText,
            protectionLevel = ShieldStore.getProtectionLevel(this),
        )
        val rebuilt = stateMachine.onSendClicked(accepted.packageName) ?: accepted
        showSendPromptOverlay(rebuilt)
        // The shield is normally still attached (we never removed it), but re-sync if a
        // background refresh dropped it while the prompt was open.
        if (touchShieldView == null) {
            syncTouchShieldWithActiveWindow(accepted.packageName)
        }
    }

    private fun clearAllStateAndOverlays() {
        stateMachine.reset()
        heldInputNode = null
        armedSendNode = null
        activePackage = null
        lastLoggedArmed = false
        consecutiveBlankObservations = 0
        cancelShieldRemoval()
        cancelArmRetry()
        if (touchShieldView != null) Log.d(TAG, "shieldRemoved reason=clearAll")
        removeTouchShieldInternal()
        dismissPromptOverlayInternal()
    }

    /** Debounced removal: one transient blank / unreadable observation must not open a gap. */
    private fun scheduleShieldRemoval(reason: String) {
        if (touchShieldView == null || shieldRemovalPending) return
        shieldRemovalPending = true
        pendingRemovalReason = reason
        mainHandler.postDelayed(delayedShieldRemoval, SHIELD_REMOVE_GRACE_MS)
    }

    private fun cancelShieldRemoval() {
        if (!shieldRemovalPending) return
        shieldRemovalPending = false
        mainHandler.removeCallbacks(delayedShieldRemoval)
    }

    private fun removeTouchShieldInternal() {
        cancelShieldRemoval()
        removeTypingHint()
        val current = touchShieldView ?: return
        touchShieldView = null
        touchShieldBounds = null
        runCatching { windowManager?.removeView(current) }
            .onFailure { err -> Log.e(TAG, "shieldRemoveViewFailed err=${err.message}") }
    }

    private fun dismissPromptOverlayInternal() {
        promptIsEscaped = false
        val current = promptOverlayView ?: return
        promptOverlayView = null
        runCatching { windowManager?.removeView(current) }
            .onFailure { err -> Log.e(TAG, "promptRemoveViewFailed err=${err.message}") }
    }

    override fun onInterrupt() {
        clearAllStateAndOverlays()
    }

    override fun onDestroy() {
        clearAllStateAndOverlays()
        super.onDestroy()
    }
}
