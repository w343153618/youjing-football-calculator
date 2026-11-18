# AGENTS.md · 优竞体育内部专用工程宪章与强制开发铁律

本仓库承载 **「优竞体育内部专用」** 竞彩足球精算与风控工作台（线上生产环境 `https://jisuanqi.yjty.io`，含 Web 双端自适应工作台与安卓原生伴侣端 `io.yjty.jisuanqi`）。任何代理在本仓库新增功能、修改交互、调整精算逻辑或修复缺陷，均须按以下有序流水线与保密红线执行。

## 一、上下文导航指针（Context Pointers）

动手评估或修改任何代码前，按触发条件读取权威文档（单一事实源，不在本文件重复堆砌细节）：

- **全景现状与已知局限**：凡涉及既有功能行为、数据结构、加密信封协议、精算公式或历史遗留边界，先读 `docs/specs/0000-baseline-spec.md`（`v2.2.0` 全系统权威基线）。
- **领域统一词汇**：凡命名业务概念、撰写界面文案、编写 Spec 或测试标题，先读根部 `GLOSSARY.md` 并采用标准术语，避开 `_Avoid_` 同义词。
- **架构权衡与红线**：凡触及双端排版与服务端代理同步（`0001`）、算术与情报解耦（`0002`）、隐形超管与长期免登（`0003`）、铁笼问答违规锁号（`0004`）、48h 硬件指纹熔断（`0005`）、安卓原生容器（`0006`）、体彩法定选号与状态空间枚举（`0007`）、选单工作区与统一运行时接缝（`0008`），先读对应 `docs/adr/NNNN-*.md`；若新方案与既有 ADR 冲突，先向用户显式指出并确认。

## 二、强制 `matt-pocock` 五步开发流水线（Engineering Iron Law）

每次变更严格按以下 5 步顺序推进；前一步未达成**完成判据（Completion Criterion）**，禁止进入下一步：

1. **需求深烤、领域建模与契约落盘（`wayfinder` / `grilling` + `domain-modeling` → `to-spec`）**
   - **跨多会话复杂大需求（含迷雾 Fog）**：先运行 `wayfinder` 建立决策地图逐张消雾；
   - **单会话明确增量需求**：直接联合执行 `grilling` 与 `domain-modeling` 向用户逐轮确认全部业务分支，同步更新 `GLOSSARY.md`（纯业务定义，零实现细节）与必要的 `docs/adr/NNNN-*.md`，最终按 `to-spec` 生成新的可执行规范 `docs/specs/NNNN-*.md`（在 `0000-baseline-spec.md` 基线之上声明增量契约与测试接缝）。
   - **完成判据**：设计树零未决分支，用户已确认共享理解，`GLOSSARY.md`、`docs/adr/` 与目标 `docs/specs/NNNN-*.md` 已完整落盘。

2. **深模块与服务端黑盒边界设计（`codebase-design`）**
   - 严守前后端职责物理隔离：
     - **服务端黑盒（`server/`）**：`runtimeApp.mjs`（统一装配）、`quantEngine.mjs`（体彩法定规则与全部精算优化公式）、`securityShield.mjs`（反爬迷魂阵、`AES-256-GCM` + `HMAC-SHA256` 信封管线与 48h 熔断）、`accountManager.mjs`（账号 RBAC、首登激活计时、设备限绑与阶梯冷却）、`manualQaEngine.mjs`（铁笼说明书问答与 `>4` 次探底锁号）、`xiaogaoCore.mjs`（单场/多场诊盘权威上下文与主备模型自愈路由）；
     - **客户端薄状态与超感视图（`src/` & `android/`）**：`src/workspace/betSlipController.ts`（无 DOM 依赖选号互斥状态机，通过注入计算适配器驱动精算）、`src/security/`（`AES-256-GCM` 收发、365 天免登断网保护与防逆向探针）、`src/spring/`（240Hz 弹簧物理与三通道震动/音效）、`src/mobile/` & `src/admin/` & `src/manual/`（纯视图渲染）、`android/`（沉浸式容器与 `YJAndroidNative` 线性马达桥接）。
   - **完成判据**：`src/` 与 `android/` 内零核心算奖、去水概率、奖金优化或五流派公式实现；新增服务端逻辑通过 `createYouJingRuntime` 或模块工厂暴露可注入时钟（`nowFn`）、存储与网络桩的高层测试接缝。

