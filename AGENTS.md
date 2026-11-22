# AGENTS.md · 优竞体育内部专用工程宪章

本仓库承载 **「优竞体育内部专用」** 竞彩足球精算与风控工作台（线上生产环境 `https://jisuanqi.yjty.io`，含 Web 双端自适应工作台与安卓原生伴侣端 `io.yjty.jisuanqi`）。所有功能演进、精算调整与缺陷修复均按以下导航指针与五步流水线执行。

## 一、上下文导航指针（Context Pointers）

动手评估或修改代码前，按触发条件读取权威单一事实源：

- **既有功能、协议与遗留边界** → 先读 GitHub Spec Issues（见 `docs/agents/issue-tracker.md`）与历史归档 `docs/specs/0000-baseline-spec.md`、`docs/specs/0011..0013-*.md`。
- **业务命名、界面文案与测试标题** → 先读 `GLOSSARY.md` 采用标准术语，避开 `_Avoid_` 同义词。
- **架构权衡（ADR `0001`~`0017` 索引）、深模块锚点导航与测试导入约定** → 先读 `docs/agents/domain.md` 定位对应 `docs/adr/NNNN-*.md` 及模块符号锚点；方案与既有 ADR 冲突时先向用户显式指出并确认。
- **保密口径、入参上界、法定算奖与审查细则** → 审查或触及服务端接口/双端排版时，读根部 `CODING_STANDARDS.md`。
- **Web 双视口实机核验与线上巡检** → 启动浏览器前，读 `docs/ops/qa-ego-browser.md`。

## 二、强制 `matt-pocock` 五步开发流水线

每次变更按序推进，前一步达成**完成判据**后进入下一步：

1. **需求深烤、领域建模与契约落盘（`wayfinder` / `grilling` + `domain-modeling` → `to-spec`）**
   - 跨会话复杂需求先跑 `wayfinder` 建图消雾；单会话增量需求联合执行 `grilling` 与 `domain-modeling` 确认全部分支，同步更新 `GLOSSARY.md`、`docs/adr/` 与 `docs/specs/NNNN-*.md`。
   - **完成判据**：设计树零未决分支，用户已确认共享理解，规范文档落盘。
2. **深模块与服务端黑盒边界设计（`codebase-design`）**
   - 算奖、去水、五池闭合校准与 `3+1 精算配单` 归属零 I/O 纯内存 `server/quantEngine.mjs`（及 `server/quant/*`）；数据源、鉴权风控、权威快照封存、铁笼问答与小高路由归属 `server/{runtimeApp,appRoutes,securityShield,ledgerManager,accountManager,manualQaEngine,xiaogaoCore,sportteryFeed}.mjs`；客户端 `src/` 与 `android/` 保持薄状态与纯渲染视图，通过 `createYouJingRuntime`、`createWorkbenchController` 与 `createBetSlipController` 暴露可注入时钟/存储/网络桩的测试接缝。
   - **完成判据**：`pnpm run check:guardrails` 通过（零客户端算术泄露、零厂商名外泄、零敏感路径跟踪）。
3. **测试驱动红绿循环（`tdd` / `diagnosing-bugs`）**
   - 在 `tests/*.test.ts` 围绕公开模块接缝先写覆盖正常路径、体彩法定极值与恶意入参的失败测试（_red_），再编写最小完备实现转绿（_green_）并重构。
   - **完成判据**：`pnpm typecheck && pnpm test` 100% 通过，目标 Spec 每条验收项均有断言锁死。
4. **零泄露生产构建与全量 AST 混淆门禁**
   - 运行 `pnpm build`（串联 `tsc -b`、`vite build` 与 `scripts/obfuscate-dist.mjs` RC4 混淆及产物门禁）。
   - **完成判据**：`pnpm build` 退出码为 `0`（内置门禁自动断言 `dist/` 零 `.map` 文件且 `dist/assets/*.js` 零明文中文字符）。
5. **双轴平行子代理交叉审查（`code-review`）与实机核验**
   - 派生两个只读子代理分别对照 `CODING_STANDARDS.md`（Axis 1）与目标 `docs/specs/NNNN-*.md`（Axis 2）平行审查变更；涉及界面改动时按 `docs/ops/qa-ego-browser.md` 完成桌面端（`>= 960px`）与移动端（`< 960px`）核验并调用 `task.finish(...)` 收尾。
   - **完成判据**：双轴审查零阻断项，`pnpm run check:guardrails && pnpm test && pnpm build` 全绿。

## 三、核心不可逾越底线

- **唯一角色与零外泄口径**：品牌固定为 **「优竞体育内部专用」**，排雷参谋固定为 **「扫地僧小高」**，问答助手固定为 **「内部说明书助手」**；全栈禁绝底层模型厂商名与 `"零风险"` 夸大文案；`data/`、`.env*`、`*.keystore` 严禁入库（`CODING_STANDARDS.md` §1–3）。

## Agent skills

### Issue tracker

GitHub Issues (`w343153618/youjing-football-calculator` via `gh` CLI; historical specs `0000`–`0013` archived in `docs/specs/`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role triage vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`GLOSSARY.md` + `docs/adr/0001..0017` + module symbol anchors). See `docs/agents/domain.md`.
