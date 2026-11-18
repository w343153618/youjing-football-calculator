import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  createSecurityAndQuantGateway,
  computeEnvelopeHmacHex,
  decryptEnvelope,
  deriveSessionSubkeys,
  encryptEnvelope,
} from '../server/securityShield.mjs';
import { createXiaoGaoService } from '../server/xiaogaoCore.mjs';

function makeMockHttpExchange(opts: {
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
  req.method = opts.method || 'GET';
  req.url = opts.url || '/';
  req.headers = Object.fromEntries(
    Object.entries(opts.headers || {}).map(([k, v]) => [k.toLowerCase(), v])
  );
  req.socket = { remoteAddress: opts.remoteAddress || '203.0.113.88' };
  req.destroy = () => {};

  let statusCode = 200;
  const respHeaders: Record<string, string> = {};
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
    setHeader(k: string, v: string) {
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
        req.emit('data', Buffer.from(JSON.stringify(opts.body)));
      }
      req.emit('end');
    });
  };

  return { req, res, triggerBody, getResult: () => ({ statusCode, respHeaders, body: rawOut }) };
}

const REAL_BROWSER_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'sec-fetch-mode': 'navigate',
};

describe('Seam 4: Anti-Reader Decoy, Honeypot Fuse, Subkey Separation & AES-256-GCM Anti-Replay Gateway', () => {
  it('feeds Decoy HTML to Doubao, Jina Reader, GPTBot, curl, and HeadlessChrome while allowing real browsers & direct loopback deploy healthchecks', async () => {
    const gateway = createSecurityAndQuantGateway({
      xiaogaoService: createXiaoGaoService({ enableProbe: false }),
      getApiKey: () => 'test-key',
    });

    const botCases = [
      { name: 'Doubao/Bytespider', headers: { 'user-agent': 'Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)' } },
      { name: 'Doubao App Bot', headers: { 'user-agent': 'DoubaoBot/1.0 (+https://www.doubao.com)' } },
      { name: 'Jina Reader Header', headers: { ...REAL_BROWSER_HEADERS, 'x-jina-respond-with': 'markdown' } },
      { name: 'GPTBot', headers: { 'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2' } },
      { name: 'curl CLI external', headers: { 'user-agent': 'curl/8.7.1', accept: '*/*' } },
      { name: 'HeadlessChrome Sec-CH-UA', headers: { ...REAL_BROWSER_HEADERS, 'sec-ch-ua': '"HeadlessChrome";v="131"' } },
    ];

    for (const bc of botCases) {
      const ex = makeMockHttpExchange({ method: 'GET', url: '/', headers: bc.headers });
      const handled = await gateway.handleRequest(ex.req, ex.res, '/');
      assert.equal(handled, true, `${bc.name} should be intercepted`);
      const out = ex.getResult();
      assert.equal(out.statusCode, 200);
      assert.ok(out.body.includes('公开足球联赛标准时区换算'));
      assert.equal(out.body.includes('优竞'), false);
      assert.equal(out.body.includes('假中奖'), false);
      assert.equal(out.body.includes('扫地僧'), false);

      const jsEx = makeMockHttpExchange({ method: 'GET', url: '/assets/index-abc.js', headers: bc.headers });
      await gateway.handleRequest(jsEx.req, jsEx.res, '/assets/index-abc.js');
      assert.equal(jsEx.getResult().statusCode, 403);
    }

    // Real Sogou Browser & Feishu BytedanceWebview humans are NOT falsely blocked!
    for (const ua of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) SogouMobileBrowser/5.30',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 BytedanceWebview/d8a21c6',
    ]) {
      const ex = makeMockHttpExchange({
        method: 'GET',
        url: '/',
        headers: { ...REAL_BROWSER_HEADERS, 'user-agent': ua },
      });
      assert.equal(await gateway.handleRequest(ex.req, ex.res, '/'), false);
    }

    // Direct loopback curl to /api/xiaogao/status (used by deploy-sg.sh [5/5]) succeeds with 200 OK!
    const deployCheck = makeMockHttpExchange({
      method: 'GET',
      url: '/api/xiaogao/status',
      remoteAddress: '127.0.0.1',
      headers: { 'user-agent': 'curl/8.7.1', accept: '*/*' },
    });
    await gateway.handleRequest(deployCheck.req, deployCheck.res, '/api/xiaogao/status');
    assert.equal(deployCheck.getResult().statusCode, 200);
    assert.equal(JSON.parse(deployCheck.getResult().body).ok, true);

    // /api/health is redacted (no brand leak)
    const healthCheck = makeMockHttpExchange({ method: 'GET', url: '/api/health' });
    await gateway.handleRequest(healthCheck.req, healthCheck.res, '/api/health');
    assert.equal(healthCheck.getResult().body.includes('youjing'), false);
  });

  it('enforces SHA-256 subkey separation, endpoint binding, anti-replay IP fuse, and NAT-safe client session fuse', async () => {
    let clock = 1_700_000_000_000;
    const gateway = createSecurityAndQuantGateway({
      nowFn: () => clock,
      fuseLoopback: true,
      xiaogaoService: createXiaoGaoService({ enableProbe: false }),
      getApiKey: () => 'test-key',
    });

    const bootEx = makeMockHttpExchange({
      method: 'POST',
      url: '/api/security/bootstrap',
      remoteAddress: '198.51.100.42',
      headers: { ...REAL_BROWSER_HEADERS, 'content-type': 'application/json' },
      body: { v: 1, tz: 'Asia/Shanghai' },
    });
    bootEx.triggerBody();
    await gateway.handleRequest(bootEx.req, bootEx.res, '/api/security/bootstrap');
    const bootJson = JSON.parse(bootEx.getResult().body);
    assert.equal(bootJson.ok, true);

    const { aesKey, hmacKey } = deriveSessionSubkeys(Buffer.from(bootJson.k, 'base64'));
    const bootData = decryptEnvelope(aesKey, bootJson.payload.iv, bootJson.payload.d);
    assert.ok(bootData.matches.length >= 4);
    assert.deepEqual(bootData.initialPicks, [], 'Login bootstrap must start with clean empty picks');

    const bm0 = bootData.matches[0];
    const testPicks = ['hh', 'dh'].map((k) => {
      const o = bm0.pools.HAFU.options.find((x: { key: string }) => x.key === k);
      return {
        matchId: bm0.id,
        matchNumStr: bm0.matchNumStr,
        home: bm0.home,
        away: bm0.away,
        poolCode: 'HAFU',
        poolName: '半全场',
        singleAllowed: true,
        optionKey: o.key,
        optionLabel: o.label,
        odds: o.odds,
        fairProb: o.fairProb,
      };
    });

    // Valid signed request bound to 'quant/compute'
    const plainReq = {
      picks: testPicks,
      multiple: 5,
      subjectiveDeltaPct: 0,
      simVoidFirstMatch: false,
      planSpec: { kind: 'bonus', optMode: 'hot-first' },
      targetIds: bootData.matches.slice(0, 2).map((m: { id: string }) => m.id),
      budget: 100,
      stance: 'objective',
      unlockFullAgg: false,
    };
    const env1 = encryptEnvelope(aesKey, plainReq);
    const ts1 = String(clock);
    const nonce1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const sig1 = computeEnvelopeHmacHex(
      hmacKey,
      bootJson.sid,
      'quant/compute',
      ts1,
      nonce1,
      env1.iv,
      env1.d
    );

    const compEx1 = makeMockHttpExchange({
      method: 'POST',
      url: '/api/quant/compute',
      remoteAddress: '198.51.100.42',
      headers: {
        ...REAL_BROWSER_HEADERS,
        'x-yj-sid': bootJson.sid,
        'x-yj-ts': ts1,
        'x-yj-nonce': nonce1,
        'x-yj-sig': sig1,
      },
      body: env1,
    });
    compEx1.triggerBody();
    await gateway.handleRequest(compEx1.req, compEx1.res, '/api/quant/compute');
    const compJson1 = JSON.parse(compEx1.getResult().body);
    assert.equal(compJson1.ok, true);
    const compData1 = decryptEnvelope(aesKey, compJson1.payload.iv, compJson1.payload.d);
    assert.equal(compData1.appliedPlan.shortTab, '博热保本');

    // Cross-endpoint confusion attack: sending a 'quant/compute' signed envelope to 'quant/sync' with fresh nonce MUST fail & fuse!
    const nonceCross = '11223344556677889900aabbccddeeff';
    const sigWrongEndpoint = computeEnvelopeHmacHex(
      hmacKey,
      bootJson.sid,
      'quant/compute', // signed for compute, sent to sync!
      ts1,
      nonceCross,
      env1.iv,
      env1.d
    );
    const crossEx = makeMockHttpExchange({
      method: 'POST',
      url: '/api/quant/sync',
      remoteAddress: '198.51.100.42',
      headers: {
        ...REAL_BROWSER_HEADERS,
        'x-yj-sid': bootJson.sid,
        'x-yj-ts': ts1,
        'x-yj-nonce': nonceCross,
        'x-yj-sig': sigWrongEndpoint,
      },
      body: env1,
    });
    crossEx.triggerBody();
    await gateway.handleRequest(crossEx.req, crossEx.res, '/api/quant/sync');
    assert.equal(crossEx.getResult().statusCode, 403);
    assert.equal(JSON.parse(crossEx.getResult().body).fused, true);

    // Fused cookie check ('yj_sh_sid=fused') blocks access even from a switched mobile IP!
    const switchedIpEx = makeMockHttpExchange({
      method: 'GET',
      url: '/',
      remoteAddress: '203.0.113.200',
      headers: { ...REAL_BROWSER_HEADERS, cookie: 'yj_sh_sid=fused' },
    });
    await gateway.handleRequest(switchedIpEx.req, switchedIpEx.res, '/');
    assert.equal(switchedIpEx.getResult().statusCode, 403);

    // At 47 hours, 48-hour meltdown fuse MUST still block access!
    clock += 47 * 60 * 60 * 1000;
    const stillFusedNav = makeMockHttpExchange({
      method: 'GET',
      url: '/',
      remoteAddress: '198.51.100.42',
      headers: REAL_BROWSER_HEADERS,
    });
    await gateway.handleRequest(stillFusedNav.req, stillFusedNav.res, '/');
    assert.equal(stillFusedNav.getResult().statusCode, 403);

    // After 48 hours + 2 minutes cooldown, IP fuse releases cleanly
    clock += 62 * 60 * 1000;
    const recoveredNav = makeMockHttpExchange({
      method: 'GET',
      url: '/',
      remoteAddress: '198.51.100.42',
      headers: REAL_BROWSER_HEADERS,
    });
    assert.equal(await gateway.handleRequest(recoveredNav.req, recoveredNav.res, '/'), false);
  });
});
