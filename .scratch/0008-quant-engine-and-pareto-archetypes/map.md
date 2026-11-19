# 精算预测底座与 3+1 帕累托智能配单科学化重构决策地图（Spec 0008）

Label: `wayfinder:map`

## Destination

完成 `GLOSSARY.md` 术语焕新、必要的架构决策记录（`ADR-0009` 及对 `ADR-0007` 的衔接说明），并产出零未决分支、可直接交付子代理执行与双轴审查的增量可执行规范 `docs/specs/0008-coherent-quant-and-pareto-portfolio.md`（Status: `ready-for-agent`）。

## Notes

- **领域与权威锚点**：严格遵循 `AGENTS.md` 五步开发铁律、商业保密红线（全链路零底层大模型字样外泄）与 `GLOSSARY.md` 标准术语；基线参照 `docs/specs/0000-baseline-spec.md` 与 `docs/specs/0007-baseline-quirks-and-ledger-closure.md`；数学依据锚定 `docs/research/0001`、`0002`、`0003` 三份交叉核验报告。
- **核心必调技能**：每轮消雾与术语收敛联合遵循 `grilling` + `domain-modeling`；模块边界设计遵循 `codebase-design`（严守 `ADR-0008`：前端 `src/` 与 `android/` 零精算数学公式，100% 收敛于服务端黑盒）。
- **唯一最高准则**：功利客观，拒绝迎合人类主观手感；废除一切拍脑袋经验常数（`shieldOnly: 0.04`、硬编码比分/半全场剧本、非互斥注单概率直接相加、未重归一化的倾向乘数、同场双单关固定净胜球权重），一切推荐由校准概率论与联合状态空间离散最优化严格导出。

## Decisions so far

- [五池联合闭合概率核与主观偏移重归一化策略](./issues/01-coherent-probability-core-and-stance-semantics.md): 全局 `fairProb` 统一收敛为 `Shin/Power` + 四参数 `Dixon-Coles` 二项半场五池闭合概率 $P_{\text{DC}}$（替代 `Spec 0007` 分段卡盘补丁与双单关写死权重），三档倾向与信心滑块全部在底层状态空间保序重归一化至总和 `1.000000`。
- [3+1 帕累托主轴裁剪边界与跨盘真错价雷达门禁](./issues/02-pareto-3plus1-solver-and-alpha-gate.md): 第四席采用经验贝叶斯收缩后跑赢主盘返还率 `>= +3.0%` 的门禁（区分绝对 `+EV` 与跨盘低抽水洼地，无洼地严格 `¥0` 空仓）；第二席在纯客观下主动裁剪 `<= 1.45` 累赘腿、锚定下保留并预警；第三席融合 $C(v,k,t)$ 旋转矩阵与 `M串N`，独立实票上限 `10 张`。
- [界面导航重构、审单组合展示拆分与旧方案兼容契约](./issues/03-ui-taxonomy-audit-display-and-compatibility.md): 全端焕新为「精算配单（`稳健保本 / 期望效用 / 容错缩水 / 错价雷达`）」，单场底牌新增节奏相关性与洼地扫描，审单台与三模优化统一拆分为物理实票 `tickets` 与联合状态空间互斥事件 `combos`，服务端保持旧字段与旧枚举兼容。
- [四层科学验证基准数据源与帕累托支配判据](./issues/04-four-layer-benchmark-fixtures-and-pareto-criteria.md): 内置 `tests/fixtures/` 版本化真实完场离线样本与账本序列，在单位本金化四维目标空间执行 10,000 次固定种子蒙特卡洛帕累托检验，同时纳入 `pnpm test` 强制门禁与 `pnpm bench:quant` 报表命令。
- [GLOSSARY 术语焕新、ADR-0009 立档与 Spec 0008 契约合龙](./issues/05-glossary-adr0009-and-spec0008-synthesis.md): 敲定水位刷新后已套用错价方案的保结构重算+抚平预警策略、四席标准枚举键、`< 15ms` 耗时上限、`ADR-0009` 立档及 A/B/C 三道高层测试接缝，全图消雾完毕。

## Not yet specified

<!-- 全图已消雾完毕，所有分支均已落入 Spec 0008 -->

## Out of scope

- 引入外部历史赛果数据库、球队动态评级（Elo / Pi-ratings）离线爬虫重训管线或外部博彩公司参考赔率源（保持 100% 零历史库依赖，纯中国体彩实时五池水位快照驱动）。
- 允许「扫地僧小高」语义推理结果直接篡改客观去水概率、Dixon-Coles 校准参数或自动改写注单倍数（严守 `ADR-0002` 算术与情报物理隔离）。
- 修改中国体彩法定计奖与选号红线（单注 2 元 `BigInt` 四舍六入五成双、10/20/50/100 万四档封顶、同场单一玩法串关互斥、`HAD/HHAD:8 / TTG:6 / HAFU&CRS:4` 关数上限、单次订单 `> ¥20,000` 硬拦截）、48 小时硬件指纹熔断（`ADR-0005`）或主备语义通道配置。
- 真钱充值代购出票或自动联网抓取赛果结算双轨账本。
