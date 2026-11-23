package com.localfirst.triage.accessibility

import android.accessibilityservice.AccessibilityService
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
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
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Button
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.localfirst.triage.R
import com.localfirst.triage.data.ShieldStore
import com.localfirst.triage.firewall.LocalFirewallEngine
import com.localfirst.triage.model.RedactionSpan

/**
 * Cordon's background shield.
 *
 * Instead of hunting for a Send button (whose label, shape and position differ on every app and
 * every OEM skin), this service watches the editable field itself. When a guarded app's composer
 * holds a secret or PII, a full-screen, branded decision modal appears *before* the message can
 * leave: the scrim consumes every touch, and hardware Enter/Search keys are swallowed while it
 * is up.
 *
 * Zero-PII: raw text lives only in local variables and the modal's click closures. Nothing here
 * writes text to [ShieldStore], SharedPreferences or Logcat - only category counts and a
 * `(package, text)` hash held in memory for the anti-loop override.
 */
class CordonAccessibilityService : AccessibilityService() {

    private companion object {
        const val TAG = "CordonA11y"
        const val MAX_EDITABLE_SCAN_NODES = 400
        const val SELF_EDIT_EXPIRY_MS = 800L
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var windowManager: WindowManager? = null

    private var modalView: View? = null
    private var modalPackage: String? = null

    private val overrideMemory = OverrideMemory()
    private val selfEdits = SelfEditTracker()

    private var activePackage: String? = null
    private var riskyPackage: String? = null
    private val lastTextByPackage = HashMap<String, String>()

    private var pendingRescan: Runnable? = null
    private var pendingRescanPackage: String? = null
    private var pendingRescanSpans: List<RedactionSpan> = emptyList()

    override fun onServiceConnected() {
        super.onServiceConnected()
        windowManager = getSystemService(Context.WINDOW_SERVICE) as? WindowManager
        Log.d(TAG, "serviceConnected=true")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val ev = event ?: return
        val pkg = ev.packageName?.toString() ?: return

        if (ev.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            handleWindowStateChanged(pkg)
        }

        if (GuardExclusions.isExcludedPackage(pkg)) return

        if (ShieldStore.isShieldPaused(this)) {
            dismissModal("paused")
            return
        }
        if (!ShieldStore.isPackageGuarded(this, pkg)) {
            if (modalPackage != null && modalPackage != pkg) dismissModal("leftGuardedApp")
            return
        }

        when (ev.eventType) {
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED,
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED,
            -> evaluateField(ev, pkg)

            else -> Unit
        }
    }

    /**
     * Leaving the app (or going home) releases the modal immediately, so a soft-lock can never
     * trap the user in an app they are no longer looking at.
     */
    private fun handleWindowStateChanged(pkg: String) {
        val shownFor = modalPackage
        if (shownFor != null && shownFor != pkg) {
            dismissModal("appSwitch")
            overrideMemory.clear()
        }
        if (pkg != activePackage) {
            cancelPendingRescan()
            activePackage = pkg
        }
    }

    private fun evaluateField(event: AccessibilityEvent, pkg: String) {
        if (modalView != null) return

        val source = event.source
        if (source != null && isPasswordNode(source)) return

        val root = rootInActiveWindow
        val editable = when {
            source != null && source.isEditable && !isPasswordNode(source) -> source
            else -> findEditable(root)
        }
        if (editable != null && isPasswordNode(editable)) return

        val text = readFieldText(event, editable) ?: return

        if (selfEdits.consume(text)) {
            // Our own ACTION_SET_TEXT echo: the field now holds the scrubbed version.
            lastTextByPackage[pkg] = text
            return
        }

        if (text.isBlank()) {
            lastTextByPackage[pkg] = ""
            cancelPendingRescan()
            overrideMemory.onTextChanged(pkg, text)
            if (riskyPackage == pkg) riskyPackage = null
            return
        }

        val previous = lastTextByPackage[pkg].orEmpty()
        if (text == previous) return
        lastTextByPackage[pkg] = text

        overrideMemory.onTextChanged(pkg, text)
        if (overrideMemory.isOverridden(pkg, text)) return

        val (sanitized, spans) = LocalFirewallEngine.scrub(
            rawText = text,
            protectionLevel = ShieldStore.getProtectionLevel(this),
        )
        val findings = spans.filter { it.masked }
        if (findings.isEmpty()) {
            cancelPendingRescan()
            if (riskyPackage == pkg) riskyPackage = null
            return
        }
        riskyPackage = pkg

        val burst = GuardTriggerPolicy.isPasteBurst(previous.length, text.length)
        when (GuardTriggerPolicy.trigger(burst, findings.size)) {
            GuardTriggerPolicy.Trigger.LOCK_NOW -> {
                cancelPendingRescan()
                showBlockModal(pkg, text, sanitized, findings)
            }

            GuardTriggerPolicy.Trigger.DEBOUNCE -> scheduleRescan(pkg, findings)

            GuardTriggerPolicy.Trigger.IGNORE -> Unit
        }
    }

    /** Node text first (authoritative), then the event payload. Null when unreadable. */
    private fun readFieldText(event: AccessibilityEvent, editable: AccessibilityNodeInfo?): String? {
        editable?.text?.toString()?.let { return it }
        val fromEvent = event.text?.joinToString("")
        if (!fromEvent.isNullOrEmpty()) return fromEvent
        return null
    }

    /**
     * Manual typing: wait for the user to stop, then re-read the live field and only lock if the
     * secret that triggered the scan is still there.
     */
    private fun scheduleRescan(pkg: String, detected: List<RedactionSpan>) {
        cancelPendingRescan()
        pendingRescanPackage = pkg
        pendingRescanSpans = detected
        val runnable = Runnable {
            pendingRescan = null
            val targetPkg = pendingRescanPackage ?: return@Runnable
            val spans = pendingRescanSpans
            pendingRescanPackage = null
            pendingRescanSpans = emptyList()

            if (modalView != null) return@Runnable
            if (ShieldStore.isShieldPaused(this)) return@Runnable
            if (!ShieldStore.isPackageGuarded(this, targetPkg)) return@Runnable

            val root = rootInActiveWindow ?: return@Runnable
            val editable = findEditable(root) ?: return@Runnable
            if (isPasswordNode(editable)) return@Runnable
            val current = editable.text?.toString().orEmpty()
            if (current.isBlank()) return@Runnable
            if (overrideMemory.isOverridden(targetPkg, current)) return@Runnable
            if (!GuardTriggerPolicy.stillHoldsSecret(current, spans)) {
                Log.d(TAG, "debounceSkipped pkg=$targetPkg reason=secretGone")
                return@Runnable
            }

            val (sanitized, fresh) = LocalFirewallEngine.scrub(
                rawText = current,
                protectionLevel = ShieldStore.getProtectionLevel(this),
            )
            val findings = fresh.filter { it.masked }
            if (findings.isEmpty()) return@Runnable
            Log.d(TAG, "debounceElapsed pkg=$targetPkg findings=${findings.size}")
            showBlockModal(targetPkg, current, sanitized, findings)
        }
        pendingRescan = runnable
        mainHandler.postDelayed(runnable, GuardTriggerPolicy.TYPING_DEBOUNCE_MS)
    }

    private fun cancelPendingRescan() {
        pendingRescan?.let { mainHandler.removeCallbacks(it) }
        pendingRescan = null
        pendingRescanPackage = null
        pendingRescanSpans = emptyList()
    }

    private fun showBlockModal(
        pkg: String,
        rawText: String,
        sanitizedText: String,
        spans: List<RedactionSpan>,
    ) {
        if (modalView != null) return
        val wm = windowManager
        if (wm == null) {
            Log.e(TAG, "modalAddViewFailed pkg=$pkg err=noWindowManager")
            return
        }
        val appName = ShieldStore.appDisplayNameForPackage(this, pkg)
        val scrim = buildModalView(
            appName = appName,
            spans = spans,
            onScrub = { onScrubChosen(pkg, sanitizedText, spans) },
            onAllowOnce = { onAllowOnceChosen(pkg, rawText, spans) },
        )
        runCatching {
            wm.addView(scrim, modalLayoutParams())
            modalView = scrim
            modalPackage = pkg
            // Zero-PII diagnostic: counts and categories only.
            Log.d(TAG, "modalShown pkg=$pkg findings=${spans.size} chips=${FindingChips.summary(spans)}")
        }.onFailure { err ->
            Log.e(TAG, "modalAddViewFailed pkg=$pkg err=${err.message}")
            modalView = null
            modalPackage = null
        }
    }

    private fun modalLayoutParams(): WindowManager.LayoutParams =
        WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            // Touchable on purpose: the scrim must consume every touch, so the app underneath
            // cannot be tapped while the decision is pending.
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
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

    private fun dismissModal(reason: String) {
        val current = modalView ?: return
        val pkg = modalPackage
        modalView = null
        modalPackage = null
        runCatching { windowManager?.removeView(current) }
            .onFailure { err -> Log.e(TAG, "modalRemoveViewFailed pkg=$pkg err=${err.message}") }
        Log.d(TAG, "modalDismissed reason=$reason pkg=$pkg")
    }

    private fun onScrubChosen(pkg: String, sanitizedText: String, spans: List<RedactionSpan>) {
        dismissModal("scrub")
        val root = rootInActiveWindow
        val editable = findEditable(root)
        if (editable == null) {
            Log.e(TAG, "setTextFailed pkg=$pkg err=noEditable action=clipboardFallback")
            copyScrubbedToClipboard(sanitizedText)
            return
        }

        selfEdits.mark(sanitizedText)
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, sanitizedText)
        }
        val setTextOk = runCatching {
            editable.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        }.getOrDefault(false)

