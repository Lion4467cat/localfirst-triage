package com.localfirst.triage.accessibility

/**
 * Pure policy for hardware keys. Kept out of the service so it can be unit tested without an
 * AccessibilityService instance.
 *
 * The modal is a touch surface, so a physical keyboard (or TV remote) could otherwise submit the
 * field underneath it. Soft keyboards are out of scope: the platform does not guarantee that a
 * soft key produces a KeyEvent, which is why the modal is raised on the text change itself,
 * before any send can happen.
 */
object EnterKeyPolicy {
    private const val KEY_ENTER = 66
    private const val KEY_NUMPAD_ENTER = 160
    private const val ACTION_DOWN = 0
    private const val ACTION_UP = 1

    fun shouldConsume(keyCode: Int, action: Int, riskyDraftPresent: Boolean): Boolean {
        if (!riskyDraftPresent) return false
        if (keyCode != KEY_ENTER && keyCode != KEY_NUMPAD_ENTER) return false
        return action == ACTION_DOWN || action == ACTION_UP
    }
}
