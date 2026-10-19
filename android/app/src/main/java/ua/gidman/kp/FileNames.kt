package ua.gidman.kp

import java.io.ByteArrayOutputStream
import java.nio.charset.Charset

/** File name and MIME type decisions for downloaded files. */
object FileNames {

    private const val FALLBACK = "КП"
    private const val MAX_LENGTH = 100

    private val MIME_BY_EXT = mapOf(
        "pdf" to "application/pdf",
        "pptx" to "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "docx" to "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" to "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "png" to "image/png",
        "jpg" to "image/jpeg",
        "jpeg" to "image/jpeg",
        "webp" to "image/webp",
        "zip" to "application/zip",
        "json" to "application/json",
        "csv" to "text/csv",
        "txt" to "text/plain",
    )
    private val GENERIC = setOf("application/octet-stream", "binary/octet-stream", "application/force-download", "application/download")

    private val EXT_PARAM = Regex("""(?:^|;)\s*filename\*\s*=\s*([^;]+)""", RegexOption.IGNORE_CASE)
    private val PLAIN_PARAM = Regex("""(?:^|;)\s*filename\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]*))""", RegexOption.IGNORE_CASE)
    private val QUOTED_PAIR = Regex("""\\(.)""")
    private val UNSAFE = Regex("""[\\/:*?"<>|\u0000-\u001F\u007F]""")
    private val SPACES = Regex("""\s+""")

    class DataUrl(val mime: String, val base64: Boolean, val payload: String)

    fun fromContentDisposition(cd: String?): String? {
        if (cd.isNullOrBlank()) return null
        EXT_PARAM.find(cd)?.let { m ->
            val parts = m.groupValues[1].trim().trim('"').split('\'', limit = 3)
            if (parts.size == 3) decodePercent(parts[2], parts[0])?.takeIf { it.isNotBlank() }?.let { return it }
        }
        val m = PLAIN_PARAM.find(cd) ?: return null
        val quoted = m.groups[1]
        val raw = if (quoted != null) quoted.value.replace(QUOTED_PAIR, "\$1") else m.groupValues[2].trim()
        return fixLatin1(raw).takeIf { it.isNotBlank() }
    }

    fun pick(contentDisposition: String?, hint: String?, urlPath: String?, contentType: String?): String {
        val fromPath = urlPath?.substringAfterLast('/')?.let { decodePercent(it, "UTF-8") }
            ?.takeIf { hasExtension(it) }
        val raw = fromContentDisposition(contentDisposition)
            ?: hint?.takeIf { it.isNotBlank() }
            ?: fromPath
            ?: FALLBACK
        val name = sanitize(raw)
        if (hasExtension(name)) return name
        val ext = extensionFor(mimeOf(contentType)) ?: return name
        return sanitize("$name.$ext")
    }

    fun mimeFor(name: String, contentType: String?): String {
        val ct = mimeOf(contentType)
        if (ct != null && ct !in GENERIC) return ct
        return MIME_BY_EXT[extensionOf(name)] ?: "application/octet-stream"
    }

    fun sanitize(name: String): String {
        val cleaned = name.replace(UNSAFE, "_").replace(SPACES, " ").trim().trim('.', ' ')
        if (cleaned.isEmpty()) return FALLBACK
        if (cleaned.length <= MAX_LENGTH) return cleaned
        val ext = if (hasExtension(cleaned)) "." + extensionOf(cleaned) else ""
        return cleaned.take(MAX_LENGTH - ext.length).trimEnd() + ext
    }

    fun parseDataUrl(url: String): DataUrl? {
        if (!url.startsWith("data:", ignoreCase = true)) return null
        val comma = url.indexOf(',')
        if (comma < 0) return null
        val meta = url.substring(5, comma).split(';')
        val mime = meta[0].trim().lowercase().ifEmpty { "text/plain" }
        val base64 = meta.drop(1).any { it.trim().equals("base64", ignoreCase = true) }
        return DataUrl(mime, base64, url.substring(comma + 1))
    }

    fun extensionFor(mime: String?): String? =
        if (mime == null) null else MIME_BY_EXT.entries.firstOrNull { it.value == mime }?.key

    private fun mimeOf(contentType: String?): String? =
        contentType?.substringBefore(';')?.trim()?.lowercase()?.takeIf { it.contains('/') }

    private fun extensionOf(name: String): String = name.substringAfterLast('.', "").lowercase()

    private fun hasExtension(name: String): Boolean {
        val ext = extensionOf(name)
        return ext.length in 1..5 && ext.all { it.isLetterOrDigit() } && name.length > ext.length + 1
    }

    private fun decodePercent(value: String, charsetName: String): String? {
        val bytes = ByteArrayOutputStream()
        var i = 0
        while (i < value.length) {
            if (value[i] == '%') {
                if (i + 2 >= value.length) return null
                val hi = Character.digit(value[i + 1], 16)
                val lo = Character.digit(value[i + 2], 16)
                if (hi < 0 || lo < 0) return null
                bytes.write(hi * 16 + lo)
                i += 3
            } else {
                val next = value.indexOf('%', i)
                val end = if (next < 0) value.length else next
                bytes.write(value.substring(i, end).toByteArray(Charsets.UTF_8))
                i = end
            }
        }
        val charset = try {
            Charset.forName(charsetName.ifBlank { "UTF-8" })
        } catch (e: IllegalArgumentException) {
            Charsets.UTF_8
        }
        return String(bytes.toByteArray(), charset)
    }

    /** Headers are read as ISO-8859-1; recover a raw UTF-8 file name sent without RFC 5987 encoding. */
    private fun fixLatin1(value: String): String {
        if (value.none { it.code in 0x80..0xFF } || value.any { it.code > 0xFF }) return value
        val decoded = String(value.toByteArray(Charsets.ISO_8859_1), Charsets.UTF_8)
        return if ('�' in decoded) value else decoded
    }
}
