package io.yjty.jisuanqi

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher

class MainActivity : Activity() {

    companion object {
        private const val ALLOWED_HOST = "jisuanqi.yjty.io"
        private const val TARGET_URL = "https://jisuanqi.yjty.io/"
        private const val BG_DARK = "#070B14"

        fun isTrustedUrl(rawUrl: String?): Boolean {
            if (rawUrl.isNullOrBlank()) return false
            val parsed = try {
                Uri.parse(rawUrl)
            } catch (_: Throwable) {
                return false
            }
            return parsed.scheme.equals("https", ignoreCase = true) &&
                parsed.host.equals(ALLOWED_HOST, ignoreCase = true)
        }
    }

    private lateinit var rootLayout: FrameLayout
    private lateinit var webView: WebView
    private lateinit var offlineOverlay: LinearLayout
    private lateinit var statusSubText: TextView

    @Volatile
    private var needsReloadOnReconnect = false

    private var lastBackPressMs = 0L
    private var connectivityManager: ConnectivityManager? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var backCallback: OnBackInvokedCallback? = null

    inner class NativeHapticBridge(private val ctx: Context) {
        @JavascriptInterface
        fun vibrateWaveform(patternCsv: String?, amplitude: Int) {
            if (patternCsv.isNullOrBlank()) return
            val parts = patternCsv.split(",")
                .mapNotNull { it.trim().toLongOrNull() }
                .take(16)
                .map { it.coerceIn(2L, 260L) }
            if (parts.isEmpty()) return

            val safeAmp = amplitude.coerceIn(1, 255)
            val timings = LongArray(parts.size + 1)
            val amplitudes = IntArray(parts.size + 1)
            timings[0] = 0L
            amplitudes[0] = 0
            for (i in parts.indices) {
                timings[i + 1] = parts[i]
                amplitudes[i + 1] = if (i % 2 == 0) safeAmp else 0
            }

            try {
                val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val vm = ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                    vm?.defaultVibrator
                } else {
                    @Suppress("DEPRECATION")
                    ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                }
                if (vibrator?.hasVibrator() == true) {
                    vibrator.cancel()
                    if (vibrator.hasAmplitudeControl()) {
                        vibrator.vibrate(VibrationEffect.createWaveform(timings, amplitudes, -1))
                    } else {
                        vibrator.vibrate(VibrationEffect.createWaveform(timings, -1))
                    }
                }
            } catch (_: Throwable) {
                // Ignore device vibrator permission/ROM quirks
            }
        }
    }

    private fun loadTrustedEntry() {
        needsReloadOnReconnect = false
        offlineOverlay.visibility = View.GONE
        webView.loadUrl(TARGET_URL)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Strictly forbid remote USB WebView debugging (chrome://inspect)
        WebView.setWebContentsDebuggingEnabled(false)

        val bgInt = Color.parseColor(BG_DARK)
        window.decorView.setBackgroundColor(bgInt)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.setSystemBarsAppearance(
                0,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                    WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            )
        }

        rootLayout = FrameLayout(this).apply {
            setBackgroundColor(bgInt)
        }

        rootLayout.setOnApplyWindowInsetsListener { view, insets ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val sys = insets.getInsets(
                    WindowInsets.Type.systemBars() or WindowInsets.Type.ime()
                )
                view.setPadding(sys.left, sys.top, sys.right, sys.bottom)
            } else {
                @Suppress("DEPRECATION")
                view.setPadding(
                    insets.systemWindowInsetLeft,
                    insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight,
                    insets.systemWindowInsetBottom
                )
            }
            insets
        }

        webView = WebView(this).apply {
            setBackgroundColor(bgInt)
            overScrollMode = View.OVER_SCROLL_NEVER
        }

        val cookieMgr = CookieManager.getInstance()
        cookieMgr.setAcceptCookie(true)
        cookieMgr.setAcceptThirdPartyCookies(webView, false)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            textZoom = 100
            userAgentString = "$userAgentString YouJingAndroid/2.0.0"
        }

        webView.addJavascriptInterface(NativeHapticBridge(applicationContext), "YJAndroidNative")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                return !isTrustedUrl(request?.url?.toString())
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (isTrustedUrl(url) && !needsReloadOnReconnect) {
                    offlineOverlay.visibility = View.GONE
                    CookieManager.getInstance().flush()
                }
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    needsReloadOnReconnect = true
                    statusSubText.text = "当前网络信号未就绪 · 恢复联网后将自动无感接入（已登录凭证永久保留）"
                    offlineOverlay.visibility = View.VISIBLE
                }
            }

            override fun onReceivedSslError(
                view: WebView?,
                handler: SslErrorHandler?,
                error: SslError?
            ) {
                handler?.cancel()
            }
        }

        offlineOverlay = buildStatusOverlay()
        rootLayout.addView(
            webView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        rootLayout.addView(
            offlineOverlay,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )

        setContentView(rootLayout)
        registerNetworkSelfHeal()
        registerBackNavigation()

        if (isNetworkAvailable()) {
            loadTrustedEntry()
        } else {
            needsReloadOnReconnect = true
            statusSubText.text = "未检测到网络连接 · 恢复 5G/WiFi 后自动无感进入"
            offlineOverlay.visibility = View.VISIBLE
        }
    }

    private fun dp(v: Int): Int =
        TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            v.toFloat(),
            resources.displayMetrics
        ).toInt()

    private fun buildStatusOverlay(): LinearLayout {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor(BG_DARK))
            setPadding(dp(28), dp(28), dp(28), dp(28))
            visibility = View.GONE
        }

        val badgeBg = GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            intArrayOf(Color.parseColor("#2563EB"), Color.parseColor("#0D9488"))
        ).apply {
            cornerRadius = dp(16).toFloat()
        }

        val badge = TextView(this).apply {
            text = "优竞"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            background = badgeBg
            layoutParams = LinearLayout.LayoutParams(dp(54), dp(54)).apply {
                bottomMargin = dp(16)
            }
        }

        val title = TextView(this).apply {
            text = "优竞体育内部专用"
            setTextColor(Color.parseColor("#F8FAFC"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 19f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        }

        statusSubText = TextView(this).apply {
            text = "正在连接加密精算通道..."
            setTextColor(Color.parseColor("#94A3B8"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(10)
                bottomMargin = dp(22)
            }
        }

        val btnBg = GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            intArrayOf(Color.parseColor("#2563EB"), Color.parseColor("#0D9488"))
        ).apply {
            cornerRadius = dp(12).toFloat()
        }

        val retryBtn = Button(this).apply {
            text = "立即重试连接"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            isAllCaps = false
            background = btnBg
            setPadding(dp(24), dp(10), dp(24), dp(10))
            setOnClickListener { loadTrustedEntry() }
        }

        wrap.addView(badge)
        wrap.addView(title)
        wrap.addView(statusSubText)
        wrap.addView(retryBtn)
        return wrap
    }

    private fun isNetworkAvailable(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return true
        val net = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(net) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun registerNetworkSelfHeal() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        connectivityManager = cm
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                if (needsReloadOnReconnect &&
                    caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                    caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
                ) {
                    runOnUiThread {
                        if (needsReloadOnReconnect) loadTrustedEntry()
                    }
                }
            }
        }
        networkCallback = cb
        try {
            val req = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            cm.registerNetworkCallback(req, cb)
        } catch (_: Throwable) {
            // ignore
        }
    }

    private fun handleBackAction() {
        if (::offlineOverlay.isInitialized &&
            offlineOverlay.visibility != View.VISIBLE &&
            ::webView.isInitialized &&
            webView.canGoBack()
        ) {
            webView.goBack()
            return
        }
        val now = System.currentTimeMillis()
        if (now - lastBackPressMs < 1800L) {
            CookieManager.getInstance().flush()
            finish()
        } else {
            lastBackPressMs = now
            Toast.makeText(this, "再按一次返回手机桌面", Toast.LENGTH_SHORT).show()
        }
    }

    private fun registerBackNavigation() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val cb = OnBackInvokedCallback { handleBackAction() }
            backCallback = cb
            onBackInvokedDispatcher.registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                cb
            )
        }
    }

    @Deprecated("Fallback for Android 8..12")
    override fun onBackPressed() {
        handleBackAction()
    }

    override fun onPause() {
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onStop() {
        CookieManager.getInstance().flush()
        super.onStop()
    }

    override fun onDestroy() {
        try {
            networkCallback?.let { connectivityManager?.unregisterNetworkCallback(it) }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                backCallback?.let { onBackInvokedDispatcher.unregisterOnBackInvokedCallback(it) }
            }
            CookieManager.getInstance().flush()
            if (::webView.isInitialized) {
                webView.removeJavascriptInterface("YJAndroidNative")
                webView.destroy()
            }
        } catch (_: Throwable) {
            // ignore
        }
        super.onDestroy()
    }
}
