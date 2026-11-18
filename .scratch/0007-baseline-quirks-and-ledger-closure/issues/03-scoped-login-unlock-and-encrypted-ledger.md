# 03: 超管解锁 IP 精准隔离与跨端加密双轨止损账本闭环

**What to build:**
修复超管 `unlock-login` 清空全局无关 IP 防爆破记录的问题；新增服务端按登录成员隔离持久化的双轨止损账本深模块与加密网关接口，升级前端账本界面支持可调「每日止损护栏」（北京时间 `00:00` 自动重置）、超止损额度记实买防上头拦截（支持一键转 0 成本模拟观察单或确认强行记入）、订单待开奖/红单/黑单结算与删除，以及实买累计净盈亏、实买红单率、模拟单累计免损金额三项真实指标动态计算（配合本地离线缓存兜底）。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `accountManager` 记录账号最近密码输错 IP，`unlock-login` 仅清理该账号自身关联 IP 的防爆破冷却，绝不清空其他陌生攻击 IP 的 `429` 冷却状态，且保持 48 小时硬件/IP 熔断库不受影响。
- [ ] 新增服务端账本深模块 `server/ledgerManager.mjs`（持久化至 `data/ledgers-db.json`，支持注入 `nowFn`），集成至 `createYouJingRuntime` 与 `securityShield.mjs`：登录与握手加密包直接下发当前成员 `ledger` 快照（新账号零写死假数据），`POST /api/ledger/mutate` 支持修改每日止损上限（跨北京时间 `00:00` 自动归零当日已用实买额）、新增实买单/模拟观察单（超当日剩余额度且未确认时返回 `STOP_LOSS_EXCEEDED` 拦截详情）、切换 `pending / won / lost` 结算状态（实买红单支持默认保底或自定义实派金额，模拟单标记 `lost` 累加 `paperSavedAmount`）及删除记录；删除成员账号时同步清理其账本。
- [ ] 升级前端 `secureClient.ts` 与 `SkinPhoneApp.tsx`（桌面宽屏右栏账本 + 手机端第 4 页签账本 + 审单台「记入实买 / 存模拟单」入口）：支持编辑每日止损上限、超额记实买弹出防上头确认卡（一键转 0 成本模拟观察单 vs 确认强行记入实买）、逐条切换待开奖/红单(可填实派)/黑单与删除、顶部 3 格统计卡动态展示真实「实买累计净盈亏 / 实买红单率 / 模拟单累计免损」，并以 `localStorage` 按 `userId` 镜像最新快照保障断网离线可看。
- [ ] 在 `tests/ledgerAndUnlock0007.test.ts` 按 TDD 红绿循环覆盖跨 IP 隔离解锁与全栈加密账本生命周期测试，全仓 `pnpm test` 100% 通过。
