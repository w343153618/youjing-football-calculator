import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createYouJingRuntime } from '../server/runtimeApp.mjs';
import {
  computeEnvelopeHmacHex,
  decryptEnvelope,
  deriveSessionSubkeys,
  encryptEnvelope,
} from '../server/securityShield.mjs';
import * as quantModule from '../server/quantEngine.mjs';
import { FALLBACK_MATCHES, evaluateQuantWorkspace } from '../server/quantEngine.mjs';
import { createBetSlipController } from '../src/workspace/betSlipController.ts';
import type { MatchItem } from '../src/prototype/quantTypes.ts';

const REAL_BROWSER_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'sec-fetch-mode': 'cors',
};

function makeExchange(opts: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  remoteAddress?: string;
  body?: unknown;
}) {
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    url: string;
    headers: Record<string, string>;
    socket: { remoteAddress: string };
    destroy?: () => void;
  };
  req.method = opts.method || 'POST';
  req.url = opts.url || '/';
  req.headers = Object.fromEntries(
    Object.entries(opts.headers || {}).map(([k, v]) => [k.toLowerCase(), v])
  );
  req.socket = { remoteAddress: opts.remoteAddress || '198.51.100.77' };
  req.destroy = () => {};

  let statusCode = 200;
  const respHeaders: Record<string, string | string[]> = {};
  let rawOut = '';
  let headersSent = false;

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(v: number) {
      statusCode = v;
    },
    get headersSent() {
      return headersSent;
    },
    setHeader(k: string, v: string | string[]) {
      respHeaders[k.toLowerCase()] = v;
    },
    end(chunk = '') {
      headersSent = true;
      rawOut += String(chunk);
    },
  };

  const triggerBody = () => {
    queueMicrotask(() => {
      if (opts.body !== undefined) {
        req.emit('data', Buffer.from(JSON.stringify(opts.body), 'utf8'));
      }
      req.emit('end');
    });
  };

  return {
    req,
    res,
    triggerBody,
    getResult: () => ({ statusCode, headers: respHeaders, body: rawOut }),
  };
}

