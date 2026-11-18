# 0008. 选单工作区深模块接缝、统一服务端装配与小高服务端上下文内聚架构

Date: 2026-11-19

## Status

Accepted

## Context

随着 `v2.1.0` 落地体彩法定选号互斥、双单关自动锁定、常驻过关/倍数投控栏与五流派选队同步锚定，架构体检（`/improve-codebase-architecture`）暴露出三处高摩擦浅层耦合：
1. `src/mobile/SkinPhoneApp.tsx` 膨胀至 4,548 行，30 余个视图与交互状态钩子直接混写，导致「同场单一玩法互斥」「双单关自动锁定」「玩法切换裁剪」等核心交互状态无法脱离 DOM 独立测试；同时 `server/quantEngine.mjs` 中的 `validateSportteryPickToggle` 仅被单元测试调用而未接入真实点选链路，`makeUnderwaterDemoPicks` 在前后端各维护一份副本。
2. `server/index.mjs` 与 `vite.config.ts` 各自重复编写一套四模块服务装配代码，`server/securityShield.mjs` 内的 9 条加密 POST 路由各自重复编写读取请求体、AES-256-GCM + HMAC 拆封验签、会话鉴权与回包加密样板。
3. `src/intel/xiaogaoClient.ts` 在浏览器端拼接抽水率、真实隐含概率与一球小胜卡盘占比等语义上下文字符串后再发往服务端，属于未通过删除测试（Deletion Test）的浅层包装模块，且使本应归属服务端的诊盘上下文逻辑跨网络接缝外溢。

## Decision

1. **提炼选单工作区状态深模块（`src/workspace/betSlipController.ts`）并严守服务端算术黑盒**：将选号互斥门禁、双单关/超 8 场自动锁单关、过关规格切换、1~999 倍调配、五流派选队锚定、实盘刷新选号对齐及预设演示场景收拢至单一无 DOM 依赖的状态模块。该模块**严禁包含任何奖金舍入、去水概率、三模分倍或五流派生成数学公式**，底部通过注入式工作区计算接缝（生产环境注入加密 HTTP 适配器，测试环境注入内存 `evaluateQuantWorkspace` 适配器）驱动全部精算结果；清理生产未调用的孤立函数与重复预设副本。
2. **统一服务端运行时装配（`server/runtimeApp.mjs`）与声明式加密信封路由管线**：由单一运行时模块统一组装账号管理、说明书铁笼、扫地僧小高与安全精算网关，供 Node 生产入口与 Vite 开发中间件共同挂载；在 `securityShield.mjs` 内将重复的拆封验签、登录角色校验与加密回包收敛为统一管线函数。
3. **扫地僧小高诊盘上下文收回服务端并移除前端浅包装（删除 `src/intel/xiaogaoClient.ts`）**：客户端仅发送加密的 `matchId`、已选方案标识与用户补充备注；服务端直接依据权威在售赛事快照与精算结果构建单场及多场串关诊盘上下文。

## Consequences

- **正面收益**：4,548 行界面组件退化为纯粹的视图渲染与弹簧触觉反馈层；所有体彩选号互斥与投控栏交互均可通过单一窄接口在毫秒级内存测试中端到端锁死；开发服与生产服 100% 同源装配；前端包体积进一步缩小且彻底消除诊盘提示词片段拼接。
- **代价与约束**：`tests/sportteryRulesPassAndSync.test.ts` 中原先针对孤立辅助函数 `validateSportteryPickToggle` 的断言须迁移至真实的 `createBetSlipController` 公共接口上，以贯彻“接口即测试面（The interface is the test surface）”。
