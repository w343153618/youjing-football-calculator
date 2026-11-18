# 安卓客户端采用「服务端黑盒直连 + 原生线性马达桥接 + 禁绝 USB 调试」混合原生容器架构

若将前端资源或计算逻辑离线打包进安卓 APK 的 `assets/` 目录，竞品只需用 `apktool` / `jadx` 解包即可离线静态分析全部静态包，且每次调整盘口策略都迫使全员重新下载安装 APK。因此安卓端（`io.yjty.jisuanqi`）采用原生 Kotlin 全屏沉浸式容器直连 `https://jisuanqi.yjty.io`：一方面确保 APK 安装包内部零策略代码与零密钥残留、策略升级秒级全员同步；另一方面通过 `@JavascriptInterface` 原生桥接调用安卓系统 `VibrationEffect.createWaveform` 幅度控制马达、在进程切后台时强制刷盘持久化 Cookie 与本地凭证实现微信级杀进程不断登、通过 `ConnectivityManager` 拦截断网白屏实现联网自愈，并硬编码关闭 `WebView.setWebContentsDebuggingEnabled(false)` 彻底封死 USB `chrome://inspect` 远程调试抓包。
