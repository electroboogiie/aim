package ua.gidman.kp

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.webkit.CookieManager
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Fetches files (KP PDF/PPTX) into the app cache with the WebView cookies and the page's
 * Authorization header, so they can be opened or shared through the FileProvider.
 * All work runs on one background thread, which also keeps blob chunks in order.
 */
class Downloader(context: Context) {

    sealed class Result {
        class Ready(val file: File, val mime: String) : Result()
        class Failed(val message: String) : Result()
    }

    class Request(
        val url: String,
        val fileName: String?,
        val mime: String?,
        val authorization: String?,
        val serverOrigin: String?,
        val userAgent: String,
    )

    private class BlobPart(val tmp: File, val out: OutputStream, val fileName: String?, val mime: String?) {
        var failure: String? = null
    }

    private val app = context.applicationContext
    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val blobs = HashMap<String, BlobPart>()

    private val dir: File
        get() = File(app.cacheDir, DIR).also { it.mkdirs() }

    fun fetch(request: Request, done: (Result) -> Unit) = submit(done) { fetchNow(request) }

    fun saveDataUrl(url: String, fileName: String?, done: (Result) -> Unit) = submit(done) {
        val data = FileNames.parseDataUrl(url)
            ?: return@submit Result.Failed(app.getString(R.string.dl_error_unsupported))
        val bytes = if (data.base64) {
            Base64.decode(data.payload, Base64.DEFAULT)
        } else {
            URLDecoder.decode(data.payload.replace("+", "%2B"), "UTF-8").toByteArray(Charsets.UTF_8)
        }
        val name = FileNames.pick(null, fileName, null, data.mime)
        Result.Ready(write(name, bytes.inputStream()), FileNames.mimeFor(name, data.mime))
    }

    fun blobBegin(id: String, fileName: String?, mime: String?) = executor.execute {
        blobs.remove(id)?.let { discard(it) }
        val tmp = File(dir, "blob-${id.filter { it.isLetterOrDigit() }}.part")
        val out = try {
            FileOutputStream(tmp)
        } catch (e: IOException) {
            return@execute
        }
        blobs[id] = BlobPart(tmp, out, fileName, mime)
    }

    fun blobChunk(id: String, base64: String) = executor.execute {
        val part = blobs[id] ?: return@execute
        if (part.failure != null) return@execute
        try {
            part.out.write(Base64.decode(base64, Base64.DEFAULT))
        } catch (e: IOException) {
            part.failure = e.localizedMessage ?: e.javaClass.simpleName
        } catch (e: IllegalArgumentException) {
            part.failure = e.localizedMessage ?: e.javaClass.simpleName
        }
    }

    fun blobEnd(id: String, done: (Result) -> Unit) = submit(done) {
        val part = blobs.remove(id)
            ?: return@submit Result.Failed(app.getString(R.string.dl_error_storage, id))
        part.out.close()
        part.failure?.let {
            part.tmp.delete()
            return@submit Result.Failed(app.getString(R.string.dl_error_storage, it))
        }
        val name = FileNames.pick(null, part.fileName, null, part.mime)
        Result.Ready(moveInto(part.tmp, name), FileNames.mimeFor(name, part.mime))
    }

    fun blobDiscard(id: String) = executor.execute { blobs.remove(id)?.let { discard(it) } }

    fun copy(file: File, target: Uri, done: (Boolean) -> Unit) = executor.execute {
        val ok = try {
            app.contentResolver.openOutputStream(target)?.use { out ->
                file.inputStream().use { it.copyTo(out) }
            } != null
        } catch (e: IOException) {
            false
        } catch (e: SecurityException) {
            false
        }
        main.post { done(ok) }
    }

    /** Removes downloads older than a few days; they are only kept for re-sharing. */
    fun cleanup() = executor.execute {
        val limit = System.currentTimeMillis() - MAX_AGE_MS
        dir.listFiles()?.forEach { if (it.lastModified() < limit) it.delete() }
    }

    fun shutdown() = executor.shutdown()

