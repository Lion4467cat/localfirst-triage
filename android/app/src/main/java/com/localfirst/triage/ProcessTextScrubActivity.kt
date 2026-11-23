package com.localfirst.triage

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import com.localfirst.triage.data.Pluralize
import com.localfirst.triage.data.ShieldStore
import com.localfirst.triage.firewall.LocalFirewallEngine
import com.localfirst.triage.model.ProtectionLevel
import com.localfirst.triage.model.RedactionSpan

data class ProcessTextScrubOutcome(
    val sanitizedText: String,
    val blockedCount: Int,
    val spans: List<RedactionSpan> = emptyList(),
)

object ProcessTextScrubLogic {
    fun scrub(
        rawText: String,
        protectionLevel: ProtectionLevel = ProtectionLevel.MEDIUM,
    ): ProcessTextScrubOutcome {
        val (sanitizedText, spans) = LocalFirewallEngine.scrub(
            rawText = rawText,
            protectionLevel = protectionLevel,
        )
        return ProcessTextScrubOutcome(
            sanitizedText = sanitizedText,
            blockedCount = spans.count { it.masked },
            spans = spans,
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

        val level = ShieldStore.getProtectionLevel(this)

        val outcome = ProcessTextScrubLogic.scrub(rawText, level)
        if (outcome.blockedCount > 0) {
            ShieldStore.recordBlockEvent(
                context = this,
                appName = "Text Selection",
                spans = outcome.spans,
                engineUsed = ShieldStore.ENGINE_ON_DEVICE,
            )
        }

        val blocked = Pluralize.of(outcome.blockedCount, "secret")
        if (!readonly) {
            val resultIntent = Intent().putExtra(Intent.EXTRA_PROCESS_TEXT, outcome.sanitizedText)
            setResult(RESULT_OK, resultIntent)
            val msg = if (outcome.blockedCount > 0) {
                "Cordon [${level.name}] blocked $blocked · 0 leaked"
            } else {
                "Cordon: No secrets detected"
            }
            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
        } else {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            clipboard?.setPrimaryClip(
                ClipData.newPlainText("Cordon Safe Text", outcome.sanitizedText),
            )
            setResult(RESULT_CANCELED)
            val msg = if (outcome.blockedCount > 0) {
                "Blocked $blocked · Safe text copied"
            } else {
                "Cordon: No secrets detected"
            }
            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
        }

        finish()
    }
}
