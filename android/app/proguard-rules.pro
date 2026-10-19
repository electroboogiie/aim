# Methods called from page JavaScript through addJavascriptInterface (fallback bridge).
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
