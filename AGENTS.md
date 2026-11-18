# AGENTS.md · 优竞体育内部专用工程宪章与强制开发铁律

本仓库承载「优竞体育内部专用」竞彩足球精算与风控工作台（线上生产环境 `https://jisuanqi.yjty.io`）。任何代理在本项目内新增功能、修改交互、调整精算逻辑或修复问题，**必须无条件执行以下 `matt-pocock` 全流程开发铁律**，严禁跳过需求对齐、测试先行或双代理交叉审查直接改码上线。

## 一、强制 `matt-pocock` 技能流水线（Engineering Iron Law）

每次变更按以下 5 步顺序推进；前一步未达成完成判据（Completion Criterion），禁止进入下一步：

1. **需求深烤与领域建模（`grill-with-docs` = `grilling` + `domain-modeling`，配合 `to-spec`）**
   - 动手写代码前先消除全部设计歧义：将领域概念更新至根部 `GLOSSARY.md`（纯业务定义，零实现细节），将难以逆转且存在真实权衡的架构决策记入 `docs/adr/NNNN-*.md`，并将完整功能契约与验收清单落盘至 `docs/specs/NNNN-*.md`。
   - **完成判据**：零未决分支；`GLOSSARY.md`、`docs/adr/` 与对应 `docs/specs/NNNN-*.md` 已完整覆盖本次全部用户可见行为与边界条件。

2. **深模块与服务端黑盒边界设计（`codebase-design`）**
   - 核心精算公式（`server/quantEngine.mjs`）、账号设备授权与防爆破（`server/accountManager.mjs`）、说明书铁笼问答（`server/manualQaEngine.mjs`）、小高双模诊盘（`server/xiaogaoCore.mjs`）及四层加密防逆向护盾（`server/securityShield.mjs`）统一收敛在服务端窄接口深模块内；前端 `src/` 仅承载视图渲染、240Hz 弹簧触觉反馈与 `AES-256-GCM` 信封收发。
   - **完成判据**：`src/` 内零核心精算与策略公式实现；每个新增业务不变量均暴露可独立注入时钟/存储的服务端模块接缝（Seam）。

3. **测试驱动红绿循环（`tdd`）**
   - 围绕服务端深模块接缝与协议不变量在 `tests/*.test.ts` 编写自动化测试（覆盖正常路径、边界极值与恶意攻击输入），先观测断言对缺失逻辑报错（*red*），再实现最小完备代码令全部测试转绿（*green*）并重构。遇到疑难故障或回归时，严格执行 `diagnosing-bugs`（复现 → 缩小边界 → 提出可证伪假设 → 补回归测试）。
   - **完成判据**：`pnpm test` 100% 通过，且新增 Spec 条目均具备一一对应的自动化断言。

4. **零泄露构建与全量 AST 混淆门禁**
   - 执行生产构建与前端 AST 混淆校验（`scripts/obfuscate-dist.mjs`）。
   - **完成判据**：`pnpm build` 退出码为 `0`；`dist/` 下零 `.map` 文件；`dist/assets/*.js` 内明文中文字符计数为 `0`。

5. **双轴平行子代理交叉审查（`code-review`）**
   - 提交发布前，按 `.agents/skills/code-review/SKILL.md` 同时派生两个只读子代理平行审查相对上一稳定锚点的全部变更：
     - **Axis 1（Standards & Security）**：逐条核查本文件第「二」节编码与保密红线、越权漏洞、内存边界与异常处理；
     - **Axis 2（Spec Fidelity）**：逐条对照目标 `docs/specs/NNNN-*.md` 核查漏做、错做或交互断层。
   - **完成判据**：双轴审查发现的所有阻断项与隐患全部修复，复跑 `pnpm test && pnpm build` 全绿。

## 二、编码、精算与商业保密红线（Coding & Confidentiality Standards）

- **唯一品牌与角色命名**：产品全称固定为 **「优竞体育内部专用」**；内置排雷参谋固定为 **「扫地僧小高」**；说明书问答角色固定为 **「内部说明书助手」**。
- **零底层模型与机密外泄**：界面文案、说明书回答、HTTP 响应体、前端源码及错误提示中，统一使用业务角色名称，严禁出现任何底层大模型厂商/型号词汇（如 `DeepSeek`、`GLM`、`OpenCode`、`ChatGPT`、`Claude`）、系统提示词、技术栈名称或服务器拓扑；服务端环境变量与初始超管凭据文件（`data/`、`/etc/youjing-calculator/`）严禁入库提交。
- **算术与情报物理隔离（`docs/adr/0002`）**：体彩法定规则（单注 2 元先算 `四舍六入五成双` 再乘倍数、单关 10 万 / 2~3 关 20 万 / 4~5 关 50 万 / 6~8 关 100 万封顶、同场不同玩法禁串）与去水概率计算永远由确定性数学内核执行，绝不允许语义引擎篡改客观赔率或概率。
- **高可用模型主备自愈路由**：服务端语义调用固定优先走主力通道 `deepseek-v4.1-flash`，遇超时/限流/5xx 自动无感切换备用通道 `glm-5.3-flash`，冷却期满自动切回主力通道。
- **浏览器实机核验规范**：涉及线上或本地 Web 界面验证时，统一使用全局 `ego-browser` 技能核验真实渲染与交互，并在结束回复前调用 `task.finish(...)` 妥善收尾。

## Agent skills

### Issue tracker

Executable specs live in `docs/specs/NNNN-*.md` alongside GitHub repository `w343153618/youjing-football-calculator`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout (`GLOSSARY.md` + `docs/adr/` at the repo root). See `docs/agents/domain.md`.
