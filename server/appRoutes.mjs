import { evaluateQuantWorkspace } from "./quantEngine.mjs";
import {
  FALLBACK_MATCHES,
  fetchOfficialMatchResultsServer,
  fetchOfficialMatchesServer,
} from "./sportteryFeed.mjs";
import {
  buildComboDiagnosisContext,
  buildSingleMatchDiagnosisContext,
  matchesCanonicalSportteryItem,
} from "./xiaogaoCore.mjs";

function setBoundedAlertMap(map, key, val, maxCap = 32) {
  if (!map.has(key) && map.size >= maxCap) {
    const oldestKey = map.keys().next().value;
    map.delete(oldestKey);
  }
  map.set(key, val);
}

export function findCanonicalMatchForReportItem(pm, canonicalMatches = []) {
  if (!pm || typeof pm !== "object" || !Array.isArray(canonicalMatches)) {
    return null;
  }
  return (
    canonicalMatches.find((cm) => matchesCanonicalSportteryItem(pm, cm)) || null
  );
}

/**
 * 扫地僧小高串关会诊后单场告警统一对齐映射器：
 * 将会诊返回的 perMatch 项按 id / 赛事编号 / 标题赛事编号对齐至权威在售赛事 ID 并写入有界告警字典。
 */
export function reconcileComboAlertsToMatchMap(
  comboReport,
  canonicalMatches = [],
  targetAlertMap = new Map(),
  maxCap = 32
) {
  if (
    !Array.isArray(comboReport?.perMatch) ||
    !(targetAlertMap instanceof Map)
  ) {
    return targetAlertMap;
  }
  const level = comboReport.level === "high" ? "high" : "medium";
  for (const pm of comboReport.perMatch) {
    if (!pm || typeof pm !== "object") continue;
    const matchedCanonical = findCanonicalMatchForReportItem(
      pm,
      canonicalMatches
    );
    const canonicalId =
      matchedCanonical?.id || (pm.matchId ? String(pm.matchId) : "");
    if (!canonicalId) continue;
    setBoundedAlertMap(
      targetAlertMap,
      String(canonicalId),
      {
        level,
        tag: pm.tag,
        summary: pm.note,
        priceInStatus: pm.priceInStatus,
        source: comboReport.source,
      },
      maxCap
    );
  }
  return targetAlertMap;
}

/**
 * 统一业务路由与体彩上游数据源编排模块（认证、说明书铁笼、隐形总控台、精算黑盒、双轨账本与扫地僧小高）
 */