        if (!setTextOk) {
            selfEdits.clear()
            Log.e(TAG, "setTextFailed pkg=$pkg action=clipboardFallback")
            copyScrubbedToClipboard(sanitizedText)
            return
        }

        mainHandler.postDelayed({ selfEdits.clear() }, SELF_EDIT_EXPIRY_MS)
        lastTextByPackage[pkg] = sanitizedText
        riskyPackage = null
        ShieldStore.recordBlockEvent(
            context = this,
            appName = ShieldStore.appDisplayNameForPackage(this, pkg),
            spans = spans,
            engineUsed = ModalCopy.ENGINE_LABEL,
        )
        Log.d(TAG, "modalAction action=scrubbed pkg=$pkg findings=${spans.size} setTextOk=true")
    }

    private fun onAllowOnceChosen(pkg: String, rawText: String, spans: List<RedactionSpan>) {
        // Remember BEFORE dismissing: the dismissal itself can trigger the content-changed
        // event that would otherwise re-lock the very same message.
        overrideMemory.remember(pkg, rawText)
        lastTextByPackage[pkg] = rawText
        ShieldStore.recordOverrideEvent(
            context = this,
            appName = ShieldStore.appDisplayNameForPackage(this, pkg),
            spans = spans,
            engineUsed = ModalCopy.ENGINE_LABEL,
        )
        dismissModal("allowOnce")
        Log.d(TAG, "modalAction action=override pkg=$pkg findings=${spans.size}")
    }

    private fun copyScrubbedToClipboard(sanitizedText: String) {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        runCatching {
            clipboard?.setPrimaryClip(ClipData.newPlainText("Cordon scrubbed text", sanitizedText))
        }.onFailure { err -> Log.e(TAG, "clipboardCopyFailed err=${err.message}") }
        Toast.makeText(this, ModalCopy.CLIPBOARD_TOAST, Toast.LENGTH_LONG).show()
        Log.d(TAG, "modalAction action=clipboardFallback")
    }

    private fun buildModalView(
        appName: String,
        spans: List<RedactionSpan>,
        onScrub: () -> Unit,
        onAllowOnce: () -> Unit,
    ): View {
        val scrim = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#D9090D12"))
            isClickable = true
            // Consume anything that misses the card: nothing behind this window is reachable.
            setOnTouchListener { _, _ -> true }
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
        }
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(20), dp(28), dp(20), dp(28))
        }
        column.addView(
            buildCard(appName, spans, onScrub, onAllowOnce),
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ),
        )
        scroll.addView(
            column,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
            ),
        )
        scrim.addView(
            scroll,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        return scrim
    }

    private fun buildCard(
        appName: String,
        spans: List<RedactionSpan>,
        onScrub: () -> Unit,
        onAllowOnce: () -> Unit,
    ): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(18))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#11141B"))
                setStroke(dp(1), Color.parseColor("#2A3342"))
                cornerRadius = dp(24).toFloat()
            }
            elevation = dp(18).toFloat()
        }

        // Brand row: logo + product name.
        val brand = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        brand.addView(
            ImageView(this).apply {
                setImageResource(R.drawable.ic_brand_logo)
                contentDescription = null
            },
            LinearLayout.LayoutParams(dp(26), dp(26)),
        )
        brand.addView(
            text(ModalCopy.HEADER, 15f, "#F8FAFC", bold = true),
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { marginStart = dp(10) },
        )
        card.addView(brand)

        // Status pill.
        card.addView(
            pill(ModalCopy.STATUS_PILL, bg = "#2A0F14", stroke = "#FF4D5A", fg = "#FF7A85"),
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(14) },
        )

        // Subtext.
        card.addView(
            text(ModalCopy.subtext(appName), 13.5f, "#CBD5E1").apply { setLineSpacing(0f, 1.15f) },
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(12) },
        )

        // Zero-PII category chips (counts only, never the matched value).
        val chipRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        FindingChips.chips(spans).forEach { label ->
            chipRow.addView(
                chip(label),
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                ).apply { marginEnd = dp(6) },
            )
        }
        card.addView(
            HorizontalScrollView(this).apply {
                isHorizontalScrollBarEnabled = false
                addView(chipRow)
            },
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(14) },
        )

        card.addView(
            View(this).apply { setBackgroundColor(Color.parseColor("#1E2634")) },
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1)).apply {
                topMargin = dp(16)
            },
        )

        card.addView(
            actionButton(
                label = ModalCopy.PRIMARY,
                bg = "#00E5A3",
                fg = "#06110D",
                stroke = null,
                onClick = onScrub,
            ),
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(50),
            ).apply { topMargin = dp(16) },
        )

        card.addView(
            actionButton(
                label = ModalCopy.SECONDARY,
                bg = "#1B202A",
                fg = "#FF7A85",
                stroke = "#4A2A2F",
                onClick = onAllowOnce,
            ),
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(46),
            ).apply { topMargin = dp(10) },
        )

        card.addView(
            text(ModalCopy.FOOTER, 10.5f, "#64748B").apply { gravity = Gravity.CENTER },
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(14) },
        )
        return card
    }

    private fun actionButton(
        label: String,
        bg: String,
        fg: String,
        stroke: String?,
        onClick: () -> Unit,
    ): Button = Button(this).apply {
        text = label
        isAllCaps = false
        setTextColor(Color.parseColor(fg))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        setTypeface(typeface, Typeface.BOLD)
        stateListAnimator = null
        minHeight = 0
        minWidth = 0
        setPadding(dp(12), 0, dp(12), 0)
        background = GradientDrawable().apply {
            setColor(Color.parseColor(bg))
            if (stroke != null) setStroke(dp(1), Color.parseColor(stroke))
            cornerRadius = dp(14).toFloat()
        }
        setOnClickListener { onClick() }
    }

    private fun text(value: String, sizeSp: Float, color: String, bold: Boolean = false): TextView =
        TextView(this).apply {
            text = value
            setTextColor(Color.parseColor(color))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
            if (bold) setTypeface(typeface, Typeface.BOLD)
            includeFontPadding = false
        }

    private fun pill(value: String, bg: String, stroke: String, fg: String): TextView =
        TextView(this).apply {
            text = value
            setTextColor(Color.parseColor(fg))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 10.5f)
            setTypeface(typeface, Typeface.BOLD)
            letterSpacing = 0.04f
            setPadding(dp(10), dp(5), dp(10), dp(5))
            background = GradientDrawable().apply {
                setColor(Color.parseColor(bg))
                setStroke(dp(1), Color.parseColor(stroke))
                cornerRadius = dp(20).toFloat()
            }
        }

    private fun chip(value: String): TextView =
        TextView(this).apply {
            text = value
            setTextColor(Color.parseColor("#DCE3EC"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            setTypeface(typeface, Typeface.BOLD)
            setPadding(dp(9), dp(4), dp(9), dp(4))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#0C1016"))
                setStroke(dp(1), Color.parseColor("#2A3342"))
                cornerRadius = dp(8).toFloat()
            }
        }

    private fun dp(value: Int): Int = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP,
        value.toFloat(),
        resources.displayMetrics,
    ).toInt()

    private fun findEditable(root: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (root == null) return null
        val focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        if (focused != null && focused.isEditable && !isPasswordNode(focused)) return focused
        return bfsFindEditable(root)
    }

    private fun bfsFindEditable(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var visited = 0
        while (queue.isNotEmpty() && visited < MAX_EDITABLE_SCAN_NODES) {
            val current = queue.removeFirst()
            visited++
            if (current.isEditable && !isPasswordNode(current)) return current
            for (i in 0 until current.childCount) {
                current.getChild(i)?.let { queue.add(it) }
            }
        }
        return null
    }

    private fun isPasswordNode(node: AccessibilityNodeInfo): Boolean {
        if (node.isPassword) return true
        val variation = node.inputType and InputType.TYPE_MASK_VARIATION
        return variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
            variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
            variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
            variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
    }

    override fun onKeyEvent(event: KeyEvent): Boolean {
        val modalUp = modalView != null
        if (GuardTriggerPolicy.shouldSwallowKey(event.keyCode, modalUp)) {
            Log.d(TAG, "keySwallowed keyCode=${event.keyCode} modal=$modalUp")
            return true
        }
        val pkg = activePackage
        val risky = modalUp || (pkg != null && riskyPackage == pkg)
        if (EnterKeyPolicy.shouldConsume(event.keyCode, event.action, risky)) {
            Log.d(TAG, "enterConsumed pkg=$pkg modal=$modalUp")
            return true
        }
        return super.onKeyEvent(event)
    }

    override fun onInterrupt() {
        teardown()
    }

    override fun onDestroy() {
        teardown()
        super.onDestroy()
    }

    private fun teardown() {
        cancelPendingRescan()
        selfEdits.clear()
        overrideMemory.clear()
        dismissModal("teardown")
        activePackage = null
        riskyPackage = null
        lastTextByPackage.clear()
    }
}
