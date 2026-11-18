# Preserve JavascriptInterface methods for WebView linear motor bridge
-keepclassmembers class io.yjty.jisuanqi.MainActivity$NativeHapticBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
