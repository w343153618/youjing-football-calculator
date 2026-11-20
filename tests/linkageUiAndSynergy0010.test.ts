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

    // Odd custom budget (e.g., 15) rounds to nearest even ¥2 bet unit (16)
    const plansAt15 = generateParetoPortfolio(
      [FALLBACK_MATCHES[0]],
      15,
      "objective",
      false,
      []
    );
    const alpha15 = plansAt15.find((p: any) => p.key === "alpha-radar");
    if (alpha15.available === false) {
      assert.equal(alpha15.savedCash, 16);
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
          perMatch: [
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
