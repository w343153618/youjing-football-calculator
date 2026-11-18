# Spec 0006 · 架构深化：选单工作区深模块、统一加密路由网关与小高服务端上下文内聚

- **状态**：Completed & Verified
- **关联 ADR**：`docs/adr/0002`, `docs/adr/0005`, `docs/adr/0007`, `docs/adr/0008`
- **目标版本**：`v2.2.0`

## 1. 背景与目标

基于 `/improve-codebase-architecture` 扫描结论，在不改变任何用户可见界面布局、视觉皮肤、弹簧触觉反馈及中国体彩法定算奖行为的前提下，深化三处高摩擦架构接缝：
1. 将耦合在 `src/mobile/SkinPhoneApp.tsx` 中的选单工作区状态转换逻辑收敛为独立可测深模块 `src/workspace/betSlipController.ts`，消除生产未调用的测试孤立函数与前后端重复预设代码；
2. 将 `server/index.mjs` 与 `vite.config.ts` 的重复装配收拢至 `server/runtimeApp.mjs`，并将 `server/securityShield.mjs` 内 9 条加密 POST 路由的拆封验签、鉴权与回封流程收敛为统一路由管线；
3. 删除浅层包装模块 `src/intel/xiaogaoClient.ts`，将「扫地僧小高」单场点诊与多场联合串关会诊的盘口摘要构建逻辑全部收回服务端黑盒。

## 2. 功能契约与架构不变量

### 2.1 选单工作区深模块（`src/workspace/betSlipController.ts`）
- **窄接口契约（`createBetSlipController`）**：
  - 接收注入式工作区计算适配器 `computeWorkspace(params, matches)`（生产环境注入加密 HTTP 请求适配器，自动化测试注入内存 `evaluateQuantWorkspace` 适配器）及可选调度延迟 `debounceMs`（生产默认 `18ms`，测试可传 `0` 同步验证）。
  - 统一管理并暴露选单工作区状态：`matches`、`picks`、`mode`、`multiple`（`1~999` 整数夹逼）、`passSpec`、`planSpec`、`subjectiveDeltaPct`、`simVoidFirstMatch`、`targetIds`、`anchorToRadarPicks`、`syncedRadarSig`、`budget`、`stance`、`unlockFullAgg`、`workspace`。
  - 提供语义动作接口并返回明确的结果判定（供视图层决定触发何种弹簧动画、震动与提示文案）：
    1. `isPicked(matchId, poolCode, optionKey)` 与 `isPoolMutexLocked(match, poolCode)`；
    2. `togglePick(match, poolCode, optionKey)`：完整执行未开售拦截、同场单一玩法互斥、胜平负/单关页签下全单双单关自动锁定 `passSizes: [1]`、超 8 场全单关自动锁定 `passSizes: [1]`、超 8 场非单关拦截及超 15 场上限拦截；
    3. `setMode(nextMode)`：从 `spf` / `single` 切往其他模式时自动裁剪同场跨玩法多余项并重置过关规格；
    4. `setDirectMultiple(nextRaw)`、`stepMultiple(delta)`、`clearPicks()`、`toggleFreePassSize(size)`、`selectComboPass(code)`；
    5. `applyBonusOptimization(optMode)`、`applyArchetype(plan)`、`restoreEqualMultiple()`、`scaleAppliedPlanBy(factor)`、`applyEquivalentSwap(arb)`；
    6. `syncRadarPicksToArchetypes()`、`toggleTargetMatch(matchId)`、`loadPresetScenario(kind)`、`applyAuthenticatedBundle(bundle)`、`applyMatchesSync(res)`、`applyMatchAiAlert(matchId, alert)`、`applyComboAiReport(rep)`。
- **保密与算术边界铁律**：
  - `src/`（含 `src/workspace/betSlipController.ts`）内**严禁**实现任何 `四舍六入五成双`、单注封顶、去水概率、状态空间串关枚举、三模奖金优化或五流派注数分配公式；
  - 移除 `server/quantEngine.mjs` 中未被生产代码调用的 `validateSportteryPickToggle` 与重复的 `makeUnderwaterDemoPicks`，移除 `src/mobile/SkinPhoneApp.tsx` 中的重复 `makeUnderwaterDemoPicks`。

