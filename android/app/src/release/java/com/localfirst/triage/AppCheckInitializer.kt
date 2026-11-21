package com.localfirst.triage

import android.content.Context
import com.google.firebase.Firebase
import com.google.firebase.appcheck.appCheck
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory

object AppCheckInitializer {
    fun install(@Suppress("UNUSED_PARAMETER") context: Context) {
        runCatching {
            Firebase.appCheck.installAppCheckProviderFactory(
                PlayIntegrityAppCheckProviderFactory.getInstance(),
            )
        }
    }

    const val PROVIDER_LABEL: String = "Play Integrity"
}