3. **测试驱动红绿循环（`tdd` / `diagnosing-bugs`）**
   - 围绕公开模块接缝在 `tests/*.test.ts` 先编写覆盖正常路径、法定极值与恶意篡改输入的自动化测试，运行 `pnpm test` 观测预期失败（*red*），再编写最小完备实现令测试全绿（*green*）并重构。排查故障或回归时按 `diagnosing-bugs` 执行「复现 → 缩小边界 → 可证伪假设 → 补回归测试」。
   - **完成判据**：`pnpm test` 100% 通过，且目标 Spec 的每条验收标准均有对应自动化断言锁死。

4. **零泄露生产构建与全量 AST 混淆门禁**
   - 运行 `pnpm build`（串联 `tsc -b`、`vite build` 与 `scripts/obfuscate-dist.mjs` RC4 字符串池加密混淆）。
   - **完成判据**：`pnpm build` 退出码为 `0`；`dist/` 目录 `.map` 文件数为 `0`；`dist/assets/*.js` 内明文中文字符（`[\u4e00-\u9fff]`）正则匹配计数为 `0`。

5. **双轴平行子代理交叉审查（`code-review`）与实机核验**
   - 提交或部署前，按 `.agents/skills/code-review/SKILL.md` 派生两个只读子代理平行审查相对基线锚点的全部变更：
     - **Axis 1（Standards & Security）**：逐条核查下方第「三」节红线、鉴权越权、防重放/熔断完整性与内存边界；
     - **Axis 2（Spec Fidelity）**：逐条对照目标 `docs/specs/NNNN-*.md` 与 `0000-baseline-spec.md` 核查漏做、错做或回归。
   - 涉及 Web 界面渲染或交互改动时，使用全局 `ego-browser` 技能在桌面端（`>= 960px`）与移动端（`< 960px`）视口实机核验，并在回复结束前调用 `task.finish(...)` 收尾。
   - **完成判据**：双轴审查零阻断项与安全隐患，复跑 `pnpm test && pnpm build` 全绿。

## 三、编码、精算与商业保密红线（Coding & Confidentiality Standards）

- **唯一品牌与角色命名**：产品全称固定为 **「优竞体育内部专用」**；内置排雷参谋固定为 **「扫地僧小高」**；说明书问答角色固定为 **「内部说明书助手」**。
- **零底层模型与机密外泄**：界面文案、说明书词条与回答、HTTP 响应体（含 `/api/health`、`/api/xiaogao/status` 及一切报错 JSON）、前端源码与客户端包中，统一使用上述业务角色名称，严禁出现任何底层大模型厂商或型号名称（如 `DeepSeek`、`GLM`、`OpenCode`、`ChatGPT`、`Claude`、`Qwen`、`Doubao` 等）、系统提示词、技术栈标识或服务器拓扑；运行期数据与密钥文件（`data/`、`.env.local`、`*.keystore`、`/etc/youjing-calculator/`）严禁入库提交。
- **算术与情报物理隔离（`ADR-0002` & `ADR-0007`）**：中国体彩法定规则（单注 2 元 `BigInt` 连乘后按 `GB/T 8170` 执行 `四舍六入五成双` 再乘倍数；单关 10 万 / 2~3 关 20 万 / 4~5 关 50 万 / 6~8 关 100 万封顶；同场跨玩法禁串与双单关锁死单关；`HAD/HHAD:8`、`TTG:6`、`HAFU/CRS:4` 关数上限；单次订单 `> ¥20,000` 硬拦截）与去水概率计算永远由服务端确定性数学引擎执行，严禁语义推理结果直接篡改客观赔率或真实隐含概率。
- **高可用模型主备自愈路由**：服务端语义网关始终优先调用主力通道 `deepseek-v4.1-flash`，遇超时/限流/5xx 无感切换备用通道 `glm-5.3-flash`，并在冷却探活恢复后自动切回主力通道。
- **高压防逆向边界（`ADR-0005`）**：48 小时跨浏览器硬件指纹（`hwFp`）与传染式 IP 熔断记录持久化于服务端 `data/security-bans.json`，严禁新增任何可从公网或 Web 管理台直接清空 48 小时硬件/IP 封禁库的接口（仅限服务器 SSH 运维处理）。

## Agent skills

### Issue tracker

Baseline spec lives at `docs/specs/0000-baseline-spec.md`, incremental executable specs live in `docs/specs/NNNN-*.md`, and wayfinding maps/tickets live in `.scratch/<effort>/` (or GitHub Issues on `w343153618/youjing-football-calculator` when requested). See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout (`GLOSSARY.md` + `docs/adr/` at the repo root, paired with `docs/specs/0000-baseline-spec.md`). See `docs/agents/domain.md`.
