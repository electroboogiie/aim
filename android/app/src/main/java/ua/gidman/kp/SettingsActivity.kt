package ua.gidman.kp

import android.os.Bundle
import android.view.View
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewCompat
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class SettingsActivity : AppCompatActivity() {

    private lateinit var urlField: EditText
    private lateinit var status: TextView
    private val executor = Executors.newSingleThreadExecutor()
    private var checkSeq = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_settings)
        val root = findViewById<View>(R.id.settings_root)
        SystemBars.applyPadding(root)
        WindowInsetsControllerCompat(window, root).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }

        urlField = findViewById(R.id.settings_url)
        status = findViewById(R.id.settings_status)
        if (savedInstanceState == null) urlField.setText(Prefs.serverUrl(this))

        findViewById<View>(R.id.settings_back).setOnClickListener { finish() }
        findViewById<View>(R.id.settings_save).setOnClickListener { save() }
        findViewById<View>(R.id.settings_check).setOnClickListener { check() }
        findViewById<View>(R.id.settings_clear).setOnClickListener { confirmClear() }
        urlField.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                save()
                true
            } else {
                false
            }
        }

        val webViewVersion = try {
            WebViewCompat.getCurrentWebViewPackage(this)?.versionName
        } catch (e: RuntimeException) {
            null
        } ?: getString(R.string.settings_webview_unknown)
        findViewById<TextView>(R.id.settings_about).text =
            getString(R.string.settings_about, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE, webViewVersion)
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    /** Normalized URL, or null after showing why the input is not acceptable. */
    private fun validated(): String? {
        val input = urlField.text.toString()
        val error = when (NetPolicy.check(input)) {
            NetPolicy.Check.OK -> null
            NetPolicy.Check.EMPTY -> R.string.url_error_empty
            NetPolicy.Check.INVALID -> R.string.url_error_invalid
            NetPolicy.Check.INSECURE -> R.string.url_error_insecure
        }
        if (error != null) {
            urlField.error = getString(error)
            status.text = getString(error)
            return null
        }
        return NetPolicy.normalizeServerUrl(input)
    }

    private fun save() {
        val url = validated() ?: return
        Prefs.setServerUrl(this, url)
        Toast.makeText(this, R.string.settings_saved, Toast.LENGTH_SHORT).show()
        finish()
    }

    private fun check() {
        val url = validated() ?: return
        urlField.setText(url)
        urlField.setSelection(url.length)
        val seq = ++checkSeq
        status.setText(R.string.settings_checking)
        executor.execute {
            val text = probe(url)
            runOnUiThread { if (seq == checkSeq && !isDestroyed) status.text = text }
        }
    }

    private fun probe(base: String): String {
        val conn = try {
            URL(URL(base), "api/health").openConnection() as HttpURLConnection
        } catch (e: IOException) {
            return getString(R.string.settings_fail, e.localizedMessage ?: e.javaClass.simpleName)
        }
        return try {
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            conn.setRequestProperty("Accept", "application/json")
            val code = conn.responseCode
            if (code != HttpURLConnection.HTTP_OK) return getString(R.string.settings_fail_http, code)
            val body = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            val json = try {
                JSONObject(body)
            } catch (e: JSONException) {
                return getString(R.string.settings_not_kp)
            }
            if (!json.optBoolean("ok", false)) return getString(R.string.settings_not_kp)
            val version = json.str("version")
            if (version == null) getString(R.string.settings_ok_no_version) else getString(R.string.settings_ok, version)
        } catch (e: IOException) {
            getString(R.string.settings_fail, e.localizedMessage ?: e.javaClass.simpleName)
        } finally {
            conn.disconnect()
        }
    }

    private fun confirmClear() {
        AlertDialog.Builder(this)
            .setTitle(R.string.settings_clear)
            .setMessage(R.string.settings_clear_confirm)
            .setNegativeButton(R.string.action_cancel, null)
            .setPositiveButton(R.string.action_continue) { _, _ ->
                WebStorage.getInstance().deleteAllData()
                CookieManager.getInstance().removeAllCookies(null)
                CookieManager.getInstance().flush()
                Prefs.requestClearWebData(this)
                Toast.makeText(this, R.string.settings_cleared, Toast.LENGTH_SHORT).show()
            }
            .show()
    }
}
