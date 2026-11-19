import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  FALLBACK_MATCHES,
  OFFICIAL_CRS_PAIRS,
  evaluateQuantWorkspace,
  parseSportteryRawJson,
} from '../server/quantEngine.mjs';
import { createManualQaEngine } from '../server/manualQaEngine.mjs';
import { createYouJingRuntime } from '../server/runtimeApp.mjs';
import {
  computeEnvelopeHmacHex,
  decryptEnvelope,
  deriveSessionSubkeys,
  encryptEnvelope,
} from '../server/securityShield.mjs';
import { createBetSlipController } from '../src/workspace/betSlipController.ts';
import type { ArchetypePlan, MatchItem } from '../src/prototype/quantTypes.ts';

function buildCoherentTestMatch(
  id: string,
  numStr: string,
  lamH: number,
  lamA: number,
  lag?: { poolCode: 'HHAD' | 'TTG' | 'CRS'; key: string; mult: number }
): MatchItem {
  const pX = Array.from({ length: 11 }, (_, k) => {
    let f = 1;
    for (let i = 2; i <= k; i++) f *= i;
    return (Math.exp(-lamH) * Math.pow(lamH, k)) / f;
  });
  const pY = Array.from({ length: 11 }, (_, k) => {
    let f = 1;
    for (let i = 2; i <= k; i++) f *= i;
    return (Math.exp(-lamA) * Math.pow(lamA, k)) / f;
  });
  let h = 0;
  let d = 0;
  let a = 0;
  let hh = 0;
  let hd = 0;
  let ha = 0;
  const ttg = Array(8).fill(0);
  const crsMap: Record<string, number> = {};
  for (const [, lbl] of OFFICIAL_CRS_PAIRS) crsMap[lbl] = 0;
  const explicitSet = new Set(OFFICIAL_CRS_PAIRS.map(([, l]: [string, string]) => l));
  for (let x = 0; x <= 10; x++) {
    for (let y = 0; y <= 10; y++) {
      const p = pX[x] * pY[y];
      if (x > y) h += p;
      else if (x === y) d += p;
      else a += p;
      if (x - 1 > y) hh += p;
      else if (x - 1 === y) hd += p;
      else ha += p;
      ttg[Math.min(7, x + y)] += p;
      const lbl = `${x}:${y}`;
      if (explicitSet.has(lbl)) crsMap[lbl] += p;
      else if (x > y) crsMap['胜其它'] += p;
      else if (x === y) crsMap['平其它'] += p;
      else crsMap['负其它'] += p;
    }
  }
  const toOdds = (p: number, R: number, z: number) => {
    const V = 1 / R;
    const q = Math.sqrt(V * Math.max(1e-6, p) * ((1 - z) * Math.max(1e-6, p) + z));
    return Number(Math.max(1.06, 1 / q).toFixed(2));
  };
  const raw: Record<string, unknown> & {
    ttg: Record<string, string>;
    hhad: Record<string, string>;
    crs: Record<string, string>;
  } = {
    matchId: id,
    matchNumStr: numStr,
    leagueAbbName: '精算联赛',
    matchTime: '21:00:00',
    homeTeamAbbName: `主${numStr}`,
    awayTeamAbbName: `客${numStr}`,
    poolList: [
      { poolCode: 'HAD', single: 1, cbtValue: 1 },
      { poolCode: 'HHAD', single: 1, cbtValue: 1 },
      { poolCode: 'TTG', single: 1, cbtValue: 1 },
      { poolCode: 'HAFU', single: 0, cbtValue: 2, poolStatus: 'Suspended' },
      { poolCode: 'CRS', single: 1, cbtValue: 1 },
    ],
    had: {
      h: String(toOdds(h, 0.88, 0.05)),
      d: String(toOdds(d, 0.88, 0.05)),
      a: String(toOdds(a, 0.88, 0.05)),
    },
    hhad: {
      goalLine: '-1',
      h: String(toOdds(hh, 0.88, 0.05)),
      d: String(toOdds(hd, 0.88, 0.05)),
      a: String(toOdds(ha, 0.88, 0.05)),
    },
    ttg: Object.fromEntries(ttg.map((p, idx) => [`s${idx}`, String(toOdds(p, 0.8, 0.06))])),
    crs: Object.fromEntries(
      OFFICIAL_CRS_PAIRS.map(([rawK, lbl]: [string, string]) => [
        rawK,
        String(toOdds(crsMap[lbl], 0.75, 0.08)),
      ])
    ),
  };
  raw.crs.s00s00 = raw.ttg.s0;
  const synDa = 1 / (1 / Number(raw.had.d) + 1 / Number(raw.had.a));
  const invHa = 1 / synDa;
  const remInv = Math.max(0.12, 1 / 0.88 - invHa);
  const rawInvHh = 1 / Number(raw.hhad.h);
  const rawInvHd = 1 / Number(raw.hhad.d);
  const scaleHd = remInv / (rawInvHh + rawInvHd);
  raw.hhad.a = synDa.toFixed(2);
  raw.hhad.h = Math.max(1.06, 1 / (rawInvHh * scaleHd)).toFixed(2);
  raw.hhad.d = Math.max(1.06, 1 / (rawInvHd * scaleHd)).toFixed(2);
  if (lag) {
    if (lag.poolCode === 'TTG') {
      raw.ttg[lag.key] = String(Number((Number(raw.ttg[lag.key]) * lag.mult).toFixed(2)));
    } else if (lag.poolCode === 'HHAD') {
      raw.hhad[lag.key] = String(Number((Number(raw.hhad[lag.key]) * lag.mult).toFixed(2)));
    } else if (lag.poolCode === 'CRS') {
      const pair = OFFICIAL_CRS_PAIRS.find(([, l]: [string, string]) => l === lag.key)!;
      raw.crs[pair[0]] = String(Number((Number(raw.crs[pair[0]]) * lag.mult).toFixed(2)));
    }
  }
  return parseSportteryRawJson({ value: { matchInfoList: [{ subMatchList: [raw] }] } })[0];
}

