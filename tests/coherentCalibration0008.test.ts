import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  FALLBACK_MATCHES,
  OFFICIAL_CRS_PAIRS,
  analyzeMatchMicroQuant,
  calibrateMatchCoherentModel,
  devigPoolProbabilities,
  parseSportteryRawJson,
} from "../server/quantEngine.mjs";
import type { MatchItem } from "../src/prototype/quantTypes.ts";

describe("Spec 0008 · Seam A: Non-Linear Shin/Power De-Vigging & 4-Parameter Coherent Calibration", () => {
  it("Slice 1: solves Shin & Power de-vigging across 3/8/9/31-way pools within 1e-12, compresses FLB longshot foam, and falls back safely on degenerate boundaries", () => {
    const devig = devigPoolProbabilities;
    assert.equal(
      typeof devig,
      "function",
      "Expected devigPoolProbabilities to be exported at Seam A"
    );

    // 1. Literature / Research 0002 Table 2A reference vector: HAD [1.69, 3.25, 4.18]
    const hadOdds = [1.69, 3.25, 4.18];
    const shinHad = devig(hadOdds, "shin");
    const powerHad = devig(hadOdds, "power");
    const multHad = devig(hadOdds, "multiplicative");

    assert.equal(shinHad.methodUsed, "shin");
    assert.ok(
      Math.abs(shinHad.param - 0.07023) < 2e-4,
      `Expected Shin z ≈ 0.07023, got ${shinHad.param}`
    );
    assert.ok(Math.abs(shinHad.probs[0] - 0.5386) < 6e-4);
    assert.ok(Math.abs(shinHad.probs[1] - 0.2637) < 6e-4);
    assert.ok(Math.abs(shinHad.probs[2] - 0.1978) < 6e-4);
    assert.ok(
      Math.abs(shinHad.probs.reduce((a: number, b: number) => a + b, 0) - 1) <
        1e-12
    );

    assert.equal(powerHad.methodUsed, "power");
    assert.ok(
      Math.abs(powerHad.param - 1.14746) < 2e-4,
      `Expected Power k ≈ 1.14746, got ${powerHad.param}`
    );
    assert.ok(Math.abs(powerHad.probs[0] - 0.5477) < 6e-4);
    assert.ok(Math.abs(powerHad.probs[1] - 0.2586) < 6e-4);
    assert.ok(Math.abs(powerHad.probs[2] - 0.1937) < 6e-4);
    assert.ok(
      Math.abs(powerHad.probs.reduce((a: number, b: number) => a + b, 0) - 1) <
        1e-12
    );

    assert.equal(multHad.methodUsed, "multiplicative");
    assert.ok(
      shinHad.probs[0] > multHad.probs[0],
      "Shin must raise favorite probability relative to Multiplicative"
    );
    assert.ok(
      shinHad.probs[2] < multHad.probs[2],
      "Shin must trim underdog FLB foam relative to Multiplicative"
    );

    // 2. 8-way TTG, 9-way HAFU (Table 2B), and 31-way CRS high-vig longshot foam compression
    const hafuOdds = [2.95, 16.0, 39.0, 3.9, 4.6, 8.8, 29.0, 16.0, 7.0];
    const shinHafu = devig(hafuOdds, "shin");
    const multHafu = devig(hafuOdds, "multiplicative");
    assert.equal(shinHafu.methodUsed, "shin");
    assert.ok(Math.abs(shinHafu.probs[0] - 0.2907) < 8e-4); // 胜胜 @2.95 -> ~29.07%
    assert.ok(Math.abs(shinHafu.probs[2] - 0.0115) < 8e-4); // 胜负 @39.0 -> ~1.15% vs Multiplicative 2.04%
    assert.ok(shinHafu.probs[2] < multHafu.probs[2] * 0.65);

    for (const poolCode of ["HAD", "HHAD", "TTG", "HAFU", "CRS"] as const) {
      const opts = FALLBACK_MATCHES[0].pools[poolCode].options;
      const res = devig(opts, "shin");
      assert.equal(res.probs.length, opts.length);
      for (const p of res.probs) {
        assert.ok(
          Number.isFinite(p) && p > 0 && p < 1,
          `${poolCode} prob out of (0,1): ${p}`
        );
      }
      const sum = res.probs.reduce((a: number, b: number) => a + b, 0);
      assert.ok(
        Math.abs(sum - 1) < 1e-12,
        `${poolCode} sum error ${Math.abs(sum - 1)} >= 1e-12`
      );
    }

    const crsOpts = FALLBACK_MATCHES[0].pools.CRS.options;
    const shinCrs = devig(crsOpts, "shin");
    const multCrs = devig(crsOpts, "multiplicative");
    const idx25 = crsOpts.findIndex((o) => o.label === "2:5");
    assert.ok(idx25 >= 0);
    assert.ok(
      shinCrs.probs[idx25] < multCrs.probs[idx25] * 0.5,
      `Expected 31-way CRS @180 longshot Shin (${shinCrs.probs[idx25]}) < 0.5 * Multiplicative (${multCrs.probs[idx25]})`
    );

    // 3. Degenerate boundary fallbacks: V <= 1 + 1e-6 -> Power; O_i <= 1.0 or n < 2 -> Multiplicative
    const zeroVig = devig([2.0, 2.0], "shin");
    assert.equal(zeroVig.methodUsed, "power");
    assert.ok(Math.abs(zeroVig.probs[0] - 0.5) < 1e-12);
    assert.ok(Math.abs(zeroVig.probs[1] - 0.5) < 1e-12);

    const underround = devig([2.1, 2.1], "shin");
    assert.equal(underround.methodUsed, "power");
    assert.ok(Math.abs(underround.probs[0] + underround.probs[1] - 1) < 1e-12);

    const subUnitOdds = devig([0.95, 25.0], "shin");
    assert.equal(subUnitOdds.methodUsed, "multiplicative");
    assert.ok(subUnitOdds.probs.every((p: number) => p > 0 && p < 1));
    assert.ok(
      Math.abs(subUnitOdds.probs[0] + subUnitOdds.probs[1] - 1) < 1e-12
    );

    const singleOpt = devig([1.85], "shin");
    assert.equal(singleOpt.methodUsed, "multiplicative");
    assert.deepEqual(singleOpt.probs, [1]);
  });

  it("Slice 2: calibrates 4-parameter Dixon-Coles + Binomial Thinning across all 5 pools with < 1e-12 coherence, < 0.5ms/match speed, HAFU theta=0.43 prior, and <2-pool Shin fallback", () => {
    const calibrate = calibrateMatchCoherentModel;
    assert.equal(
      typeof calibrate,
      "function",
      "Expected calibrateMatchCoherentModel to be exported at Seam A"
    );

    const homeWinCrs = new Set([
      "1:0",
      "2:0",
      "2:1",
      "3:0",
      "3:1",
      "3:2",
      "4:0",
      "4:1",
      "4:2",
      "5:0",
      "5:1",
      "5:2",
      "胜其它",
    ]);
    const drawCrs = new Set(["0:0", "1:1", "2:2", "3:3", "平其它"]);
    const awayWinCrs = new Set([
      "0:1",
      "0:2",
      "1:2",
      "0:3",
      "1:3",
      "2:3",
      "0:4",
      "1:4",
      "2:4",
      "0:5",
      "1:5",
      "2:5",
      "负其它",
    ]);

    for (const m of FALLBACK_MATCHES as MatchItem[]) {
      const cal = calibrate(m);
      assert.equal(cal.coherent, true);
      assert.equal(cal.sellingPoolCount, 5);
      assert.ok(cal.params.lambdaHome >= 0.12 && cal.params.lambdaHome <= 5.5);
      assert.ok(cal.params.lambdaAway >= 0.12 && cal.params.lambdaAway <= 5.5);
      assert.ok(cal.params.theta >= 0.38 && cal.params.theta <= 0.46);

      // Extended 15x15 ({0..14}^2) scoreGrid strictly positive and sums to 1
      assert.equal(cal.scoreGrid.length, 225);
      let gridSum = 0;
      for (const cellP of cal.scoreGrid) {
        assert.ok(
          cellP > 0 && cellP < 1,
          `Expected strictly positive DC grid cell, got ${cellP}`
        );
        gridSum += cellP;
      }
      assert.ok(Math.abs(gridSum - 1) < 1e-12);

      // Physically compatible (HT, FT) atomic states: no impossible half-time lead on 0 full-time goals
      let atomicSum = 0;
      for (const st of cal.atomicStates) {
        assert.ok(st.prob > 0 && st.prob < 1);
        atomicSum += st.prob;
        if (st.crsKey === "0:0") {
          assert.equal(
            st.ht,
            "d",
            "0:0 full-time can ONLY have half-time draw"
          );
        }
        if (["0:1", "0:2", "0:3", "0:4", "0:5"].includes(st.crsKey)) {
          assert.notEqual(
            st.ht,
            "h",
            `${st.crsKey} full-time cannot have half-time home lead`
          );
        }
        if (["1:0", "2:0", "3:0", "4:0", "5:0"].includes(st.crsKey)) {
          assert.notEqual(
            st.ht,
            "a",
            `${st.crsKey} full-time cannot have half-time away lead`
          );
        }
      }
      assert.ok(Math.abs(atomicSum - 1) < 1e-12);

      // Every selling pool on FALLBACK_MATCHES already carries coherent fairProb & single-pool shinProb, preserving raw payoutRatio & vig
      for (const pCode of ["HAD", "HHAD", "TTG", "HAFU", "CRS"] as const) {
        const pool = m.pools[pCode];
        const invSum = pool.options.reduce((a, o) => a + 1 / o.odds, 0);
        assert.ok(Math.abs(pool.payoutRatio - 1 / invSum) < 1e-12);
        assert.ok(Math.abs(pool.vig - Math.max(0, 1 - 1 / invSum)) < 1e-12);

        let sumFair = 0;
        let sumShin = 0;
        for (const o of pool.options) {
          assert.ok(
            typeof o.shinProb === "number" && o.shinProb > 0 && o.shinProb < 1
          );
          assert.ok(o.fairProb > 0 && o.fairProb < 1);
          sumFair += o.fairProb;
          sumShin += o.shinProb!;
        }
        assert.ok(
          Math.abs(sumFair - 1) < 1e-12,
          `${m.id} ${pCode} fairProb sum drift: ${Math.abs(sumFair - 1)}`
        );
        assert.ok(
          Math.abs(sumShin - 1) < 1e-12,
          `${m.id} ${pCode} shinProb sum drift: ${Math.abs(sumShin - 1)}`
        );
      }

      // Cross-pool exact coherence invariants (< 1e-12)
      const pOf = (
        poolCode: "HAD" | "HHAD" | "TTG" | "HAFU" | "CRS",
        key: string
      ) =>
        m.pools[poolCode].options.find((o) => o.key === key || o.label === key)!
          .fairProb;

      assert.ok(
        Math.abs(
          pOf("HAFU", "hh") +
            pOf("HAFU", "dh") +
            pOf("HAFU", "ah") -
            pOf("HAD", "h")
        ) < 1e-12
      );
      assert.ok(
        Math.abs(
          pOf("HAFU", "hd") +
            pOf("HAFU", "dd") +
            pOf("HAFU", "ad") -
            pOf("HAD", "d")
        ) < 1e-12
      );
      assert.ok(
        Math.abs(
          pOf("HAFU", "ha") +
            pOf("HAFU", "da") +
            pOf("HAFU", "aa") -
            pOf("HAD", "a")
        ) < 1e-12
      );

      assert.ok(Math.abs(pOf("TTG", "s0") - pOf("CRS", "0:0")) < 1e-12);
      assert.ok(
        Math.abs(pOf("TTG", "s1") - (pOf("CRS", "1:0") + pOf("CRS", "0:1"))) <
          1e-12
      );
      assert.ok(
        Math.abs(
          pOf("TTG", "s2") -
            (pOf("CRS", "2:0") + pOf("CRS", "1:1") + pOf("CRS", "0:2"))
        ) < 1e-12
      );

      const crsH = m.pools.CRS.options
        .filter((o) => homeWinCrs.has(o.label))
        .reduce((a, o) => a + o.fairProb, 0);
      const crsD = m.pools.CRS.options
        .filter((o) => drawCrs.has(o.label))
        .reduce((a, o) => a + o.fairProb, 0);
      const crsA = m.pools.CRS.options
        .filter((o) => awayWinCrs.has(o.label))
        .reduce((a, o) => a + o.fairProb, 0);
      assert.ok(Math.abs(crsH - pOf("HAD", "h")) < 1e-12);
      assert.ok(Math.abs(crsD - pOf("HAD", "d")) < 1e-12);
      assert.ok(Math.abs(crsA - pOf("HAD", "a")) < 1e-12);

      const gLine = Number(m.pools.HHAD.goalLine);
      if (gLine === -1) {
        assert.ok(
          Math.abs(pOf("HHAD", "ha") - (pOf("HAD", "d") + pOf("HAD", "a"))) <
            1e-12
        );
        assert.ok(
          Math.abs(pOf("HHAD", "hh") + pOf("HHAD", "hd") - pOf("HAD", "h")) <
            1e-12
        );
      } else if (gLine === 1) {
        assert.ok(
          Math.abs(pOf("HHAD", "hh") - (pOf("HAD", "h") + pOf("HAD", "d"))) <
            1e-12
        );
        assert.ok(
          Math.abs(pOf("HHAD", "hd") + pOf("HHAD", "ha") - pOf("HAD", "a")) <
            1e-12
        );
      }
    }

    // HAFU unsold -> fixes theta = 0.43 while keeping HAD/HHAD/TTG/CRS coherent
    const base = FALLBACK_MATCHES[0] as MatchItem;
    const noHafuMatch: MatchItem = {
      ...base,
      id: "no-hafu-01",
      pools: {
        ...base.pools,
        HAFU: { ...base.pools.HAFU, selling: false, options: [] },
      },
    };
    const calNoHafu = calibrate(noHafuMatch);
    assert.equal(calNoHafu.coherent, true);
    assert.equal(calNoHafu.sellingPoolCount, 4);
    assert.equal(calNoHafu.params.theta, 0.43);

    // < 2 selling pools -> falls back to single-pool Shin/Power (fairProb === shinProb)
    const singlePoolMatch = parseSportteryRawJson({
      value: {
        matchInfoList: [
          {
            subMatchList: [
              {
                matchId: 99101,
                matchNumStr: "周三101",
                leagueAbbName: "杯赛",
                matchTime: "20:00:00",
                homeTeamAbbName: "甲队",
                awayTeamAbbName: "乙队",
                poolList: [
                  {
                    poolCode: "HAD",
                    single: 1,
                    cbtValue: 1,
                    poolStatus: "Selling",
                  },
                  {
                    poolCode: "HHAD",
                    single: 0,
                    cbtValue: 2,
                    poolStatus: "Suspended",
                  },
                  {
                    poolCode: "HAFU",
                    single: 0,
                    cbtValue: 2,
                    poolStatus: "Suspended",
                  },
                  {
                    poolCode: "TTG",
                    single: 0,
                    cbtValue: 2,
                    poolStatus: "Suspended",
                  },
                  {
                    poolCode: "CRS",
                    single: 0,
                    cbtValue: 2,
                    poolStatus: "Suspended",
                  },
                ],
                had: { h: "1.69", d: "3.25", a: "4.18" },
              },
            ],
          },
        ],
      },
    })[0];
    const calSingle = calibrate(singlePoolMatch);
    assert.equal(calSingle.coherent, false);
    assert.equal(calSingle.sellingPoolCount, 1);
    for (const o of singlePoolMatch.pools.HAD.options) {
      assert.ok(Math.abs(o.fairProb - o.shinProb!) < 1e-15);
    }
    assert.ok(
      Math.abs(
        singlePoolMatch.pools.HAD.options.reduce((a, o) => a + o.fairProb, 0) -
          1
      ) < 1e-12
    );

    // Speed gate: average < 0.5ms per match across 240 full 5-pool match calibrations
    // Warm up JIT
    for (const m of FALLBACK_MATCHES) calibrate(m);
    const iterations = 240;
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      calibrate(FALLBACK_MATCHES[i % FALLBACK_MATCHES.length]);
    }
    const avgMs = (performance.now() - t0) / iterations;
    assert.ok(
      avgMs < 0.5,
      `Expected average calibration < 0.5ms/match, got ${avgMs.toFixed(4)}ms`
    );
  });

  it("Slice 3: upgrades analyzeMatchMicroQuant with coherent xG sum identity, unified 1-goal share across all goalLines, paceCorrelation/paceLabel, and alphaScanSummary", () => {
    const calibrate = calibrateMatchCoherentModel;

    // 1. All 8 FALLBACK_MATCHES satisfy exact xG sum identity, coherent 1-goal share, pace fields, and alphaScanSummary
    for (const m of FALLBACK_MATCHES as MatchItem[]) {
      const mq = m.microQuant;
      const cal = calibrate(m);
      assert.equal(Number((mq.homeXG + mq.awayXG).toFixed(2)), mq.totalXG);
      assert.ok(Math.abs(mq.homeXG + mq.awayXG - mq.totalXG) < 1e-12);

      // Verify homeXG & awayXG match coherent grid E[X], E[Y] to 2 decimal places
      const gridDim = Math.round(Math.sqrt(cal.scoreGrid.length));
      const maxG = gridDim - 1;
      let expX = 0;
      let expY = 0;
      for (let x = 0; x <= maxG; x++) {
        for (let y = 0; y <= maxG; y++) {
          const p = cal.scoreGrid[x * gridDim + y];
          expX += x * p;
          expY += y * p;
        }
      }
      assert.equal(mq.homeXG, Number(expX.toFixed(2)));
      assert.equal(mq.awayXG, Number(expY.toFixed(2)));

      // Verify oneGoalProb & oneGoalShareOfWins match coherent scoreline grid regardless of goalLine (-1, +1, -2)
      const gNum = Number(m.pools.HHAD.goalLine);
      const isAwayFav = gNum > 0;
      let gridFavWin = 0;
      let gridFavOne = 0;
      for (let x = 0; x <= maxG; x++) {
        for (let y = 0; y <= maxG; y++) {
          const d = x - y;
          const p = cal.scoreGrid[x * gridDim + y];
          if (isAwayFav ? d < 0 : d > 0) {
            gridFavWin += p;
            if (d === (isAwayFav ? -1 : 1)) gridFavOne += p;
          }
        }
      }
      assert.ok(Math.abs(mq.oneGoalProb - gridFavOne) < 1e-12);
      assert.ok(
        Math.abs(
          mq.oneGoalShareOfWins - Math.min(0.85, gridFavOne / gridFavWin)
        ) < 1e-12
      );

      assert.equal(typeof mq.paceCorrelation, "number");
      assert.ok(Number.isFinite(mq.paceCorrelation));
      assert.ok(["防守死锁", "均衡节奏", "开放对攻"].includes(mq.paceLabel));
      if (mq.paceCorrelation <= -0.05) assert.equal(mq.paceLabel, "防守死锁");
      else if (mq.paceCorrelation >= 0.05)
        assert.equal(mq.paceLabel, "开放对攻");
      else assert.equal(mq.paceLabel, "均衡节奏");

      assert.equal(typeof mq.alphaScanSummary, "string");
      assert.ok(mq.alphaScanSummary.length >= 10);
    }

    // 2. Helper to synthesize a coherent Sporttery match from exact (lamH, lamA, rho, theta) + optional sub-pool lag
    const makeSyntheticMatch = (
      id: string,
      lamH: number,
      lamA: number,
      rho: number,
      goalLine: string,
      lagOption?: {
        poolCode: "HAFU" | "TTG" | "CRS";
        key: string;
        oddsMultiplier: number;
      }
    ): MatchItem => {
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
      const grid: number[][] = Array.from({ length: 11 }, () =>
        Array(11).fill(0)
      );
      let sum = 0;
      for (let x = 0; x <= 10; x++) {
        for (let y = 0; y <= 10; y++) {
          let tau = 1;
          if (x === 0 && y === 0) tau = 1 - lamH * lamA * rho;
          else if (x === 1 && y === 0) tau = 1 + lamA * rho;
          else if (x === 0 && y === 1) tau = 1 + lamH * rho;
          else if (x === 1 && y === 1) tau = 1 - rho;
          grid[x][y] = tau * pX[x] * pY[y];
          sum += grid[x][y];
        }
      }
      for (let x = 0; x <= 10; x++)
        for (let y = 0; y <= 10; y++) grid[x][y] /= sum;

      const gNum = Number(goalLine);
      let h = 0,
        d = 0,
        a = 0,
        hh = 0,
        hd = 0,
        ha = 0;
      const ttg = Array(8).fill(0);
      const crsMap: Record<string, number> = {};
      for (const [, lbl] of OFFICIAL_CRS_PAIRS) crsMap[lbl] = 0;
      const explicitSet = new Set(
        OFFICIAL_CRS_PAIRS.map(([, l]: [string, string]) => l)
      );

      for (let x = 0; x <= 10; x++) {
        for (let y = 0; y <= 10; y++) {
          const p = grid[x][y];
          if (x > y) h += p;
          else if (x === y) d += p;
          else a += p;
          if (x + gNum > y) hh += p;
          else if (x + gNum === y) hd += p;
          else ha += p;
          ttg[Math.min(7, x + y)] += p;
          const lbl = `${x}:${y}`;
          if (explicitSet.has(lbl)) crsMap[lbl] += p;
          else if (x > y) crsMap["胜其它"] += p;
          else if (x === y) crsMap["平其它"] += p;
          else crsMap["负其它"] += p;
        }
      }

      const toOdds = (p: number, R: number, z: number) => {
        const V = 1 / R;
        const q = Math.sqrt(V * p * ((1 - z) * p + z));
        return Number(Math.max(1.04, 1 / q).toFixed(2));
      };

      const rawMatch: Record<string, any> = {
        matchId: id,
        matchNumStr: "周六001",
        leagueAbbName: "测试甲级",
        matchTime: "20:00:00",
        homeTeamAbbName: "主测试队",
        awayTeamAbbName: "客测试队",
        poolList: [
          { poolCode: "HAD", single: 1, cbtValue: 1 },
          { poolCode: "HHAD", single: 1, cbtValue: 1 },
          { poolCode: "TTG", single: 1, cbtValue: 1 },
          { poolCode: "HAFU", single: 0, cbtValue: 2, poolStatus: "Suspended" },
          { poolCode: "CRS", single: 1, cbtValue: 1 },
        ],
        had: {
          h: String(toOdds(h, 0.88, 0.05)),
          d: String(toOdds(d, 0.88, 0.05)),
          a: String(toOdds(a, 0.88, 0.05)),
        },
        hhad: {
          goalLine,
          h: String(toOdds(hh, 0.88, 0.05)),
          d: String(toOdds(hd, 0.88, 0.05)),
          a: String(toOdds(ha, 0.88, 0.05)),
        },
        ttg: Object.fromEntries(
          ttg.map((p, idx) => [`s${idx}`, String(toOdds(p, 0.8, 0.06))])
        ),
        crs: Object.fromEntries(
          OFFICIAL_CRS_PAIRS.map(([rawK, lbl]: [string, string]) => [
            rawK,
            String(toOdds(crsMap[lbl], 0.76, 0.08)),
          ])
        ),
      };
      rawMatch.crs.s00s00 = rawMatch.ttg.s0;
      if (gNum === -1) {
        const synDa =
          1 / (1 / Number(rawMatch.had.d) + 1 / Number(rawMatch.had.a));
        const remInv = Math.max(0.12, 1 / 0.88 - 1 / synDa);
        const rawInvHh = 1 / Number(rawMatch.hhad.h);
        const rawInvHd = 1 / Number(rawMatch.hhad.d);
        const sc = remInv / (rawInvHh + rawInvHd);
        rawMatch.hhad.a = synDa.toFixed(2);
        rawMatch.hhad.h = Math.max(1.04, 1 / (rawInvHh * sc)).toFixed(2);
        rawMatch.hhad.d = Math.max(1.04, 1 / (rawInvHd * sc)).toFixed(2);
      } else if (gNum === 1) {
        const synHd =
          1 / (1 / Number(rawMatch.had.h) + 1 / Number(rawMatch.had.d));
        const remInv = Math.max(0.12, 1 / 0.88 - 1 / synHd);
        const rawInvHd = 1 / Number(rawMatch.hhad.d);
        const rawInvHa = 1 / Number(rawMatch.hhad.a);
        const sc = remInv / (rawInvHd + rawInvHa);
        rawMatch.hhad.h = synHd.toFixed(2);
        rawMatch.hhad.d = Math.max(1.04, 1 / (rawInvHd * sc)).toFixed(2);
        rawMatch.hhad.a = Math.max(1.04, 1 / (rawInvHa * sc)).toFixed(2);
      }

      if (lagOption) {
        if (lagOption.poolCode === "TTG") {
          rawMatch.ttg[lagOption.key] = String(
            Number(
              (
                Number(rawMatch.ttg[lagOption.key]) * lagOption.oddsMultiplier
              ).toFixed(2)
            )
          );
        } else if (lagOption.poolCode === "CRS") {
          const pair = OFFICIAL_CRS_PAIRS.find(
            ([, lbl]: [string, string]) => lbl === lagOption.key
          )!;
          rawMatch.crs[pair[0]] = String(
            Number(
              (
                Number(rawMatch.crs[pair[0]]) * lagOption.oddsMultiplier
              ).toFixed(2)
            )
          );
        }
      }

      return parseSportteryRawJson({
        value: { matchInfoList: [{ subMatchList: [rawMatch] }] },
      })[0];
    };

    // Defensive deadlock (rho = -0.16 -> 0:0 and 1:1 inflated) vs Open attack (rho = +0.16)
    const deadlockMatch = makeSyntheticMatch(
      "pace-deadlock",
      1.15,
      1.05,
      -0.16,
      "-1"
    );
    assert.ok(
      deadlockMatch.microQuant.paceCorrelation <= -0.05,
      `Expected rho <= -0.05, got ${deadlockMatch.microQuant.paceCorrelation}`
    );
    assert.equal(deadlockMatch.microQuant.paceLabel, "防守死锁");
    assert.ok(
      deadlockMatch.microQuant.alphaScanSummary.includes("严密") ||
        deadlockMatch.microQuant.alphaScanSummary.includes("无跨盘错价洼地"),
      `Tightly priced match should report no cross-pool alpha, got: ${deadlockMatch.microQuant.alphaScanSummary}`
    );

    const openMatch = makeSyntheticMatch("pace-open", 1.65, 1.45, 0.16, "-1");
    assert.ok(
      openMatch.microQuant.paceCorrelation >= 0.05,
      `Expected rho >= 0.05, got ${openMatch.microQuant.paceCorrelation}`
    );
    assert.equal(openMatch.microQuant.paceLabel, "开放对攻");

    // Lagged sub-pool option (e.g. TTG s2 lagged +22% higher odds) triggers >= +3.0% alphaScanSummary!
    const alphaMatch = makeSyntheticMatch("alpha-lag", 1.5, 1.1, 0.0, "-1", {
      poolCode: "TTG",
      key: "s2",
      oddsMultiplier: 1.24,
    });
    assert.ok(
      alphaMatch.microQuant.alphaScanSummary.includes("洼地"),
      `Expected alphaScanSummary to detect >= +3.0% sub-pool mispricing, got: ${alphaMatch.microQuant.alphaScanSummary}`
    );

    // Unified 1-goal share across -1, -2, +2, and suspended HHAD
    const mMinus2 = makeSyntheticMatch("line-minus2", 2.6, 0.55, 0.0, "-2");
    const mPlus2 = makeSyntheticMatch("line-plus2", 0.55, 2.6, 0.0, "+2");
    assert.ok(mMinus2.microQuant.oneGoalShareOfWins < 0.5);
    assert.ok(mPlus2.microQuant.oneGoalShareOfWins < 0.5);
    assert.ok(
      Math.abs(
        mMinus2.microQuant.oneGoalShareOfWins -
          mPlus2.microQuant.oneGoalShareOfWins
      ) < 0.02
    );

    const mSuspHhad: MatchItem = {
      ...mPlus2,
      pools: {
        ...mPlus2.pools,
        HHAD: {
          ...mPlus2.pools.HHAD,
          selling: false,
          goalLine: "-1",
          options: [],
        },
      },
    };
    const mqSusp = analyzeMatchMicroQuant(mSuspHhad);
    assert.ok(
      Math.abs(
        mqSusp.oneGoalShareOfWins - mPlus2.microQuant.oneGoalShareOfWins
      ) < 0.02
    );
  });

  it("Slice 4 · Layer 1 Proper Scoring Rules: Shin + Coherent Dixon-Coles strictly beats legacy Multiplicative on RPS, Brier Score, Log-Loss, and 10-bin ECE across HAD, HAFU, and CRS", () => {
    const fixturePath = path.resolve(
      process.cwd(),
      "tests/fixtures/syntheticCoherenceFixture.json"
    );
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as {
      schemaVersion: string;
      matchCount: number;
      cycleCount: number;
      matches: Array<
        Record<string, any> & {
          profile: string;
          outcome: {
            htHome: number;
            htAway: number;
            ftHome: number;
            ftAway: number;
            hadKey: string;
            hafuKey: string;
            ttgKey: string;
            crsLabel: string;
          };
        }
      >;
    };

    assert.ok(fixture.matches.length >= 60 && fixture.matches.length <= 120);
    assert.equal(fixture.matches.length, fixture.matchCount);

    const profilesSeen = new Set<string>();
    for (const rm of fixture.matches) {
      profilesSeen.add(rm.profile);
      assert.ok(
        rm.outcome.htHome >= 0 && rm.outcome.htHome <= rm.outcome.ftHome
      );
      assert.ok(
        rm.outcome.htAway >= 0 && rm.outcome.htAway <= rm.outcome.ftAway
      );
    }
    for (const requiredProfile of [
      "balanced",
      "heavy-home",
      "heavy-away",
      "defensive-deadlock",
      "open-high-scoring",
    ]) {
      assert.equal(
        profilesSeen.has(requiredProfile),
        true,
        `Missing match profile ${requiredProfile}`
      );
    }

    parseSportteryRawJson({
      value: {
        matchInfoList: [{ subMatchList: fixture.matches.slice(0, 32) }],
      },
    });
    const t0 = performance.now();
    const parsedMatches = parseSportteryRawJson({
      value: { matchInfoList: [{ subMatchList: fixture.matches }] },
    }) as MatchItem[];
    const parseElapsedMs = performance.now() - t0;
    assert.equal(parsedMatches.length, fixture.matches.length);
    assert.ok(
      parseElapsedMs / parsedMatches.length < 0.5,
      `Expected batch parse+calibrate < 0.5ms/match, got ${(parseElapsedMs / parsedMatches.length).toFixed(4)}ms`
    );

    // Verify Sporttery vig realism & 5-pool coherence across all settled matches
    for (const pm of parsedMatches) {
      assert.ok(pm.pools.HAD.vig >= 0.09 && pm.pools.HAD.vig <= 0.16);
      assert.ok(pm.pools.HAFU.vig >= 0.16 && pm.pools.HAFU.vig <= 0.28);
      assert.ok(pm.pools.CRS.vig >= 0.18 && pm.pools.CRS.vig <= 0.34);

      const pOf = (
        poolCode: "HAD" | "HHAD" | "TTG" | "HAFU" | "CRS",
        key: string
      ) =>
        pm.pools[poolCode].options.find(
          (o) => o.key === key || o.label === key
        )!.fairProb;
      assert.ok(
        Math.abs(
          pOf("HAFU", "hh") +
            pOf("HAFU", "dh") +
            pOf("HAFU", "ah") -
            pOf("HAD", "h")
        ) < 1e-12
      );
      assert.ok(Math.abs(pOf("TTG", "s0") - pOf("CRS", "0:0")) < 1e-12);
      assert.equal(
        Number((pm.microQuant.homeXG + pm.microQuant.awayXG).toFixed(2)),
        pm.microQuant.totalXG
      );
    }

    const computeProperScoring = (poolCode: "HAD" | "HAFU" | "CRS") => {
      let multRps = 0;
      let cohRps = 0;
      let multBrier = 0;
      let cohBrier = 0;
      let multLogLoss = 0;
      let cohLogLoss = 0;
      const multPairs: Array<[number, number]> = [];
      const cohPairs: Array<[number, number]> = [];

      for (let i = 0; i < parsedMatches.length; i++) {
        const pm = parsedMatches[i];
        const out = fixture.matches[i].outcome;
        const opts = pm.pools[poolCode].options;
        const multProbs = devigPoolProbabilities(opts, "multiplicative").probs;
        const cohProbs = opts.map((o) => o.fairProb);

        const winIdx =
          poolCode === "HAD"
            ? opts.findIndex((o) => o.key === out.hadKey)
            : poolCode === "HAFU"
              ? opts.findIndex((o) => o.key === out.hafuKey)
              : opts.findIndex((o) => o.label === out.crsLabel);
        assert.ok(
          winIdx >= 0,
          `Outcome not found in ${poolCode} for match ${pm.id}`
        );

        const R = opts.length;
        let cumM = 0;
        let cumC = 0;
        let cumY = 0;
        let rpsM = 0;
        let rpsC = 0;
        for (let r = 0; r < R; r++) {
          const y = r === winIdx ? 1 : 0;
          multBrier += (multProbs[r] - y) ** 2;
          cohBrier += (cohProbs[r] - y) ** 2;
          multPairs.push([multProbs[r], y]);
          cohPairs.push([cohProbs[r], y]);
          if (r < R - 1) {
            cumM += multProbs[r];
            cumC += cohProbs[r];
            cumY += y;
            rpsM += (cumM - cumY) ** 2;
            rpsC += (cumC - cumY) ** 2;
          }
        }
        multRps += rpsM / (R - 1);
        cohRps += rpsC / (R - 1);
        multLogLoss += -Math.log(Math.max(1e-12, multProbs[winIdx]));
        cohLogLoss += -Math.log(Math.max(1e-12, cohProbs[winIdx]));
      }

      const calcEce10 = (pairs: Array<[number, number]>) => {
        const bins = Array.from({ length: 10 }, () => ({
          count: 0,
          sumP: 0,
          sumY: 0,
        }));
        for (const [p, y] of pairs) {
          const b = Math.min(9, Math.max(0, Math.floor(p * 10)));
          bins[b].count += 1;
          bins[b].sumP += p;
          bins[b].sumY += y;
        }
        let ece = 0;
        for (const b of bins) {
          if (b.count > 0) {
            ece += Math.abs(b.sumP - b.sumY) / pairs.length;
          }
        }
        return ece;
      };

      const N = parsedMatches.length;
      return {
        multiplicative: {
          rps: multRps / N,
          brier: multBrier / N,
          logLoss: multLogLoss / N,
          ece: calcEce10(multPairs),
        },
        coherentShinDc: {
          rps: cohRps / N,
          brier: cohBrier / N,
          logLoss: cohLogLoss / N,
          ece: calcEce10(cohPairs),
        },
      };
    };

    for (const poolCode of ["HAD", "HAFU", "CRS"] as const) {
      const m = computeProperScoring(poolCode);
      assert.ok(
        m.coherentShinDc.rps < m.multiplicative.rps,
        `${poolCode} RPS: expected Shin+DC (${m.coherentShinDc.rps}) < Multiplicative (${m.multiplicative.rps})`
      );
      assert.ok(
        m.coherentShinDc.brier < m.multiplicative.brier,
        `${poolCode} Brier: expected Shin+DC (${m.coherentShinDc.brier}) < Multiplicative (${m.multiplicative.brier})`
      );
      assert.ok(
        m.coherentShinDc.logLoss < m.multiplicative.logLoss,
        `${poolCode} Log-Loss: expected Shin+DC (${m.coherentShinDc.logLoss}) < Multiplicative (${m.multiplicative.logLoss})`
      );
      assert.ok(
        m.coherentShinDc.ece < m.multiplicative.ece,
        `${poolCode} 10-bin ECE: expected Shin+DC (${m.coherentShinDc.ece}) < Multiplicative (${m.multiplicative.ece})`
      );
    }
  });
});
