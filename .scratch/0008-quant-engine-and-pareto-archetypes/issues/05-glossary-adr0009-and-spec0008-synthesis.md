# GLOSSARY 术语焕新、ADR-0009 立档与 Spec 0008 契约合龙

Label: `wayfinder:grilling`
Type: `grilling`
Status: `resolved`
Blocked by: 01, 02, 03, 04

## Question

确认第四席「错价雷达」在水位刷新后洼地消失时的状态流转、四席标准枚举键、`ADR-0009` 立档、性能上界及 `Spec 0008` 三大高层公开测试接缝。

## Answer

用户已拍板采纳全部推荐方案：
1. **水位刷新洼地消失降级流转**：未套用时就地刷新为 `¥0` 空仓省钱态；若此前已带 `snapshotPlan` 套用挂载，保留实票按最新实盘水位重算派奖与 `EV`，并在审单台防坑雷达顶部插入「⚠️ 原跨盘错价洼地已被官方最新调水抚平，建议还原等倍或改选前 3 档主方案」高优预警；未带 `snapshotPlan` 直接请求空仓态时安全回退 `manualReport`。
2. **标准枚举键与架构立档**：四席键值锁定为 `'max-profit-prob' | 'max-ev-utility' | 'max-cvar-wheel' | 'alpha-radar'`（服务端透明兼容旧五流派键值）；立档 `docs/adr/0009-shin-dixon-coles-coherent-calibration-and-pareto-3plus1-portfolio.md`；8 场满额选单工作区单次精算耗时硬门禁 `< 15ms`（常规 `< 8ms`）。
3. **锁定 A / B / C 三道高层公开测试接缝**并正式生成 `docs/specs/0008-coherent-quant-and-pareto-portfolio.md`。
