package com.localfirst.triage.accessibility

/**
 * Pure policy for the send guard. Kept out of the service so every decision can be unit
 * tested without an AccessibilityService instance.
 */
object EnterKeyPolicy {
    private const val KEY_ENTER = 66
    private const val KEY_NUMPAD_ENTER = 160
    private const val ACTION_DOWN = 0
    private const val ACTION_UP = 1

    /**
     * True when a hardware Enter press must be swallowed.
     *
     * Soft keyboards are explicitly out of scope: the platform does not guarantee that any
     * soft-key press produces a KeyEvent, so those are caught by the post-send blocker
     * instead. This path exists for physical keyboards and TV remotes, where the key really
     * does arrive before the app sees it.
     */
    fun shouldConsume(keyCode: Int, action: Int, riskyDraftPresent: Boolean): Boolean {
        if (!riskyDraftPresent) return false
        if (keyCode != KEY_ENTER && keyCode != KEY_NUMPAD_ENTER) return false
        return action == ACTION_DOWN || action == ACTION_UP
    }
}

object BlockerCopy {
    fun headline(summary: String): String = "Cordon found $summary"

    fun subtitle(appName: String): String = "in $appName · nothing has been sent"

    /** Used when the send already left through a path Android gives apps no hook for. */
    fun escapedHeadline(summary: String): String = "Sent unredacted · $summary"

    fun escapedSubtitle(appName: String): String =
        "in $appName · Cordon could not stop this one — delete it in the app."

    const val PRIMARY = "Use Scrub & Send"
    const val SECONDARY = "Send Anyway"
    const val CANCEL = "Keep editing"
    const val ESCAPED_DISMISS = "Got it"
}

object TypingHintCopy {
    fun text(summary: String): String = "Cordon found $summary · Send will be scrubbed"
}

/**
 * The banner shown while the user is typing: it must never steal a touch from the composer
 * or the keyboard, so it is placed in the gap directly above the composer row.
 */
object TypingHintPlacement {
    fun topFor(composerTop: Int, hintHeight: Int, gapPx: Int, screenTopPx: Int): Int =
        (composerTop - gapPx - hintHeight).coerceAtLeast(screenTopPx)
}

/**
 * Post-send proof.
 *
 * A soft keyboard's Send arrow never produces a KeyEvent and sits in a window above any
 * accessibility overlay, so that path cannot be pre-empted. What can be done is to prove the
 * send happened: the composer clears *and* the secret reappears in the conversation tree.
 * Requiring both avoids accusing a user who simply deleted the draft.
 */
object EscapedSendDetector {
    private const val MIN_NEEDLE = 6
    private const val TRUNCATED_PREFIX = 12

    fun isPresent(secretTexts: List<String>, visibleTexts: List<String>): Boolean {
        val needles = secretTexts.map { it.trim() }.filter { it.length >= MIN_NEEDLE }
        if (needles.isEmpty()) return false
        val haystack = visibleTexts.filter { it.isNotBlank() }
        if (haystack.isEmpty()) return false
        return needles.any { needle ->
            val prefix = if (needle.length > TRUNCATED_PREFIX) needle.take(TRUNCATED_PREFIX) else null
            haystack.any { text ->
                text.contains(needle) || (prefix != null && text.contains(prefix))
            }
        }
    }
}

/**
 * The send control's corner of the composer row.
 *
 * Chat apps put Send at the trailing edge of the composer, but its shape is not dependable:
 * a labelled button in ChatGPT, an unlabelled arrow in Google, a paper plane in Telegram.
 * Matching the node tree misses the unlabelled ones, so the guard covers the corner region
 * the control always occupies instead.
 *
 * Three clamps keep that region from becoming hostile on real devices: it never leaves the
 * screen, it never grows past [maxHeightPx] (a full-page editor would otherwise be covered),
 * and it never crosses [bottomLimitPx] (the top of the keyboard, whose keys must stay tappable).
 */
object ComposerTrailingRegion {
    fun forComposer(
        composer: ShieldGeometry.ShieldRect,
        screen: ShieldGeometry.ShieldRect,
        widthFraction: Float,
        extraBottomPx: Int,
        edgeMarginPx: Int,
        maxHeightPx: Int = Int.MAX_VALUE,
        bottomLimitPx: Int = Int.MAX_VALUE,
    ): ShieldGeometry.ShieldRect? {
        if (composer.width <= 0 || composer.height <= 0) return null
        if (widthFraction <= 0f || widthFraction > 1f) return null

        val width = (composer.width * widthFraction).toInt().coerceAtLeast(1)
        val left = (composer.right - width).coerceAtLeast(screen.left)
        val right = (screen.right - edgeMarginPx).coerceAtMost(screen.right)
        val bottom = (composer.bottom + extraBottomPx)
            .coerceAtMost(screen.bottom)
            .coerceAtMost(bottomLimitPx)
        val top = (bottom - maxHeightPx).coerceAtLeast(composer.top).coerceAtLeast(screen.top)
        if (right <= left || bottom <= top) return null
        return ShieldGeometry.ShieldRect(left, top, right, bottom)
    }
}