describe('Spec 0006 Seam 2 & 3: Unified Server Runtime, Encrypted Route Pipeline & Server-Owned XiaoGao Context', () => {
  it('assembles full stack via createYouJingRuntime and builds authoritative XiaoGao single & combo prompts from minimal ID/pick payloads', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yj-arch-0006-'));
    const capturedPrompts: string[] = [];

    const runtime = createYouJingRuntime({
      dataDir: tmpDir,
      getApiKey: () => 'test-key-0006',
      enableXiaoGaoProbe: false,
      fetchMatches: async () => ({ matches: FALLBACK_MATCHES, syncNote: '测试固定快照' }),
      xiaogaoTransport: async (_apiKey: string, _model: string, messages: Array<{ role: string; content: string }>) => {
        const userMsg = messages.find((m) => m.role === 'user')?.content || '';
        capturedPrompts.push(userMsg);
        if (userMsg.includes('会诊模式')) {
          return JSON.stringify({
            level: 'high',
            comboTag: '2串1·防次关小胜卡盘',
            summary: '两场串关连乘抽水偏高，需防强队一球小胜。',
            weakestLeg: '首关一球卡盘风险突出。',
            structureAdvice: '建议启用博胆护盾防平。',
            priceInVerdict: '主胜低水已消化市场预期。',
            perMatch: [
              {
                matchId: FALLBACK_MATCHES[0].id,
                matchTitle: `${FALLBACK_MATCHES[0].matchNumStr} ${FALLBACK_MATCHES[0].home}vs${FALLBACK_MATCHES[0].away}`,
                tag: '防一球卡盘',
                note: '主胜热度偏高。',
                priceInStatus: '利好已入价',
              },
            ],
          });
        }
        return JSON.stringify({
          level: 'high',
          tag: '警惕一球卡盘',
          summary: '当前胜平负与让球盘利差收窄，强队净胜一球概率较高。',
          priceInStatus: '主胜水位已提前下调消化热度',
          suggestedDelta: '建议主胜微调 -3%',
        });
      },
    });

    try {
      // Create test member via unified runtime accountManager
      const created = runtime.accountManager.createAccount({
        username: 'arch_member',
        note: 'Spec 0006 测试员',
        durationHours: 24,
        maxDevices: 2,
        aiEnabled: true,
        dailyAiLimit: 10,
      });

      // 1. Handshake
      const bootEx = makeExchange({
        method: 'POST',
        url: '/api/security/bootstrap',
        headers: REAL_BROWSER_HEADERS,
        body: { v: 1, tz: 'Asia/Shanghai', hwFp: 'a'.repeat(64) },
      });
      bootEx.triggerBody();
      await runtime.gateway.handleRequest(bootEx.req, bootEx.res, '/api/security/bootstrap');
      const bootJson = JSON.parse(bootEx.getResult().body);
      assert.equal(bootJson.ok, true);
      const { aesKey, hmacKey } = deriveSessionSubkeys(Buffer.from(bootJson.k, 'base64'));

      const postEnc = async (endpoint: string, payload: unknown, nonce: string) => {
        const ts = String(Date.now());
        const env = encryptEnvelope(aesKey, payload);
        const sig = computeEnvelopeHmacHex(
          hmacKey,
          bootJson.sid,
          endpoint,
          ts,
          nonce,
          env.iv,
          env.d
        );
        const ex = makeExchange({
          method: 'POST',
          url: `/api/${endpoint}`,
          headers: {
            ...REAL_BROWSER_HEADERS,
            'x-yj-sid': bootJson.sid,
            'x-yj-ts': ts,
            'x-yj-nonce': nonce,
            'x-yj-sig': sig,
          },
          body: env,
        });
        ex.triggerBody();
        await runtime.gateway.handleRequest(ex.req, ex.res, `/api/${endpoint}`);
        const res = ex.getResult();
        assert.equal(res.statusCode, 200, `Expected 200 on ${endpoint}, got ${res.statusCode}: ${res.body}`);
        const body = JSON.parse(res.body);
        return decryptEnvelope(aesKey, body.payload.iv, body.payload.d);
      };

      // 2. Login
      const loginData = await postEnc(
        'auth/login',
        {
          username: 'arch_member',
          password: created.plainPassword,
          hwFp: 'a'.repeat(64),
          deviceLabel: 'MacTest',
        },
        '1'.repeat(32)
      );
      assert.equal(loginData.authenticated, true);

      // 3. Single-match XiaoGao diagnosis with ONLY { matchId, userNote } (zero client string formatting!)
      const m0 = FALLBACK_MATCHES[0];
      const singleRes = await postEnc(
        'xiaogao/analyze',
        { matchId: m0.id, userNote: '主力前锋轮休' },
        '2'.repeat(32)
      );
      assert.equal(singleRes.alert.tag, '警惕一球卡盘');
      assert.equal(singleRes.aiRemaining, 9);
      assert.ok(capturedPrompts[0].includes(m0.home), 'Server must populate match home team from authoritative snapshot');
      assert.ok(capturedPrompts[0].includes('胜平负抽水'), 'Server must compute vigSummary on server');
      assert.ok(capturedPrompts[0].includes('主力前锋轮休'), 'Server must include sanitized userNote');

      // 4. Multi-match Combo diagnosis with ONLY { sourceMode, matchIds, picks, multiple, passSpec, userNote }
      // Even if a tampered client sends spoofed odds=999 or optionLabel="HACK", server MUST use authoritative odds!
      const m1 = FALLBACK_MATCHES[1];
      const twoPicks = [m0, m1].map((m) => ({
        matchId: m.id,
        matchNumStr: m.matchNumStr,
        home: m.home,
        away: m.away,
        poolCode: 'HAD',
        poolName: 'SPOOFED_POOL',
        singleAllowed: m.pools.HAD.single,
        optionKey: 'h',
        optionLabel: 'SPOOFED_LABEL',
        odds: 999.99,
        fairProb: m.pools.HAD.options[0].fairProb,
      }));
      const comboRes = await postEnc(
        'xiaogao/analyze-combo',
        {
          sourceMode: 'picked',
          matchIds: [m0.id, m1.id],
          picks: twoPicks,
          multiple: 5,
          passSpec: { mode: 'auto' },
          userNote: '准备重注晚场',
        },
        '3'.repeat(32)
      );
      assert.equal(comboRes.comboReport.comboTag, '2串1·防次关小胜卡盘');
      assert.equal(comboRes.aiRemaining, 8);
      assert.ok(capturedPrompts[1].includes('总投入¥10'), 'Server must compute authoritative parlay orderSummary');
      assert.ok(capturedPrompts[1].includes('胜平负[主胜@'), 'Server must format picked leg descriptions from authoritative snapshot');
      assert.equal(capturedPrompts[1].includes('SPOOFED'), false, 'Server must ignore spoofed client option labels/odds');

      // 5. Pre-RBAC invalid envelope on /api/admin/create-user MUST return 401 without leaking English error text
      const unauthAdminEx = makeExchange({
        method: 'POST',
        url: '/api/admin/create-user',
        headers: REAL_BROWSER_HEADERS,
        body: { iv: 'bad', d: 'bad' },
      });
      unauthAdminEx.triggerBody();
      await runtime.gateway.handleRequest(unauthAdminEx.req, unauthAdminEx.res, '/api/admin/create-user');
      const unauthAdminRes = unauthAdminEx.getResult();
      assert.equal(unauthAdminRes.statusCode, 401);
      assert.equal(/[A-Za-z]{4,}/.test(JSON.parse(unauthAdminRes.body).error), false);
    } finally {
      runtime.dispose();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});


describe('Spec 0006 Seam 1: Deep Bet-Slip & Workspace State Module + Shallow Wrapper Cleanup', () => {
  it('drives selection mutex, dual-single auto-lock, mode trimming, pass/multiplier dock, radar sync, and presets via injected in-memory quant adapter', async () => {
    const ctrl = createBetSlipController({
      debounceMs: 0,
      computeWorkspace: (params, matches) => evaluateQuantWorkspace(params, matches),
    });

    const m0 = FALLBACK_MATCHES[0] as MatchItem;
    const m1 = FALLBACK_MATCHES[1] as MatchItem;
    const m2 = FALLBACK_MATCHES[2] as MatchItem;
    const initialWorkspace = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: [m0.id, m1.id],
        budget: 100,
        stance: 'objective',
        unlockFullAgg: false,
      },
      FALLBACK_MATCHES as MatchItem[]
    );

    ctrl.initializeMatches(FALLBACK_MATCHES as MatchItem[], [], initialWorkspace);
    assert.equal(ctrl.getState().picks.length, 0);

    // 1. Same-match cross-pool parlay mutex in 'mix' mode
    const addHad = await ctrl.togglePick(m0, 'HAD', 'h');
    assert.equal(addHad.ok, true);
    assert.equal(addHad.action, 'added');
    assert.equal(ctrl.isPoolMutexLocked(m0, 'HHAD'), true);

    const blockedCross = await ctrl.togglePick(m0, 'HHAD', 'hd');
    assert.equal(blockedCross.ok, false);
    assert.ok(blockedCross.blockedReason?.includes('同一场比赛只能选择一种玩法'));

    // Same-pool multi-select is allowed
    const addSamePool = await ctrl.togglePick(m0, 'HAD', 'd');
    assert.equal(addSamePool.ok, true);
    assert.equal(ctrl.getState().picks.length, 2);

    // 2. Dual-single HAD + HHAD auto-locks [1] in 'spf' mode, and switching back to 'mix' trims second pool
    await ctrl.clearPicks();
    const dualSingleMatch: MatchItem = {
      ...m0,
      pools: {
        ...m0.pools,
        HAD: { ...m0.pools.HAD, single: true },
        HHAD: { ...m0.pools.HHAD, single: true },
      },
    };
    const allMatches = [dualSingleMatch, ...FALLBACK_MATCHES.slice(1)] as MatchItem[];
    ctrl.initializeMatches(allMatches, [], initialWorkspace);
    await ctrl.setMode('spf');
    assert.equal((await ctrl.togglePick(dualSingleMatch, 'HAD', 'h')).ok, true);
    const addDualHhad = await ctrl.togglePick(dualSingleMatch, 'HHAD', 'hd');
    assert.equal(addDualHhad.ok, true);
    assert.equal(addDualHhad.autoLockedSingleReason, 'dual-single');
    assert.deepEqual(ctrl.getState().passSpec, { mode: 'free', passSizes: [1] });
    assert.equal(ctrl.getState().workspace.manualReport.modeLabel, '单关');

    const modeTrim = await ctrl.setMode('mix');
    assert.equal(modeTrim.trimmed, true);
    assert.equal(ctrl.getState().picks.length, 1);

    // 3. Pass selection (3串4) + Multiplier clamping (1~999) + Bonus Optimization + Scale + Restore
    await ctrl.togglePick(m1, 'HAD', 'h');
    await ctrl.togglePick(m2, 'HAD', 'h');
    assert.equal(ctrl.getState().workspace.manualReport.modeLabel, '3串1');

    const c3x4 = ctrl.getState().workspace.manualReport.availableComboPasses.find((c) => c.label === '3串4')!;
    const comboRes = ctrl.selectComboPass(c3x4.code);
    assert.equal(comboRes.ok, true);
    assert.equal(ctrl.getState().workspace.manualReport.modeLabel, '3串4');
    assert.equal(ctrl.getState().workspace.manualReport.comboCount, 4);

    ctrl.setDirectMultiple(1500);
    assert.equal(ctrl.getState().multiple, 999);
    ctrl.setDirectMultiple(2);
    assert.equal(ctrl.getState().multiple, 2);

    const bonusRes = ctrl.applyBonusOptimization('equal');
    assert.equal(bonusRes.ok, true);
    assert.ok(ctrl.getState().planSpec?.kind === 'bonus');
    ctrl.scaleAppliedPlanBy(2);
    assert.equal(ctrl.getState().planSpec?.scaleMultiple, 2);
    ctrl.restoreEqualMultiple();
    assert.equal(ctrl.getState().planSpec, null);

    // 4. Five-Archetype Radar Pick Sync + Stale Signature Tracking
    const syncRes = ctrl.syncRadarPicksToArchetypes();
    assert.equal(syncRes.ok, true);
    assert.equal(syncRes.syncedCount, 3);
    assert.equal(ctrl.getState().anchorToRadarPicks, true);
    assert.equal(ctrl.isRadarSyncCurrent(), true);
    ctrl.togglePick(m2, 'HAD', 'd');
    assert.equal(ctrl.isRadarSyncCurrent(), false);

    // 5. Preset scenarios
    for (const kind of ['underwater', 'synthetic', 'parlay4', 'hedge2'] as const) {
      ctrl.loadPresetScenario(kind);
      assert.ok(ctrl.getState().picks.length >= 1, `Preset ${kind} should populate picks`);
    }

    // 6. Over-8 all-single matches auto-locks [1] up to 15 matches, and blocks 16th match;
    //    also allows unpicking an already-picked option even if pool later suspends!
    const sixteenSingleMatches: MatchItem[] = Array.from({ length: 16 }, (_, idx) => ({
      ...m0,
      id: `sgl-${idx + 1}`,
      matchNumStr: `周六${String(idx + 1).padStart(3, '0')}`,
      pools: {
        ...m0.pools,
        HAD: { ...m0.pools.HAD, single: true },
      },
    }));
    ctrl.applyAuthenticatedBundle({
      matches: sixteenSingleMatches,
      initialPicks: [],
      workspace: evaluateQuantWorkspace({ picks: [], multiple: 5 }, sixteenSingleMatches),
    });
    assert.equal(ctrl.getState().multiple, 5, 'applyAuthenticatedBundle must reset modified multiple');
    assert.equal(ctrl.getState().anchorToRadarPicks, false, 'applyAuthenticatedBundle must reset anchor flag');

    ctrl.setMode('single');
    for (let i = 0; i < 8; i++) {
      assert.equal(ctrl.togglePick(sixteenSingleMatches[i], 'HAD', 'h').ok, true);
    }
    const ninthSingle = ctrl.togglePick(sixteenSingleMatches[8], 'HAD', 'h');
    assert.equal(ninthSingle.ok, true);
    assert.equal(ninthSingle.autoLockedSingleReason, 'over-8-matches');
    assert.deepEqual(ctrl.getState().passSpec, { mode: 'free', passSizes: [1] });

    for (let i = 9; i < 15; i++) {
      assert.equal(ctrl.togglePick(sixteenSingleMatches[i], 'HAD', 'h').ok, true);
    }
    const sixteenthAttempt = ctrl.togglePick(sixteenSingleMatches[15], 'HAD', 'h');
    assert.equal(sixteenthAttempt.ok, false);
    assert.ok(sixteenthAttempt.blockedReason?.includes('15'));

    // Suspend match 0 pool and verify user can still remove the already-selected pick!
    const suspendedFirst: MatchItem = {
      ...sixteenSingleMatches[0],
      pools: {
        ...sixteenSingleMatches[0].pools,
        HAD: { ...sixteenSingleMatches[0].pools.HAD, selling: false, options: [] },
      },
    };
    const removeSuspended = ctrl.togglePick(suspendedFirst, 'HAD', 'h');
    assert.equal(removeSuspended.ok, true);
    assert.equal(removeSuspended.action, 'removed');

    // 7. Debounced controller never hangs superseded promises & preserves aiAlert across applyMatchesSync
    const debouncedCtrl = createBetSlipController({
      debounceMs: 20,
      computeWorkspace: async (params, matches) => evaluateQuantWorkspace(params, matches),
    });
    debouncedCtrl.applyAuthenticatedBundle({
      matches: FALLBACK_MATCHES as MatchItem[],
      initialPicks: [],
      workspace: initialWorkspace,
    });
    const pAlert1 = debouncedCtrl.applyMatchAiAlert(m0.id, {
      level: 'high',
      tag: '测试排雷签',
      summary: '摘要',
      priceInStatus: '已消化',
      source: '扫地僧小高',
    });
    const pCombo = debouncedCtrl.applyComboAiReport({
      level: 'medium',
      source: '扫地僧小高',
      perMatch: [
        {
          matchId: m1.id,
          matchTitle: `${m1.matchNumStr} ${m1.home}vs${m1.away}`,
          tag: '联合签',
          note: '点评',
          priceInStatus: '未消化',
        },
      ],
    });
    await Promise.all([pAlert1, pCombo]);
    assert.equal(debouncedCtrl.getState().matches[0].aiAlert?.tag, '测试排雷签');
    assert.equal(debouncedCtrl.getState().matches[1].aiAlert?.tag, '联合签');

    debouncedCtrl.togglePick(m0, 'HAD', 'h');
    debouncedCtrl.togglePick(m1, 'HAD', 'h');
    await debouncedCtrl.flush();
    assert.equal(debouncedCtrl.getState().workspace.manualReport.matchCount, 2);

    // Sync dropping m1 without aiAlert on m0 -> preserves m0.aiAlert and recalculates workspace to 1 match!
    const onlyM0 = [{ ...(m0 as MatchItem), aiAlert: undefined }];
    debouncedCtrl.applyMatchesSync({
      matches: onlyM0,
      workspace: debouncedCtrl.getState().workspace,
    });
    await debouncedCtrl.flush();
    assert.equal(debouncedCtrl.getState().matches[0].aiAlert?.tag, '测试排雷签');
    assert.equal(debouncedCtrl.getState().picks.length, 1);
    assert.equal(debouncedCtrl.getState().workspace.manualReport.matchCount, 1);
  });

  it('removes shallow xiaogaoClient.ts and uncalled/duplicate exports from server/quantEngine.mjs', () => {
    const xiaogaoClientPath = path.resolve(process.cwd(), 'src/intel/xiaogaoClient.ts');
    assert.equal(fs.existsSync(xiaogaoClientPath), false, 'Shallow xiaogaoClient.ts must be deleted');
    assert.equal('validateSportteryPickToggle' in quantModule, false, 'Uncalled test-only validator must be removed');
    assert.equal('makeUnderwaterDemoPicks' in quantModule, false, 'Duplicate preset helper must be removed from server');
  });
});
