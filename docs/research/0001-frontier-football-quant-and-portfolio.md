# 足球精算预测与注单组合优化前沿调研报告（开源社区 + 学术文献 + 现有内核审计）

- **调研日期**：2026-11-19
- **对标代码基线**：`server/quantEngine.mjs`（`v2.2.0` + `Spec 0007`）
- **核心原则**：摒弃“迎合人类主观手感的拍脑袋常数与拼凑式剧本”，完全以**校准概率论（Calibrated Probability）**、**跨盘口分布自洽性（Cross-Market Coherence）**与**风险约束效用最优化（Risk-Constrained Utility Optimization）**作为唯一客观标尺。

---

## 一、开源社区与学术前沿四大核心支柱（Primary Sources）

### 1. 去水校准与冷门高估修正（De-Vigging & Favorite-Longshot Bias）

庄家（含中国体彩）并非对所有选项等比例抽水：在「冷热偏差（Favorite-Longshot Bias, FLB）」与防内幕保护机制下，高赔冷门选项（如半全场 `平胜`、比分 `3:2`）隐含的庄家暗扣率往往是低赔正路的 **3～8 倍**。

- **学术一手文献**：
  - **Hyun Song Shin (1993)**, *"Measuring the Incidence of Insider Trading in a Market for State-Contingent Claims"*, The Economic Journal (`https://doi.org/10.2307/2234240`)：从知情交易博弈推导出内幕比例参数 $z$ 下的真实概率闭式迭代解：
    $$\pi_i(z) = \frac{\sqrt{z^2 + \frac{4(1-z) q_i^2}{\sum_j q_j}} - z}{2(1-z)}, \quad \sum_{i=1}^n \pi_i(z) = 1 \quad \left(q_i = \frac{1}{O_i}\right)$$
  - **Stephen R. Clarke, Stephanie Kovalchik & Martin Ingram (2017)**, *"Adjusting Bookmaker's Odds to Allow for Overround"*, American Journal of Sports Science (`https://doi.org/10.11648/j.ajss.20170506.12`)：系统评测等比法（Multiplicative）、加法（Additive）、Shin 方法与**幂次法（Power Method）**，证明幂次法：
    $$\pi_i(k) = \left(\frac{1}{O_i}\right)^k, \quad \text{求解唯一 } k > 1 \text{ 使 } \sum_{i=1}^n \left(\frac{1}{O_i}\right)^k = 1$$
    在 3 项盘（`HAD / HHAD`）与高抽水多项盘（如 9 项 `HAFU`、31 项 `CRS`，体彩抽水约 `20%~25%`）中兼具严格保界性（$\pi_i \in (0,1)$ 永不出负数或奇异值）与最优概率校准度。
