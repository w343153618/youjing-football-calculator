# Spec 0013 · 双轨实票账本视觉区隔、官方完场自动对奖、翻牌解剖与国内竞彩实操闭环打磨

Status: ready-for-agent
Date: 2026-11-21
Related ADRs: ADR-0001, ADR-0002, ADR-0007, ADR-0008, ADR-0011, ADR-0012, ADR-0013, ADR-0014

## Problem Statement

在 `v2.4.0` 实盘使用中，围绕「情报与止损账本」及国内体彩竞彩足球真实购彩闭环存在五处明显体验短板：

1. **实买单与模拟观察单混排难辨**：双轨账本记录使用同一套卡片外观且无快速筛选栏，真金白银出票的实买单与 0 成本试水的模拟单混在一起，无法一眼区分。
2. **账本“失忆”无明细，无法查看对阵或拆解局部中奖**：记账时仅保存了标题与总金额，丢失了对阵双方、让球线、出票固定赔率与逐张实票拆分，导致事后点开订单看不到具体买了哪几队，遇到复式/容错缩水“中了一部分、黑了一部分（甚至总派奖低于本金）”时更无法逐票复盘盈亏。
3. **全靠人工手动点红黑，删单操作缺少撤销与防上头保护**：比赛踢完开奖后不会自动对奖；缺少顺手的删除撤销缓冲与模拟单批量清理；且若直接删除当天已亏损实买单可能误退止损额度。
4. **第 4 页签「赛前情报」与「赛后账本」纵向挤占**：40+ 场赛前单场情报流排在账本上方，每次查单都要先滚过几十场球。
5. **国内竞彩线下实操三处断档**：① 赛事雷达缺少搜编号/队名、按比赛日分组及体彩官方停售红线倒计时；② 防错打票单缺少一键复制发体彩实体店老板的微信标准口令及弹窗内顺手记账按钮；③ 账本待开奖串关在早场已红、晚场未开时不会主动亮起时间差锁利补单提醒。

## Solution

在不改动核心概率精算校准模型与 `1-2-3` 顶层导航心智的前提下，升级服务端账本与官方赛果自动对奖深模块，并完成双端工作台布局解耦与国内竞彩体验打磨：

1. **双轨强视觉区隔 + 四态胶囊秒筛**：
   - 账本顶部新增 `全部` ｜ `💰 实买真金 (N)` ｜ `🧪 模拟观察 (N)` ｜ `⏳ 待开奖 (N)` 筛选栏；
   - **💰 实买单**采用暖金/朱砂加粗实线左脊、实底票面与实心 `[💰 实买出票]` 印章；**🧪 模拟观察单**采用冷青灰虚线边框、微斜纹蓝图底与空心 `[🧪 模拟未买]` 水印章。
2. **出票快照封存 + 官方赛果全自动对奖 + 诚实局部回血三态**：
   - 记账瞬间封存完整出票快照（赛事 `matchId`、编号、主客队、开球时间、封存 `goalLine`、选项固定 `odds`、胆码标记与逐张实票组合倍数）；
   - 服务端对接中国体彩官方完场赛果接口（`getUniformMatchResultV1.qry`），在加载账本、刷新同步或触发自动对奖时，调用 `server/quantEngine.mjs` 按 90 分钟常规时间半全场比分与无效场次公告自动核定每场红黑与每张实票法定派奖（严格执行 `GB/T 8170` 四舍六入五成双、腰斩按 `1.0` 算奖并降档限赔）；
   - 结算结果严格区分 **真红单/保本（`won`，`settledReturn >= cost`）**、**局部回血倒亏（`partial`，`0 < settledReturn < cost`，不虚增实买红单率）** 与 **黑单（`lost`，`settledReturn === 0`）**；支持手动微调实际到手派奖（锁定 `manualOverride` 免被覆盖）及重置回自动对奖。