export function createAppRoutes(opts = {}) {
  const snapshotFile = opts.snapshotFile || null;
  const resultsCacheFile = opts.resultsCacheFile || null;
  const accountManager = opts.accountManager || null;
  const ledgerManager = opts.ledgerManager || null;
  const manualQaEngine = opts.manualQaEngine || null;
  const xiaogaoService = opts.xiaogaoService;
  const getApiKey = opts.getApiKey || (() => "");
  const nowFn = opts.nowFn || (() => Date.now());
  const fetchMatchesFn = opts.fetchMatches || fetchOfficialMatchesServer;
  const fetchResultsFn =
    opts.fetchResults ||
    ((forceRefresh = false) =>
      fetchOfficialMatchResultsServer({
        nowMs: nowFn(),
        cacheFilePath: resultsCacheFile,
        forceRefresh,
      }));

  let cachedMatches = FALLBACK_MATCHES;
  let cachedSyncNote = "已连接体彩实盘快照 · 支持一键刷新官网水位";
  let lastMatchFetchAt = 0;
  let inFlightMatchLoad = null;

  async function ensureMatchesLoaded(force = false) {
    const now = nowFn();
    if (!force && lastMatchFetchAt > 0 && now - lastMatchFetchAt < 120_000) {
      return { matches: cachedMatches, syncNote: cachedSyncNote };
    }
    if (inFlightMatchLoad) return inFlightMatchLoad;

    inFlightMatchLoad = (async () => {
      try {
        const res = await fetchMatchesFn(snapshotFile);
        cachedMatches = res.matches;
        cachedSyncNote = res.syncNote;
        lastMatchFetchAt = nowFn();
        return { matches: cachedMatches, syncNote: cachedSyncNote };
      } finally {
        inFlightMatchLoad = null;
      }
    })();

    return inFlightMatchLoad;
  }

  async function resolveSyncedUserLedger(
    userId,
    liveMatches,
    forceRefresh = false
  ) {
    if (!ledgerManager || !userId) {
      return {
        ledger: undefined,
        newlySettledCount: 0,
        newlySettledTitles: [],
      };
    }
    if (!forceRefresh && !ledgerManager.hasPendingSnapshots?.(userId)) {
      return {
        ledger: ledgerManager.getUserLedger(userId),
        newlySettledCount: 0,
        newlySettledTitles: [],
      };
    }
    try {
      const resultsById = await fetchResultsFn(forceRefresh);
      const settled = ledgerManager.autoSettleUserLedger(userId, {
        resultsById,
        liveMatchesById: liveMatches,
      });
      return {
        ledger: settled.ledger,
        newlySettledCount: settled.newlySettledCount || 0,
        newlySettledTitles: settled.newlySettledTitles || [],
      };
    } catch {
      return {
        ledger: ledgerManager.getUserLedger(userId),
        newlySettledCount: 0,
        newlySettledTitles: [],
      };
    }
  }

  function mergeSessionAlerts(baseMatches, sess) {
    if (!sess?.aiAlerts || sess.aiAlerts.size === 0) return baseMatches;
    return baseMatches.map((m) =>
      sess.aiAlerts.has(m.id) ? { ...m, aiAlert: sess.aiAlerts.get(m.id) } : m
    );
  }

  function buildInitialWorkspaceBundle(matches, syncNote) {
    const initialPicks = [];
    const workspace = evaluateQuantWorkspace(
      {
        picks: initialPicks,
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: matches.slice(0, 2).map((m) => m.id),
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      matches
    );
    return { matches, syncNote, initialPicks, workspace };
  }

  async function resolveBootstrapSession({
    req,
    ip,
    sid,
    rawAuthToken,
    deviceBindFp,
    cookieSuffix,
  }) {
    const authRes = accountManager
      ? accountManager.verifyAuthTokenDetailed(rawAuthToken, deviceBindFp, ip)
      : { ok: true, user: null };
    const cookiesOut = [`yj_sh_sid=${sid}${cookieSuffix(req, 7200)}`];

    if (accountManager && !authRes.ok) {
      if (rawAuthToken) {
        cookiesOut.push(`yj_auth_tok=${cookieSuffix(req, 0)}`);
      }
      return {
        authToken: null,
        cookiesOut,
        payload: {
          authenticated: false,
          authCode: authRes.code,
          authError: rawAuthToken ? authRes.error : null,
        },
      };
    }

    if (accountManager && rawAuthToken) {
      cookiesOut.push(
        `yj_auth_tok=${rawAuthToken}${cookieSuffix(req, 31536000)}`
      );
    }
    const { matches, syncNote } = await ensureMatchesLoaded(false);
    const bundle = buildInitialWorkspaceBundle(matches, syncNote);
    if (!accountManager) {
      return { authToken: null, cookiesOut, payload: bundle };
    }
    const syncedBootstrapLedger = authRes.user?.id
      ? await resolveSyncedUserLedger(authRes.user.id, matches, false)
      : { ledger: undefined, newlySettledCount: 0, newlySettledTitles: [] };
    return {
      authToken: rawAuthToken || null,
      cookiesOut,
      payload: {
        authenticated: true,
        user: authRes.user,
        authToken: rawAuthToken,
        ledger: syncedBootstrapLedger.ledger,
        newlySettledCount: syncedBootstrapLedger.newlySettledCount,
        ...bundle,
      },
    };
  }

  function consumeUserAiQuota(user, res, sendJson) {
    if (!accountManager || !user) return { ok: true, remaining: undefined };
    const quota = accountManager.consumeAiQuota(user.id);
    if (!quota.ok) {
      sendJson(res, quota.statusCode || 403, { ok: false, error: quota.error });
      return { ok: false, remaining: 0 };
    }
    return { ok: true, remaining: quota.remaining };
  }

  function handlePublicStatus(req, res, pathname, sendJson) {
    if (pathname !== "/api/xiaogao/status" || req.method !== "GET") {
      return false;
    }
    const apiKey = getApiKey();
    sendJson(
      res,
      200,
      xiaogaoService
        ? xiaogaoService.getPublicStatus(Boolean(apiKey))
        : {
            ok: true,
            configured: Boolean(apiKey),
            channel: "primary",
            degraded: false,
          }
    );
    return true;
  }

  async function handleDomainRoute(req, res, pathname, shieldCtx) {
    const {
      ip,
      runEncryptedRoute,
      sendJson,
      cookieSuffix,
      deriveFallbackClientFp,
      checkAndContagiousLockHwFp,
      tripFuse,
      getBanStats,
    } = shieldCtx;

    // 1. Encrypted Member & Super-Admin Login (/api/auth/login)
    if (pathname === "/api/auth/login" && req.method === "POST") {
      if (!accountManager) {
        sendJson(res, 404, { ok: false, error: "Auth service not enabled" });
        return true;
      }
      return runEncryptedRoute(
        req,
        res,
        ip,
        {
          endpoint: "auth/login",
          maxBodyBytes: 32_000,
          fallbackError: "登录安全校验失败，请刷新重试",
        },
        async ({ sess, data }) => {
          const effectiveHwFp =
            sess.hwFp ||
            (typeof data?.hwFp === "string" &&
            /^[0-9a-f]{32,64}$/i.test(data.hwFp)
              ? data.hwFp.toLowerCase()
              : null);
          if (effectiveHwFp) sess.hwFp = effectiveHwFp;
          const bindFp =
            effectiveHwFp ||
            sess.deviceBindFp ||
            deriveFallbackClientFp(req, ip);
          sess.deviceBindFp = bindFp;

          const fusedExp = checkAndContagiousLockHwFp(effectiveHwFp, ip);
          if (fusedExp !== null) {
            sendJson(res, 403, {
              ok: false,
              fused: true,
              unlockAt: fusedExp,
              error: "熔断天平已触发：当前电脑硬件指纹处于 48 小时封禁期",
            });
            return { __handled: true };
          }

          const loginRes = accountManager.authenticateLogin({
            username: data?.username,
            password: data?.password,
            hwFp: bindFp,
            deviceLabel: data?.deviceLabel,
            ip,
          });

          if (!loginRes.ok) {
            sendJson(res, loginRes.statusCode || 401, {
              ok: false,
              lockedRemainingSec: loginRes.lockedRemainingSec || 0,
              error: loginRes.error,
            });
            return { __handled: true };
          }

          sess.authToken = loginRes.authToken;
          const { matches, syncNote } = await ensureMatchesLoaded(false);
          const sessionMatches = mergeSessionAlerts(matches, sess);
          const bundle = buildInitialWorkspaceBundle(sessionMatches, syncNote);

          const syncedLoginLedger = loginRes.user?.id
            ? await resolveSyncedUserLedger(
                loginRes.user.id,
                sessionMatches,
                false
              )
            : { ledger: undefined, newlySettledCount: 0 };

          res.setHeader(
            "Set-Cookie",
            `yj_auth_tok=${loginRes.authToken}${cookieSuffix(req, 31536000)}`
          );
          return {
            authenticated: true,
            user: loginRes.user,
            authToken: loginRes.authToken,
            ledger: syncedLoginLedger.ledger,
            newlySettledCount: syncedLoginLedger.newlySettledCount,
            ...bundle,
          };
        }
      );
    }

    // 2. Encrypted Explicit Logout (/api/auth/logout)
    if (pathname === "/api/auth/logout" && req.method === "POST") {
      return runEncryptedRoute(
        req,
        res,
        ip,
        {
          endpoint: "auth/logout",
          maxBodyBytes: 16_000,
          fallbackError: "退出操作异常",
        },
        async ({ sess }) => {
          sess.authToken = null;
          res.setHeader("Set-Cookie", `yj_auth_tok=${cookieSuffix(req, 0)}`);
          return { loggedOut: true };
        }
      );
    }

    // 3. Encrypted Route-C Hybrid Iron-Cage Manual Q&A (/api/manual/ask)
    if (pathname === "/api/manual/ask" && req.method === "POST") {
      if (!manualQaEngine || !accountManager) {
        sendJson(res, 404, { ok: false, error: "Manual QA not enabled" });
        return true;
      }
      return runEncryptedRoute(
        req,
        res,
        ip,
        {
          endpoint: "manual/ask",
          maxBodyBytes: 32_000,
          requireAuth: true,
          fallbackError: "说明书助手繁忙，请稍后再试",
        },
        async ({ sess, data, user }) => {
          const qaRes = await manualQaEngine.answerManualQuestion({
            userId: user.id,
            question: data?.question,
            ip,
          });

          if (qaRes.accountLocked) {
            const unlockAt = tripFuse(ip, sess.sid, undefined, true, sess.hwFp);
            res.setHeader("Set-Cookie", [
              `yj_auth_tok=${cookieSuffix(req, 0)}`,
              `yj_sh_sid=fused${cookieSuffix(req, 172800)}`,
            ]);
            sendJson(res, 403, {
              ok: false,
              accountLocked: true,
              fused: true,
              unlockAt,
              error: qaRes.error,
            });
            return { __handled: true };
          }

          if (!qaRes.ok) {
            sendJson(res, qaRes.statusCode || 400, {
              ok: false,
              error: qaRes.error,
            });
            return { __handled: true };
          }

          return qaRes;
        }
      );
    }

    // 4. Encrypted Hidden Super-Admin RBAC Console Endpoints (/api/admin/*)
    if (pathname.startsWith("/api/admin/") && req.method === "POST") {
      if (!accountManager) {
        sendJson(res, 404, { ok: false, error: "Admin service not enabled" });
        return true;
      }
      const subEndpoint = pathname.slice("/api/".length);
      if (
        ![
          "admin/overview",
          "admin/create-user",
          "admin/update-user",
          "admin/delete-user",
        ].includes(subEndpoint)
      ) {
        sendJson(res, 404, { ok: false, error: "Admin endpoint not found" });
        return true;
      }
      return runEncryptedRoute(
        req,
        res,
        ip,
        {
          endpoint: subEndpoint,
          maxBodyBytes: 64_000,
          requireSuperAdmin: true,
          fallbackError: "管理操作鉴权失败",
          onDomainError: (err) => {
            const msg = String(err?.message || "");
            const safeMsg = /[\u4e00-\u9fff]/.test(msg) ? msg : "管理操作失败";
            sendJson(res, 400, { ok: false, error: safeMsg });
          },
        },
        async ({ sess, data, user }) => {
          if (subEndpoint === "admin/overview") {
            const stats = getBanStats();
            return {
              accounts: accountManager.listAccounts(),
              auditLogs: accountManager.listAuditLogs(),
              fusedIpsCount: stats.fusedIpsCount,
              fusedHwCount: stats.fusedHwCount,
            };
          }
          if (subEndpoint === "admin/create-user") {
            return accountManager.createAccount(data || {});
          }
          if (subEndpoint === "admin/update-user") {
            const updated = accountManager.updateAccount(
              data?.userId,
              data || {}
            );
            if (updated.freshAuthToken && data?.userId === user.id) {
              sess.authToken = updated.freshAuthToken;
              res.setHeader(
                "Set-Cookie",
                `yj_auth_tok=${updated.freshAuthToken}${cookieSuffix(req, 31536000)}`
              );
            }
            return {
              user: updated.user,
              newPassword: updated.newPassword,
              selfAuthToken:
                data?.userId === user.id ? updated.freshAuthToken : undefined,
            };
          }
          const delRes = accountManager.deleteAccount(data?.userId);
          if (delRes?.ok && ledgerManager && data?.userId) {
            ledgerManager.deleteUserLedger(String(data.userId));
          }
          return delRes;
        }
      );
    }

    // 5. Encrypted Personal Dual-Track Stop-Loss Ledger (/api/ledger/mutate)
    if (pathname === "/api/ledger/mutate" && req.method === "POST") {
      if (!ledgerManager || !accountManager) {
        sendJson(res, 404, { ok: false, error: "账本服务暂未启用" });
        return true;
      }
      return runEncryptedRoute(
        req,
        res,
        ip,
        {
          endpoint: "ledger/mutate",
          maxBodyBytes: 256_000,
          requireAuth: true,
          fallbackError: "账本安全校验失败或会话已过期",
          onDomainError: (err) => {
            const msg = String(err?.message || "");
            const safeMsg = /[\u4e00-\u9fff]/.test(msg)
              ? msg
              : "账本操作参数无效";
            sendJson(res, 400, { ok: false, error: safeMsg });
          },
        },
        async ({ sess, data, user }) => {
          const act = String(data?.action || "");
          const { matches } = await ensureMatchesLoaded(false);
          const sessionMatches = mergeSessionAlerts(matches, sess);

          if (act === "auto-settle") {
            const synced = await resolveSyncedUserLedger(
              user.id,
              sessionMatches,
              Boolean(data?.forceRefresh)
            );
            return {
              ok: true,
              newlySettledCount: synced.newlySettledCount,
              newlySettledTitles: synced.newlySettledTitles,
              ledger: synced.ledger,
            };
          }

          const mutated = ledgerManager.mutateUserLedger(user.id, data || {}, {
            authoritativeMatches: sessionMatches,
          });

          const shouldAutoSyncNow =
            mutated.ok &&
            (act === "add-entry" ||
              (act === "settle-entry" && data?.status === "pending")) &&
            ledgerManager.hasPendingSnapshots?.(user.id);

          if (shouldAutoSyncNow) {
            const synced = await resolveSyncedUserLedger(
              user.id,
              sessionMatches,
              false
            );
            return {
              ...mutated,
              ledger: synced.ledger,
              newlySettledCount: synced.newlySettledCount,
            };
          }
          return mutated;
        }
      );
    }

    // 6. Encrypted Black-Box Quant Workspace Compute (/api/quant/compute)
    if (pathname === "/api/quant/compute" && req.method === "POST") {
      return runEncryptedRoute(
        req,
        res,
        ip,
        {
          endpoint: "quant/compute",
          maxBodyBytes: 400_000,
          requireAuth: true,
          fallbackError: "加密信封校验失败或会话已过期",
        },
        async ({ sess, data }) => {
          const { matches } = await ensureMatchesLoaded(false);
          const sessionMatches = mergeSessionAlerts(matches, sess);
          return evaluateQuantWorkspace(data, sessionMatches);
        }
      );
    }

    // 7. Encrypted Live Official Odds Sync (/api/quant/sync)
    if (pathname === "/api/quant/sync" && req.method === "POST") {
      return runEncryptedRoute(
        req,
        res,
        ip,
        {
          endpoint: "quant/sync",
          maxBodyBytes: 400_000,
          requireAuth: true,
          fallbackError: "同步校验失败",
        },
        async ({ sess, data, user }) => {
          const { matches, syncNote } = await ensureMatchesLoaded(true);
          const sessionMatches = mergeSessionAlerts(matches, sess);
          const workspace = evaluateQuantWorkspace(
            data?.workspaceParams || {},
            sessionMatches
          );
          const syncedLedger = user?.id
            ? await resolveSyncedUserLedger(user.id, sessionMatches, true)
            : { ledger: undefined, newlySettledCount: 0 };
          return {
            matches: sessionMatches,
            syncNote,
            workspace,
            ledger: syncedLedger.ledger,
            newlySettledCount: syncedLedger.newlySettledCount,
          };
        }
      );
    }

    // 8. Encrypted Single-Match Diagnosis (/api/xiaogao/analyze)
    if (pathname === "/api/xiaogao/analyze" && req.method === "POST") {
      return runEncryptedRoute(
        req,
        res,
        ip,
        {
          endpoint: "xiaogao/analyze",
          maxBodyBytes: 200_000,
          requireAuth: true,
          fallbackError: "安全会话已失效",
          onDomainError: (err) => {
            sendJson(res, err?.statusCode || 502, {
              ok: false,
              error: "服务繁忙，请稍后再试",
            });
          },
        },
        async ({ sess, data, user }) => {
          const apiKey = getApiKey();
          if (!apiKey || !xiaogaoService) {
            sendJson(res, 500, { ok: false, error: "服务暂未就绪" });
            return { __handled: true };
          }

          const { matches } = await ensureMatchesLoaded(false);
          const sessionMatches = mergeSessionAlerts(matches, sess);
          const targetMatch = sessionMatches.find(
            (m) => m.id === String(data?.matchId || "")
          );
          if (!targetMatch) {
            sendJson(res, 400, { ok: false, error: "未找到指定赛事盘口" });
            return { __handled: true };
          }
          const reqCtx = buildSingleMatchDiagnosisContext(
            targetMatch,
            data?.userNote
          );

          const qCheck = consumeUserAiQuota(user, res, sendJson);
          if (!qCheck.ok) return { __handled: true };

          const alert = await xiaogaoService.analyzeMatch(apiKey, reqCtx);
          setBoundedAlertMap(sess.aiAlerts, String(targetMatch.id), alert, 32);
          return { alert, aiRemaining: qCheck.remaining };
        }
      );
    }

    // 9. Encrypted Multi-Match Joint Parlay Diagnosis (/api/xiaogao/analyze-combo)
    if (pathname === "/api/xiaogao/analyze-combo" && req.method === "POST") {
      return runEncryptedRoute(
        req,
        res,
        ip,
        {
          endpoint: "xiaogao/analyze-combo",
          maxBodyBytes: 350_000,
          requireAuth: true,
          fallbackError: "安全会话已失效",
          onDomainError: (err) => {
            sendJson(res, err?.statusCode || 502, {
              ok: false,
              error: "服务繁忙，请稍后再试",
            });
          },
        },
        async ({ sess, data, user }) => {
          const apiKey = getApiKey();
          if (!apiKey || !xiaogaoService?.analyzeComboMatches) {
            sendJson(res, 500, { ok: false, error: "服务暂未就绪" });
            return { __handled: true };
          }

          const { matches } = await ensureMatchesLoaded(false);
          const sessionMatches = mergeSessionAlerts(matches, sess);

          const rawIds = Array.isArray(data?.matchIds) ? data.matchIds : [];
          const idSet = new Set(rawIds.filter(Boolean).map((x) => String(x)));
          const targetMatches = sessionMatches
            .filter((m) => idSet.has(m.id))
            .slice(0, 8);
          if (targetMatches.length < 2) {
            sendJson(res, 400, {
              ok: false,
              error: "请至少选择 2 场比赛再发起多场联合会诊",
            });
            return { __handled: true };
          }
          const sourceMode =
            data?.sourceMode === "custom" ? "custom" : "picked";
          const ws =
            sourceMode === "picked"
              ? evaluateQuantWorkspace(
                  {
                    picks: Array.isArray(data?.picks) ? data.picks : [],
                    multiple: data?.multiple ?? 5,
                    passSpec: data?.passSpec ?? { mode: "auto" },
                    syntheticSingleMode: data?.syntheticSingleMode,
                    planSpec: data?.planSpec ?? null,
                    subjectiveDeltaPct: Number(data?.subjectiveDeltaPct) || 0,
                    simVoidFirstMatch: Boolean(data?.simVoidFirstMatch),
                    targetIds: targetMatches.map((m) => m.id),
                    anchorToRadarPicks: Boolean(data?.anchorToRadarPicks),
                    budget: Number(data?.budget) || 100,
                    stance:
                      data?.stance === "home-lean" ||
                      data?.stance === "upset-watch"
                        ? data.stance
                        : "objective",
                    unlockFullAgg: Boolean(data?.unlockFullAgg),
                  },
                  sessionMatches
                )
              : null;
          const comboCtx = buildComboDiagnosisContext({
            sourceMode,
            targetMatches,
            picks: Array.isArray(data?.picks) ? data.picks : [],
            effectiveReport: ws?.effectiveReport ?? null,
            appliedPlan: ws?.appliedPlan ?? null,
            planSpec: data?.planSpec ?? null,
            insights: ws?.insights ?? null,
            userNote: data?.userNote,
          });

          const qCheck = consumeUserAiQuota(user, res, sendJson);
          if (!qCheck.ok) return { __handled: true };

          const comboReport = await xiaogaoService.analyzeComboMatches(
            apiKey,
            comboCtx
          );
          reconcileComboAlertsToMatchMap(
            comboReport,
            sessionMatches,
            sess.aiAlerts,
            32
          );
          return { comboReport, aiRemaining: qCheck.remaining };
        }
      );
    }

    return false;
  }

  return {
    ensureMatchesLoaded,
    resolveSyncedUserLedger,
    resolveBootstrapSession,
    handlePublicStatus,
    handleDomainRoute,
  };
}
