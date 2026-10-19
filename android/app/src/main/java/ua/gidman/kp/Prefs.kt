package ua.gidman.kp

import android.content.Context
import android.content.SharedPreferences

object Prefs {
    private const val FILE = "kp"
    private const val KEY_SERVER_URL = "server_url"
    private const val KEY_CLEAR_WEB_DATA = "clear_web_data"

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** Saved server URL, else the build-time default, else "" (ask the user). */
    fun serverUrl(context: Context): String {
        val saved = prefs(context).getString(KEY_SERVER_URL, null)
        if (!saved.isNullOrEmpty()) return saved
        val fallback = NetPolicy.normalizeServerUrl(BuildConfig.SERVER_URL) ?: return ""
        return if (NetPolicy.isAllowed(fallback)) fallback else ""
    }

    fun setServerUrl(context: Context, url: String) {
        prefs(context).edit().putString(KEY_SERVER_URL, url).apply()
    }

    fun requestClearWebData(context: Context) {
        prefs(context).edit().putBoolean(KEY_CLEAR_WEB_DATA, true).apply()
    }

    fun takeClearWebDataRequest(context: Context): Boolean {
        val p = prefs(context)
        if (!p.getBoolean(KEY_CLEAR_WEB_DATA, false)) return false
        p.edit().remove(KEY_CLEAR_WEB_DATA).apply()
        return true
    }
}
