import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  FALLBACK_MATCHES,
  evaluateQuantWorkspace,
  generateParetoPortfolio,
} from "../server/quantEngine.mjs";
import {
  DESKTOP_RIGHT_CABIN_TABS,
  DESKTOP_WORKBENCH_COLUMNS,
  KEYPAD_MULTIPLIER_PRESETS,
  PORTFOLIO_BUDGET_PRESETS,
  PORTFOLIO_CUSTOM_BUDGET_LIMITS,
  SUBJECTIVE_SLIDER_BOUNDS,
  buildAuditCockpitTiles,
  buildLedgerEntryPresentation,
  buildMobileTab4CabinOptions,
  buildPortfolioKpiTiles,
  buildPortfolioSlotOptions,
  buildPosterSlipRows,
  buildSyntheticModePillSpecs,
  formatHedgeDrawerCopy,
  formatLedgerStatsSummary,
  formatPaceCorrelationTileLabel,
  formatPortfolioGroupAndTicketMetric,
  normalizeComboResidualRisks,
  resolveCompactAuditBarPrimaryAction,
} from "../src/mobile/cabins/cabinViewModels.ts";
import {
  EMPTY_INSIGHTS,
  EMPTY_TRUTH_REPORT,
  type ArchetypePlan,
  type MatchItem,
} from "../src/prototype/quantTypes.ts";
import type { LedgerEntry } from "../src/security/secureClient.ts";

