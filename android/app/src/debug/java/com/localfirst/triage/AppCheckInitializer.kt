package com.localfirst.triage

import android.content.Context
import com.google.firebase.Firebase
import com.google.firebase.appcheck.appCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory

object AppCheckInitializer {
    fun install(@Suppress("UNUSED_PARAMETER") context: Context) {
        runCatching {
            Firebase.appCheck.installAppCheckProviderFactory(
                DebugAppCheckProviderFactory.getInstance(),
            )
        }
    }

    const val PROVIDER_LABEL: String = "Debug App Check"
}
