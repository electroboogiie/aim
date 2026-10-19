package ua.gidman.kp

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.text.format.Formatter
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.StringRes
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.isVisible
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONException
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.net.MalformedURLException
import java.net.URISyntaxException
import java.net.URL

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var swipe: SwipeRefreshLayout
    private lateinit var progress: ProgressBar
    private lateinit var errorView: View
    private lateinit var errorTitle: TextView
    private lateinit var errorText: TextView
    private lateinit var downloader: Downloader

    private var serverUrl: String? = null
    private var serverOrigin: String? = null
    private var authorization: String? = null
    private var innerScrolled = false
    private var mainFrameFailed = false
    private var sslFailed = false
    private var failedUrl: String? = null
    private var clearHistoryOnLoad = false
    private var settingsPrompted = false
    private var listenerInstalled = false
    private var jsInterfaceInstalled = false
    private var webViewGone = false
    private var blobSeq = 0
    private var pendingSave: File? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback = null
    }

    private val createDocument = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val file = pendingSave
        pendingSave = null
        val target = result.data?.data
        if (result.resultCode == RESULT_OK && file != null && target != null) {
            downloader.copy(file, target) { ok -> toast(if (ok) R.string.dl_saved else R.string.dl_save_failed) }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)
        val root = findViewById<View>(R.id.root)
        SystemBars.applyPadding(root)
        WindowInsetsControllerCompat(window, root).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }

        webView = findViewById(R.id.web)
        swipe = findViewById(R.id.swipe)
        progress = findViewById(R.id.progress)
        errorView = findViewById(R.id.error_view)
        errorTitle = findViewById(R.id.error_title)
        errorText = findViewById(R.id.error_text)
        downloader = Downloader(this)
        downloader.cleanup()
        pendingSave = savedInstanceState?.getString(STATE_PENDING_SAVE)?.let { File(it) }

        setupWebView()
        swipe.setColorSchemeColors(ContextCompat.getColor(this, R.color.kp_orange))
        swipe.setProgressBackgroundColorSchemeColor(ContextCompat.getColor(this, R.color.kp_surface))
        swipe.setOnRefreshListener { reload() }
        swipe.setOnChildScrollUpCallback { _, _ -> innerScrolled || webView.canScrollVertically(-1) }

        findViewById<Button>(R.id.error_retry).setOnClickListener { reload() }
        findViewById<Button>(R.id.error_settings).setOnClickListener { openSettings() }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (!webViewGone && webView.canGoBack()) {
                    mainFrameFailed = false
                    sslFailed = false
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                    isEnabled = true
                }
            }
        })

        registerNetworkCallback()
        if (savedInstanceState == null) handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        if (webViewGone) return
        webView.onResume()
        val clear = Prefs.takeClearWebDataRequest(this)
        if (clear) {
            webView.clearCache(true)
            clearHistoryOnLoad = true
        }
        val url = Prefs.serverUrl(this)
        if (url.isEmpty()) {
            serverUrl = null
            serverOrigin = null
            showError(getString(R.string.error_no_server_title), getString(R.string.error_no_server_text))
            if (!settingsPrompted) openSettings()
            return
        }
        if (url != serverUrl) {
            serverUrl = url
            serverOrigin = NetPolicy.origin(url)
            authorization = null
            serverOrigin?.let { installBridge(it) }
            clearHistoryOnLoad = true
            load(url)
        } else if (clear) {
            load(url)
        }
    }

    override fun onPause() {
        if (!webViewGone) webView.onPause()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        pendingSave?.let { outState.putString(STATE_PENDING_SAVE, it.absolutePath) }
    }

    override fun onDestroy() {
        networkCallback?.let { callback ->
            try {
                getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(callback)
            } catch (e: IllegalArgumentException) {
                // not registered
            }
        }
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        downloader.shutdown()
        if (!webViewGone) {
            webView.stopLoading()
            webView.destroy()
            webViewGone = true
        }
        super.onDestroy()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString KpAndroid/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
        webView.webViewClient = Client()
        webView.webChromeClient = Chrome()
        webView.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
            onDownloadRequested(url, contentDisposition, mimeType)
        }

        // Service workers (PWA offline shell) get the same settings and the same HTTP rule as pages.
        val workers = ServiceWorkerController.getInstance()
        workers.serviceWorkerWebSettings.apply {
            allowContentAccess = false
            allowFileAccess = false
            blockNetworkLoads = false
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        workers.setServiceWorkerClient(object : ServiceWorkerClient() {
            override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? =
                blockIfInsecure(request)
        })
    }

    private fun installBridge(origin: String) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            if (listenerInstalled) WebViewCompat.removeWebMessageListener(webView, Bridge.NAME)
            listenerInstalled = try {
                WebViewCompat.addWebMessageListener(webView, Bridge.NAME, setOf(origin)) { _, message, _, isMainFrame, _ ->
                    val data = try {
                        message.data
                    } catch (e: IllegalStateException) {
                        null
                    }
                    if (isMainFrame && data != null) onBridgeMessage(data)
                }
                true
            } catch (e: IllegalArgumentException) {
                false
            }
            if (listenerInstalled) return
        }
        if (!jsInterfaceInstalled) {
            webView.addJavascriptInterface(JsBridge(), Bridge.NAME)
            jsInterfaceInstalled = true
        }
    }

    /** Fallback for WebView builds without WEB_MESSAGE_LISTENER: same API, origin checked here. */
    private inner class JsBridge {
        @JavascriptInterface
        fun postMessage(message: String) {
            runOnUiThread {
                if (!webViewGone && NetPolicy.sameOrigin(webView.url, serverOrigin)) onBridgeMessage(message)
            }
        }
    }

    private fun onBridgeMessage(json: String) {
        val msg = try {
            JSONObject(json)
        } catch (e: JSONException) {
            return
        }
        when (msg.optString("type")) {
            "download" -> {
                val url = msg.str("url") ?: return
                val auth = if (msg.has("authorization")) asAuthorization(msg.str("authorization")) else authorization
                startDownload(url, msg.str("fileName"), msg.str("mime"), auth, msg.str("action") ?: Bridge.ACTION_ASK)
            }
            "auth" -> authorization = asAuthorization(msg.str("authorization"))
            "settings" -> openSettings()
            "refresh" -> swipe.isEnabled = msg.optBoolean("enabled", true)
            "scroll" -> innerScrolled = msg.optBoolean("inner", false)
            "blob-begin" -> {
                toast(R.string.dl_started)
                downloader.blobBegin(msg.optString("id"), msg.str("fileName"), msg.str("mime"))
            }
            "blob-chunk" -> downloader.blobChunk(msg.optString("id"), msg.optString("data"))
            "blob-end" -> downloader.blobEnd(msg.optString("id")) { onDownloadResult(it, Bridge.ACTION_ASK) }
            "blob-error" -> {
                downloader.blobDiscard(msg.optString("id"))
                showDownloadError(getString(R.string.dl_error_page, msg.str("message") ?: "?"))
            }
        }
    }

    private fun asAuthorization(value: String?): String? {
        val v = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        return if (' ' in v) v else "Bearer $v"
    }

    private fun handleIntent(intent: Intent?) {
        if (intent?.action == ACTION_SETTINGS) openSettings()
    }

    private fun openSettings() {
        settingsPrompted = true
        swipe.isRefreshing = false
        startActivity(Intent(this, SettingsActivity::class.java))
    }

    private fun load(url: String) {
        mainFrameFailed = false
        sslFailed = false
        failedUrl = null
        webView.loadUrl(url)
    }

    private fun reload() {
        val server = serverUrl
        if (server == null || webViewGone) {
            swipe.isRefreshing = false
            openSettings()
            return
        }
        if (mainFrameFailed || webView.url == null) load(failedUrl ?: server) else webView.reload()
    }

    private fun blockIfInsecure(request: WebResourceRequest): WebResourceResponse? {
        if (NetPolicy.isAllowed(request.url.toString())) return null
        return WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
    }

    /** true = the WebView must not load this URL itself. */
    private fun handleNavigation(uri: Uri): Boolean {
        val url = uri.toString()
        when (uri.scheme?.lowercase()) {
            "http", "https" -> {
                if (NetPolicy.sameOrigin(url, serverOrigin)) return false
                if (!NetPolicy.isAllowed(url)) {
                    toast(R.string.error_blocked_link)
                    return true
                }
                openExternal(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
                return true
            }
            "about", "blob", "data" -> return false
            "javascript", "file", "content" -> return true
            "intent" -> {
                val intent = try {
                    Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
                } catch (e: URISyntaxException) {
                    return true
                }
                intent.addCategory(Intent.CATEGORY_BROWSABLE)
                intent.component = null
                intent.selector = null
                if (!openExternal(intent, quiet = true)) {
                    val fallback = intent.getStringExtra("browser_fallback_url")
                    if (fallback != null && fallback.startsWith("https://")) {
                        openExternal(Intent(Intent.ACTION_VIEW, Uri.parse(fallback)).addCategory(Intent.CATEGORY_BROWSABLE))
                    }
                }
                return true
            }
            else -> {
                // tel:, mailto:, viber:, tg:, geo: ...
                openExternal(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
                return true
            }
        }
    }

    private fun openExternal(intent: Intent, quiet: Boolean = false): Boolean =
        try {
            startActivity(intent)
            true
        } catch (e: ActivityNotFoundException) {
            if (!quiet) toast(R.string.error_no_app_for_link)
            false
        }

    private fun onDownloadRequested(url: String, contentDisposition: String?, mimeType: String?) {
        when {
            url.startsWith("blob:") -> webView.evaluateJavascript(Bridge.fetchBlobJs(url, "n" + (++blobSeq)), null)
            url.startsWith("data:") -> {
                toast(R.string.dl_started)
                downloader.saveDataUrl(url, FileNames.fromContentDisposition(contentDisposition)) {
                    onDownloadResult(it, Bridge.ACTION_ASK)
                }
            }
            else -> startDownload(url, FileNames.fromContentDisposition(contentDisposition), mimeType, authorization, Bridge.ACTION_ASK)
        }
    }

    private fun startDownload(rawUrl: String, fileName: String?, mime: String?, auth: String?, action: String) {
        if (rawUrl.startsWith("blob:") || rawUrl.startsWith("data:")) {
            onDownloadRequested(rawUrl, null, mime)
            return
        }
        val base = webView.url ?: serverUrl
        val url = try {
            if (base != null) URL(URL(base), rawUrl).toString() else rawUrl
        } catch (e: MalformedURLException) {
            rawUrl
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            showDownloadError(getString(R.string.dl_error_unsupported))
            return
        }
        toast(R.string.dl_started)
        val request = Downloader.Request(url, fileName, mime, auth, serverOrigin, webView.settings.userAgentString)
        downloader.fetch(request) { onDownloadResult(it, action) }
    }

    private fun onDownloadResult(result: Downloader.Result, action: String) {
        if (isFinishing || isDestroyed) return
        when (result) {
            is Downloader.Result.Failed -> showDownloadError(result.message)
            is Downloader.Result.Ready -> when (action) {
                Bridge.ACTION_OPEN -> openFile(result.file, result.mime)
                Bridge.ACTION_SHARE -> shareFile(result.file, result.mime)
                else -> AlertDialog.Builder(this)
                    .setTitle(R.string.dl_ready_title)
                    .setMessage(getString(R.string.dl_ready_text, result.file.name, Formatter.formatShortFileSize(this, result.file.length())))
                    .setPositiveButton(R.string.action_share) { _, _ -> shareFile(result.file, result.mime) }
                    .setNegativeButton(R.string.action_open) { _, _ -> openFile(result.file, result.mime) }
                    .setNeutralButton(R.string.action_save_copy) { _, _ -> saveCopy(result.file, result.mime) }
                    .show()
            }
        }
    }

    private fun showDownloadError(message: String) {
        if (isFinishing || isDestroyed) return
        AlertDialog.Builder(this)
            .setTitle(R.string.dl_error_title)
            .setMessage(message)
            .setPositiveButton(android.R.string.ok, null)
            .show()
    }

    private fun contentUri(file: File): Uri = FileProvider.getUriForFile(this, "$packageName.files", file)

    private fun openFile(file: File, mime: String) {
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(contentUri(file), mime)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            toast(R.string.no_app_to_open)
        }
    }

    private fun shareFile(file: File, mime: String) {
        val uri = contentUri(file)
        val send = Intent(Intent.ACTION_SEND)
            .setType(mime)
            .putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_SUBJECT, file.nameWithoutExtension)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = ClipData.newRawUri(file.name, uri)
        try {
            startActivity(Intent.createChooser(send, getString(R.string.chooser_share)))
        } catch (e: ActivityNotFoundException) {
            toast(R.string.no_app_to_open)
        }
    }

    private fun saveCopy(file: File, mime: String) {
        pendingSave = file
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mime)
            .putExtra(Intent.EXTRA_TITLE, file.name)
        try {
            createDocument.launch(intent)
        } catch (e: ActivityNotFoundException) {
            pendingSave = null
            toast(R.string.dl_save_failed)
        }
    }

    private fun showConnectionError(detail: String?) {
        if (!isOnline()) {
            showError(getString(R.string.error_offline_title), getString(R.string.error_offline_text))
        } else {
            showError(getString(R.string.error_server_title), getString(R.string.error_server_text, serverUrl.orEmpty(), detail.orEmpty()))
        }
    }

    private fun showError(title: String, text: String) {
        swipe.isRefreshing = false
        progress.isVisible = false
        errorTitle.text = title
        errorText.text = text
        errorView.isVisible = true
    }

    private fun hideError() {
        errorView.isVisible = false
    }

    private fun isOnline(): Boolean {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return true
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun registerNetworkCallback() {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                runOnUiThread {
                    if (!isDestroyed && !webViewGone && mainFrameFailed && errorView.isVisible) reload()
                }
            }
        }
        try {
            cm.registerDefaultNetworkCallback(callback)
            networkCallback = callback
        } catch (e: RuntimeException) {
            // no network callbacks on this device: the retry button still works
        }
    }

    private fun toast(@StringRes id: Int) {
        Toast.makeText(this, id, Toast.LENGTH_SHORT).show()
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
            handleNavigation(request.url)

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            blockIfInsecure(request)

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            // mainFrameFailed is reset only by load()/back: error callbacks may arrive before this one.
            innerScrolled = false
        }

        override fun onPageFinished(view: WebView, url: String) {
            swipe.isRefreshing = false
            if (!mainFrameFailed) hideError()
            if (clearHistoryOnLoad && !mainFrameFailed) {
                clearHistoryOnLoad = false
                view.clearHistory()
            }
            view.evaluateJavascript(Bridge.HELPER_JS, null)
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            val description = error.description?.toString().orEmpty()
            // A navigation that turned into a file download is reported as aborted: not an error.
            if (description.contains("ERR_ABORTED") || sslFailed) return
            mainFrameFailed = true
            failedUrl = request.url.toString()
            showConnectionError(description)
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
            if (!request.isForMainFrame || errorResponse.statusCode < 500) return
            mainFrameFailed = true
            failedUrl = request.url.toString()
            showError(getString(R.string.error_server_title), getString(R.string.error_http_text, errorResponse.statusCode))
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel()
            if (!NetPolicy.sameOrigin(error.url, serverOrigin)) return
            sslFailed = true
            mainFrameFailed = true
            failedUrl = error.url
            showError(getString(R.string.error_ssl_title), getString(R.string.error_ssl_text))
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // The WebView is unusable now: drop it and rebuild the screen.
            webViewGone = true
            (view.parent as? ViewGroup)?.removeView(view)
            view.destroy()
            recreate()
            return true
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            progress.progress = newProgress
            progress.isVisible = newProgress in 1..99 && !errorView.isVisible
        }

        override fun onShowFileChooser(
            view: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: WebChromeClient.FileChooserParams,
        ): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = filePathCallback
            return try {
                pickFiles.launch(fileChooserParams.createIntent())
                true
            } catch (e: ActivityNotFoundException) {
                fileCallback = null
                toast(R.string.file_chooser_failed)
                false
            }
        }
    }

    companion object {
        const val ACTION_SETTINGS = "ua.gidman.kp.action.SETTINGS"
        private const val STATE_PENDING_SAVE = "pending_save"
    }
}
