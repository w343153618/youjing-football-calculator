# Spec 0004 · 配套安卓原生客户端（APK）构建、线性马达触觉桥接与 GitHub Releases 分发（v2.0.0）

> 遵循 `AGENTS.md` 强制 `matt-pocock` 流水线归档，受 `GLOSSARY.md` 与 `docs/adr/0006` 约束。

## 1. 目标与边界

为「优竞体育内部专用」提供可直接安装于安卓手机的正式签名安装包（`youjing-calculator-v2.0.0.apk` / 展示名 **「优竞体育内部专用」**，包名 `io.yjty.jisuanqi`），并发布至 GitHub 仓库官方 **Releases（`v2.0.0`）** 供随时下载分发。

## 2. 核心功能与安全要求

1. **全屏沉浸式原生体验与专属图标**：
   - 应用桌面名称固定为 **「优竞体育内部专用」**，配备深海蓝青渐变「优竞」矢量自适应图标（Adaptive Icon）。
   - 启动即全屏无浏览器地址栏，深色状态栏与导航栏边缘融合（`#070B14`），物理返回键优先驱动应用内历史返回与防误退处理。
2. **微信级杀进程免重登与断网无感自愈**：
   - 开启 `domStorageEnabled` 与 `CookieManager` 持久化，在 `onPause` / `onStop` 生命周期主动执行 `CookieManager.getInstance().flush()`，确保手机锁屏、切后台甚至划掉进程重开后依然保持已登录状态，无需重复输密码。
   - 内置原生 `ConnectivityManager` 网络监听与暗色重连遮罩：无网启动或中途断网时绝不暴露系统原始英文报错页，网络恢复瞬间自动重连恢复工作台。
3. **原生线性马达震动桥接（`YJAndroidNative`）**：
   - 原生层注入窄接口 `window.YJAndroidNative.vibrateWaveform(patternCsv, amplitude)`，调用安卓 `VibratorManager` / `VibrationEffect.createWaveform` 输出精细振幅震动；前端 `src/spring/tactileSymphony.ts` 优先走原生桥接，兼容所有限制网页 `navigator.vibrate` 的国产安卓定制系统（HyperOS / ColorOS / OriginOS / HarmonyOS）。
4. **反逆向与防抓包加固**：
   - 正式包强制 `debuggable = false`、`allowBackup = false`，且显式锁死 `WebView.setWebContentsDebuggingEnabled(false)`，禁止通过数据线连接电脑 `chrome://inspect` 调试页面。
   - APK 只允许加载受信任同源域名 `jisuanqi.yjty.io`（外部链接一律拦截），且签名密钥库（`data/android-release.keystore`）严格置于 `.gitignore` 保护目录，严禁入库。
5. **服务端防爬白名单兼容**：
   - 安卓端 User-Agent 追加受控标识，确保 `server/securityShield.mjs` 100% 识别为合法真实客户端，绝不误判为爬虫假壳。

## 3. 验收标准（Acceptance Criteria）

- [ ] `pnpm test` 覆盖安卓 WebView User-Agent 放行校验与原生震动桥接单元测试并 100% 通过。
- [ ] `pnpm build` 通过零明文混淆校验并同步更新线上前端桥接。
- [ ] Gradle `assembleRelease` 产出正式 V2/V3 签名 APK（`apksigner verify` 校验通过，且 APK 内不含任何源码密钥）。
- [ ] 双子代理平行 `code-review`（Standards & Security + Spec 0004 Fidelity）零阻断项通过。
- [ ] 通过 `gh release create v2.0.0` 将签名 APK 上传至 GitHub Releases，校验仓库后台 Releases 页面可直接看到并下载该 `.apk` 文件。