3. **翻开实票看透细节（逐场红黑 × 逐票派奖 × 早场红单锁利提醒）**：
   - 点击任意含快照的账本订单可顺滑展开/翻开实票解剖视图：展示 **盈亏总账条**（投入、实派、净赚/净亏金额与回血比例）、**逐场赛果对账单**（官方完场比分 + 半场比分 + 所买选项红黑/腰斩徽章）与 **逐张实票命中明细**（每张票命中/未中及精确派奖）；
   - 当待开奖串关前序场次已官方完场全红、仅剩末场尚未开球且当前实盘反向互补池开放单关时，卡片自动亮起 **`⚡ 前序已红 · 末场补单锁利/减损`** 实时提醒条。
4. **顺手删除 + 5 秒撤销气泡 + 批量清模拟单 + 防上头额度锁死**：
   - 单点删除立即生效并弹出 5 秒 `[已删除 · 点此撤销]` 弹簧气泡；模拟观察筛选下提供 `🧹 清空已结模拟单`；
   - 删除当天 `pending` 或净盈利实买单立即退回今日止损额度；删除当天已结算净亏损（`lost` / `partial`）实买单不退回当日已消耗止损额度（5 秒内点撤销恢复时不重复扣减）。
5. **第 4 页签「账本 ⇄ 情报」双舱解耦 + 国内竞彩实操三补丁**：
   - 移动端第 4 页签顶部新增 `📒 双轨账本`（默认）⇄ `🧹 小高情报舱` 分段切换；桌面端右栏升级为 `③ 审单锁利` ｜ `📒 双轨账本` ｜ `🧹 小高情报` 三段切换；
   - ① 赛事雷达顶部新增紧凑 `🔍 搜编号(如008)/队名` 搜索框、按比赛日（如 `周五 · X场` / `周六 · Y场`）折叠分组头，以及 **体彩官方停售倒计时胶囊**（工作日 `22:00` / 周末 `23:00` 北京时间，距停售 `<= 30 分钟` 高亮预警）；
   - 「🧾 防错打票单」弹窗新增 **`📋 一键复制发店主微信口令`** 按钮（自动按合票或分倍模式生成体彩店老板秒懂的标准文本）及弹窗底部 **`记入实买 / 存模拟单`** 快捷闭环按钮。

## User Stories

1. 作为购彩成员，我希望能通过鲜明的边框底纹印章与顶部筛选栏一眼分清哪笔是我真掏钱买的「实买单」、哪笔只是试水验证的「0 成本模拟单」。
2. 作为购彩成员，当我今天记入明天的球赛订单后，等到明天比赛踢完且体彩官方开奖后打开账本，我希望系统已经自动帮我算好这单是红单、局部回血还是黑单，以及精确赚了或亏了多少钱，无需我再去查比分手动标记。
3. 作为购买多串容错、复式或奖金优化方案的成员，我希望点开账本里的任意订单就能像翻开体彩实票一样，看清每一场球踢了几比几、哪个选项红了黑了、拆出的哪几张票中了多少钱，并且当总派奖低于本金时诚实标为「⚠️ 局部回血 -¥X」而不是自欺欺人算进红单率。
4. 作为高频使用模拟单试水或偶有手滑误记的成员，我希望能一点即删订单并通过 5 秒撤销气泡防误删，还能一键清空已结模拟单；同时在我当天实买亏钱后，系统锁死当日已耗止损额度防止我靠删黑单绕过止损护栏上头重注。
5. 作为查账和看情报的成员，我希望第 4 页签把「双轨账本」和「小高情报舱」分成清爽切换的两个舱室，打开账本就能直接看到止损额度与我的订单，不再被几十场赛前情报淹没。
6. 作为习惯微信找线下体彩实体店老板出票的国内彩民，我希望在「防错打票单」里点一下就能复制排版清晰的微信出票口令直接发给店主，并顺手一键记入账本。
7. 作为在周末几十场球里找特定比赛的成员，我希望在①赛事雷达输入 `008` 或球队名就能秒搜定位，按比赛日分组浏览，并实时看到距离今晚体彩停售还有多久，避免算好单却错过出票时间。
8. 作为买了早晚场串关的成员，当早场已经踢完红单而晚场还没开球时，我希望账本卡片能主动提醒我现在去补买多少元晚场反向单关即可锁利或减损。

## Implementation Decisions

