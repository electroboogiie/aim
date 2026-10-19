package ua.gidman.kp

import java.net.URI
import java.net.URISyntaxException

/**
 * Which URLs the app may load: HTTPS anywhere, plain HTTP only to loopback and private-network
 * IP addresses. The network security config cannot express address ranges, so this is the rule.
 */
object NetPolicy {

    enum class Check { OK, EMPTY, INVALID, INSECURE }

    fun check(input: String): Check {
        if (input.isBlank()) return Check.EMPTY
        val url = normalizeServerUrl(input) ?: return Check.INVALID
        return if (isAllowed(url)) Check.OK else Check.INSECURE
    }

    /** "kp.example.com" -> "https://kp.example.com/", "192.168.1.10:8080" -> "http://192.168.1.10:8080/". */
    fun normalizeServerUrl(input: String): String? {
        var s = input.trim()
        if (s.isEmpty()) return null
        if (!s.contains("://")) {
            val host = hostOf(s.substringBefore('/').substringBefore('?').substringBefore('#'))
            s = (if (isLocalHost(host)) "http://" else "https://") + s
        }
        val uri = try {
            URI(s)
        } catch (e: URISyntaxException) {
            return null
        }
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        if (uri.rawUserInfo != null) return null
        val host = uri.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
        val port = if (uri.port == -1) "" else ":" + uri.port
        val rawPath = uri.rawPath.orEmpty()
        val path = if (rawPath.endsWith("/")) rawPath else "$rawPath/"
        return "$scheme://$host$port$path"
    }

    fun isAllowed(url: String): Boolean {
        val sep = url.indexOf(':')
        if (sep <= 0) return true
        val scheme = url.substring(0, sep).lowercase()
        if (scheme != "http" && scheme != "ws") return true
        val authority = authorityOf(url) ?: return false
        return isLocalHost(hostOf(authority))
    }

    /** "scheme://host[:port]" in lower case without the default port, or null for non-HTTP(S) URLs. */
    fun origin(url: String?): String? {
        if (url == null) return null
        val sep = url.indexOf("://")
        if (sep <= 0) return null
        val scheme = url.substring(0, sep).lowercase()
        if (scheme != "http" && scheme != "https") return null
        var authority = authorityOf(url)?.substringAfterLast('@')?.lowercase() ?: return null
        if (authority.isEmpty()) return null
        val defaultPort = if (scheme == "https") ":443" else ":80"
        if (authority.endsWith(defaultPort)) authority = authority.removeSuffix(defaultPort)
        return "$scheme://$authority"
    }

    fun sameOrigin(a: String?, b: String?): Boolean {
        val oa = origin(a) ?: return false
        return oa == origin(b)
    }

    fun isLocalHost(rawHost: String): Boolean {
        val host = rawHost.trim().removePrefix("[").removeSuffix("]").substringBefore('%')
            .lowercase().removeSuffix(".")
        if (host == "localhost") return true
        val v4 = parseIpv4(host)
        if (v4 != null) {
            val a = v4[0]
            val b = v4[1]
            // 100.64.0.0/10 is carrier-grade NAT space, also used by VPN overlays such as Tailscale.
            return a == 10 || a == 127 || (a == 172 && b in 16..31) || (a == 192 && b == 168) ||
                (a == 169 && b == 254) || (a == 100 && b in 64..127)
        }
        if (':' in host) {
            if (host == "::1") return true
            val first = host.substringBefore(':')
            if (first.isEmpty() || first.length > 4) return false
            val word = first.toIntOrNull(16) ?: return false
            return (word and 0xfe00) == 0xfc00 || (word and 0xffc0) == 0xfe80
        }
        return false
    }

    private fun authorityOf(url: String): String? {
        val sep = url.indexOf("://")
        if (sep <= 0) return null
        val rest = url.substring(sep + 3)
        val end = rest.indexOfAny(charArrayOf('/', '?', '#', '\\'))
        return if (end < 0) rest else rest.substring(0, end)
    }

    private fun hostOf(authority: String): String {
        val a = authority.substringAfterLast('@')
        if (a.startsWith("[")) return a.substringBefore(']').removePrefix("[")
        return a.substringBefore(':')
    }

    private fun parseIpv4(host: String): IntArray? {
        val parts = host.split('.')
        if (parts.size != 4) return null
        val out = IntArray(4)
        for ((i, p) in parts.withIndex()) {
            if (p.isEmpty() || p.length > 3 || !p.all { it in '0'..'9' }) return null
            val n = p.toInt()
            if (n > 255) return null
            out[i] = n
        }
        return out
    }
}
