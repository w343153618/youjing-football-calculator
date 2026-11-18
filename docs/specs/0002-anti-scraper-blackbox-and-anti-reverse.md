# Spec 0002 · 反 AI 读链抓取、核心策略服务端黑盒与高压防逆向加固（v1.2.0）

## 1. 威胁模型（Threat Model）
1. **AI 读链与页面克隆（Anti-Reader / Anti-Scraper）**：外部人员将 `https://jisuanqi.yjty.io` 粘贴至豆包（`Bytespider` / `Doubao`）、Kimi、ChatGPT、Claude、Perplexity、Jina Reader（`r.jina.ai`）、Firecrawl 或 `curl`/`python-requests` 让 AI 拆解界面、说明书与策略。
2. **同行扒取前端算法源码（Core IP Protection）**：五流派配单、三模奖金优化、泊松预期进球（xG）反推、一球卡盘温度计、四舍六入五成双与早晚场锁利等核心公式必须物理移出前端包。
3. **浏览器逆向调试与抓包重放（High-Pressure Anti-Reverse）**：通过 F12 开发者工具、右键查看源码、抓包重放或无头浏览器（Headless/WebDriver）批量探测接口。

## 2. 四层纵深防御架构（Defense-in-Depth）
1. **边缘反 Reader 迷魂阵与蜜罐封禁（`server/securityShield.mjs`）**：
   - `robots.txt` 全量屏蔽 60+ 主流 AI 爬虫与网页阅读器，并布置 `/internal-export-trap` 陷阱路径。
   - 命中豆包/字节/Jina/GPT/Claude/Scrapy/curl/无浏览器 `Sec-Fetch` 特征的文档请求，直接返回 `200 OK` 的「公开基础体育赛程时间与 3/1/0 积分统计表」静态假壳，令 AI 读链器完全无法感知真实精算产品。
   - 页面挂载隐藏 `aria-hidden` 陷阱锚点；爬虫一旦请求陷阱路由即触发 IP 熔断（30 分钟封禁）。
2. **核心策略全量上收服务端黑盒 + `AES-256-GCM` 动态信封（`server/quantEngine.mjs`）**：
   - 彻底移除前端中的全部精算公式实现，前端仅保留纯类型定义 `src/prototype/quantTypes.ts` 与加密通信层 `src/security/secureClient.ts`。
   - 启动时通过 `/api/security/bootstrap` 协商会话 `sid` 与 256-bit 会话密钥 `k`；业务请求体与响应体均使用 `AES-256-GCM` 密文封装，配合 `X-YJ-Ts`、`X-YJ-Nonce` 一次性防重放随机串与 `X-YJ-Sig`（`HMAC-SHA256`）签名，重放或篡改立即 `403` 熔断。
3. **前端全量 AST 代码混淆与脱敏（`scripts/obfuscate-dist.mjs`）**：
   - 关闭生产 SourceMap，清理皮肤 CSS 注释；对前端 JS 执行 `javascript-obfuscator`（十六进制重命名 + 字符串池抽取 + `RC4` 加密轮转 + 数字表达式变形）。
4. **浏览器端高压防逆向护盾（`src/security/antiReverseShield.ts`）**：
   - 拦截右键菜单、`F12`、`Ctrl+Shift+I/J/C`、`Cmd+Option+I/J/C`、`Ctrl+U`、`Ctrl+S` 及正文复制。
   - 多维调试器与无头环境探针（防缩放误伤的窗口突变检测 + `debugger` 暂停耗时探针 + 无头浏览器指纹检测）：一旦确认开启调试器或自动化抓取，立即调用 `/api/security/fuse` 熔断会话（15 分钟冷却封禁）并清空浏览器全部 DOM。