1. **官方完场赛果抓取与五池法定判奖深模块（`server/quantEngine.mjs`）**：
   - 新增 `parseSportteryResultsJson(rawJson)` 与 `fetchOfficialMatchResultsServer({ beginDate, endDate, cacheFilePath, fetchFn })`：请求 `https://webapi.sporttery.cn/gateway/uniform/football/getUniformMatchResultV1.qry`，带 3 分钟内存热缓存与磁盘快照回退；仅当 `matchResultStatus === "2"` / `poolStatus === "Payout"` 且 `sectionsNo1`、`sectionsNo999` 有效（或官方标记无效/取消场次）时视为权威已开奖。
   - 新增纯函数 `settleTicketSnapshotWithOfficialResults(snapshot, resultsById, liveMatchesById)`：
     - 根据封存的 `goalLine` 与官方 90 分钟常规时间半场 `(h1, a1)`、全场 `(h2, a2)` 严格判定五大玩法（`HAD`、`HHAD`、`TTG`含 `7+`、`HAFU`、`CRS` 含 `胜其它/平其它/负其它`）每个选项命中状态；无效/腰斩场次标记 `void`；
     - 对每张实票 `line`：若含任意已完场 `miss` 腿则该票立即判定 `lost`（派奖 `0`）；若全部腿已完场（`hit` 或 `void`），调用 `bankerRoundParlayUnitPayout` 按剔除 `void` 腿后的有效关数执行法定限赔与 `GB/T 8170` 四舍六入五成双算奖（全 `void` 票退还 `2 * multiple` 本金）；
     - 若全部实票均已完结，则整单自动结算（`settledReturn >= refStake` 为 `"won"`，`0 < settledReturn < refStake` 为 `"partial"`，`settledReturn === 0` 为 `"lost"`）；若仍有存活待定票，保持 `"pending"` 并输出 `progress`（如 `已红 2/3 场 · 保底已锁 ¥X`），且当仅余最后 1 场未开球并在 `liveMatchesById` 中满足反向互补单关条件时，复用 `resolveComplementaryLateHedge` 生成实时 `liveEarlyHedge` 建议。

2. **有界快照账本、四态统计、软撤销与止损锁死深模块（`server/ledgerManager.mjs` & `server/securityShield.mjs`）**：
   - `LedgerEntry.status` 扩展为 `"pending" | "won" | "partial" | "lost"`；新增可选字段 `snapshot`（清洗限制 `matches <= 15`、`lines <= 512`，防恶意超大载荷）、`settlementDetail`（最近一次自动对奖生成的逐场与逐票结果）、`manualOverride?: boolean`、`autoSettled?: boolean`。
   - `stats` 保持向后兼容并精确扩展：
     - `liveSettledCount` 统计 `won | partial | lost`；`liveWonCount` 仅统计 `status === "won"`（`settledReturn >= cost`），`livePartialCount` 单独统计 `status === "partial"`，`liveWinRatePct = liveWonCount / liveSettledCount * 100`；`liveNetProfit` 精确累加所有已结实买单 `netProfit`（含 `partial` 的负净值）；
     - 模拟观察单：`paperSavedAmount` 对 `lost` 累加 `paperRefCost`，对 `partial` 累加 `paperRefCost - paperSimulatedReturn`（精确免损净额），`paperWonCount` 统计 `settledReturn >= paperRefCost`。
   - 防上头锁死与撤销：`rec.dailyLockedLosses` 按 `{ [entryId]: { date, cost } }` 记录当日已删除的净亏损实买单本金，`dailyLiveSpent` 按 `当日存活实买单本金 + 当日有效 dailyLockedLosses` 计算（跨北京时间 `00:00` 自动过期清理）；内存保留每用户最近删除记录供 `restore-entry` 一键无损还原，同时支持 `clear-settled-paper` 批量清理已结模拟单与 `auto-settle` 触发拉取官方赛果自动对奖。
   - `/api/auth/session`、`/api/auth/login`、`/api/matches` 同步与 `/api/ledger/mutate` 在用户存在 `pending` 快照订单时自动联动官方赛果静默对奖。