describe('Spec 0008 · Seam C: Bet-Slip Controller, Dual-Viewport 3+1 UI Contracts & Iron-Cage Manual Q&A', () => {
  it('Slice 1: createBetSlipController blocks empty/unavailable alpha-radar plans, applies valid 3+1 slots, and surfaces post-sync alpha-smoothed warnings', async () => {
    const tightA = buildCoherentTestMatch('c-tight-a', '周六201', 1.45, 1.15);
    const tightB = buildCoherentTestMatch('c-tight-b', '周六202', 1.25, 1.3);
    const tightC = buildCoherentTestMatch('c-tight-c', '周六203', 1.55, 1.05);
    const tightMatches = [tightA, tightB, tightC];

    const ctrl = createBetSlipController({
      debounceMs: 0,
      computeWorkspace: (params, matches) => evaluateQuantWorkspace(params, matches),
    });

    ctrl.initializeMatches(
      tightMatches,
      [],
      evaluateQuantWorkspace(
        {
          picks: [],
          multiple: 5,
          subjectiveDeltaPct: 0,
          simVoidFirstMatch: false,
          planSpec: null,
          targetIds: [tightA.id, tightB.id, tightC.id],
          budget: 100,
          stance: 'objective',
          unlockFullAgg: false,
        },
        tightMatches
      )
    );
    ctrl.selectTargetSlice(3);

    // User manually picks 2 matches first
    assert.equal(ctrl.togglePick(tightA, 'HAD', 'h').ok, true);
    assert.equal(ctrl.togglePick(tightB, 'HAD', 'h').ok, true);
    assert.equal(ctrl.getState().picks.length, 2);
    assert.equal(ctrl.getState().planSpec, null);

    // Slot ④ on tightly priced slate is unavailable (empty state)
    const emptyAlpha = ctrl
      .getState()
      .workspace.portfolioPlans.find((p) => p.key === 'alpha-radar')!;
    assert.equal(emptyAlpha.available, false);
    assert.equal(emptyAlpha.lines.length, 0);

    // Guard 1: Attempting to apply unavailable plan MUST return false and preserve existing picks & planSpec!
    const refusedUnavailable = ctrl.applyArchetype(emptyAlpha);
    assert.equal(refusedUnavailable, false, 'applyArchetype must return false for available === false');
    assert.equal(ctrl.getState().planSpec, null, 'Must not overwrite planSpec with empty plan');
    assert.equal(ctrl.getState().picks.length, 2, 'Must not wipe user manual picks when refusing empty plan');

    // Guard 2: Attempting to apply a malformed plan with available=true but lines=[] MUST also be refused!
    const malformedEmptyLines: ArchetypePlan = {
      ...emptyAlpha,
      available: true,
      lines: [],
    };
    assert.equal(ctrl.applyArchetype(malformedEmptyLines), false);
    assert.equal(ctrl.getState().planSpec, null);
    assert.equal(ctrl.getState().picks.length, 2);

    // Valid Slot ② (max-ev-utility) and Slot ③ (max-cvar-wheel) apply cleanly
    const evPlan = ctrl
      .getState()
      .workspace.portfolioPlans.find((p) => p.key === 'max-ev-utility')!;
    assert.equal(ctrl.applyArchetype(evPlan), true);
    assert.equal(ctrl.getState().planSpec?.kind, 'archetype');
    if (ctrl.getState().planSpec?.kind === 'archetype') {
      assert.equal(ctrl.getState().planSpec.key, 'max-ev-utility');
    }
    assert.equal(ctrl.getState().workspace.appliedPlan?.key, 'max-ev-utility');

    const wheelPlan = ctrl
      .getState()
      .workspace.portfolioPlans.find((p) => p.key === 'max-cvar-wheel')!;
    assert.equal(ctrl.applyArchetype(wheelPlan), true);
    assert.equal(ctrl.getState().workspace.appliedPlan?.key, 'max-cvar-wheel');

    // Post-sync degradation flow: apply available alpha-radar on lagged slate, then sync smoothed official odds
    const laggedA = buildCoherentTestMatch('c-lag-a', '周六301', 1.5, 1.1, {
      poolCode: 'TTG',
      key: 's2',
      mult: 1.26,
    });
    const laggedSlate = [laggedA, tightB];
    ctrl.applyAuthenticatedBundle({
      matches: laggedSlate,
      initialPicks: [],
      workspace: evaluateQuantWorkspace(
        {
          picks: [],
          multiple: 5,
          subjectiveDeltaPct: 0,
          simVoidFirstMatch: false,
          planSpec: null,
          targetIds: [laggedA.id, tightB.id],
          budget: 100,
          stance: 'objective',
          unlockFullAgg: false,
        },
        laggedSlate
      ),
    });
    const activeAlpha = ctrl
      .getState()
      .workspace.portfolioPlans.find((p) => p.key === 'alpha-radar')!;
    assert.equal(activeAlpha.available, true);
    assert.equal(ctrl.applyArchetype(activeAlpha), true);
    const maxPayoutBeforeSync = ctrl.getState().workspace.effectiveReport.maxPayout;

    // Official sync arrives with lag smoothed out
    const smoothedA = buildCoherentTestMatch('c-lag-a', '周六301', 1.5, 1.1);
    const smoothedSlate = [smoothedA, tightB];
    const serverSyncWs = evaluateQuantWorkspace(ctrl.buildWorkspaceParams(), smoothedSlate);
    ctrl.applyMatchesSync({ matches: smoothedSlate, workspace: serverSyncWs });
    await ctrl.flush();

    const postSyncState = ctrl.getState();
    assert.ok(postSyncState.workspace.appliedPlan, 'Frozen snapshotPlan remains mounted after sync');
    assert.equal(
      postSyncState.workspace.portfolioPlans.find((p) => p.key === 'alpha-radar')?.available,
      false,
      'Live Slot ④ switches to unavailable empty state after lag smoothed'
    );
    assert.equal(postSyncState.workspace.effectiveReport.warnings[0]?.id, 'alpha-smoothed');
    assert.ok(
      postSyncState.workspace.effectiveReport.warnings[0]?.title.includes('已被官方最新调水抚平')
    );
    assert.ok(postSyncState.workspace.allWarnings.some((w) => w.id === 'alpha-smoothed'));
    assert.ok(postSyncState.workspace.effectiveReport.maxPayout < maxPayoutBeforeSync);
  });

  it('Slice 2: Iron-Cage Manual Q&A serves 0ms local-kb answers for 3+1 portfolio, empty alpha-radar, covering-wheel & coherent calibration (plus legacy 五流派 compatibility) while preserving >4 strike lockout & zero vendor leaks across encrypted runtime', async () => {
    let quotaCalls = 0;
    let strikes = 0;
    const qa = createManualQaEngine({
      accountManager: {
        recordQaViolation: () => {
          strikes += 1;
          return { locked: strikes > 4, strikeCount: strikes, maxAllowed: 4 };
        },
        consumeAiQuota: () => {
          quotaCalls += 1;
          return { ok: true, remaining: 10 - quotaCalls };
        },
      },
      xiaogaoService: null,
      getApiKey: () => '',
    });

    const vendorLeakRe = /deepseek|glm|opencode|chatgpt|openai|claude|anthropic|qwen|doubao|豆包|kimi|moonshot/i;
    for (const topic of qa.localTopics) {
      assert.equal(
        vendorLeakRe.test(`${topic.question}\n${topic.answer}`),
        false,
        `Local KB topic ${topic.id} must never leak model/vendor names`
      );
    }

    const expectedLocalCases: Array<{ q: string; mustInclude: string[]; expectedSection: string }> = [
      {
        q: '为什么错价雷达会显示空仓？',
        mustInclude: ['空仓', '洼地'],
        expectedSection: 'archetypes',
      },
      {
        q: '什么是旋转矩阵缩水？',
        mustInclude: ['旋转矩阵', '10'],
        expectedSection: 'archetypes',
      },
      {
        q: '什么是跨盘联合校准？',
        mustInclude: ['联合校准', '闭合'],
        expectedSection: 'glossary',
      },
      {
        q: '精算配单四档方案有什么区别？',
        mustInclude: ['稳健保本', '期望效用', '容错缩水', '错价雷达'],
        expectedSection: 'archetypes',
      },
      {
        q: '原来的五流派去哪了？',
        mustInclude: ['精算配单', '稳健保本'],
        expectedSection: 'archetypes',
      },
    ];

    for (const tc of expectedLocalCases) {
      const res = await qa.answerManualQuestion({
        userId: 'u-spec0008',
        question: tc.q,
        ip: '127.0.0.1',
      });
      assert.equal(res.ok, true);
      assert.equal(res.source, 'local-kb', `Question "${tc.q}" must resolve in 0ms from local-kb`);
      assert.equal(res.jumpSection, tc.expectedSection);
      for (const kw of tc.mustInclude) {
        assert.ok(
          res.answer?.includes(kw),
          `Answer for "${tc.q}" must include "${kw}", got: ${res.answer}`
        );
      }
      assert.equal(vendorLeakRe.test(res.answer || ''), false);
    }
    assert.equal(quotaCalls, 0, 'Local KB hits must consume 0 AI quota');

    // Full-stack encrypted runtime verification (Seam C: createYouJingRuntime)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yj-seam-c-0008-'));
    const tightA = buildCoherentTestMatch('rt-tight-a', '周日001', 1.45, 1.15);
    const tightB = buildCoherentTestMatch('rt-tight-b', '周日002', 1.25, 1.3);
    const runtime = createYouJingRuntime({
      dataDir: tmpDir,
      getApiKey: () => 'mock-key-0008',
      enableXiaoGaoProbe: false,
      fetchMatches: async () => ({ matches: [tightA, tightB], syncNote: '测试严密盘快照' }),
      xiaogaoTransport: async () =>
        JSON.stringify({
          outOfScope: false,
          section: 'archetypes',
          answer: '在精算配单中可优先选用稳健保本（由 OpenCode 与 glm-5.3-flash 生成）。',
        }),
    });

    const REAL_HEADERS = {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      accept: 'application/json,text/plain,*/*',
      'accept-language': 'zh-CN,zh;q=0.9',
      'sec-fetch-mode': 'cors',
    };

    const runHttp = async (url: string, headers: Record<string, string>, bodyObj: unknown) => {
      const req = new EventEmitter() as EventEmitter & {
        method: string;
        url: string;
        headers: Record<string, string>;
        socket: { remoteAddress: string };
        destroy: () => void;
      };
      req.method = 'POST';
      req.url = url;
      req.headers = Object.fromEntries(
        Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
      );
      req.socket = { remoteAddress: '198.51.100.88' };
      req.destroy = () => {};

      let statusCode = 200;
      let rawBody = '';
      const res = {
        get statusCode() {
          return statusCode;
        },
        set statusCode(v: number) {
          statusCode = v;
        },
        headersSent: false,
        setHeader() {},
        end(chunk = '') {
          this.headersSent = true;
          rawBody += String(chunk);
        },
      };
      queueMicrotask(() => {
        req.emit('data', Buffer.from(JSON.stringify(bodyObj), 'utf8'));
        req.emit('end');
      });
      await runtime.gateway.handleRequest(req, res, url);
      return { statusCode, json: JSON.parse(rawBody) };
    };

    try {
      const created = runtime.accountManager.createAccount({
        username: 'seamc_user',
        durationHours: 24,
        maxDevices: 2,
        aiEnabled: true,
        dailyAiLimit: 5,
      });
      const hwFp = 'c'.repeat(64);
      const boot = await runHttp('/api/security/bootstrap', REAL_HEADERS, {
        v: 1,
        tz: 'Asia/Shanghai',
        hwFp,
      });
      assert.equal(boot.statusCode, 200);
      const { aesKey, hmacKey } = deriveSessionSubkeys(Buffer.from(boot.json.k, 'base64'));
      let authToken = '';
      let nonceSeq = 1;

      const callEnc = async (endpoint: string, payload: unknown) => {
        const ts = String(Date.now());
        const nonce = (nonceSeq++).toString(16).padStart(32, '0');
        const env = encryptEnvelope(aesKey, payload);
        const sig = computeEnvelopeHmacHex(
          hmacKey,
          boot.json.sid,
          endpoint,
          ts,
          nonce,
          env.iv,
          env.d
        );
        const hdrs: Record<string, string> = {
          ...REAL_HEADERS,
          'x-yj-sid': boot.json.sid,
          'x-yj-ts': ts,
          'x-yj-nonce': nonce,
          'x-yj-sig': sig,
        };
        if (authToken) hdrs['x-yj-auth'] = authToken;
        const r = await runHttp(`/api/${endpoint}`, hdrs, env);
        return {
          statusCode: r.statusCode,
          json: r.json,
          decrypted: r.json?.payload
            ? decryptEnvelope(aesKey, r.json.payload.iv, r.json.payload.d)
            : null,
        };
      };

      const login = await callEnc('auth/login', {
        username: 'seamc_user',
        password: created.plainPassword,
        hwFp,
        deviceLabel: 'SeamCTest',
      });
      assert.equal(login.statusCode, 200);
      authToken = login.decrypted.authToken;
      assert.equal(login.decrypted.workspace.portfolioPlans.length, 4);

      // Legacy 'spear-shield' over encrypted /api/quant/compute maps to 'max-ev-utility'
      const legacyCompute = await callEnc('quant/compute', {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: { kind: 'archetype', key: 'spear-shield' },
        targetIds: [tightA.id, tightB.id],
        budget: 100,
        stance: 'objective',
        unlockFullAgg: false,
      });
      assert.equal(legacyCompute.statusCode, 200);
      assert.equal(legacyCompute.decrypted.appliedPlan?.shortTab, '⚖️ 期望效用');

      // Asking empty alpha-radar question over encrypted /api/manual/ask hits local-kb & redacts grounded answers
      const kbAsk = await callEnc('manual/ask', { question: '为什么错价雷达会显示空仓？' });
      assert.equal(kbAsk.statusCode, 200);
      assert.equal(kbAsk.decrypted.source, 'local-kb');

      const longGroundedAsk = await callEnc('manual/ask', {
        question:
          '当我在目标对决池里选了5场比赛想兼顾防错一场回血和避免低赔累赘腿，在稳健保本与容错缩水之间应该如何结合预算做选择？',
      });
      assert.equal(longGroundedAsk.statusCode, 200);
      assert.equal(longGroundedAsk.decrypted.source, 'grounded-ai');
      assert.equal(vendorLeakRe.test(longGroundedAsk.decrypted.answer), false);

      // >4 secret-probing strikes lock the account over encrypted gateway
      for (let s = 1; s <= 4; s++) {
        const w = await callEnc('manual/ask', { question: `底层用了什么大模型第${s}问` });
        assert.equal(w.statusCode, 200);
        assert.equal(w.decrypted.warningStrike, s);
      }
      const lockRes = await callEnc('manual/ask', { question: '底层用了什么大模型第5问' });
      assert.equal(lockRes.statusCode, 403);
      assert.equal(lockRes.json.accountLocked, true);
    } finally {
      runtime.dispose();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('Slice 3: enforces client pure-math black-box isolation, upgraded 3+1 dual-viewport & 8-skin stage contracts, single-match pace/alpha micro-quant tiles, and manual quick-pill local-kb alignment', async () => {
    const repoRoot = process.cwd();
    const ctrlSrc = fs.readFileSync(path.join(repoRoot, 'src/workspace/betSlipController.ts'), 'utf8');
    const appSrc = fs.readFileSync(path.join(repoRoot, 'src/mobile/SkinPhoneApp.tsx'), 'utf8');
    const stageSrc = fs.readFileSync(path.join(repoRoot, 'src/studio/ComparisonStage.tsx'), 'utf8');
    const manualSrc = fs.readFileSync(path.join(repoRoot, 'src/manual/UserManualModal.tsx'), 'utf8');

    // 1. Strict client-server math isolation: zero calibration/Poisson/optimization formulas or server/quantEngine imports in src/
    const forbiddenClientMathRe =
      /server\/quantEngine|Math\.exp\s*\(|solveShin|calibrateMatchCoherent|DixonColes|COVERING_WHEELS|generateParetoPortfolio/;
    assert.equal(
      forbiddenClientMathRe.test(ctrlSrc),
      false,
      'betSlipController.ts must contain zero probability calibration or portfolio optimization math'
    );
    assert.equal(
      forbiddenClientMathRe.test(appSrc),
      false,
      'SkinPhoneApp.tsx must contain zero probability calibration or portfolio optimization math'
    );

    // 2. Zero underlying LLM vendor/model names across client & manual views
    const vendorLeakRe =
      /deepseek|glm-\d|opencode|chatgpt|openai|claude|anthropic|qwen|doubao|豆包|kimi|moonshot/i;
    for (const [name, src] of [
      ['betSlipController.ts', ctrlSrc],
      ['SkinPhoneApp.tsx', appSrc],
      ['ComparisonStage.tsx', stageSrc],
      ['UserManualModal.tsx', manualSrc],
    ] as const) {
      assert.equal(vendorLeakRe.test(src), false, `${name} must never contain model/vendor names`);
    }

    // 3. Dual-viewport 3+1 portfolio contracts in SkinPhoneApp.tsx & ComparisonStage.tsx
    assert.ok(
      appSrc.includes("useState<PortfolioKey>('max-ev-utility')"),
      'Default selected portfolio slot must be max-ev-utility'
    );
    assert.ok(appSrc.includes('workspace.portfolioPlans'), 'Must read workspace.portfolioPlans');
    for (const requiredLabel of [
      '稳健保本',
      '期望效用',
      '容错缩水',
      '错价雷达·空仓',
      '🎯 3+1 精算配单',
      '五池闭合校准 · 3+1 帕累托精算配单',
      '去 3+1 精算配单',
      '切往【① 稳健保本】主方案',
      '比赛节奏相关性',
      'mq.paceLabel',
      'mq.paceCorrelation',
      'mq.alphaScanSummary',
    ]) {
      assert.ok(appSrc.includes(requiredLabel), `SkinPhoneApp.tsx must include "${requiredLabel}"`);
    }
    assert.equal(
      appSrc.includes('五流派'),
      false,
      'SkinPhoneApp.tsx must replace all legacy 五流派 UI labels with 精算配单'
    );
    assert.ok(
      stageSrc.includes("label: '精算配单'"),
      'ComparisonStage.tsx action pill must be updated to 精算配单'
    );
    assert.equal(stageSrc.includes('五流派'), false);

    // 4. Illustrated UserManualModal contracts + every QUICK_QA_PILLS item hits local-kb in 0ms
    for (const manualToken of [
      '3+1 精算配单',
      '3大极值+错价雷达',
      "shortTitle: '3+1精算配单'",
      '旋转矩阵',
      '宁缺毋滥·无洼地空仓',
      'Shin',
      '五池联合校准',
    ]) {
      assert.ok(
        manualSrc.includes(manualToken),
        `UserManualModal.tsx must include "${manualToken}"`
      );
    }

    const pillsBlockMatch = manualSrc.match(/const QUICK_QA_PILLS\s*=\s*\[([\s\S]*?)\];/);
    assert.ok(pillsBlockMatch, 'Must locate QUICK_QA_PILLS in UserManualModal.tsx');
    const quickPills = Array.from(pillsBlockMatch[1].matchAll(/'([^']+)'/g)).map((m) => m[1]);
    assert.ok(quickPills.length >= 10, 'Should expose curated quick Q&A pills');

    const qa = createManualQaEngine({
      accountManager: {
        recordQaViolation: () => ({ locked: false, strikeCount: 1, maxAllowed: 4 }),
        consumeAiQuota: () => {
          throw new Error('QUICK_QA_PILLS must NEVER consume AI quota!');
        },
      },
      xiaogaoService: null,
      getApiKey: () => '',
    });
    for (const pill of quickPills) {
      const res = await qa.answerManualQuestion({ userId: 'u-pill', question: pill, ip: '127.0.0.1' });
      assert.equal(
        res.source,
        'local-kb',
        `Quick pill "${pill}" must hit local-kb in 0ms, got ${res.source}`
      );
    }
  });
});