- **开源参考实现**：
  - [`martineastwood/penaltyblog`](https://github.com/martineastwood/penaltyblog)（`penaltyblog/implied/implied.py`）：工业级足球量化库，完整实现 `MULTIPLICATIVE`、`POWER`、`SHIN`、`ODDS_RATIO`、`DIFFERENTIAL_MARGIN_WEIGHTING` 等 7 种去水求解器。
  - [`mberk/shin`](https://github.com/mberk/shin)：专用于博彩赔率去水的 Shin 不动点/二分法开源库。

---

### 2. 跨玩法比分联合分布与真实错价识别（Coherent Scoreline Matrix & Prediction）

单场比赛的五大玩法（胜平负 `HAD`、让球 `HHAD`、总进球 `TTG`、半全场 `HAFU`、比分 `CRS`）在数学上并非 5 个孤立赌局，而是由同一个底层随机变量 $(X, Y)$（主客队全场进球数，以及半场进球数）生成的边缘投影。

- **学术一手文献**：
  - **Mark J. Dixon & Stuart G. Coles (1997)**, *"Modelling Association Football Scores and Inefficiencies in the Football Betting Market"*, JRSS Series C (`https://doi.org/10.1111/1467-9876.00065`)：在独立泊松分布基础上引入低比分相关性修正因子 $\tau_{\lambda, \mu}(x, y)$（专门修正足球比赛中 `0:0`、`1:0`、`0:1`、`1:1` 显著偏离独立泊松的客观规律）：
    $$P(X=x, Y=y) = \tau_{\lambda, \mu}(x, y) \cdot \frac{\lambda^x e^{-\lambda}}{x!} \cdot \frac{\mu^y e^{-\mu}}{y!}$$
    其中：
    $$\tau_{\lambda,\mu}(0,0)=1-\lambda\mu\rho,\quad \tau_{\lambda,\mu}(1,0)=1+\mu\rho,\quad \tau_{\lambda,\mu}(0,1)=1+\lambda\rho,\quad \tau_{\lambda,\mu}(1,1)=1-\rho$$
  - **Georgi N. Boshnakov, Tarak Kharrat & Ian G. McHale (2017)**, *"A bivariate Weibull count model for forecasting association football scores"*, International Journal of Forecasting (`https://doi.org/10.1016/j.ijforecast.2016.11.006`)：用 Weibull 计数与 Copula 捕捉进球过度离散（Over-dispersion）与主客相关性，实证打败简单独立泊松。
  - **Ondřej Hubáček, Gustav Šír & Filip Železný (2021)**, *"Forty years of score-based soccer match outcome prediction: an experimental review"*, IMA Journal of Management Mathematics (`https://doi.org/10.1093/imaman/dpab029`) & **Daniel Berrar et al. (2018)** (`https://doi.org/10.1007/s10994-018-5747-8`)：横跨 40 年足球预测算法大横评——纯历史统计特征下 `Pi-ratings / Berrar ratings + CatBoost/GBT` 与 `Dixon-Coles / Bivariate Weibull` 稳居第一梯队。
  - **Conor Walsh & Alok Joshi (2023/2024)**, *"Machine learning for sports betting: should model selection be based on accuracy or calibration?"* (`https://doi.org/10.48550/arxiv.2303.06021`)：**关键实证结论**——按「概率校准度（Calibration / Brier）」选模的实盘平均投资回报率为 **`+34.69%`**，而按「分类准确率（Accuracy）」选模的平均回报率为 **`-35.17%`**。在精算下注中，**概率准不准（Calibration）比猜对谁赢（Accuracy）重要得多**。
- **竞彩足球开源实证参考**：
  - [`wlrwx/football-engine`](https://github.com/wlrwx/football-engine)（竞彩足球 Dixon-Coles + 蒙特卡洛开源实验系统）：基于 **426 场真实已结算竞彩账本** 的消融回放实证得出两条极硬的结论：
    1. **市场去水概率是最强先验基准**：纯市场去水 `Brier = 0.583`，显著优于脱离赔率单跑的纯统计/树模型（`0.646+`），最优融合必须以去水市场概率为主导（权重约 `0.75`）；
    2. **“高价值幻觉（Winner's Curse）”封顶**：天真算出来 `edge > +10%` 的极端错价桶，实盘回测 `ROI = -19%`（几乎全是冷门概率高估），必须对感知 Edge 施加收缩（Shrinkage）与上限截断。
  - [`Hicruben/world-cup-2026-prediction-model`](https://github.com/Hicruben/world-cup-2026-prediction-model) & [`georgedouzas/sports-betting`](https://github.com/georgedouzas/sports-betting)：分别提供 `Elo + Dixon-Coles + Monte Carlo` 与基于 `scikit-learn` 时间序列交叉验证的回测管道。

---

### 3. 多场串关与注单组合优化（Multivariate Kelly, CRRA & Portfolio Frontier）

- **学术一手文献**：
  - **Qingyun Sun & Stephen Boyd (2018)**, *"Distributional Robust Kelly Gambling: Optimal Strategy under Uncertainty in the Long-Run"* (`https://doi.org/10.48550/arxiv.1812.10371`)：当真实概率 $p$ 存在估计误差（模糊集 $\mathcal{P}$）时，直接用全凯利会导致严重过度下注与破产；分布鲁棒凯利（DR-Kelly）与二阶均值-方差风险惩罚等价于对高方差长串施加数学内生的仓位收缩。
  - **Christopher D. Long (2026-03)**, *"Optimal Parlay Wagering and Whitrow Asymptotics: A State-Price and Implicit-Cash Treatment"* (`https://doi.org/10.48550/arxiv.2603.26620`)：从状态价格（State-Price $q_i$）与隐含现金视角严格证明：**一条串关腿只有在单场子问题中具备正边际效用时，才应进入最优串关组合**（Active-Leg Criterion），彻底否定了“把负价值高抽水腿硬凑进串关”的做法。
  - **Christopher D. Long (2026-04)**, *"Risk-Constrained Kelly for Mutually Exclusive Outcomes: CRRA Support Invariance and Logarithmic One-Dimensional Calibration"* (`https://doi.org/10.48550/arxiv.2604.11577`)：在有抽水市场（$\sum q_i > 1$）下研究**常相对风险厌恶效用（CRRA）**与回撤约束 $\sum_i p_i W_i^{-\lambda} \le 1$，证明风险厌恶参数决定的是有效候选集上的**资金倾斜曲率**，且非满支撑（绝不应全包所有结果，否则必亏抽水）。
- **中国体彩固定预算下的功利客观数学现实**：
  - 在体彩单关 `~12%` 抽水、2串1 `~22%` 抽水、4串1 `~40%` 抽水且纯市场客观概率下（无额外信息优势时），任何下注的客观数学期望 $\text{EV} < 0$，无约束凯利准则的唯一诚实解是 **下注 ¥0（空仓不买）**。
  - 当用户在工作台中给定固定预算 $B$（如 `¥100`）要求在所圈比赛集合上生成最优实票组合 $\mathbf{m} \in \mathbb{Z}_{\ge 0}^K$（$2 \sum_k m_k \le B$）时，客观精算问题必须定义为**联合状态空间 $\Omega$ 上的约束整数规划问题**：
    对每个互斥联合赛果状态 $\omega \in \Omega$（概率 $P(\omega)$，总派奖 $R(\omega, \mathbf{m})$），最大化不同风险偏好系数下的客观目标函数（如期望回报 $\mathbb{E}[R]$、盈利概率 $\mathbb{P}(R \ge C)$、条件风险价值 $\text{CVaR}_\alpha$ 或 CRRA 效用 $\mathbb{E}[U_\gamma(W_0 - C + R)]$），**零拍脑袋硬编码权重**。

---

## 二、对现有 `server/quantEngine.mjs` 的逐行客观数学审计（发现 6 处核心缺陷）

对照上述前沿标准逐行审查当前代码后，现有「五流派」与微观精算存在以下 **6 处违背客观数学理性的硬伤**：

1. **等比例去水导致高赔冷门系统性虚高（`quantEngine.mjs:175`）**：
   - 现状：`fairProb = (1 / o.odds) / invSum`。在抽水 `20%+` 的半全场与比分池中，该公式未修正冷热偏差（FLB），导致 `平胜`、`让平`、大比分冷门的“真率”被系统性高估 `15%～40%`。
2. **五大玩法各自孤立去水，同场概率自相矛盾（`quantEngine.mjs:217-294`）**：
   - 现状：`homeXG = totalXG * (0.18 + 0.64 * strengthShare)` 为经验线性凑数公式；同场比赛 `HAD` 算出的主胜率、`CRS` 13 个主胜比分加总的胜率、以及 `TTG` 隐含的 `0:0` 概率彼此不闭合。
3. **「错价刺客」名不副实——硬编码剧本而非真错价扫描（`quantEngine.mjs:2747-2762`）**：
   - 现状：`assassinLegFor` 机械固定抓 `CRS 1:0 / 0:1`、`HAFU 平胜 / 平负`、`HHAD 让平`，**根本没有计算该选项相对低抽水主盘（`HAD + HHAD + TTG` 拟合出的基准分布）是否存在正的价格偏离（Mispricing Edge）**！哪怕当天 `平胜` 被体彩严重压低水位、EV 低至 `-38%`，刺客依然无脑推荐它。
4. **流派胜率直接把非互斥实票概率相加，严重虚标胜率（`quantEngine.mjs:2408-2412`）**：
   - 现状：`winProb = Math.min(0.92, lines.reduce((a, l) => a + l.prob, 0))`。
   - 数学错误：只有**严格互斥**的事件才能满足 $P(A \cup B) = P(A) + P(B)$！在「容错防爆」（`AB`、`AC`、`BC` 两两 2串1 同时命中重叠）与跨盘组合（同一场 `平胜` 与 `让球(-1)让平` 在上半场 `0:0`、全场 `1:0` 时**同时命中**）中，直接求和会把重叠区重复累加 2～3 次（例如 3 场 `60%` 的 `3串3` 真实命中率是 `64.8%`，直接相加却算出 `108% -> 截断为 92%`，虚标了 **+27.2%**！）。
5. **分倍器 `shieldOnly: 0.04` 固定常数引发多场“主盾倒挂”（`quantEngine.mjs:2259-2270`）**：
   - 现状：回本盾权重写死为 `0.04`。当选 4 场球时，主攻 4串1 的概率连乘降至 `0.013`（`< 0.04`），导致「回本盾」反客为主抢走 `56%` 预算，违背了“盾只负责刚好覆盖本金 $R_{\text{shield}} \ge C$，多余预算全归最高 EV 主攻箭”的最优化定义。
6. **倾向调节未做概率重归一化 & 抽水只取首张票（`quantEngine.mjs:2178-2189, 2413-2420`）**：
   - `applyStanceToFairProb` 将单选项乘以 `1.08 / 1.12` 后未对同场其余互斥结果重归一化（导致同场总概率 $> 100\%$）；`pack` 计算 `vigPct` 时仅取 `lines[0]` 单张票代替整套方案的资金加权真实抽水。

---

## 三、科学性验证体系设计（如何客观证明算法好坏，拒绝主观感觉）

要验证升级后的推荐引擎是否真正科学，可建立一套可自动运行、100% 用数字裁决的四层基准测试（Benchmark Suite）：

1. **第一层：概率校准度检验（Proper Scoring Rules）**
   - 在历史已完场竞彩数据集上，严格采用**有序概率评分（Ranked Probability Score, RPS）**、**Brier Score**、**对数损失（Log-Loss）**与**期望校准误差（ECE，分 10 个概率桶核对预测 40% 的比赛实际是否赢下约 40%）**对比「等比去水」vs「Power / Shin 去水」vs「Dixon-Coles 跨盘联合校准」：
     $$\text{RPS} = \frac{1}{R - 1} \sum_{r=1}^{R - 1} \left( \sum_{j=1}^r p_j - \sum_{j=1}^r y_j \right)^2 \quad (R=3 \text{ 对应胜/平/负有序分布})$$
2. **第二层：公理与跨盘自洽性不变量测试（Axiomatic Invariants）**
   - 任意单场全状态概率和恒等于 $1.000000$；
   - 任意多票组合（含跨玩法 `HAFU + HHAD + CRS` 及 `M串N` 子串）在 $6\times 6$ 比分网格或联合状态空间 $\Omega$ 上精确积分，保证 `realProfitProb <= anyWinProb <= 1`、重叠兼中最高奖金 `maxReturn` 与期望值 `EV` 误差 $< 10^{-9}$。
3. **第三层：帕累托支配检验（Pareto Dominance Check）**
   - 对任意一组比赛与预算 $B$，随机采样 $10,000$ 组同预算合法注单（Monte Carlo Random Portfolios），验证系统输出的每一个推荐方案在三维目标空间 **$(\text{期望净值 EV}, \text{真赚钱率 } P_{\text{profit}}, \text{尾部保底/CVaR})$** 上均处于**帕累托前沿（Pareto Frontier）**，不被任何随机方案全面碾压。
4. **第四层：时间序列滚动回放与蒙特卡洛破产压力测试（Walk-Forward & Risk-of-Ruin）**
   - 基于已沉淀的双轨账本与历史赔率快照执行配对消融回放（Ablation Replay），输出夏普比率（Sharpe）、最大回撤（Max Drawdown）、连黑 95% 分位极值与实盘 ROI。

---

## 四、推荐模式数量推演：3 种 vs 5 种 vs 7/8 种，多少种最科学？

从**投资组合有效前沿（Markowitz / CRRA 风险厌恶谱）**与**收益分布高阶矩（均值 Mean、方差 Variance、正偏度 Skewness）**两个纯数学维度推导：

### 为什么 **7～8 种太多**？
- 在给定 $1 \sim 8$ 场比赛与固定预算（如 `¥100 = 50 注`）的离散整数空间中，非支配帕累托极值点非常有限；强行凑 7～8 个流派，必然退化为**“换汤不换药的重复组合”**或**“为了凑名字硬塞负 EV 垃圾高抽水玩法（如盲买比分/半全场）”**，还会触发决策瘫痪（Choice Overload）。

### 为什么「**3 大帕累托主轴 + 1 个条件触发异动狙击（或精简 3～4 档）**」比死板的 5 流派更客观？
在数学期望、胜率（方差）与爆发赔率（偏度）构成的三维空间中，真正不可互相替代的客观极值点其实只有 **3 个核心主轴 + 1 个仅在真错价出现时才亮灯的机会窗口**：

| 客观数学定位 | 优化目标函数（纯数学定义，零剧本拼凑） | 自动匹配的底层结构 |
|---|---|---|
| **① 稳健保本极值（Max Profit-Prob）** | $\max_{\mathbf{m}} \mathbb{P}(R(\omega,\mathbf{m}) > C)$，约束命中任一覆盖态绝不水下倒贴 | 自动优选最低抽水主盘（`HAD/HHAD`）与最优容错关数，求真赚钱率上限 |
| **② 期望效用极值（Max EV / Log-Utility）** | $\max_{\mathbf{m}} \mathbb{E}[\ln(W_0 - C + R(\omega,\mathbf{m}))]$（风险约束凯利 / 最优性价比） | 只选边际效用最高的精简串关腿，回本盾严格按 $m_{\text{shield}} = \lceil C / u_{\text{shield}} \rceil$ 最小整数倍锁死，绝不抢主攻预算 |
| **③ 容错抗回撤极值（Max CVaR / Min-Drawdown）** | 最大化黑掉 1～2 场时的保底回收率（次优分位点回报） | 自动在官方 `M串N`（如 `3串3 / 4串6 / 4串4`）与拆分 `2串1` 矩阵中搜索最高错一返还结构 |
| **④ 跨盘真错价猎手（Conditional Alpha，有错价才激活！）** | 扫描全盘 50+ 选项相对 Dixon-Coles 基准分布的 $\text{Edge}_j = O_j \cdot P_{\text{DC}}(j) - 1$ | **功利客观核心**：若当天存在跨盘滞后红利或低抽水洼地则精准出击（配轻仓凯利）；**若当天全盘无任何正相对价值洼地，直接诚实显示「当前盘面无跨盘错价洼地，建议空仓此档或走①②主盘」，绝不硬塞高抽水垃圾单！** |