### 2.2 统一服务端运行时装配与加密信封路由管线（`server/runtimeApp.mjs` + `server/securityShield.mjs`）
- **统一装配模块 `server/runtimeApp.mjs`**：
  - 导出 `createYouJingRuntime(opts)`，集中组装 `xiaogaoService`、`accountManager`、`manualQaEngine` 与 `gateway`，支持注入自定义数据目录/文件路径、时钟函数、传输桩与 API 密钥获取函数。
  - `server/index.mjs` 与 `vite.config.ts` 统一通过 `createYouJingRuntime` 完成服务挂载，消除重复装配代码。
- **统一加密 POST 管线（`server/securityShield.mjs`）**：
  - 抽取统一的加密请求处理辅助管线（涵盖请求体大小限制读取、`verifyAndUnseal` 防重放与端到端签名校验、可选登录会话校验 `requireAuth`、可选超管角色校验 `requireSuperAdmin`、自动 `encryptEnvelope` 封装与统一网关异常映射），驱动 `/api/auth/login`、`/api/auth/logout`、`/api/manual/ask`、`/api/admin/*`、`/api/quant/compute`、`/api/quant/sync`、`/api/xiaogao/analyze`、`/api/xiaogao/analyze-combo`。
  - 原有 48 小时整机熔断天平、爬虫静默诱饵页、重放攻击熔断及说明书违规超 4 次锁号熔断行为 100% 保持不变。

### 2.3 「扫地僧小高」诊盘上下文服务端内聚（移除 `src/intel/xiaogaoClient.ts`）
- **删除浅包装模块**：删除 `src/intel/xiaogaoClient.ts`；在 `src/security/secureClient.ts` 中提供极简加密调用入口：
  - `requestXiaoGaoDiagnosis(matchId, userNote?)`：仅向 `/api/xiaogao/analyze` 发送 `{ matchId, userNote }`；
  - `requestXiaoGaoComboDiagnosis({ sourceMode, matchIds, picks, multiple, passSpec, planSpec, userNote })`：仅向 `/api/xiaogao/analyze-combo` 发送结构化选单标识与备注，不在前端拼接任何盘口抽水、真率或订单文案。
- **服务端权威上下文组装**：
  - `/api/xiaogao/analyze` 与 `/api/xiaogao/analyze-combo` 在服务端直接从权威在售赛事快照（`sessionMatches`）与 `evaluateQuantWorkspace` 计算结果中提取主让盘水位、红升绿降异动、抽水结构、泊松预期进球（xG）、一球卡盘占比及整单真实赚钱率摘要，再交由 `xiaogaoService` 执行主备自愈诊盘（`xiaogaoCore.mjs` 同时兼容直接传入已格式化字段的既有调用）。

## 3. 验收清单（Acceptance Criteria）

- [x] **AC-1**：`createBetSlipController` 注入内存 `evaluateQuantWorkspace` 适配器后，完整通过同场单一玩法互斥、双单关自动锁定 `passSizes: [1]`、超 8 场全单关自动锁定、超 15 场拦截、玩法切换自动裁剪、常驻过关/倍数调配、五流派选队锚定同步及 4 种预设演示场景的端到端测试。
- [x] **AC-2**：`server/quantEngine.mjs` 中已移除未被生产调用的 `validateSportteryPickToggle` 与重复的 `makeUnderwaterDemoPicks`；`src/` 目录零核心算奖与概率公式实现。
- [x] **AC-3**：`createYouJingRuntime` 同时支撑 `server/index.mjs`、`vite.config.ts` 与全栈网关测试，全部加密接口、RBAC 超管鉴权与 48h 整机熔断测试 100% 通过。
- [x] **AC-4**：`src/intel/xiaogaoClient.ts` 已彻底删除；客户端调用 `/api/xiaogao/analyze` 与 `/api/xiaogao/analyze-combo` 仅传结构化 ID/选单与备注，服务端基于权威盘口自动组装完整诊盘提示上下文并回写会话级 `aiAlerts`。
- [x] **AC-5**：`pnpm test` 100% 全绿；`pnpm build` 退出码为 `0`，`dist/` 下 `.map` 文件数为 `0`，`dist/assets/*.js` 明文中文字符数为 `0`；双轴 `/code-review` 无阻断问题，线上 `https://jisuanqi.yjty.io` 实机桌面端与移动端核验正常。
