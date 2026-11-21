import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import {
  FALLBACK_MATCHES,
  evaluateQuantWorkspace,
  generateParetoPortfolio,
} from "../server/quantEngine.mjs";
import { createManualQaEngine } from "../server/manualQaEngine.mjs";
import { createYouJingRuntime } from "../server/runtimeApp.mjs";
import {
  computeEnvelopeHmacHex,
  createSecurityAndQuantGateway,
  decryptEnvelope,
  deriveSessionSubkeys,
  encryptEnvelope,
} from "../server/securityShield.mjs";
import * as betSlipModule from "../src/workspace/betSlipController.ts";

describe("Spec 0010 · Seam 1A: ¥10 Minimum Budget Floor & Ban Persistence Concurrency Guard", () => {
  it("Slice 1: accepts ¥10 minimum budget (5 notes) and rounds odd custom budgets to ¥2 bet units while guarding concurrent ban persistence against stale overwrite", async () => {
    // Part A: ¥10 budget floor & ¥2 integer-bet rounding on evaluateQuantWorkspace / generateParetoPortfolio
    const twoMatches = FALLBACK_MATCHES.slice(0, 2);
    const plansAt10 = generateParetoPortfolio(
      twoMatches,
      10,
      "objective",
      false,
      []
    );
    assert.equal(plansAt10.length, 4);
    const evSlot10 = plansAt10.find((p: any) => p.key === "max-ev-utility");
    assert.ok(evSlot10, "max-ev-utility slot must exist at ¥10 budget");
    assert.equal(evSlot10.available, true);
    assert.ok(
      evSlot10.totalCost >= 2 && evSlot10.totalCost <= 10,
      `Expected ¥10 budget totalCost in [2, 10], got ${evSlot10.totalCost}`
    );
    assert.equal(
      evSlot10.totalCost % 2,
      0,
      "Ticket cost must be ¥2 integer multiple"
    );

    const ws10 = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 1,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: twoMatches.map((m: any) => m.id),
        budget: 10,
        stance: "objective",
        unlockFullAgg: false,
      },
      FALLBACK_MATCHES
    );
    const wsEv10 = ws10.portfolioPlans.find(
      (p: any) => p.key === "max-ev-utility"
    );
    assert.ok(
      wsEv10.totalCost <= 10,
      `evaluateQuantWorkspace must honor budget=10 instead of clamping to 20 (got ${wsEv10.totalCost})`
    );
    const wsAlpha10 = ws10.portfolioPlans.find(
      (p: any) => p.key === "alpha-radar"
    );
    if (wsAlpha10.available === false) {
      assert.equal(
        wsAlpha10.savedCash,
        10,
        "Empty alpha-radar at budget=10 must report savedCash=10"
      );
    }

    // Odd custom budget (e.g., 15) floors downward to even ¥2 bet unit (14) so totalCost never overspends budgetYuan (Spec #1 budget sovereignty)
    const plansAt15 = generateParetoPortfolio(
      [FALLBACK_MATCHES[0]],
      15,
      "objective",
      false,
      []
    );
    const alpha15 = plansAt15.find((p: any) => p.key === "alpha-radar");
    if (alpha15.available === false) {
      assert.equal(alpha15.savedCash, 14);
    }

    // Part B: Concurrent tripFuse during slow writeFile must NOT drop newer ban or let stale writer overwrite newer file
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-ban-seq-0010-"));
    const banFile = path.join(tmpDir, "security-bans.json");

    let writeCallCount = 0;
    let releaseFirstWrite!: () => void;
    const firstWriteEntered = new Promise<void>((resolve) => {
      const gate = new Promise<void>((r) => {
        releaseFirstWrite = r;
      });
      (globalThis as any).__yjGate0010 = { resolve, gate };
    });

    const controlledFsp = {
      mkdir: (...args: Parameters<typeof fsp.mkdir>) => fsp.mkdir(...args),
      rename: (...args: Parameters<typeof fsp.rename>) => fsp.rename(...args),
      unlink: (...args: Parameters<typeof fsp.unlink>) => fsp.unlink(...args),
      writeFile: async (
        file: Parameters<typeof fsp.writeFile>[0],
        data: Parameters<typeof fsp.writeFile>[1],
        options?: Parameters<typeof fsp.writeFile>[2]
      ) => {
        writeCallCount += 1;
        const myCall = writeCallCount;
        await fsp.writeFile(file, data, options);
        if (myCall === 1) {
          (globalThis as any).__yjGate0010.resolve();
          await (globalThis as any).__yjGate0010.gate;
        }
      },
    };

    try {
      const gw = createSecurityAndQuantGateway({
        banStoreFile: banFile,
        persistDelayMs: 15,
        fspImpl: controlledFsp,
      });

      // First fuse triggers Writer #1 (snapshot contains only 203.0.113.10)
      gw.tripFuse("203.0.113.10", null, 60_000, true, "a".repeat(64));
      await firstWriteEntered;

      // While Writer #1 is paused after writeFile (before rename), second fuse arrives!
      gw.tripFuse("203.0.113.20", null, 60_000, true, "b".repeat(64));
      // Wait for Writer #2 to flush and rename cleanly
      await new Promise((r) => setTimeout(r, 45));

      // Now release stale Writer #1 — it MUST detect mySeq !== banPersistSeq, unlink its tmp, and NOT overwrite banFile!
      releaseFirstWrite();
      await new Promise((r) => setTimeout(r, 25));

      const persisted = JSON.parse(fs.readFileSync(banFile, "utf8"));
      const savedIpKeys = new Map(persisted.ips).keys();
      const ipSet = new Set(savedIpKeys);
      assert.equal(ipSet.has("203.0.113.10"), true);
      assert.equal(
        ipSet.has("203.0.113.20"),
        true,
        "Stale Writer #1 must not overwrite or drop Writer #2's newer ban entry"
      );

      const leftoverTmp = fs
        .readdirSync(tmpDir)
        .filter((name: string) => name.includes(".tmp."));
      assert.equal(
        leftoverTmp.length,
        0,
        `Stale temporary ban files must be cleaned up, found: ${leftoverTmp.join(", ")}`
      );
    } finally {
      delete (globalThis as any).__yjGate0010;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("Spec 0010 · Seam 1B: Dual-Lens Actuary-Intel Synergy Diagnosis & Iron-Cage Manual Q&A", () => {
  it("Slice 2: injects authoritative 3+1 actuary structure into XiaoGao combo diagnosis (preventing self-contradiction vs naked parlays) and serves 0ms local KB answers for new Spec 0010 topics", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-synergy-0010-"));
    const capturedMessages: Array<Array<{ role: string; content: string }>> =
      [];

    const runtime = createYouJingRuntime({
      dataDir: tmpDir,
      getApiKey: () => "test-key-0010",
      enableXiaoGaoProbe: false,
      fetchMatches: async () => ({
        matches: FALLBACK_MATCHES,
        syncNote: "测试固定快照",
      }),
      xiaogaoTransport: async (
        _apiKey: string,
        _model: string,
        messages: Array<{ role: string; content: string }>
      ) => {
        capturedMessages.push(messages);
        const userPrompt =
          messages.find((m) => m.role === "user")?.content || "";
        const isActuaryApplied = userPrompt.includes("稳健保本");
        return JSON.stringify({
          level: isActuaryApplied ? "low" : "high",
          comboTag: isActuaryApplied
            ? "稳健保本已配平·盯防次关降水透支"
            : "手动裸串·警惕一球卡盘与假中奖",
          summary: isActuaryApplied
            ? "当前方案已由精算配单完成整数倍零倒贴配平，重心转向核查临场水位入价程度。"
            : "手动等倍串关尚未做防卡盘分倍保护，连乘抽水与小胜卡盘风险偏高。",
          actuarySynergy: isActuaryApplied
            ? "已启用【稳健保本】0-1背包配平，覆盖态 0 假中奖倒贴，消除了中奖亏本隐患。"
            : "当前为手动未优化等倍串关，尚未配置防平或不等倍回本护盾。",
          residualRisks:
            "主胜低水已连续下调消化公开利好，仍需提防全场闷平超预期冷门导致全单未命中。",
          weakestLeg: "次关热门方一球小胜卡盘温度偏高。",
          structureAdvice: isActuaryApplied
            ? "维持当前稳健保本分倍结构即可，若首关早场顺利打出可在审单台执行晚场时间差锁利。"
            : "建议切至 ② 精算配单套用【稳健保本】或【容错缩水】消除裸串软肋。",
          priceInVerdict:
            "首关利好已被绿箭头降水充分消化，次关总进球盘尚存微幅滞后。",
          perMatch: isActuaryApplied
            ? [
                {
                  matchId: FALLBACK_MATCHES[0].id,
                  matchTitle: `${FALLBACK_MATCHES[0].matchNumStr} ${FALLBACK_MATCHES[0].home}vs${FALLBACK_MATCHES[0].away}`,
                  tag: "利好已入价",
                  note: "主胜连续压水防范，但净胜两球穿盘阻力增大。",
                  priceInStatus: "主胜水位已提前消化伤停利好",
                  poolImpact:
                    "胜平负主胜稳健但油水薄；让球(-1)需防让平卡盘；总进球倾向2~3球。",
                },
                {
                  matchId: FALLBACK_MATCHES[1].id,
                  matchTitle: `${FALLBACK_MATCHES[1].matchNumStr} ${FALLBACK_MATCHES[1].home}vs${FALLBACK_MATCHES[1].away}`,
                  tag: "防半场闷平",
                  note: "客队防守反击韧性足，上半场易僵持。",
                  priceInStatus: "让球盘水位平稳，未见过度透支",
                  poolImpact:
                    "胜平负宜防平局分流；让球受让方具韧性；总进球优先关注1~2球。",
                },
              ]
            : [
                // Intentionally return only the 2nd match to verify 100% deterministic backfill of the 1st match
                {
                  matchId: FALLBACK_MATCHES[1].id,
                  matchTitle: `${FALLBACK_MATCHES[1].matchNumStr} ${FALLBACK_MATCHES[1].home}vs${FALLBACK_MATCHES[1].away}`,
                  tag: "次关穿盘难",
                  note: "客队防线紧凑，裸串防冷压力大。",
                  priceInStatus: "让球水位平稳",
                },
              ],
        });
      },
    });

    const REAL_HEADERS = {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      "sec-fetch-mode": "cors",
    };

    const callGateway = async (
      url: string,
      headers: Record<string, string>,
      body: unknown
    ) => {
      const req = new EventEmitter() as any;
      req.method = "POST";
      req.url = url;
      req.headers = Object.fromEntries(
        Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
      );
      req.socket = { remoteAddress: "198.51.100.88" };
      req.destroy = () => {};

      let statusCode = 200;
      const respHeaders: Record<string, string | string[]> = {};
      let rawOut = "";
      const res = {
        get statusCode() {
          return statusCode;
        },
        set statusCode(v: number) {
          statusCode = v;
        },
        get headersSent() {
          return rawOut.length > 0;
        },
        setHeader(k: string, v: string | string[]) {
          respHeaders[k.toLowerCase()] = v;
        },
        end(chunk = "") {
          rawOut += String(chunk);
        },
      };
      queueMicrotask(() => {
        req.emit("data", Buffer.from(JSON.stringify(body), "utf8"));
        req.emit("end");
      });
      await runtime.gateway.handleRequest(req, res, url);
      return { statusCode, body: rawOut };
    };

    try {
      const member = runtime.accountManager.createAccount({
        username: "synergy_tester",
        note: "Spec 0010",
        durationHours: 24,
        maxDevices: 2,
        aiEnabled: true,
        dailyAiLimit: 10,
      });

      const boot = await callGateway("/api/security/bootstrap", REAL_HEADERS, {
        v: 1,
        tz: "Asia/Shanghai",
        hwFp: "c".repeat(64),
      });
      const bootJson = JSON.parse(boot.body);
      const { aesKey, hmacKey } = deriveSessionSubkeys(
        Buffer.from(bootJson.k, "base64")
      );

      let nonceSeq = 1;
      const postEnc = async (endpoint: string, payload: unknown) => {
        const ts = String(Date.now());
        const nonce = String(nonceSeq++).padStart(32, "0");
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
        const r = await callGateway(
          `/api/${endpoint}`,
          {
            ...REAL_HEADERS,
            "x-yj-sid": bootJson.sid,
            "x-yj-ts": ts,
            "x-yj-nonce": nonce,
            "x-yj-sig": sig,
          },
          env
        );
        assert.equal(r.statusCode, 200);
        const parsed = JSON.parse(r.body);
        return decryptEnvelope(aesKey, parsed.payload.iv, parsed.payload.d);
      };

      await postEnc("auth/login", {
        username: "synergy_tester",
        password: member.plainPassword,
        hwFp: "c".repeat(64),
        deviceLabel: "Mac",
      });

      // Build an authoritative 3+1 Slot 1 (稳健保本) plan on first 2 matches
      const m0 = FALLBACK_MATCHES[0];
      const m1 = FALLBACK_MATCHES[1];
      const baseWs = evaluateQuantWorkspace(
        {
          picks: [],
          multiple: 5,
          subjectiveDeltaPct: 0,
          simVoidFirstMatch: false,
          planSpec: null,
          targetIds: [m0.id, m1.id],
          budget: 100,
          stance: "objective",
          unlockFullAgg: false,
        },
        FALLBACK_MATCHES
      );
      const slot1 = baseWs.portfolioPlans.find(
        (p: any) => p.key === "max-profit-prob"
      );
      assert.ok(slot1 && slot1.available);

      const appliedPicks = [
        {
          matchId: m0.id,
          matchNumStr: m0.matchNumStr,
          home: m0.home,
          away: m0.away,
          poolCode: "HAD",
          poolName: m0.pools.HAD.name,
          singleAllowed: m0.pools.HAD.single,
          optionKey: "h",
          optionLabel: "主胜",
          odds: m0.pools.HAD.options[0].odds,
          fairProb: m0.pools.HAD.options[0].fairProb,
        },
        {
          matchId: m1.id,
          matchNumStr: m1.matchNumStr,
          home: m1.home,
          away: m1.away,
          poolCode: "HAD",
          poolName: m1.pools.HAD.name,
          singleAllowed: m1.pools.HAD.single,
          optionKey: "h",
          optionLabel: "主胜",
          odds: m1.pools.HAD.options[0].odds,
          fairProb: m1.pools.HAD.options[0].fairProb,
        },
      ];

      // 1. Diagnose AFTER applying 3+1 稳健保本 plan
      const synergyRes = await postEnc("xiaogao/analyze-combo", {
        sourceMode: "picked",
        matchIds: [m0.id, m1.id],
        picks: appliedPicks,
        multiple: 5,
        passSpec: { mode: "auto" },
        planSpec: {
          kind: "archetype",
          key: "max-profit-prob",
          snapshotPlan: slot1,
          scaleMultiple: 1,
        },
        budget: 100,
        stance: "objective",
        userNote: "主队后腰伤愈复出",
      });

      const userPrompt1 =
        capturedMessages[0]?.find((m) => m.role === "user")?.content || "";
      assert.ok(
        userPrompt1.includes("稳健保本") && userPrompt1.includes("0 假中奖"),
        `Prompt must inject applied actuary structure into XiaoGao context, got:\n${userPrompt1}`
      );
      assert.ok(
        synergyRes.comboReport.planContextBadge?.includes("稳健保本"),
        `Expected planContextBadge to mention 稳健保本, got: ${synergyRes.comboReport.planContextBadge}`
      );
      assert.ok(
        synergyRes.comboReport.actuarySynergy?.includes("稳健保本"),
        "Expected actuarySynergy field on comboReport"
      );
      assert.ok(
        synergyRes.comboReport.residualRisks?.length > 10,
        "Expected residualRisks field on comboReport"
      );
      assert.equal(synergyRes.comboReport.perMatch.length, 2);
      assert.ok(
        synergyRes.comboReport.perMatch[0].poolImpact?.includes("胜平负"),
        "Expected perMatch[0].poolImpact to preserve multi-pool impact breakdown"
      );

      // 1b. Contrast against manual unoptimized slip (planSpec: null) + partial perMatch backfill
      const manualRes = await postEnc("xiaogao/analyze-combo", {
        sourceMode: "picked",
        matchIds: [m0.id, m1.id],
        picks: appliedPicks,
        multiple: 5,
        passSpec: { mode: "auto" },
        planSpec: null,
        budget: 100,
        stance: "objective",
      });
      assert.ok(
        manualRes.comboReport.planContextBadge?.includes("手动"),
        `Expected manual slip badge to reflect manual mode, got: ${manualRes.comboReport.planContextBadge}`
      );
      assert.equal(
        manualRes.comboReport.perMatch.length,
        2,
        "Even when upstream returns partial perMatch, all input matches must be backfilled"
      );
      assert.equal(manualRes.comboReport.perMatch[0].matchId, m0.id);
      assert.equal(manualRes.comboReport.perMatch[1].matchId, m1.id);
      assert.ok(
        manualRes.comboReport.perMatch[0].poolImpact?.includes("胜平负")
      );

      // 2. Manual QA local 0ms KB hits for new Spec 0010 workflows & compound card-pan query
      let aiQuotaUsed = 0;
      const qa = createManualQaEngine({
        accountManager: {
          recordQaViolation: () => ({
            locked: false,
            strikeCount: 1,
            maxAllowed: 4,
          }),
          consumeAiQuota: () => {
            aiQuotaUsed += 1;
            return { ok: true, remaining: 9 };
          },
        },
        xiaogaoService: null,
        getApiKey: () => "",
      });

      const qCardPan = await qa.answerManualQuestion({
        userId: member.user.id,
        question: "一球小胜卡盘超过50%怎么防？",
        ip: "127.0.0.1",
      });
      assert.equal(qCardPan.source, "local-kb");
      assert.equal(qCardPan.jumpSection, "glossary");

      const qBudget10 = await qa.answerManualQuestion({
        userId: member.user.id,
        question: "10元预算怎么配单？",
        ip: "127.0.0.1",
      });
      assert.equal(qBudget10.source, "local-kb");
      assert.equal(qBudget10.jumpSection, "archetypes");
      assert.ok(qBudget10.answer.includes("10"));

      const qStance = await qa.answerManualQuestion({
        userId: member.user.id,
        question: "看球直觉倾向偏主队改变了什么？",
        ip: "127.0.0.1",
      });
      assert.equal(qStance.source, "local-kb");
      assert.equal(qStance.jumpSection, "archetypes");

      const qSynergy = await qa.answerManualQuestion({
        userId: member.user.id,
        question: "联合会诊和精算配单怎么协同？",
        ip: "127.0.0.1",
      });
      assert.equal(qSynergy.source, "local-kb");
      assert.equal(qSynergy.jumpSection, "xiaogao");

      assert.equal(
        aiQuotaUsed,
        0,
        "All curated Spec 0010 FAQ hits must resolve in 0ms without consuming AI quota"
      );
    } finally {
      runtime.dispose();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("Spec 0010 · Seam 2A: Manual Tokenized Search & Unblocked Section Jump State Machine", () => {
  it("Slice 3: matches compound query '一球小胜卡盘' across relevant manual chapters and immediately jumps/scrolls to target chapter even when search query is non-empty or unmatched", () => {
    const matchManualTopics = (betSlipModule as any).matchManualTopics;
    const resolveManualNavigation = (betSlipModule as any)
      .resolveManualNavigation;
    assert.equal(
      typeof matchManualTopics,
      "function",
      "Expected matchManualTopics to be exported on workspace seam"
    );
    assert.equal(
      typeof resolveManualNavigation,
      "function",
      "Expected resolveManualNavigation to be exported on workspace seam"
    );

    // 1. Compound search "一球小胜卡盘" MUST hit glossary (and not return empty [])
    const matched = matchManualTopics("一球小胜卡盘");
    const matchedIds = matched.map((t: any) => t.id);
    assert.ok(
      matchedIds.includes("glossary"),
      `Expected '一球小胜卡盘' to match 'glossary', got [${matchedIds.join(", ")}]`
    );
    assert.ok(
      matchedIds.includes("sandbox") || matchedIds.includes("quickstart"),
      `Expected '一球小胜卡盘' to also match secondary chapters, got [${matchedIds.join(", ")}]`
    );

    // 2. Even if user typed an unmatched query in top search bar and stayed on 'qa',
    // clicking '📖 跳转查看该功能完整矢量图解 ›' (jumpSection = 'glossary') or clicking a chapter tab
    // MUST immediately switch currentTopic to 'glossary', clear blocking query, bump scrollSeq, and set highlightSec!
    const stuckState = {
      activeSec: "qa" as const,
      query: "一球小胜卡盘怎么买最稳xyz",
      scrollSeq: 0,
      highlightSec: null,
    };
    const afterJump = resolveManualNavigation(stuckState, {
      type: "jump",
      targetSec: "glossary",
    });
    assert.equal(afterJump.activeSec, "glossary");
    assert.equal(
      afterJump.currentTopic.id,
      "glossary",
      "currentTopic must never be locked back to 'qa' by residual search query"
    );
    assert.ok(
      afterJump.scrollSeq > stuckState.scrollSeq,
      "Jumping to diagram section must increment scrollSeq to scroll .manual-body to top"
    );
    assert.equal(
      afterJump.highlightSec,
      "glossary",
      "Jumping from Q&A card must set highlightSec for visual diagram focus pulse"
    );

    // 3. Manual tab click while a completely non-matching query is present also unlocks and switches immediately
    const unmatchedSearchState = resolveManualNavigation(afterJump, {
      type: "search",
      query: "完全不存在的乱码词999",
    });
    const afterTabClick = resolveManualNavigation(unmatchedSearchState, {
      type: "select-tab",
      targetSec: "sandbox",
    });
    assert.equal(afterTabClick.activeSec, "sandbox");
    assert.equal(afterTabClick.currentTopic.id, "sandbox");
    assert.equal(
      afterTabClick.query,
      "",
      "Selecting a non-matching tab clears stale blocking filter query"
    );
    assert.ok(afterTabClick.scrollSeq > unmatchedSearchState.scrollSeq);
  });
});

describe("Spec 0010 · Seam 2B: Auto-Sync Radar Anchor, ¥10~¥20000 Even-Unit Budget & Stance Δ Summary", () => {
  it("Slice 4: auto-syncs radar picks to Step 2 pool by default (with clean manual override pause/resume), normalizes custom budget to ¥2 units in [10, 20000], and computes transparent stance Δ summary", async () => {
    const normalizeBudgetYuan = (betSlipModule as any).normalizeBudgetYuan;
    assert.equal(
      typeof normalizeBudgetYuan,
      "function",
      "Expected normalizeBudgetYuan helper on workspace seam"
    );
    assert.equal(normalizeBudgetYuan(2), 2);
    assert.equal(normalizeBudgetYuan(9), 8);
    assert.equal(normalizeBudgetYuan(10), 10);
    assert.equal(normalizeBudgetYuan(15), 14);
    assert.equal(normalizeBudgetYuan(25000), 20000);

    const ctrl = betSlipModule.createBetSlipController({
      debounceMs: 0,
      autoSyncRadar: true,
      computeWorkspace: (params, matches) =>
        evaluateQuantWorkspace(params as any, matches as any),
    } as any);

    const m0 = FALLBACK_MATCHES[0] as any;
    const m1 = FALLBACK_MATCHES[1] as any;
    const m2 = FALLBACK_MATCHES[2] as any;
    ctrl.applyAuthenticatedBundle({
      matches: FALLBACK_MATCHES as any,
      initialPicks: [],
      workspace: evaluateQuantWorkspace(
        { picks: [], multiple: 5 },
        FALLBACK_MATCHES as any
      ) as any,
    });

    // 1. Picking matches in Step 1 auto-syncs targetIds + anchorToRadarPicks = true without manual sync click
    ctrl.togglePick(m0, "HAD", "h");
    ctrl.togglePick(m1, "HAD", "h");
    await ctrl.flush();
    assert.deepEqual(ctrl.getState().targetIds, [m0.id, m1.id]);
    assert.equal(ctrl.getState().anchorToRadarPicks, true);
    assert.equal(ctrl.isRadarSyncCurrent(), true);

    // 2. Budget normalization via setBudget (Spec #1 floor-to-even in [2, 20000])
    ctrl.setBudget(15);
    await ctrl.flush();
    assert.equal(ctrl.getState().budget, 14);
    ctrl.setBudget(100);
    await ctrl.flush();
    assert.equal(ctrl.getState().budget, 100);

    // 3. Stance Δ summary when anchored to radar picks
    ctrl.setStance("home-lean");
    await ctrl.flush();
    const getStanceDeltaSummary = (ctrl as any).getStanceDeltaSummary;
    assert.equal(
      typeof getStanceDeltaSummary,
      "function",
      "Expected ctrl.getStanceDeltaSummary(slotKey) on controller"
    );
    const anchoredDelta = getStanceDeltaSummary("max-ev-utility");
    assert.equal(anchoredDelta.stance, "home-lean");
    assert.equal(anchoredDelta.hasBaseline, true);
    assert.ok(anchoredDelta.ruleNote.includes("偏主队"));
    assert.ok(anchoredDelta.instantRecalcNote.includes("实时重算"));
    assert.ok(
      anchoredDelta.anchorLockNote &&
        anchoredDelta.anchorLockNote.includes("锚定"),
      "When anchorToRadarPicks is active, anchorLockNote must explain why team picks stay locked"
    );
    assert.equal(typeof anchoredDelta.deltaProfitProbPct, "number");
    assert.equal(typeof anchoredDelta.deltaEvPct, "number");
    assert.equal(typeof anchoredDelta.ticketsChanged, "boolean");

    // 4. Manual override pause: toggling target match or turning off anchorToRadarPicks pauses auto-sync
    ctrl.toggleTargetMatch(m2.id);
    await ctrl.flush();
    assert.equal(ctrl.getState().anchorToRadarPicks, false);
    const freeDelta = getStanceDeltaSummary("max-ev-utility");
    assert.equal(
      freeDelta.anchorLockNote,
      null,
      "When anchorToRadarPicks is off, anchorLockNote should be null"
    );

    // Further radar toggle does NOT clobber user's manual targetIds while paused
    ctrl.togglePick(m1, "HAD", "d");
    await ctrl.flush();
    assert.equal(ctrl.getState().anchorToRadarPicks, false);
    assert.ok(ctrl.getState().targetIds.includes(m2.id));

    // Re-clicking syncRadarPicksToArchetypes resumes auto-sync!
    ctrl.syncRadarPicksToArchetypes();
    await ctrl.flush();
    assert.equal(ctrl.getState().anchorToRadarPicks, true);
    assert.deepEqual(ctrl.getState().targetIds, [m0.id, m1.id]);

    // Clearing all picks resets anchor cleanly
    ctrl.clearPicks();
    await ctrl.flush();
    assert.equal(ctrl.getState().anchorToRadarPicks, false);
  });
});

describe("Spec 0010 · Seam 2C: Untruncated Combo Ticket Attribution, Multi-Mode P&L Sorting & Zero-Quota Match Intel Digest", () => {
  it("Slice 5: preserves all legs without truncation on 4-match combos, attributes exact winning physical tickets per outcome bucket, sorts P&L by 3 modes, and builds rich 3-pool match intel digests", () => {
    const resolveComboTicketBreakdown = (betSlipModule as any)
      .resolveComboTicketBreakdown;
    const sortComboRows = (betSlipModule as any).sortComboRows;
    const buildMatchIntelDigest = (betSlipModule as any).buildMatchIntelDigest;

    assert.equal(typeof resolveComboTicketBreakdown, "function");
    assert.equal(typeof sortComboRows, "function");
    assert.equal(typeof buildMatchIntelDigest, "function");

    // 1. Evaluate a 4-match combo pass (e.g. 4串11 or free [2, 3, 4]) and verify full 4-leg preservation + exact ticket attribution
    const fourPicks = FALLBACK_MATCHES.slice(0, 4).map((m: any) => {
      const o = m.pools.HAD.options[0];
      return {
        matchId: m.id,
        matchNumStr: m.matchNumStr,
        home: m.home,
        away: m.away,
        poolCode: "HAD",
        poolName: m.pools.HAD.name,
        singleAllowed: m.pools.HAD.single,
        optionKey: o.key,
        optionLabel: o.label,
        odds: o.odds,
        fairProb: o.fairProb,
      };
    });
    const ws4 = evaluateQuantWorkspace(
      {
        picks: fourPicks,
        multiple: 2,
        passSpec: { mode: "free", passSizes: [2, 4] },
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: FALLBACK_MATCHES.slice(0, 4).map((m: any) => m.id),
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      } as any,
      FALLBACK_MATCHES as any
    );

    const rep4 = ws4.effectiveReport;
    assert.ok(rep4.combos.length >= 2);
    // Find the 4-leg all-hit combo bucket: it hits C(4,2)=6 two-leg tickets + 1 four-leg ticket = 7 physical tickets!
    const fullHitCombo = rep4.combos.find(
      (c: any) => Array.isArray(c.legs) && c.legs.length === 4
    );
    assert.ok(fullHitCombo, "Must find 4-match outcome bucket");

    const breakdown = resolveComboTicketBreakdown(
      fullHitCombo,
      rep4.tickets,
      rep4.totalCost
    );
    assert.equal(
      breakdown.legs.length,
      4,
      "All 4 match legs must be preserved without any ellipsis truncation"
    );
    assert.ok(
      breakdown.scenarioLabel.includes("全中") &&
        breakdown.scenarioLabel.includes("4场"),
      `Expected scenarioLabel to describe 全中 (4场), got: ${breakdown.scenarioLabel}`
    );
    assert.equal(
      breakdown.winningTicketCount,
      7,
      "All-4-hit outcome on [2关, 4关] must attribute C(4,2)+C(4,4)=7 winning physical tickets"
    );
    assert.ok(
      breakdown.winningTickets.every(
        (tk: any) =>
          typeof tk.ticketNo === "number" &&
          tk.ticketNo >= 1 &&
          tk.multiple === 2 &&
          tk.unitPayout > 0
      ),
      "Each attributed physical ticket must expose 1-based ticketNo, multiple, and unitPayout"
    );
    const sumAttributedPayout = Number(
      breakdown.winningTickets
        .reduce((acc: number, tk: any) => acc + tk.totalPayout, 0)
        .toFixed(2)
    );
    assert.equal(
      sumAttributedPayout,
      fullHitCombo.totalPayout,
      "Sum of attributed physical ticket payouts must equal exact combo bucket totalPayout"
    );

    // 2. Sorting modes: loss-first, prob-first, profit-first
    const byLoss = sortComboRows(rep4.combos, "loss-first");
    const byProb = sortComboRows(rep4.combos, "prob-first");
    const byProfit = sortComboRows(rep4.combos, "profit-first");
    assert.ok(byLoss[0].netProfit <= byLoss[byLoss.length - 1].netProfit);
    assert.ok(byProb[0].prob >= byProb[byProb.length - 1].prob);
    assert.ok(byProfit[0].netProfit >= byProfit[byProfit.length - 1].netProfit);

    // 3. Zero-quota MatchIntelDigest for 情报账本 (verify [0,1] -> percentage scaling & clean TTG labels)
    const digest = buildMatchIntelDigest(FALLBACK_MATCHES[0] as any);
    assert.equal(digest.matchId, FALLBACK_MATCHES[0].id);
    assert.ok(
      digest.cardPanAlert.sharePct >= 10 && digest.cardPanAlert.sharePct <= 100,
      `oneGoalShareOfWins [0,1] fraction must scale to real percentage (10..100), got ${digest.cardPanAlert.sharePct}`
    );
    assert.ok(
      digest.xgSummary.includes("xG") || digest.xgSummary.includes("总预期")
    );
    assert.ok(digest.poolImpacts.had.length > 0);
    assert.ok(
      digest.poolImpacts.hhad.includes("卡1球") ||
        digest.poolImpacts.hhad.includes("让球")
    );
    assert.ok(digest.poolImpacts.ttg.includes("球"));
    assert.equal(
      /s\d球/i.test(digest.poolImpacts.ttg),
      false,
      `TTG pool impact must strip internal 's' prefix (e.g. '2球 / 3球'), got: ${digest.poolImpacts.ttg}`
    );
    assert.ok(Array.isArray(digest.trendMovements));
  });
});

describe("Spec 0010 · Seam 3: Guided 1-2-3 Workflow, Tactile Flip Cards, Spring Drawers, Space Compaction & Dual-Lens UI Contracts", () => {
  it("Slice 6: enforces 1-2-3 guided layout, non-overlapping Step 2 CTA, untruncated combo P&L, [1,2,3,4,5,10] multipliers, [10,20,50,100]+custom budget, post-mount handoff animation, TactileFlipCard/SpringCollapseDrawer, and Android/CSS space compaction", () => {
    const repoRoot = process.cwd();
    const appSrc = fs.readFileSync(
      path.join(repoRoot, "src/mobile/SkinPhoneApp.tsx"),
      "utf8"
    );
    const widgetsSrc = fs.readFileSync(
      path.join(repoRoot, "src/spring/widgets.tsx"),
      "utf8"
    );
    const coreCss = fs.readFileSync(
      path.join(repoRoot, "public/skins/core.css"),
      "utf8"
    );
    const androidMain = fs.readFileSync(
      path.join(
        repoRoot,
        "android/app/src/main/kotlin/io/yjty/jisuanqi/MainActivity.kt"
      ),
      "utf8"
    );

    // 1. Mobile UserManualModal receives onQuotaUpdate & onLoadPresetScenario (matching Desktop)
    const manualUsages = appSrc.match(/<UserManualModal[\s\S]*?\/>/g) || [];
    assert.equal(
      manualUsages.length,
      2,
      "Expected Desktop & Mobile UserManualModal instances"
    );
    for (const snippet of manualUsages) {
      assert.ok(
        snippet.includes("onQuotaUpdate={syncRemainingAiQuota}"),
        "Every UserManualModal instance must pass onQuotaUpdate={syncRemainingAiQuota}"
      );
      assert.ok(
        snippet.includes("onLoadPresetScenario={loadPresetScenario}"),
        "Every UserManualModal instance must pass onLoadPresetScenario={loadPresetScenario}"
      );
    }

    // 2. Space compaction: non-embed hides fake .home-ind; Android MainActivity handles displayCutout cleanly
    assert.ok(
      coreCss.includes(".jz-root:not(.embed) .home-ind") ||
        !appSrc.includes('<div className="home-ind">') ||
        appSrc.includes('{embedded && <div className="home-ind">'),
      "Fake iOS .home-ind bar must not waste vertical space outside embedded 8-skin showcase"
    );
    assert.ok(
      androidMain.includes("displayCutout()"),
      "Android MainActivity WindowInsets should include displayCutout() alongside systemBars() and ime()"
    );
    assert.ok(
      androidMain.includes("WebView.setWebContentsDebuggingEnabled(false)"),
      "Android MainActivity must preserve WebView debugging prohibition"
    );

    // 3. Auto-sync radar enabled + chicken-rib首屏 buttons removed + non-overlapping Step 2 mobile betbar decoupling
    assert.ok(
      appSrc.includes("autoSyncRadar: true"),
      "SkinPhoneApp must opt into autoSyncRadar: true on createBetSlipController"
    );
    for (const removedClutter of [
      "演:假中奖",
      "演:早晚锁利",
      "演:4串1雪崩",
      "重置2场",
      "统配倍数 (1~999倍",
    ]) {
      assert.equal(
        appSrc.includes(removedClutter),
        false,
        `SkinPhoneApp must remove cluttered inline control "${removedClutter}"`
      );
    }

    // 4. Desktop left-to-right 1 -> 2 -> 3 column order: Match Radar -> 3+1 Archetypes -> 5D Audit/Ledger
    const dkMatchIdx = appSrc.indexOf("📡 赛事雷达 · 全盘矩阵");
    const dkArchIdx = appSrc.indexOf("🎯 3+1 精算配单");
    const dkAuditIdx = appSrc.indexOf("🛡️ 五维审单锁利");
    assert.ok(
      dkMatchIdx > 0 && dkArchIdx > dkMatchIdx && dkAuditIdx > dkArchIdx,
      "Desktop 3-column workbench must flow left-to-right: ① 赛事雷达 -> ② 3+1 精算配单 -> ③ 五维审单锁利"
    );

    // 5. Practical multiplier presets [1, 2, 3, 4, 5, 10] & budget presets [10, 20, 50, 100] + custom input
    assert.ok(
      appSrc.includes("[1, 2, 3, 4, 5, 10]"),
      "Keypad multiplier presets must be upgraded to [1, 2, 3, 4, 5, 10]"
    );
    assert.equal(
      appSrc.includes("[1, 5, 10, 20, 50, 99]"),
      false,
      "Legacy [1, 5, 10, 20, 50, 99] multiplier presets must be replaced"
    );
    assert.ok(
      appSrc.includes("[10, 20, 50, 100]"),
      "Budget presets must be upgraded to [10, 20, 50, 100]"
    );
    assert.equal(
      appSrc.includes("[50, 100, 200, 500]"),
      false,
      "Legacy [50, 100, 200, 500] budget presets must be replaced"
    );

    // 6. Untruncated Combo P&L + TactileFlipCard + SpringCollapseDrawer + Stance Δ + Dual-Lens Intel
    assert.equal(
      /\.combo-item\s+\.cdesc\s+b\s*\{[^}]*text-overflow:\s*ellipsis/.test(
        coreCss
      ),
      false,
      "core.css must remove single-line ellipsis truncation on .combo-item .cdesc b"
    );
    assert.ok(
      widgetsSrc.includes("export function TactileFlipCard") &&
        widgetsSrc.includes("inert="),
      "widgets.tsx must export TactileFlipCard with inert focus isolation on hidden faces"
    );
    assert.ok(
      widgetsSrc.includes("export function SpringCollapseDrawer"),
      "widgets.tsx must export SpringCollapseDrawer"
    );
    for (const skinFile of ["core.css", "swiss.css", "glass.css", "dial.css"]) {
      const skinCss = fs.readFileSync(
        path.join(repoRoot, "public/skins", skinFile),
        "utf8"
      );
      assert.ok(
        skinCss.includes("--flip-face-bg"),
        `${skinFile} must define opaque --flip-face-bg token for 3D flip surfaces`
      );
    }
    assert.ok(
      coreCss.includes("background: var(--flip-face-bg)"),
      "core.css .tflip-face must bind background: var(--flip-face-bg)"
    );
    assert.ok(
      coreCss.includes("prefers-reduced-motion: reduce"),
      "core.css must provide prefers-reduced-motion fallback for 3D flip / transitions"
    );
    assert.ok(
      appSrc.includes("resolveComboTicketBreakdown") &&
        appSrc.includes("sortComboRows"),
      "SkinPhoneApp must wire resolveComboTicketBreakdown & sortComboRows for untruncated Combo P&L"
    );
    assert.ok(
      appSrc.includes("getStanceDeltaSummary"),
      "SkinPhoneApp must surface transparent Stance Δ summary"
    );
    assert.ok(
      appSrc.includes("actuarySynergy") &&
        appSrc.includes("[comboReport.residualRisks]") &&
        appSrc.includes("...wsParams") &&
        appSrc.includes("buildMatchIntelDigest") &&
        appSrc.includes("一球小胜卡盘温度计") &&
        appSrc.includes("一键合成单关") &&
        appSrc.includes("isPlanHandoff") &&
        appSrc.includes("setDkFocusStep(3)"),
      "SkinPhoneApp must render string/array residualRisks, forward workspace params to analyze-combo, show card-pan thermometer, expose Step 3 single-match synthesis CTA, and sync handoffBanner/dkFocusStep"
    );
  });
});
