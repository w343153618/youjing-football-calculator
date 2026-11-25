// Pure zero-I/O deterministic parsers & soft-block detectors for multi-source public China Sporttery feeds.
import { OFFICIAL_CRS_PAIRS } from "./quant/statutoryRules.mjs";
import {
  parseSportteryRawJson,
  parseSportteryResultsJson,
  recalibrateMergedMatch,
} from "./quant/sportteryParsers.mjs";
import { buildPool } from "./sportteryFallbackMatches.mjs";
import { orderedMatchKey } from "./matchIdentity.mjs";

const SOFT_BLOCK_PATTERNS = [
  /acw_sc__v2/i,
  /cf-browser-verification|cf_chl_opt|turnstile/i,
  /waf_captcha|geetest|aliyun_waf|TencentEdgeOne/i,
  /<title>\s*(?:403|404|502|503|访问受限|安全验证|系统维护)/i,
];

/**
 * 识别假 200（Soft-Block 空壳 / WAF 挑战页 / 异常截断响应）
 */
export function detectSoftBlockResponse(
  bodyText,
  status = 200,
  minBytes = 256
) {
  if (status === 403 || status === 429 || status === 567 || status >= 500) {
    return { blocked: true, reason: `HTTP_${status}` };
  }
  const text = String(bodyText ?? "");
  if (text.trim().length < minBytes) {
    return { blocked: true, reason: "TINY_PAYLOAD" };
  }
  const headSlice = text.slice(0, 4096);
  for (const re of SOFT_BLOCK_PATTERNS) {
    if (re.test(headSlice)) {
      return { blocked: true, reason: "CHALLENGE_OR_WAF_SHELL" };
    }
  }
  return { blocked: false, reason: null };
}

/**
 * 提取中国体彩官方接口返回体中的线下开停售配置（vtoolsConfig.offLineSaleStatus）
 */
export function extractOfficialSaleStatus(rawJson) {
  const cfg = rawJson?.value?.vtoolsConfig;
  if (!cfg || typeof cfg !== "object") {
    return { known: false, isOpen: true, stopMessage: "" };
  }
  const rawOff = cfg.offLineSaleStatus;
  const rawOn = cfg.onLineSaleStatus;
  const hasFlag = rawOff !== undefined || rawOn !== undefined;
  if (!hasFlag) {
    return { known: false, isOpen: true, stopMessage: "" };
  }
  const isOpen =
    (rawOff !== undefined ? Number(rawOff) === 1 : false) ||
    (rawOn !== undefined ? Number(rawOn) === 1 : false);
  return {
    known: true,
    isOpen,
    stopMessage: String(
      cfg.offLineStopMessage || cfg.onLineStopMessage || ""
    ).trim(),
  };
}

function formatGoalLine(raw) {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n === 0) return "-1";
  return n > 0 ? `+${Math.trunc(n)}` : `${Math.trunc(n)}`;
}

function formatStampFromMs(epochMs) {
  const bj = new Date(epochMs + 8 * 3600_000).toISOString();
  return {
    updateDate: bj.slice(0, 10),
    updateTime: bj.slice(11, 19),
  };
}

function parse500SubActiveFlags(rawAttr) {
  const map = {};
  const str = String(rawAttr ?? "");
  for (const part of str.split(",")) {
    const [k, v] = part.split(":");
    if (k) map[k.trim()] = v?.trim() === "1";
  }
  return map;
}

const HAFU_500_MAP = [
  ["3-3", "hh", "胜胜"],
  ["3-1", "hd", "胜平"],
  ["3-0", "ha", "胜负"],
  ["1-3", "dh", "平胜"],
  ["1-1", "dd", "平平"],
  ["1-0", "da", "平负"],
  ["0-3", "ah", "负胜"],
  ["0-1", "ad", "负平"],
  ["0-0", "aa", "负负"],
];

