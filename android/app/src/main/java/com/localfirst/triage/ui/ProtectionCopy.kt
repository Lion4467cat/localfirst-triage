package com.localfirst.triage.ui

import com.localfirst.triage.model.ProtectionLevel

/** One description per dial position, shared by the Shield strip and the Settings list. */
fun protectionLevelExplanation(level: ProtectionLevel): String = when (level) {
    ProtectionLevel.LOW -> "Unmistakable credentials only: API keys, private keys, card numbers."
    ProtectionLevel.MEDIUM -> "Credentials plus emails, phones and addresses. Recommended for daily use."
    ProtectionLevel.HIGH -> "Everything in Medium plus names, IPs and health context. Most cautious."
}
