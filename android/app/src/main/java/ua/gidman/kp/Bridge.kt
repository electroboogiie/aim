package ua.gidman.kp

import org.json.JSONObject

/** Page <-> app bridge (`window.KpAndroid.postMessage(json)`), see docs/CONTRACTS.md §8. */
object Bridge {
    const val NAME = "KpAndroid"

    const val ACTION_ASK = "ask"
    const val ACTION_OPEN = "open"
    const val ACTION_SHARE = "share"

    /**
     * Installed after every page load. Saves `<a download href="blob:|data:">` files through the
     * bridge (a WebView cannot download blob URLs itself) and reports whether a touch starts inside
     * a scrolled inner container, so pull-to-refresh does not fire there.
     */
    val HELPER_JS = """
        (function () {
          if (window.__kpHelper || !window.KpAndroid) return;
          window.__kpHelper = true;
          var bridge = window.KpAndroid;
          var seq = 0;
          function send(msg) { try { bridge.postMessage(JSON.stringify(msg)); } catch (e) {} }
          function fetchBlob(url, id, name) {
            fetch(url).then(function (r) { return r.blob(); }).then(function (blob) {
              send({ type: 'blob-begin', id: id, fileName: name || '', mime: blob.type || '' });
              var size = 393216, pos = 0;
              (function next() {
                if (pos >= blob.size) { send({ type: 'blob-end', id: id }); return; }
                var reader = new FileReader();
                reader.onload = function () {
                  var s = String(reader.result);
                  send({ type: 'blob-chunk', id: id, data: s.slice(s.indexOf(',') + 1) });
                  pos += size;
                  next();
                };
                reader.onerror = function () { send({ type: 'blob-error', id: id, message: String(reader.error) }); };
                reader.readAsDataURL(blob.slice(pos, pos + size));
              })();
            }).catch(function (e) { send({ type: 'blob-error', id: id, message: String(e) }); });
          }
          window.__kpFetchBlob = fetchBlob;
          function intercept(a) {
            if (!a || !a.hasAttribute || !a.hasAttribute('download')) return false;
            var href = a.href || '';
            if (href.indexOf('blob:') !== 0 && href.indexOf('data:') !== 0) return false;
            fetchBlob(href, 'j' + (++seq), a.getAttribute('download') || '');
            return true;
          }
          var click = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function () {
            if (intercept(this)) return;
            return click.apply(this, arguments);
          };
          document.addEventListener('click', function (e) {
            var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
            if (a && intercept(a)) e.preventDefault();
          }, true);
          var revoke = URL.revokeObjectURL;
          URL.revokeObjectURL = function (u) { setTimeout(function () { revoke.call(URL, u); }, 60000); };
          document.addEventListener('touchstart', function (e) {
            var el = e.target, inner = false;
            while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement) {
              if (el.scrollTop > 0) {
                var oy = getComputedStyle(el).overflowY;
                if (oy === 'auto' || oy === 'scroll') { inner = true; break; }
              }
              el = el.parentElement;
            }
            send({ type: 'scroll', inner: inner });
          }, { capture: true, passive: true });
        })();
    """.trimIndent()

    fun fetchBlobJs(url: String, id: String): String =
        HELPER_JS + "\nwindow.__kpFetchBlob && window.__kpFetchBlob(" + JSONObject.quote(url) + ", " +
            JSONObject.quote(id) + ", '');"
}

/** String field or null when it is missing, JSON null or empty (Android's optString returns "null"). */
fun JSONObject.str(name: String): String? =
    if (isNull(name)) null else optString(name).takeIf { it.isNotEmpty() }
