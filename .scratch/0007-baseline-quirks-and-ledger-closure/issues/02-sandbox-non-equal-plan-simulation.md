# 02: 推演沙盒与不等倍智能分倍方案（三模优化 / 五流派）无损联动

**What to build:**
使「主观胜率信心微调滑块（`-15% ~ +20%`）」与「模拟首场延期/腰斩（按水位 `1.0` 算）」在用户已启用三模奖金优化或套用五流派不等倍方案时不再静默退回等倍 `manualReport`，而是固定当前不等倍各实票倍数结构不变，实时重算每张实票在腰斩/信心偏移下的法定舍入单倍奖金、单注封顶截断、假中奖状态与精确线性数学期望回报率 `EV`。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 在 `evaluateQuantWorkspace` 中，当 `planSpec` 为 `bonus` 或 `archetype` 时，先基于未腰斩、`0%` 偏移的基准盘口生成确定性不等倍实票行倍数，再将 `simVoidFirstMatch`（首场赔率置 `1.0`）与 `subjectiveDeltaPct`（单腿概率按 `1 + delta/100` 缩放并夹逼 `[0.02, 0.96]`）作用于该不等倍方案的每条实票行。
- [ ] `archetypeToReport` 与 `appliedPlan` 精确重算每行的 `unitPayout`（遵循 `GB/T 8170` 四舍六入五成双与对应关数 `10万/20万/50万/100万` 法定单注封顶）、真实 `cappedClipped`（超封顶截断总额，触发封顶警告）、`returnPayout`、`netProfit`、`isUnderwater`，并按线性期望精确计算 `expectedValueRate` 与 `subjectiveEVPct`（替代原先写死的 `-vigPct/100` 近似）。
- [ ] 在 `tests/baselineQuirks0007.test.ts` 通过 TDD 新增断言验证：启用博热保本或五流派后拉动信心滑块至 `+15%` 及开启首场腰斩时，`effectiveReport` 保持分倍模式且 `EV`、保底派奖与封顶截断精确响应变化，既有全量测试 100% 通过。
