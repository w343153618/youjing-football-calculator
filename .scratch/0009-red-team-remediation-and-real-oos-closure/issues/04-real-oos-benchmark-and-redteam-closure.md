# 04: 240+ 场中国体彩真实完场 OOS 盲测集、无偏四层科学基准与红队跨语言脚本全绿闭环

**What to build:** 修复 `D-03` 与 `D-09`：将原合成夹具重命名为 `syntheticCoherenceFixture.json` 仅作公理测试；采集并校验 240+ 场中国体彩官网完场五池实盘数据落盘为 `realSportteryOosMatches.json`；升级 `bench-quant.mjs`（序数池 `RPS`、全池 `Log-Loss / Brier` + 万次配对 Bootstrap、等质量分位 ECE、无筒仓蒙特卡洛、同规则净免损账本回放），并复跑红队独立 `audit1 ~ audit4` 脚本全部转绿。

**Blocked by:** 01, 02, 03

**Status:** resolved

- [x] `realSportteryOosMatches.json` 含 `>= 240` 场（实冻 `622` 场）真实中国体彩完场五池赛事，`0` 星期错位、`0` 比分赔率跳档违规
- [x] `pnpm run bench:quant` 与 `tests/quantScientificBenchmarks.test.ts` 在真实 OOS 集上通过万次配对 Bootstrap、无筒仓帕累托检验与同规则双轨回放
- [x] 复跑红队独立目录下的 `audit1_cross_lang.py`、`audit2_forensics_and_bootstrap.py`、`audit3_pathological_stress.mjs` 与 `audit4_portfolio_milp_and_fairness.py` 实证全项缺陷清零