describe("Spec #5 · Ticket #9: Thin 5-Cabin Shell, Behavioral UI View-Models & v2.7.0 Parity", () => {
  it("Slice 1 (Pure Cabin View-Models): computes honest 3+1 KPI tiles, >99x ticket split vs 1:1 groups, 3-state staggered hedge copy, synthetic-single priority, and dual-track ledger presentation", () => {
    const matches = FALLBACK_MATCHES as MatchItem[];

    // 1. Preset & layout constants
    assert.deepEqual(PORTFOLIO_BUDGET_PRESETS, [10, 20, 50, 100]);
    assert.deepEqual(PORTFOLIO_CUSTOM_BUDGET_LIMITS, {
      min: 2,
      max: 20000,
      step: 2,
    });
    assert.deepEqual(KEYPAD_MULTIPLIER_PRESETS, [1, 2, 3, 4, 5, 10]);
    assert.deepEqual(SUBJECTIVE_SLIDER_BOUNDS, { min: -15, max: 15, step: 1 });
    assert.deepEqual(DESKTOP_WORKBENCH_COLUMNS, [
      "① 📡 赛事雷达 · 全盘矩阵",
      "② 🎯 3+1 精算配单",
      "③ 🛡️ 五维审单锁利",
    ]);
    assert.deepEqual(DESKTOP_RIGHT_CABIN_TABS, [
      ["audit", "③ 🛡️ 五维审单锁利"],
      ["ledger", "📒 双轨账本"],
      ["intel", "🧹 小高情报舱"],
    ]);
    assert.deepEqual(buildMobileTab4CabinOptions(3, 12), [
      ["ledger", "📒 双轨账本(3)"],
      ["intel", "🧹 小高情报舱(12)"],
    ]);

    // 2. 3+1 Portfolio Slot options & KPI Tiles (dynamic underwaterCount, objective lock, >99x split, wipeoutMiss2Prob)
    const plansAt5000 = generateParetoPortfolio(
      matches.slice(0, 3),
      5000,
      "objective",
      false,
      []
    ) as ArchetypePlan[];
    const slotOpts = buildPortfolioSlotOptions(plansAt5000);
    assert.equal(slotOpts.length, 4);
    assert.equal(slotOpts[0][1], "稳健保本");
    assert.equal(slotOpts[1][1], "期望效用");
    assert.equal(slotOpts[2][1], "容错缩水");
    assert.ok(slotOpts[3][1].startsWith("错价雷达"));

    const splitPlan = plansAt5000.find(
      (p) =>
        p.available &&
        (p.physicalTicketCount ?? 0) > (p.logicalGroupCount ?? p.lines.length)
    );
    assert.ok(splitPlan, "Expected at least one >99x split slot at ¥5000");
    const splitMetric = formatPortfolioGroupAndTicketMetric(splitPlan!);
    assert.equal(splitMetric.tileLabel, "店面逻辑组与实票");
    assert.equal(splitMetric.has99xSplit, true);
    assert.equal(
      splitMetric.summary,
      `${splitPlan!.logicalGroupCount} 组 · ${splitPlan!.physicalTicketCount} 张票`
    );

    const samplePlan: ArchetypePlan = {
      ...plansAt5000[0],
      available: true,
      winProb: 0.62,
      profitProb: 0.475,
      strictNetGainProb: 0.425,
      objectiveProfitProb: 0.475,
      objectiveStrictNetGainProb: 0.425,
      subjectiveProjectedProfitProb: 0.49,
      expectedValueRate: -0.118,
      objectiveEVRate: -0.118,
      subjectiveProjectedEVRate: -0.064,
      underwaterCount: 2,
      logicalGroupCount: 3,
      physicalTicketCount: 3,
      wipeoutMiss2Prob: 0.184,
      missOneReturn: 36,
      minReturn: 36,
      maxReturn: 148,
      vigPct: 11.8,
    };
    const kpiTiles = buildPortfolioKpiTiles(samplePlan);
    assert.equal(kpiTiles.tile1.label, "严格净赚率");
    assert.equal(kpiTiles.tile1.value, "42.5%");
    assert.equal(
      kpiTiles.tile1.subtitle,
      "另含 5.0% 刚回本 · 个人推演 49.0% · 命中 62.0%"
    );
    assert.equal(kpiTiles.tile2.isDanger, true);
    assert.equal(kpiTiles.tile2.subtitle, "⚠️ 含 2 组局部回血(<本金)");
    assert.equal(kpiTiles.tile3.label, "客观数学期望与抽水");
    assert.equal(kpiTiles.tile3.value, "-11.8%");
    assert.equal(kpiTiles.tile3.subtitle, "个人推演 -6.4% · 返88.2%");
    assert.equal(kpiTiles.tile4.label, "店面逻辑组与实票");
    assert.equal(kpiTiles.tile4.value, "3 组（3 张实票）");
    assert.equal(kpiTiles.tile4.subtitle, "错≥2场击穿 18.4%");

    const zeroUwTiles = buildPortfolioKpiTiles({
      ...samplePlan,
      underwaterCount: 0,
      subjectiveProjectedEVRate: null,
      wipeoutMiss2Prob: null,
    });
    assert.equal(zeroUwTiles.tile2.isDanger, false);
    assert.equal(zeroUwTiles.tile2.subtitle, "0 假中奖倒贴");
    assert.equal(zeroUwTiles.tile3.subtitle, "票面返还 88.2%");
    assert.equal(zeroUwTiles.tile4.subtitle, "点右上翻转看实票拆解");

    // 3. Audit Cockpit Kelly 0% cap & 3-state honest Staggered Hedge copy
    const negAudit = buildAuditCockpitTiles(
      {
        ...EMPTY_TRUTH_REPORT,
        totalCost: 20,
        minPayout: 16.4,
        maxPayout: 52.8,
        anyWinProb: 0.54,
        objectiveProfitProb: 0.42,
        objectiveStrictNetGainProb: 0.38,
        underwaterCount: 1,
        comboCount: 3,
        underwaterShareOfWins: 0.22,
        dangerScore: 48,
        objectiveEVRate: -0.12,
      },
      { ...EMPTY_INSIGHTS, fiveLossStreakProb: 0.13, recommendedBankrollPct: 2 }
    );
    assert.equal(negAudit.tile1.label, "整单归零率");
    assert.equal(negAudit.tile1.value, "46.0%");
    assert.ok(negAudit.tile2.subtitle.includes("另含 4.0% 刚回本"));
    assert.equal(negAudit.tile3.isDanger, true);
    assert.ok(negAudit.tile3.subtitle.includes("1/3 组倒贴"));
    assert.ok(negAudit.tile4.subtitle.includes("连黑5次 13% · 凯利0%·娱乐≤2%"));

    const reduceLossHedge = formatHedgeDrawerCopy(
      {
        ...EMPTY_INSIGHTS.hedge,
        available: true,
        hedgeMode: "reduce-loss",
        earlyKickoff: "19:35",
        lateKickoff: "03:00",
        gapText: "7h25m",
        hedgeCost: 4,
        lockedNetProfit: -0.32,
      },
      20
    );
    assert.equal(
      reduceLossHedge.drawerTitle,
      "⚠️ 早场红单减损补单 & 主观信心/腰斩沙盒"
    );
    assert.equal(
      reduceLossHedge.lockedOutcomeText,
      "锁死少亏 -¥0.32（拿回 ¥23.68）"
    );
    assert.equal(reduceLossHedge.badgeText, "仅减损");

    const breakEvenHedge = formatHedgeDrawerCopy(
      {
        ...EMPTY_INSIGHTS.hedge,
        available: true,
        hedgeMode: "break-even",
        earlyKickoff: "19:35",
        lateKickoff: "03:00",
        gapText: "7h25m",
        hedgeCost: 4,
        lockedNetProfit: 0,
      },
      20
    );
    assert.equal(
      breakEvenHedge.drawerTitle,
      "⚖️ 早晚场零损锁回本金 & 主观信心/腰斩沙盒"
    );
    assert.equal(breakEvenHedge.lockedOutcomeText, "零损锁回本金 ¥24.00");

    const lockProfitHedge = formatHedgeDrawerCopy(
      {
        ...EMPTY_INSIGHTS.hedge,
        available: true,
        hedgeMode: "lock-profit",
        earlyKickoff: "19:35",
        lateKickoff: "03:00",
        gapText: "7h25m",
        hedgeCost: 6,
        lockedNetProfit: 8.5,
      },
      20
    );
    assert.equal(lockProfitHedge.lockedOutcomeText, "稳赚净利 +¥8.50");

    // 4. Synthetic single mode pills & compact audit bar CTA precedence
    const pillsNoBlind = buildSyntheticModePillSpecs(true, false, false);
    assert.deepEqual(
      pillsNoBlind.map((p) => p.label),
      ["🛡️ 3项全包无死角", "⚡ 2项省本搏常规", "🌉 搭1场过桥凑2串1"]
    );
    const pillsWithBlind = buildSyntheticModePillSpecs(false, true, true);
    assert.deepEqual(
      pillsWithBlind.map((p) => p.label),
      ["🛡️常规比分覆盖", "🌉搭1场过桥凑2串1"]
    );

    const synFirstCta = resolveCompactAuditBarPrimaryAction(
      { canCheckout: false },
      { isSyntheticPlayable: true, showBridgeFinder: false },
      []
    );
    assert.deepEqual(synFirstCta, {
      kind: "synthetic",
      label: "一键合成单关",
    });

    const bridgeFallbackCta = resolveCompactAuditBarPrimaryAction(
      { canCheckout: false },
      { isSyntheticPlayable: false, showBridgeFinder: true },
      [
        {
          kind: "lowest-vig",
          badge: "最低抽水",
          matchId: matches[1].id,
          matchNumStr: matches[1].matchNumStr,
          home: matches[1].home,
          away: matches[1].away,
          kickoff: matches[1].kickoff,
          poolCode: "HAD",
          poolName: "胜平负",
          optionKey: "h",
          optionLabel: "主胜",
          odds: 1.55,
          fairProb: 0.58,
          singleLegReturnRate: 0.899,
          gapMinutes: 180,
          reason: "低抽水稳胆",
        },
      ]
    );
    assert.deepEqual(bridgeFallbackCta, {
      kind: "bridge",
      label: "🌉一键凑2串1",
    });

    // 5. Single-match pace ρ label, residualRisks normalization, ledger presentation & poster >99x split
    const paceLbl = formatPaceCorrelationTileLabel({
      ...matches[0].microQuant,
      paceLabel: "防守死锁",
      paceCorrelation: -0.12,
    });
    assert.equal(
      paceLbl,
      "比赛节奏相关性 · 防守死锁（低比分联动修正系数 ρ=-0.12）"
    );
    assert.deepEqual(normalizeComboResidualRisks("次关轮换隐患"), [
      "次关轮换隐患",
    ]);

    const paperWonEntry: LedgerEntry = {
      id: "e_pw",
      kind: "paper",
      title: "2串1 · 1注方案",
      modeLabel: "2串1",
      betCount: 1,
      cost: 0,
      paperRefCost: 80,
      minPayout: 145,
      maxPayout: 145,
      status: "won",
      settledReturn: 0,
      netProfit: 0,
      createdAt: Date.now(),
      settledAt: Date.now(),
    };
    const pwPres = buildLedgerEntryPresentation(paperWonEntry);
    assert.equal(pwPres.cardToneClass, "is-paper");
    assert.equal(pwPres.badgeText, "🎯模拟命中(未实买)");

    const statsSummary = formatLedgerStatsSummary({
      liveSettledCount: 2,
      liveWonCount: 1,
      livePartialCount: 1,
      liveTotalStaked: 120,
      liveNetProfit: 30,
      liveRoiPct: 25,
      liveWinRatePct: 50,
      paperCount: 3,
      paperWonCount: 1,
      paperPartialCount: 1,
      paperLostCount: 1,
      paperSavedAmount: 96,
    });
    assert.equal(statsSummary.netProfitText, "+¥30.00");
    assert.equal(statsSummary.winRateSub, "真红单率 (1/2 · 另1回血)");
    assert.equal(statsSummary.paperSavedSub, "模拟免损 (2亏/1中)");

    const wsSample = evaluateQuantWorkspace(
      {
        picks: [
          {
            matchId: matches[0].id,
            matchNumStr: matches[0].matchNumStr,
            home: matches[0].home,
            away: matches[0].away,
            poolCode: "HAD",
            poolName: "胜平负",
            singleAllowed: matches[0].pools.HAD.single,
            optionKey: "h",
            optionLabel: "主胜",
            odds: matches[0].pools.HAD.options[0].odds,
            fairProb: matches[0].pools.HAD.options[0].fairProb,
          },
          {
            matchId: matches[1].id,
            matchNumStr: matches[1].matchNumStr,
            home: matches[1].home,
            away: matches[1].away,
            poolCode: "HAD",
            poolName: "胜平负",
            singleAllowed: matches[1].pools.HAD.single,
            optionKey: "h",
            optionLabel: "主胜",
            odds: matches[1].pools.HAD.options[0].odds,
            fairProb: matches[1].pools.HAD.options[0].fairProb,
          },
        ],
        multiple: 150,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: [],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      matches
    );
    const posterRows = buildPosterSlipRows(
      wsSample.effectiveReport,
      null,
      null,
      [],
      150,
      new Set([matches[0].id])
    );
    assert.equal(posterRows.length, 2, "150x ticket must split into 99x + 51x");
    assert.ok(posterRows[0].left.includes("📌【胆】"));
    assert.ok(posterRows[0].right.includes("99倍"));
    assert.ok(posterRows[1].right.includes("51倍"));
  });

  it("Slice 2 (Thin Responsive Shell <= 800L & 7 Pure-Render Cabin Modules): enforces hotspot line budgets, createWorkbenchController delegation, and thin-view client isolation across src/mobile/cabins/*.tsx", () => {
    const repoRoot = process.cwd();
    const countLines = (rel: string) =>
      fs.readFileSync(path.join(repoRoot, rel), "utf8").split("\n").length;

    const skinAppLines = countLines("src/mobile/SkinPhoneApp.tsx");
    const manualModalLines = countLines("src/manual/UserManualModal.tsx");
    const shieldLines = countLines("server/securityShield.mjs");
    const quantFacadeLines = countLines("server/quantEngine.mjs");

    assert.ok(
      skinAppLines <= 800,
      `Expected SkinPhoneApp.tsx <= 800 lines, got ${skinAppLines}`
    );
    assert.ok(
      manualModalLines <= 350,
      `Expected UserManualModal.tsx <= 350 lines, got ${manualModalLines}`
    );
    assert.ok(
      shieldLines <= 750,
      `Expected securityShield.mjs <= 750 lines, got ${shieldLines}`
    );
    assert.ok(
      quantFacadeLines < 600,
      `Expected quantEngine.mjs < 600 lines, got ${quantFacadeLines}`
    );

    const shieldSrc = fs.readFileSync(
      path.join(repoRoot, "server/securityShield.mjs"),
      "utf8"
    );
    assert.equal(
      shieldSrc.includes("sportteryFeed"),
      false,
      "securityShield.mjs must contain zero Sporttery feed imports"
    );

    const shellSrc = fs.readFileSync(
      path.join(repoRoot, "src/mobile/SkinPhoneApp.tsx"),
      "utf8"
    );
    assert.ok(
      shellSrc.includes("createWorkbenchController"),
      "SkinPhoneApp.tsx must wire createWorkbenchController"
    );
    assert.ok(
      shellSrc.includes("playabilityGates"),
      "SkinPhoneApp.tsx must consume unified playabilityGates from workbench snapshot"
    );
    assert.ok(
      shellSrc.includes("wbCtrl.dispose()"),
      "SkinPhoneApp.tsx must dispose wbCtrl in a useEffect cleanup on unmount"
    );

    const choreoSrc = fs.readFileSync(
      path.join(repoRoot, "src/mobile/cabins/useShellChoreography.ts"),
      "utf8"
    );
    assert.equal(
      choreoSrc.includes("registerAuthRevokedHandler"),
      false,
      "useShellChoreography.ts must NOT call registerAuthRevokedHandler directly (prevents clobbering wbCtrl's authPort handler)"
    );
    assert.equal(
      choreoSrc.includes("readPersistedWechatAuth"),
      false,
      "useShellChoreography.ts must route session token checks strictly through wbCtrl instead of calling readPersistedWechatAuth directly"
    );

    const wbCtrlSrc = fs.readFileSync(
      path.join(repoRoot, "src/workspace/workbenchController.ts"),
      "utf8"
    );
    assert.equal(
      wbCtrlSrc.includes("const WECHAT_AUTH_STORAGE_KEY") ||
        wbCtrlSrc.includes("const LEDGER_CACHE_PREFIX"),
      false,
      "workbenchController.ts must reuse secureClient.ts storage helpers instead of duplicating storage keys & JSON parsing"
    );
    for (const sharedStorageFn of [
      "readPersistedWechatAuth",
      "persistWechatAuth",
      "clearPersistedWechatAuth",
      "readCachedLedgerSnapshot",
      "persistCachedLedgerSnapshot",
    ]) {
      assert.ok(
        wbCtrlSrc.includes(sharedStorageFn),
        `workbenchController.ts must delegate to shared secureClient storage helper "${sharedStorageFn}"`
      );
    }
    for (const retiredInlineState of [
      "setLedger(",
      "setStopLossPrompt(",
      "setUndoBanner(",
      "setDiagnosingMatchId(",
      "setDiagnosingCombo(",
      "setComboReport(",
      "setOfflineMode(",
      "setAuthUser(",
    ]) {
      assert.equal(
        shellSrc.includes(retiredInlineState),
        false,
        `SkinPhoneApp.tsx must delete duplicated inline state setter "${retiredInlineState}"`
      );
    }

    const requiredCabins = [
      "src/mobile/cabins/MatchRadarCabin.tsx",
      "src/mobile/cabins/ParetoPortfolioCabin.tsx",
      "src/mobile/cabins/AuditCockpitCabin.tsx",
      "src/mobile/cabins/IntelCabin.tsx",
      "src/mobile/cabins/LedgerCabin.tsx",
      "src/mobile/cabins/BottomSheetsLayer.tsx",
      "src/mobile/cabins/PersistentBetBar.tsx",
      "src/mobile/cabins/cabinViewModels.ts",
      "src/mobile/cabins/useShellChoreography.ts",
    ];
    const forbiddenClientMathRe =
      /server\/quantEngine|devigPoolProbabilities|calibrateMatchCoherentModel|generateParetoPortfolio|evaluateTicketsOnQuotientSpace|roundHalfEvenBigInt|solveExactKnapsackDutching|Math\.exp\s*\(|DixonColes/;
    const vendorLeakRe =
      /deepseek|glm-\d|opencode|chatgpt|openai|claude|anthropic|qwen|doubao|豆包|kimi|moonshot/i;

    for (const rel of ["src/mobile/SkinPhoneApp.tsx", ...requiredCabins]) {
      const full = path.join(repoRoot, rel);
      assert.ok(fs.existsSync(full), `Missing required module ${rel}`);
      const src = fs.readFileSync(full, "utf8");
      assert.equal(
        forbiddenClientMathRe.test(src),
        false,
        `${rel} must remain 100% free of server quant formulas`
      );
      assert.equal(
        vendorLeakRe.test(src),
        false,
        `${rel} must contain zero underlying model/vendor names`
      );
      assert.equal(
        src.includes("realProfitProb"),
        false,
        `${rel} must lock to objectiveStrictNetGainProb with zero realProfitProb UI leaks`
      );
      assert.equal(
        src.includes("mutex-lock"),
        false,
        `${rel} must remain free of retired .mutex-lock UI locking`
      );
    }
  });

  it("Slice 3 (Zero Brittle UI Source-String Regex Tests): verifies functional feature tests use behavioral controller/view-model assertions instead of fs.readFileSync on SkinPhoneApp.tsx or UserManualModal.tsx", () => {
    const repoRoot = process.cwd();
    const testDir = path.join(repoRoot, "tests");
    const testFiles = fs
      .readdirSync(testDir)
      .filter((f) => f.endsWith(".test.ts"));

    const skinAppSourceReaders: string[] = [];
    const manualModalSourceReaders: string[] = [];
    const comparisonStageSourceReaders: string[] = [];

    for (const file of testFiles) {
      if (file === "thinShellAndVersionParity0015.test.ts") continue;
      const src = fs.readFileSync(path.join(testDir, file), "utf8");
      if (/["'`][^"'`]*SkinPhoneApp\.tsx["'`]/.test(src)) {
        skinAppSourceReaders.push(file);
      }
      if (
        file !== "clientWorkbenchAndManual0015.test.ts" &&
        /["'`][^"'`]*(?:UserManualModal|manualChapters)\.tsx["'`]/.test(src)
      ) {
        manualModalSourceReaders.push(file);
      }
      if (
        /readFileSync\s*\([^)]*ComparisonStage\.tsx|["'`][^"'`]*src\/studio\/ComparisonStage\.tsx["'`]/.test(
          src
        ) &&
        src.includes("readFileSync")
      ) {
        // Only flag if ComparisonStage.tsx is read as raw file text rather than imported
        if (
          /readFileSync[\s\S]{0,120}ComparisonStage\.tsx|ComparisonStage\.tsx[\s\S]{0,40}utf-?8/.test(
            src
          )
        ) {
          comparisonStageSourceReaders.push(file);
        }
      }
    }

    assert.deepEqual(
      skinAppSourceReaders,
      [],
      `Expected 0 functional feature tests reading SkinPhoneApp.tsx as raw strings, found: ${skinAppSourceReaders.join(", ")}`
    );
    assert.deepEqual(
      manualModalSourceReaders,
      [],
      `Expected 0 functional feature tests reading UserManualModal.tsx / manualChapters.tsx as raw strings, found: ${manualModalSourceReaders.join(", ")}`
    );
    assert.deepEqual(
      comparisonStageSourceReaders,
      [],
      `Expected 0 functional feature tests reading ComparisonStage.tsx as raw strings, found: ${comparisonStageSourceReaders.join(", ")}`
    );
  });

  it("Slice 4 (4-Way Release Version v2.7.0 Parity & Verified domain.md Navigation Anchors): locks 2.7.0 / versionCode=270 across all 4 surfaces + /api/health and verifies every symbol anchor in docs/agents/domain.md exists in its target module", async () => {
    const repoRoot = process.cwd();
    const { runRepositoryGuardrails } =
      await import("../scripts/check-guardrails.mjs");
    const { createSecurityShield } =
      await import("../server/securityShield.mjs");

    // 1. Guardrails 4-way version parity at 2.7.0 (versionCode = 270)
    const guardrails = runRepositoryGuardrails({ rootDir: repoRoot });
    assert.deepEqual(guardrails.errors, []);
    assert.equal(guardrails.ok, true);
    assert.equal(guardrails.version, "2.7.0");

    // 2. Runtime /api/health endpoint reports 2.7.0
    const os = await import("node:os");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-v270-health-"));
    try {
      const shield = createSecurityShield({
        stateFile: path.join(tmpDir, "bans.json"),
      });
      let statusCode = 0;
      let rawBody = "";
      const handled = await shield.handleRequest(
        {
          method: "GET",
          url: "/api/health",
          headers: {},
          socket: { remoteAddress: "127.0.0.1" },
        },
        {
          set statusCode(v: number) {
            statusCode = v;
          },
          get statusCode() {
            return statusCode;
          },
          setHeader() {},
          end(chunk?: string) {
            rawBody = chunk ?? "";
          },
        },
        "/api/health"
      );
      assert.equal(handled, true);
      assert.equal(statusCode, 200);
      const parsedHealth = JSON.parse(rawBody);
      assert.equal(parsedHealth.ok, true);
      assert.equal(parsedHealth.version, "2.7.0");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    // 3. docs/agents/domain.md navigation anchors must cover all deep modules and resolve 100% against disk
    const domainDoc = fs.readFileSync(
      path.join(repoRoot, "docs/agents/domain.md"),
      "utf8"
    );
    const navSectionIdx = domainDoc.indexOf(
      "## Module navigation anchors & test conventions"
    );
    assert.ok(
      navSectionIdx >= 0,
      "Missing ## Module navigation anchors & test conventions section in docs/agents/domain.md"
    );
    const navSection = domainDoc.slice(navSectionIdx);

    // Discover every pure quant module via recursive import walk from server/quantEngine.mjs + directory walk
    const discoveredQuantModules = new Set<string>();
    const importRe =
      /(?:from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\))/g;
    const walkQuantImports = (absFile: string) => {
      const norm = path.resolve(absFile);
      const rel = path.relative(repoRoot, norm).replace(/\\/g, "/");
      if (discoveredQuantModules.has(rel) || !fs.existsSync(norm)) return;
      discoveredQuantModules.add(rel);
      const src = fs.readFileSync(norm, "utf8");
      let m: RegExpExecArray | null;
      importRe.lastIndex = 0;
      while ((m = importRe.exec(src)) !== null) {
        const spec = m[1] || m[2];
        if (spec && spec.startsWith(".")) {
          walkQuantImports(path.resolve(path.dirname(norm), spec));
        }
      }
    };
    walkQuantImports(path.join(repoRoot, "server/quantEngine.mjs"));
    for (const f of fs
      .readdirSync(path.join(repoRoot, "server/quant"))
      .filter((n) => n.endsWith(".mjs"))) {
      discoveredQuantModules.add(`server/quant/${f}`);
    }

    for (const requiredModulePath of [
      ...discoveredQuantModules,
      "server/sportteryFeed.mjs",
      "server/securityShield.mjs",
      "server/appRoutes.mjs",
      "server/ledgerManager.mjs",
      "server/manualQaEngine.mjs",
      "src/workspace/betSlipController.ts",
      "src/workspace/workbenchController.ts",
      "src/manual/manualCatalog.ts",
      "src/manual/manualChapters.tsx",
      "src/manual/UserManualModal.tsx",
      "src/mobile/SkinPhoneApp.tsx",
      "src/mobile/cabins/cabinViewModels.ts",
      "src/mobile/cabins/MatchRadarCabin.tsx",
      "src/mobile/cabins/ParetoPortfolioCabin.tsx",
      "src/mobile/cabins/AuditCockpitCabin.tsx",
      "src/mobile/cabins/IntelCabin.tsx",
      "src/mobile/cabins/LedgerCabin.tsx",
      "src/mobile/cabins/BottomSheetsLayer.tsx",
      "src/mobile/cabins/PersistentBetBar.tsx",
    ]) {
      assert.ok(
        navSection.includes(requiredModulePath),
        `docs/agents/domain.md navigation section must list "${requiredModulePath}"`
      );
    }

    // Parse every `- **`<filepath>`**:` block and verify each backticked anchor exists in that file
    const lines = navSection.split("\n");
    let currentTargetFiles: string[] = [];
    let verifiedAnchorCount = 0;
    for (const line of lines) {
      const headerMatch = line.match(/^- \*\*`([^`]+)`\*\*/);
      if (headerMatch) {
        const candidateRel = headerMatch[1];
        if (
          !candidateRel.includes("*") &&
          fs.existsSync(path.join(repoRoot, candidateRel))
        ) {
          currentTargetFiles = [candidateRel];
        } else {
          currentTargetFiles = [];
        }
        continue;
      }
      if (
        line.startsWith("- **`src/mobile/cabins/*.tsx`**") ||
        line.startsWith("- **Pure-render cabin views")
      ) {
        currentTargetFiles = ["__CABINS__"];
        continue;
      }
      if (line.startsWith("- **")) {
        currentTargetFiles = [];
        continue;
      }
      if (currentTargetFiles.length > 0 && /^\s+-\s+/.test(line)) {
        const fileMatchPrefix = line.match(
          /^\s+-\s+`([^`]+\.(?:mjs|ts|tsx))`:/
        );
        const targetRel = fileMatchPrefix
          ? fileMatchPrefix[1]
          : currentTargetFiles[0];
        if (targetRel === "__CABINS__") continue;
        const targetContent = fs.readFileSync(
          path.join(repoRoot, targetRel),
          "utf8"
        );
        const colonIdx = line.indexOf(":");
        const anchorSegment = colonIdx >= 0 ? line.slice(colonIdx + 1) : line;
        const backticked = [...anchorSegment.matchAll(/`([^`]+)`/g)].map(
          (m) => m[1]
        );
        for (const anchor of backticked) {
          assert.ok(
            targetContent.includes(anchor),
            `Symbol anchor "${anchor}" in docs/agents/domain.md was NOT found in ${targetRel}`
          );
          verifiedAnchorCount += 1;
        }
      }
    }
    assert.ok(
      verifiedAnchorCount >= 25,
      `Expected >= 25 verified symbol anchors in docs/agents/domain.md, got ${verifiedAnchorCount}`
    );
  });
});
