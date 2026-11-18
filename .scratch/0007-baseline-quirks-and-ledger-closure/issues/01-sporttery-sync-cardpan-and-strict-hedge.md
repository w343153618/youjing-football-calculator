# 01: 实盘解析去演示污染、深盘一球卡盘率精确化与严谨早晚场锁利

**What to build:**
消除体彩实盘解析中的内置演示预警撞名污染与陈旧兜底提示文案；让单场微观精算在 `-2 / +2` 等非一球让球线下改用 31 项比分（`CRS`）去水概率精确计算热门方净胜 1 球占比并统一 `50%` 警示阈值；收紧早晚场时间差对冲锁利门禁，要求全部前序场次均在末场开球前 `>= 110` 分钟开赛且末场选号具备 100% 无死角互补反向盘。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `parseSportteryRawJson` 解析场次编号与内置演示数据相同（如 `周二002`）的体彩实盘 JSON 时，产出赛事 `aiAlert` 为空，绝不混入内置硬编码预警；`fetchOfficialMatchesServer` 内置兜底 `syncNote` 准确显示 8 场内置赛事。
- [x] `analyzeMatchMicroQuant` 在 `goalLine` 为 `-1 / +1` 且 `HHAD` 在售时保持原有让平比值法；当 `goalLine` 为 `-2 / +2` 等非 `±1` 线或 `HHAD` 停售时，依据 31 项 `CRS` 去水概率精确计算热门方净胜 1 球（主热 `1:0, 2:1, 3:2`；客热 `0:1, 1:2, 2:3`）占热门方总赢球概率的比例，且 `microBadges` 与 `cardPanTip` 统一在 `>= 50%` 时触发卡盘预警。
- [x] `computeProOrderInsights` 的早晚场时间差对冲锁利（`hedge`）仅在可出票串关、排序后倒数第 2 场与最后 1 场开球间隔 `>= 110` 分钟（杜绝 2 场晚场同时开踢误报），且末场已选项可通过 `HAD / HHAD` 构成严格互补无死角反向组合（支持单选胜/平/负、让球单选、同池双选，末场为总进球/比分/半全场局部项时返回 `available: false` 及清晰原因）时激活。
- [x] 在 `tests/baselineQuirks0007.test.ts` 按 TDD 红绿循环覆盖以上全部边界，且既有全量测试 100% 通过。
