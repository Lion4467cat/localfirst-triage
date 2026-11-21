package com.localfirst.triage

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import com.localfirst.triage.firewall.LocalFirewallEngine
import com.localfirst.triage.model.ProtectionLevel

data class ProcessTextScrubOutcome(
    val sanitizedText: String,
    val blockedCount: Int,
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

        val prefs = getSharedPreferences("localfirst_ui_prefs", Context.MODE_PRIVATE)
        val level = runCatching {
            ProtectionLevel.valueOf(
                prefs.getString("protection_level", ProtectionLevel.MEDIUM.name)
                    ?: ProtectionLevel.MEDIUM.name,
            )
        }.getOrDefault(ProtectionLevel.MEDIUM)

        val outcome = ProcessTextScrubLogic.scrub(rawText, level)

        if (!readonly) {
            val resultIntent = Intent().putExtra(Intent.EXTRA_PROCESS_TEXT, outcome.sanitizedText)
            setResult(RESULT_OK, resultIntent)
            val msg = if (outcome.blockedCount > 0) {
                "LocalFirst [${level.name}] blocked ${outcome.blockedCount} secret(s) · 0 leaked"
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