    private fun submit(done: (Result) -> Unit, block: () -> Result) = executor.execute {
        val result = try {
            block()
        } catch (e: IOException) {
            Result.Failed(app.getString(R.string.dl_error_network, e.localizedMessage ?: e.javaClass.simpleName))
        } catch (e: RuntimeException) {
            Result.Failed(app.getString(R.string.dl_error_storage, e.localizedMessage ?: e.javaClass.simpleName))
        }
        main.post { done(result) }
    }

    private fun fetchNow(req: Request): Result {
        var url = URL(req.url)
        for (hop in 0..MAX_REDIRECTS) {
            if (!NetPolicy.isAllowed(url.toString())) return Result.Failed(app.getString(R.string.dl_error_insecure))
            val conn = url.openConnection() as HttpURLConnection
            try {
                conn.instanceFollowRedirects = false
                conn.connectTimeout = 15_000
                conn.readTimeout = 120_000
                conn.setRequestProperty("User-Agent", req.userAgent)
                conn.setRequestProperty("Accept", "*/*")
                cookiesFor(url.toString())?.let { conn.setRequestProperty("Cookie", it) }
                // The token is only ever sent to the configured server, never to a redirect target elsewhere.
                if (req.authorization != null && NetPolicy.sameOrigin(url.toString(), req.serverOrigin)) {
                    conn.setRequestProperty("Authorization", req.authorization)
                }
                val code = conn.responseCode
                if (code in 300..399 && code != 304) {
                    val location = conn.getHeaderField("Location")
                        ?: return Result.Failed(app.getString(R.string.dl_error_http, code))
                    url = URL(url, location)
                    continue
                }
                if (code !in 200..299) return Result.Failed(httpError(code, conn))
                val type = conn.contentType ?: req.mime
                val name = FileNames.pick(conn.getHeaderField("Content-Disposition"), req.fileName, url.path, type)
                val file = conn.inputStream.use { write(name, it) }
                return Result.Ready(file, FileNames.mimeFor(name, type))
            } finally {
                conn.disconnect()
            }
        }
        return Result.Failed(app.getString(R.string.dl_error_redirects))
    }

    private fun httpError(code: Int, conn: HttpURLConnection): String {
        val base = when (code) {
            401, 403 -> app.getString(R.string.dl_error_auth, code)
            404 -> app.getString(R.string.dl_error_not_found)
            else -> app.getString(R.string.dl_error_http, code)
        }
        val serverMessage = try {
            conn.errorStream?.use { stream ->
                val text = stream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                JSONObject(text).str("error")?.take(500)
            }
        } catch (e: IOException) {
            null
        } catch (e: JSONException) {
            null
        }
        return if (serverMessage.isNullOrBlank()) base else "$base\n$serverMessage"
    }

    /** CookieManager is used from the main thread only; the worker waits for the answer. */
    private fun cookiesFor(url: String): String? {
        val latch = CountDownLatch(1)
        var value: String? = null
        main.post {
            value = try {
                CookieManager.getInstance().getCookie(url)
            } catch (e: RuntimeException) {
                null
            }
            latch.countDown()
        }
        latch.await(5, TimeUnit.SECONDS)
        return value
    }

    private fun write(name: String, input: InputStream): File {
        val tmp = File(dir, "$name.part")
        try {
            FileOutputStream(tmp).use { input.copyTo(it) }
        } catch (e: IOException) {
            tmp.delete()
            throw e
        }
        return moveInto(tmp, name)
    }

    private fun moveInto(tmp: File, name: String): File {
        val target = File(dir, name)
        if (target.exists()) target.delete()
        if (!tmp.renameTo(target)) {
            tmp.delete()
            throw IOException(app.getString(R.string.dl_error_storage, name))
        }
        return target
    }

    private fun discard(part: BlobPart) {
        try {
            part.out.close()
        } catch (e: IOException) {
            // already closed
        }
        part.tmp.delete()
    }

    companion object {
        const val DIR = "kp"
        private const val MAX_REDIRECTS = 5
        private const val MAX_AGE_MS = 3L * 24 * 60 * 60 * 1000
    }
}