function stripTags(html) {
  return String(html ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
}

function extractAttr(tag, attrName) {
  const re = new RegExp(`${attrName}=["']([^"']*)["']`, "i");
  const m = tag.match(re);
  return m ? m[1].trim() : "";
}

function stampUnconfirmedRights(match) {
  for (const pool of Object.values(match.pools)) {
    pool.confirmedSaleRights = { single: false, allUp: false };
  }
  return match;
}

/**
 * 解析 500 竞彩混合过关全五池页面（https://trade.500.com/jczq/?playid=312，GB18030 解码后文本）
 * 包含官方同源 matchId (data-id) 及全部五大玩法 54 个选项水位。
 */
export function parse500HunheHtml(html, capturedAtMs = Date.now()) {
  const text = String(html ?? "");
  if (!text.includes("bet-tb-tr")) return [];
  const { updateDate, updateTime } = formatStampFromMs(capturedAtMs);
  const chunks = text.split(/<tr\s+class=["']bet-tb-tr[^"']*["']/i).slice(1);

  const rawMatches = [];
  for (const chunk of chunks) {
    const attrEnd = chunk.indexOf(">");
    if (attrEnd < 0) continue;
    const openAttrs = chunk.slice(0, attrEnd);
    const restChunk = chunk.slice(attrEnd + 1);
    const mainRowEnd = restChunk.indexOf("</tr>");
    const rowBody =
      mainRowEnd >= 0 ? restChunk.slice(0, mainRowEnd) : restChunk;
    const moreIdx = restChunk.indexOf("bet-more-wrap");
    // Slice up to end of outer table or next date header if last row in tbody
    const nextSectionIdx = restChunk.search(
      /<div\s+class=["']bet-date|<\/tbody>\s*<\/table>\s*<\/div>\s*<!--\s*bet-main/i
    );
    const moreBody =
      moreIdx >= 0
        ? restChunk.slice(
            moreIdx,
            nextSectionIdx > moreIdx ? nextSectionIdx : restChunk.length
          )
        : "";

    if (extractAttr(openAttrs, "data-isend") === "1") continue;
    const matchId = extractAttr(openAttrs, "data-id");
    const matchNumStr = extractAttr(openAttrs, "data-matchnum");
    if (!matchId || !/^周[一二三四五六日]\d{3}$/.test(matchNumStr)) continue;

    const home =
      extractAttr(openAttrs, "data-homesxname") ||
      stripTags(rowBody.match(/class=["']team-l["'][^>]*>([^<]+)<\/a>/i)?.[1]);
    const away =
      extractAttr(openAttrs, "data-awaysxname") ||
      stripTags(rowBody.match(/class=["']team-r["'][^>]*>([^<]+)<\/a>/i)?.[1]);
    if (!home || !away) continue;

    const league = extractAttr(openAttrs, "data-simpleleague") || "竞彩";
    const matchDate =
      extractAttr(openAttrs, "data-matchdate") ||
      extractAttr(openAttrs, "data-processdate");
    const matchTime = extractAttr(openAttrs, "data-matchtime") || "00:00";
    const businessDate =
      extractAttr(openAttrs, "data-processdate") || matchDate || undefined;
    const goalLine = formatGoalLine(extractAttr(openAttrs, "data-rangqiu"));
    const flags = parse500SubActiveFlags(
      extractAttr(openAttrs, "data-subactive")
    );

    const homeRank =
      rowBody.match(/class=["']team-l["'][\s\S]{0,180}?\[(\d{1,2})\]/i)?.[1] ||
      undefined;
    const awayRank =
      rowBody.match(/class=["']team-r["'][\s\S]{0,180}?\[(\d{1,2})\]/i)?.[1] ||
      undefined;

    const oddsByType = {
      nspf: {},
      spf: {},
      bqc: {},
      bf: {},
      jqs: {},
    };
    const combinedHtml = `${rowBody}\n${moreBody}`;
    const btnRe =
      /data-type=["'](nspf|spf|bqc|bf|jqs)["']\s+data-value=["']([^"']+)["']\s+data-sp=["']([^"']+)["']/gi;
    let bm;
    while ((bm = btnRe.exec(combinedHtml)) !== null) {
      const t = bm[1].toLowerCase();
      const val = bm[2].trim();
      const sp = Number(bm[3]);
      if (Number.isFinite(sp) && sp > 1) {
        oddsByType[t][val] = sp;
      }
    }

    const hasHad =
      oddsByType.nspf["3"] > 1 &&
      oddsByType.nspf["1"] > 1 &&
      oddsByType.nspf["0"] > 1;
    const hasHhad =
      oddsByType.spf["3"] > 1 &&
      oddsByType.spf["1"] > 1 &&
      oddsByType.spf["0"] > 1;
    if (!hasHad && !hasHhad) continue;

    const hasHafu = Object.keys(oddsByType.bqc).length >= 9;
    const hasTtg = Object.keys(oddsByType.jqs).length >= 8;
    const hasCrs = Object.keys(oddsByType.bf).length >= 25;

    const matchObj = stampUnconfirmedRights({
      id: String(matchId),
      matchNumStr,
      league,
      kickoff: matchTime.slice(0, 5),
      ...(matchDate && matchTime
        ? { kickoffDateTime: `${matchDate} ${matchTime.slice(0, 5)}` }
        : {}),
      businessDate,
      matchDate: matchDate || undefined,
      home,
      away,
      homeRank,
      awayRank,
      isHot: Boolean(flags.nspfdg && flags.spfdg),
      aiAlert: undefined,
      pools: {
        HAD: buildPool(
          "HAD",
          "胜平负",
          Boolean(flags.nspfdg),
          [
            {
              key: "h",
              label: "主胜",
              odds: Number(oddsByType.nspf["3"] || 0),
              trend: 0,
            },
            {
              key: "d",
              label: "平",
              odds: Number(oddsByType.nspf["1"] || 0),
              trend: 0,
            },
            {
              key: "a",
              label: "客胜",
              odds: Number(oddsByType.nspf["0"] || 0),
              trend: 0,
            },
          ],
          updateTime,
          undefined,
          hasHad && (flags.nspfdg || flags.nspfgg !== false),
          updateDate,
          flags.nspfgg !== false
        ),
        HHAD: buildPool(
          "HHAD",
          `让球(${goalLine})`,
          Boolean(flags.spfdg),
          [
            {
              key: "hh",
              label: "让胜",
              odds: Number(oddsByType.spf["3"] || 0),
              trend: 0,
            },
            {
              key: "hd",
              label: "让平",
              odds: Number(oddsByType.spf["1"] || 0),
              trend: 0,
            },
            {
              key: "ha",
              label: "让负",
              odds: Number(oddsByType.spf["0"] || 0),
              trend: 0,
            },
          ],
          updateTime,
          goalLine,
          hasHhad && (flags.spfdg || flags.spfgg !== false),
          updateDate,
          flags.spfgg !== false
        ),
        HAFU: buildPool(
          "HAFU",
          "半全场",
          flags.bqdg !== false,
          HAFU_500_MAP.map(([srcKey, key, label]) => ({
            key,
            label,
            odds: Number(oddsByType.bqc[srcKey] || 0),
            trend: 0,
          })),
          updateTime,
          undefined,
          hasHafu && (flags.bqdg !== false || flags.bqgg !== false),
          updateDate,
          flags.bqgg !== false
        ),
        TTG: buildPool(
          "TTG",
          "总进球",
          flags.jqdg !== false,
          ["0", "1", "2", "3", "4", "5", "6", "7"].map((n) => ({
            key: `s${n}`,
            label: n === "7" ? "7+球" : `${n}球`,
            odds: Number(oddsByType.jqs[n] || 0),
            trend: 0,
          })),
          updateTime,
          undefined,
          hasTtg && (flags.jqdg !== false || flags.jqgg !== false),
          updateDate,
          flags.jqgg !== false
        ),
        CRS: buildPool(
          "CRS",
          "比分",
          flags.bfdg !== false,
          OFFICIAL_CRS_PAIRS.map(([, lbl]) => ({
            key: lbl,
            label: lbl,
            odds: Number(oddsByType.bf[lbl] || 0),
            trend: 0,
          })),
          updateTime,
          undefined,
          hasCrs && (flags.bfdg !== false || flags.bfgg !== false),
          updateDate,
          flags.bfgg !== false
        ),
      },
    });
    rawMatches.push(recalibrateMergedMatch(matchObj));
  }
  return rawMatches;
}

/**
 * 解析中国足彩网竞彩对阵页（https://cp.zgzcw.com/lottery/jchtplayvsForJsp.action?lotteryId=47&type=jcmini）
 * 同样携带体彩官方同源 mid (如 2043004) 与胜平负/让球胜平负水位。
 */
export function parseZgzcwJcHtml(html, capturedAtMs = Date.now()) {
  const text = String(html ?? "");
  if (!text.includes("beginBet")) return [];
  const { updateDate, updateTime } = formatStampFromMs(capturedAtMs);
  const rowRe =
    /<tr\b([^>]*\bclass=["'][^"']*beginBet[^"']*["'][^>]*)>([\s\S]*?)<\/tr>/gi;
  const out = [];
  let m;
  while ((m = rowRe.exec(text)) !== null) {
    const attrs = m[1] || "";
    const body = m[2] || "";
    if (extractAttr(attrs, "expire") === "0") continue;
    const trId = extractAttr(attrs, "id");
    const matchId = trId.replace(/^tr_/, "").trim();
    const matchNumStr = extractAttr(attrs, "mN");
    if (
      !/^\d+$/.test(matchId) ||
      !/^周[一二三四五六日]\d{3}$/.test(matchNumStr)
    ) {
      continue;
    }
    const league = extractAttr(attrs, "m") || "竞彩";
    const goalLine = formatGoalLine(extractAttr(attrs, "rq"));
    const kickMatch = body.match(
      /比赛时间:(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/
    );
    const stopStr = extractAttr(attrs, "t");
    const matchDate = kickMatch?.[1] || stopStr.slice(0, 10) || undefined;
    const matchTime = kickMatch?.[2] || stopStr.slice(11, 16) || "00:00";

    const home =
      body
        .match(/class=["']wh-4[^"']*["'][\s\S]*?title=["']([^"']+)["']/i)?.[1]
        ?.trim() || "";
    const away =
      body
        .match(/class=["']wh-6[^"']*["'][\s\S]*?title=["']([^"']+)["']/i)?.[1]
        ?.trim() || "";
    if (!home || !away) continue;

    const spVal =
      body.match(/class=["']spArr["'][^>]*value=["']([^"']+)["']/i)?.[1] ||
      body.match(/id=["']ht_\d+["'][^>]*value=["']([^"']+)["']/i)?.[1] ||
      "";
    const [hadPart = "", hhadPart = ""] = spVal.split("|");
    const hadNums = hadPart.trim().split(/\s+/).map(Number);
    const hhadNums = hhadPart.trim().split(/\s+/).map(Number);
    const hasHad =
      hadNums.length === 3 && hadNums.every((x) => Number.isFinite(x) && x > 1);
    const hasHhad =
      hhadNums.length === 3 &&
      hhadNums.every((x) => Number.isFinite(x) && x > 1);
    if (!hasHad && !hasHhad) continue;

    const hadDg = /class=["'][^"']*frq[^"']*["'][^>]*isdg=["']1["']/i.test(
      body
    );
    const hhadDg = /class=["'][^"']*rqq[^"']*["'][^>]*isdg=["']1["']/i.test(
      body
    );

    const matchObj = stampUnconfirmedRights({
      id: matchId,
      matchNumStr,
      league,
      kickoff: matchTime,
      ...(matchDate ? { kickoffDateTime: `${matchDate} ${matchTime}` } : {}),
      businessDate: matchDate,
      matchDate,
      home,
      away,
      isHot: Boolean(hadDg && hhadDg),
      aiAlert: undefined,
      pools: {
        HAD: buildPool(
          "HAD",
          "胜平负",
          hadDg,
          [
            {
              key: "h",
              label: "主胜",
              odds: hasHad ? hadNums[0] : 0,
              trend: 0,
            },
            { key: "d", label: "平", odds: hasHad ? hadNums[1] : 0, trend: 0 },
            {
              key: "a",
              label: "客胜",
              odds: hasHad ? hadNums[2] : 0,
              trend: 0,
            },
          ],
          updateTime,
          undefined,
          hasHad,
          updateDate,
          hasHad
        ),
        HHAD: buildPool(
          "HHAD",
          `让球(${goalLine})`,
          hhadDg,
          [
            {
              key: "hh",
              label: "让胜",
              odds: hasHhad ? hhadNums[0] : 0,
              trend: 0,
            },
            {
              key: "hd",
              label: "让平",
              odds: hasHhad ? hhadNums[1] : 0,
              trend: 0,
            },
            {
              key: "ha",
              label: "让负",
              odds: hasHhad ? hhadNums[2] : 0,
              trend: 0,
            },
          ],
          updateTime,
          goalLine,
          hasHhad,
          updateDate,
          hasHhad
        ),
        HAFU: buildPool(
          "HAFU",
          "半全场",
          false,
          HAFU_500_MAP.map(([, k, l]) => ({
            key: k,
            label: l,
            odds: 0,
            trend: 0,
          })),
          updateTime,
          undefined,
          false,
          updateDate,
          false
        ),
        TTG: buildPool(
          "TTG",
          "总进球",
          false,
          ["0", "1", "2", "3", "4", "5", "6", "7"].map((n) => ({
            key: `s${n}`,
            label: n === "7" ? "7+球" : `${n}球`,
            odds: 0,
            trend: 0,
          })),
          updateTime,
          undefined,
          false,
          updateDate,
          false
        ),
        CRS: buildPool(
          "CRS",
          "比分",
          false,
          OFFICIAL_CRS_PAIRS.map(([, l]) => ({
            key: l,
            label: l,
            odds: 0,
            trend: 0,
          })),
          updateTime,
          undefined,
          false,
          updateDate,
          false
        ),
      },
    });
    matchObj.__partialSubPools = true;
    out.push(recalibrateMergedMatch(matchObj));
  }
  return out;
}

/**
 * 解析澳客网竞彩混合过关页（https://www.okooo.com/jingcai/hunhe/）
 * 若传入 referenceMatches 则自动将 (matchDate/matchNumStr) 对齐至既有官方 matchId。
 */
export function parseOkoooHunheHtml(
  html,
  capturedAtMs = Date.now(),
  referenceMatches = []
) {
  const text = String(html ?? "");
  if (!text.includes("touzhu_1")) return [];
  const { updateDate, updateTime } = formatStampFromMs(capturedAtMs);

  const refByNumAndDate = new Map();
  const refByNum = new Map();
  for (const rm of referenceMatches || []) {
    if (!rm?.matchNumStr || !rm?.id) continue;
    refByNum.set(String(rm.matchNumStr), rm);
    if (rm.matchDate) {
      refByNumAndDate.set(`${rm.matchDate}|${rm.matchNumStr}`, rm);
    }
  }

  const blocks = text.split(/<div\s+class=["']touzhu_1["']/i).slice(1);
  const out = [];
  for (const rawBlock of blocks) {
    const tagEnd = rawBlock.indexOf(">");
    if (tagEnd < 0) continue;
    const attrs = rawBlock.slice(0, tagEnd);
    const body = rawBlock.slice(tagEnd + 1);
    if (extractAttr(attrs, "data-end") !== "0") continue;

    const matchNumStr = extractAttr(attrs, "data-ordercn");
    const okoId = extractAttr(attrs, "data-mid");
    if (!/^周[一二三四五六日]\d{3}$/.test(matchNumStr) || !okoId) continue;

    const goalLine = formatGoalLine(extractAttr(attrs, "data-rq"));
    const league =
      body
        .match(/class=["']saiming[^"']*["'][^>]*title=["']([^"']+)["']/i)?.[1]
        ?.trim() || "竞彩";
    const timeMatch = body.match(
      /比赛时间:(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/
    );
    const matchDate = timeMatch?.[1] || undefined;
    const matchTime = timeMatch?.[2] || extractAttr(body, "mTime") || "00:00";

    const home =
      body
        .match(/class=["']zhum[^"']*["'][^>]*title=["']([^"']+)["']/i)?.[1]
        ?.trim() || extractAttr(attrs, "data-hname");
    const awayMatches = [
      ...body.matchAll(/class=["']zhum[^"']*["'][^>]*title=["']([^"']+)["']/gi),
    ];
    const away =
      awayMatches[1]?.[1]?.trim() || extractAttr(attrs, "data-aname");
    if (!home || !away) continue;

    const hadOdds = [0, 0, 0];
    const hhadOdds = [0, 0, 0];
    let hadDg = false;
    let hhadDg = false;
    const optRe =
      /data-sp=["']([^"']+)["']\s+data-wf=["'](0|1)["']\s+data-wz=["'](0|1|2)["'][^>]*data-dg=["'](0|1)["']/gi;
    let om;
    while ((om = optRe.exec(body)) !== null) {
      const sp = Number(om[1]);
      const wf = om[2];
      const wz = Number(om[3]);
      const dg = om[4] === "1";
      if (!Number.isFinite(sp) || sp <= 1) continue;
      if (wf === "0") {
        hadOdds[wz] = sp;
        if (dg) hadDg = true;
      } else {
        hhadOdds[wz] = sp;
        if (dg) hhadDg = true;
      }
    }
    const hasHad = hadOdds.every((x) => x > 1);
    const hasHhad = hhadOdds.every((x) => x > 1);
    if (!hasHad && !hasHhad) continue;

    const refMatch =
      (matchDate && refByNumAndDate.get(`${matchDate}|${matchNumStr}`)) ||
      refByNum.get(matchNumStr) ||
      null;
    const resolvedId = refMatch ? String(refMatch.id) : `okooo_${okoId}`;
    const resolvedHome = refMatch?.home || home;
    const resolvedAway = refMatch?.away || away;

    const matchObj = stampUnconfirmedRights({
      id: resolvedId,
      matchNumStr,
      league,
      kickoff: matchTime.slice(0, 5),
      ...(matchDate
        ? { kickoffDateTime: `${matchDate} ${matchTime.slice(0, 5)}` }
        : {}),
      businessDate: refMatch?.businessDate || matchDate,
      matchDate: matchDate || refMatch?.matchDate,
      home: resolvedHome,
      away: resolvedAway,
      isHot: Boolean(hadDg && hhadDg),
      aiAlert: undefined,
      pools: {
        HAD: buildPool(
          "HAD",
          "胜平负",
          hadDg,
          [
            {
              key: "h",
              label: "主胜",
              odds: hasHad ? hadOdds[0] : 0,
              trend: 0,
            },
            { key: "d", label: "平", odds: hasHad ? hadOdds[1] : 0, trend: 0 },
            {
              key: "a",
              label: "客胜",
              odds: hasHad ? hadOdds[2] : 0,
              trend: 0,
            },
          ],
          updateTime,
          undefined,
          hasHad,
          updateDate,
          hasHad
        ),
        HHAD: buildPool(
          "HHAD",
          `让球(${goalLine})`,
          hhadDg,
          [
            {
              key: "hh",
              label: "让胜",
              odds: hasHhad ? hhadOdds[0] : 0,
              trend: 0,
            },
            {
              key: "hd",
              label: "让平",
              odds: hasHhad ? hhadOdds[1] : 0,
              trend: 0,
            },
            {
              key: "ha",
              label: "让负",
              odds: hasHhad ? hhadOdds[2] : 0,
              trend: 0,
            },
          ],
          updateTime,
          goalLine,
          hasHhad,
          updateDate,
          hasHhad
        ),
        HAFU: buildPool(
          "HAFU",
          "半全场",
          false,
          HAFU_500_MAP.map(([, k, l]) => ({
            key: k,
            label: l,
            odds: 0,
            trend: 0,
          })),
          updateTime,
          undefined,
          false,
          updateDate,
          false
        ),
        TTG: buildPool(
          "TTG",
          "总进球",
          false,
          ["0", "1", "2", "3", "4", "5", "6", "7"].map((n) => ({
            key: `s${n}`,
            label: n === "7" ? "7+球" : `${n}球`,
            odds: 0,
            trend: 0,
          })),
          updateTime,
          undefined,
          false,
          updateDate,
          false
        ),
        CRS: buildPool(
          "CRS",
          "比分",
          false,
          OFFICIAL_CRS_PAIRS.map(([, l]) => ({
            key: l,
            label: l,
            odds: 0,
            trend: 0,
          })),
          updateTime,
          undefined,
          false,
          updateDate,
          false
        ),
      },
    });
    matchObj.__partialSubPools = true;
    out.push(recalibrateMergedMatch(matchObj));
  }
  return out;
}

/**
 * 解析澳客开奖页（https://www.okooo.com/jingcai/kaijiang/）90 分钟半全场赛果
 */
export function parseOkoooKaijiangHtml(html, referenceIdLookup = new Map()) {
  const text = String(html ?? "");
  const rowRe =
    /<tr[^>]*class=["'][^"']*trClass[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi;
  const map = new Map();
  let m;
  while ((m = rowRe.exec(text)) !== null) {
    const tds = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) =>
      stripTags(x[1])
    );
    if (tds.length < 7) continue;
    const matchNumStr = tds[0];
    if (!/^周[一二三四五六日]\d{3}$/.test(matchNumStr)) continue;
    const dateTimePart = tds[2]; // MM-DD HH:mm
    const home = tds[3];
    const away = tds[4];
    const halfRaw = tds[5].replace("-", ":");
    const fullRaw = tds[6].replace("-", ":");
    const mmdd = dateTimePart.slice(0, 5);
    const matchedId =
      referenceIdLookup.get(`${mmdd}|${matchNumStr}`) ||
      referenceIdLookup.get(`${matchNumStr}|${home}|${away}`) ||
      referenceIdLookup.get(matchNumStr);
    if (!matchedId) continue;

    if (/取消|无效|腰斩|推迟/.test(`${halfRaw}|${fullRaw}`)) {
      map.set(String(matchedId), {
        matchId: String(matchedId),
        matchNumStr,
        home,
        away,
        matchDate: "",
        settled: true,
        isVoid: true,
        halfScore: "无效场次",
        fullScore: "无效场次",
        h1: null,
        a1: null,
        h2: null,
        a2: null,
      });
      continue;
    }

    const hm = halfRaw.match(/^(\d{1,2}):(\d{1,2})$/);
    const fm = fullRaw.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!hm || !fm) continue;
    map.set(String(matchedId), {
      matchId: String(matchedId),
      matchNumStr,
      home,
      away,
      matchDate: "",
      settled: true,
      isVoid: false,
      halfScore: `${Number(hm[1])}:${Number(hm[2])}`,
      fullScore: `${Number(fm[1])}:${Number(fm[2])}`,
      h1: Number(hm[1]),
      a1: Number(hm[2]),
      h2: Number(fm[1]),
      a2: Number(fm[2]),
    });
  }
  return map;
}

/**
 * 解析 500 历史日期对阵页（https://trade.500.com/jczq/?date=YYYY-MM-DD）建立 (MM-DD|周X00Y) -> 官方 matchId 索引并提取完场比分
 */
export function parse500HistoricalIdsHtml(html) {
  const text = String(html ?? "");
  const lookup = new Map();
  const fullScores = new Map();
  const trRe = /<tr\s+class=["']bet-tb-tr[^"']*["']([^>]*)>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(text)) !== null) {
    const attrs = m[1] || "";
    const body = m[2] || "";
    const id = extractAttr(attrs, "data-id");
    const num = extractAttr(attrs, "data-matchnum");
    const pdate =
      extractAttr(attrs, "data-matchdate") ||
      extractAttr(attrs, "data-processdate");
    const home = extractAttr(attrs, "data-homesxname");
    const away = extractAttr(attrs, "data-awaysxname");
    if (!id || !num) continue;
    lookup.set(num, id);
    if (pdate && pdate.length >= 10) {
      lookup.set(`${pdate.slice(5, 10)}|${num}`, id);
      lookup.set(`${pdate.slice(0, 10)}|${num}`, id);
    }
    if (home && away) {
      lookup.set(`${num}|${home}|${away}`, id);
    }
    const scoreStr = body.match(
      /class=["']score["'][^>]*>(\d{1,2}:\d{1,2})<\/a>/i
    )?.[1];
    if (scoreStr) {
      fullScores.set(id, {
        matchId: id,
        matchNumStr: num,
        matchDate: pdate,
        home,
        away,
        fullScore: scoreStr,
      });
    }
  }
  return { lookup, fullScores };
}

/**
 * 解析球探完场竞彩接口（https://jc.titan007.com/handle/JcResult.aspx?d=YYYY-MM-DD）半全场比分
 */
export function parseTitanJcResultText(rawText, referenceIdLookup = new Map()) {
  const text = String(rawText ?? "");
  const dollarIdx = text.indexOf("$");
  if (dollarIdx < 0) return new Map();
  const rows = text.slice(dollarIdx + 1).split("!");
  const map = new Map();
  for (const row of rows) {
    const cols = row.split("^");
    if (cols.length < 15) continue;
    const status = cols[3]?.trim();
    const matchNumStr = cols[4]?.trim();
    if (!/^周[一二三四五六日]\d{3}$/.test(matchNumStr)) continue;
    // JS 0-indexed month in titan007: "2026,10,24,15,45,00" -> 2026-11-24
    const dtParts = (cols[1] || "").split(",").map(Number);
    let matchDate = "";
    let mmdd = "";
    if (dtParts.length >= 3 && Number.isFinite(dtParts[0])) {
      const y = dtParts[0];
      const mon = String(dtParts[1] + 1).padStart(2, "0");
      const d = String(dtParts[2]).padStart(2, "0");
      matchDate = `${y}-${mon}-${d}`;
      mmdd = `${mon}-${d}`;
    }
    const home = (cols[8] || "").split(",")[0]?.trim() || "";
    const away = (cols[10] || "").split(",")[0]?.trim() || "";
    const matchedId =
      (matchDate && referenceIdLookup.get(`${matchDate}|${matchNumStr}`)) ||
      (mmdd && referenceIdLookup.get(`${mmdd}|${matchNumStr}`)) ||
      referenceIdLookup.get(`${matchNumStr}|${home}|${away}`) ||
      referenceIdLookup.get(matchNumStr);
    if (!matchedId) continue;

    if (
      status === "-11" ||
      status === "-12" ||
      status === "-13" ||
      status === "-14"
    ) {
      map.set(String(matchedId), {
        matchId: String(matchedId),
        matchNumStr,
        home,
        away,
        matchDate,
        settled: true,
        isVoid: true,
        halfScore: "无效场次",
        fullScore: "无效场次",
        h1: null,
        a1: null,
        h2: null,
        a2: null,
      });
      continue;
    }
    if (status !== "-1") continue;
    const h2 = Number(cols[11]);
    const a2 = Number(cols[12]);
    const h1 = Number(cols[13]);
    const a1 = Number(cols[14]);
    if (![h1, a1, h2, a2].every((x) => Number.isInteger(x) && x >= 0)) continue;
    map.set(String(matchedId), {
      matchId: String(matchedId),
      matchNumStr,
      home,
      away,
      matchDate,
      settled: true,
      isVoid: false,
      halfScore: `${h1}:${a1}`,
      fullScore: `${h2}:${a2}`,
      h1,
      a1,
      h2,
      a2,
    });
  }
  return map;
}

/**
 * 当备份源仅提供主盘（HAD/HHAD）缺省冷门子池（CRS/TTG/HAFU）时，安全继承同场先前已知有效子池（不伪造 confirmedSaleRights）
 */
export function mergePartialBackupSubPools(prevMatches, incomingMatches) {
  if (!Array.isArray(prevMatches) || prevMatches.length === 0) {
    return incomingMatches;
  }
  const prevById = new Map();
  const prevByNum = new Map();
  for (const pm of prevMatches) {
    if (pm?.id) prevById.set(String(pm.id), pm);
    if (pm?.matchNumStr) prevByNum.set(String(pm.matchNumStr), pm);
  }
  return incomingMatches.map((inc) => {
    if (!inc || !inc.__partialSubPools) return inc;
    const prev =
      prevById.get(String(inc.id)) ||
      prevByNum.get(String(inc.matchNumStr)) ||
      null;
    const cleaned = { ...inc };
    delete cleaned.__partialSubPools;
    if (!prev) return cleaned;
    if (
      String(prev.id) !== String(inc.id) &&
      orderedMatchKey(prev) !== orderedMatchKey(inc) &&
      String(prev.matchNumStr) !== String(inc.matchNumStr)
    ) {
      return cleaned;
    }
    let patched = false;
    const nextPools = { ...cleaned.pools };
    for (const subCode of ["HAFU", "TTG", "CRS"]) {
      const incP = nextPools[subCode];
      const prevP = prev.pools?.[subCode];
      const incHasOdds = incP?.options?.some((o) => Number(o.odds) > 1);
      const prevHasOdds = prevP?.options?.some((o) => Number(o.odds) > 1);
      if (!incHasOdds && prevHasOdds) {
        nextPools[subCode] = {
          ...prevP,
          confirmedSaleRights: { single: false, allUp: false },
        };
        patched = true;
      }
    }
    if (!patched) return cleaned;
    return recalibrateMergedMatch({
      ...cleaned,
      id: /^\d+$/.test(String(prev.id)) ? String(prev.id) : cleaned.id,
      home: prev.home || cleaned.home,
      away: prev.away || cleaned.away,
      pools: nextPools,
    });
  });
}

export { parseSportteryRawJson, parseSportteryResultsJson };
