# 界面导航重构、审单组合展示拆分与旧方案兼容契约

Label: `wayfinder:grilling`
Type: `grilling`
Status: `resolved`
Blocked by: None

## Question

需要确认双端入口命名、审单台对多票重叠方案的双层拆分、单场底牌新增信息及旧枚举向后兼容策略。

## Answer

用户已拍板采纳全部推荐方案：
1. **全端统一焕新为「精算配单」**：手机底栏第 2 页签、桌面端右栏主签（`🎯 3+1 精算配单`）、8 皮肤墙动作签及图文说明书/铁笼问答知识库同步焕新；四席分段器定名为 `稳健保本 | 期望效用 | 容错缩水 | 错价雷达`（无洼地时显示 `错价雷达·空仓`）；单场底牌抽屉新增展示校准后的进球节奏相关性（防守死锁 / 均衡 / 开放对攻）与跨盘洼地扫描结论。
2. **审单台与三模优化统一确立「物理实票 `tickets` + 互斥赛果 `combos`」双层架构**：`tickets` / `appliedPlan.lines` 保持对应体彩店打印的物理实票清单（严守同票单场单玩法与 99 倍拆票）；`combos` 统一由联合状态空间 $\Omega$ 聚合出严格互斥的中奖赛果场景（供五维透视舱、动态奖金天平柱状图与盈亏明细使用），审单台「三模奖金优化」一并接入同一状态空间评估核。
3. **平滑向后兼容**：`QuantWorkspaceResponse` 同时提供 `portfolioPlans` 与同指向兼容字段 `fivePlans`，服务端对旧枚举键（`iron-shield`、`spear-shield`、`fault-tolerant`、`value-assassin` 及带快照的 `goal-structure`）提供透明兼容映射；账本历史记录天然 100% 免迁移兼容。