3. **选单控制器与体彩实操辅助接缝（`src/workspace/betSlipController.ts`）**：
   - 新增纯辅助与控制器方法：`buildSealedLedgerDraft()`（提取当前有效方案的封存对阵与实票快照）、`formatShopkeeperWeChatSlip({ useConsolidated })`（生成体彩店主标准微信打票口令）、`computeSportteryCutoffStatus(nowMs, matches)`（计算距北京时间当日 `22:00` / 周末 `23:00` 官方停售剩余时长与预警等级）以及赛事编号/队名/联赛即时过滤与比赛日分组辅助。

4. **双视口 UI 解耦、说明书与版本演进（`src/mobile/SkinPhoneApp.tsx`、`server/manualQaEngine.mjs`、`src/manual/UserManualModal.tsx`）**：
   - 完成第 4 页签双舱切换、桌面右栏三页签、双轨差异化实票卡片、翻牌/抽屉式逐场逐票解剖面板、5 秒撤销删除气泡、防错打票单复制微信口令 + 快捷记账、赛事雷达搜索/分组/停售倒计时，并同步更新图文说明书与铁笼问答本地知识库。

## Testing Decisions

- **好测试准则**：仅通过公开模块接缝断言外部可观测行为与法定算奖/风控不变量，使用可注入时钟 `nowFn` 与赛果源桩函数验证跨日开奖、局部回血、腰斩降档与防上头锁死，零私有内部状态耦合。
- **四大公开测试接缝（Seams）**：
  1. **Seam 1 · 官方完场赛果解析与实票快照算奖接缝**（`server/quantEngine.mjs`: `parseSportteryResultsJson`, `settleTicketSnapshotWithOfficialResults`）：验证五大玩法（含让球线、比分 `胜其它/平其它/负其它`、总进球 `7+`、半全场）官方比分判奖、出票固定赔率优先于收盘赔率、腰斩按 `1.0` 算奖并降档限赔、复式/容错/胆拖逐票局部回血核算、早场已黑提前结单，以及早场全红触发末场单关 `liveEarlyHedge` 提醒。
  2. **Seam 2 · 双轨账本生命周期、诚实统计与止损防上头接缝**（`server/ledgerManager.mjs` & `createYouJingRuntime` `/api/ledger/mutate`）：验证有界快照清洗、无快照旧记录无损兼容、自动对奖落盘与 `manualOverride` 保护、`won / partial / lost` 三态对 `liveWinRatePct` 与 `paperSavedAmount` 的精确核算、5 秒 `restore-entry` 撤销与 `clear-settled-paper` 清理、以及删除当日 `pending` 实买退额度 vs 删除当日已亏实买锁死止损额度（跨 `00:00` 自动释放）。
  3. **Seam 3 · 选单控制器快照封存、店主微信口令与停售红线接缝**（`src/workspace/betSlipController.ts`）：验证 `buildSealedLedgerDraft` 封存胆码/分倍/合票快照一致性、`formatShopkeeperWeChatSlip` 在精确分倍与智能合票下的标准店面口令输出、`computeSportteryCutoffStatus` 工作日 `22:00` / 周末 `23:00` 临界预警及赛事编号/队名秒搜与按日分组。
  4. **Seam 4 · 铁笼说明书知识库与双视口实机核验接缝**（`server/manualQaEngine.mjs` + `ego-browser` 桌面 `1440×900` 与移动 `390×844` 实机巡检）：验证自动对奖/局部回血/微信口令 `0ms` 本地问答命中，核验双轨实买/模拟视觉区分、翻牌明细、双舱切换、搜索与停售徽章在 `390px` 超管最挤态下零横向溢出（`scrollWidth === innerWidth`）。

## Out of Scope

- 不接入任何第三方非官方野鸡比分网（严格仅以中国体彩官网权威完场公告为准，确保开奖口径与线下体彩实体店兑奖机 100% 一致）。
- 不接入代购或线上真钱支付通道（店主微信口令纯属本地剪贴板文本辅助工具）。

## Further Notes

- 全部改动须通过 `pnpm run check:guardrails`、`pnpm typecheck`、`pnpm test`、`pnpm build`（零 `.map`、产物零明文中文字符）及双轴平行子代理 `code-review`，并用 `ego-browser` 完成双视口核验收尾。
