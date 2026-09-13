package com.beardtrimmap.app

import android.content.Context
import android.speech.tts.TextToSpeech
import android.util.Log
import java.util.Locale

/**
 * SCAN-LOCK-V1B -- isolated native speech transport for scanner Voice Guidance.
 *
 * Wraps android.speech.tts.TextToSpeech with a small, truthful readiness contract: isAvailable()
 * only ever reports true once initialization has genuinely completed with TextToSpeech.SUCCESS
 * AND an English locale is actually available on this engine -- never merely because the
 * TextToSpeech object was constructed (initialization is asynchronous). On-device system engine
 * only: no network, no cloud TTS, no paid service, no automatic voice/language download.
 *
 * Isolated from NativeTrackingBridge/NativeTrackingCoordinator on purpose -- this class knows
 * nothing about scanning, tracking, or capture, and nothing in the scanner pipeline depends on
 * it. A speech failure here can never throw into or block that pipeline.
 */
class VoiceGuidanceTts(context: Context) {
    private var tts: TextToSpeech? = null
    @Volatile private var ready = false

    init {
        tts = TextToSpeech(context.applicationContext) { status ->
            ready = if (status == TextToSpeech.SUCCESS) {
                when (tts?.setLanguage(Locale.US)) {
                    TextToSpeech.LANG_AVAILABLE, TextToSpeech.LANG_COUNTRY_AVAILABLE, TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE -> true
                    else -> false
                }
            } else {
                false
            }
            Log.d("BeardTrimVoice", "TextToSpeech init status=$status ready=$ready")
        }
    }

    fun isAvailable(): Boolean = ready

    // QUEUE_FLUSH: scanner instructions are time-sensitive -- a stale utterance still speaking
    // when a new one becomes relevant is discarded, never queued behind. utteranceId is unique
    // per call only for engine bookkeeping; nothing in this class currently listens for
    // completion callbacks.
    fun speak(text: String) {
        val engine = tts ?: return
        if (!ready) return
        try {
            engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "mgVoice-" + System.nanoTime())
        } catch (e: Exception) {
            Log.w("BeardTrimVoice", "speak failed: ${e.javaClass.simpleName}")
        }
    }

    fun stop() {
        try {
            tts?.stop()
        } catch (e: Exception) {
            Log.w("BeardTrimVoice", "stop failed: ${e.javaClass.simpleName}")
        }
    }

    fun shutdown() {
        try {
            tts?.stop()
        } catch (_: Exception) {
        }
        try {
            tts?.shutdown()
        } catch (e: Exception) {
            Log.w("BeardTrimVoice", "shutdown failed: ${e.javaClass.simpleName}")
        }
        tts = null
        ready = false
    }
}
