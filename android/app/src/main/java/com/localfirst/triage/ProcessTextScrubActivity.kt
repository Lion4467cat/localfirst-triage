package com.localfirst.triage

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import com.localfirst.triage.firewall.LocalFirewallEngine

data class ProcessTextScrubOutcome(
    val sanitizedText: String,
    val blockedCount: Int,
)

object ProcessTextScrubLogic {
    fun scrub(rawText: String): ProcessTextScrubOutcome {
        val (sanitizedText, spans) = LocalFirewallEngine.scanAndRedactLocal(
            rawText = rawText,
            options = LocalFirewallEngine.ScanOptions(
                includeHeuristics = true,
                enableEntropyScanner = true,
            ),
        )
        return ProcessTextScrubOutcome(
            sanitizedText = sanitizedText,
            blockedCount = spans.size,
        )
    }
}

class ProcessTextScrubActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val rawText = intent?.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString().orEmpty()
        val readonly = intent?.getBooleanExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, false) ?: false

        if (rawText.isBlank()) {
            setResult(RESULT_CANCELED)
            finish()
            return
        }

        val outcome = ProcessTextScrubLogic.scrub(rawText)

        if (!readonly) {
            val resultIntent = Intent().putExtra(Intent.EXTRA_PROCESS_TEXT, outcome.sanitizedText)
            setResult(RESULT_OK, resultIntent)
            val msg = if (outcome.blockedCount > 0) {
                "LocalFirst blocked ${outcome.blockedCount} secret(s) on-device · 0 leaked"
            } else {
                "LocalFirst: No secrets detected"
            }
            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
        } else {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            clipboard?.setPrimaryClip(
                ClipData.newPlainText("LocalFirst Safe Text", outcome.sanitizedText),
            )
            setResult(RESULT_CANCELED)
            val msg = if (outcome.blockedCount > 0) {
                "Blocked ${outcome.blockedCount} secret(s) · Safe text copied"
            } else {
                "LocalFirst: No secrets detected"
            }
            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
        }

        finish()
    }
}
