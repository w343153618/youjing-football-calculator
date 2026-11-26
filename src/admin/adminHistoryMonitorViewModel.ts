import type {
  HistoryEndpointKey,
  HistoryMonitorOverview,
  MonitorSlotKey,
  PublicAccountUser,
} from "../security/secureClient.ts";

export type AdminConsoleTabId = "users" | "audit" | "history";

export const ADMIN_HISTORY_MONITOR_TAB_LABEL = "📊 历史库与校准监测";

export function canAccessAdminConsole(
  user: Pick<PublicAccountUser, "role"> | null | undefined
): boolean {
  return Boolean(
    user && (user.role === "superadmin" || user.role === "subadmin")
  );
}

export function buildAdminConsoleTabSpecs(
  accountsCount: number,
  auditLogsCount: number,
  role: PublicAccountUser["role"] = "superadmin"
): Array<[AdminConsoleTabId, string]> {
  if (role === "subadmin") {
    return [["users", `👥 账号与权限总控 (${accountsCount})`]];
  }
  return [
    ["users", `👥 账号与权限总控 (${accountsCount})`],
    ["audit", `🛡️ 风控与违规提问日志 (${auditLogsCount})`],
    ["history", ADMIN_HISTORY_MONITOR_TAB_LABEL],
  ];
}

export function formatMonitorByteSize(rawBytes: number): string {
  const bytes = Number.isFinite(rawBytes) && rawBytes > 0 ? rawBytes : 0;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatBeijingTimestampFull(epochMs: number | null): string {
  if (
    typeof epochMs !== "number" ||
    !Number.isFinite(epochMs) ||
    epochMs <= 0
  ) {
    return "暂无记录";
  }
  const iso = new Date(epochMs + 8 * 3600_000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

function formatRatePct(rate: number | null): string {
  if (typeof rate !== "number" || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

function formatSignedGapPp(gap: number | null): string {
  if (typeof gap !== "number" || !Number.isFinite(gap)) return "—";
  const pp = gap * 100;
  return `${pp >= 0 ? "+" : ""}${pp.toFixed(1)}pp`;
}

export interface AdminHistoryEndpointRowVm {
  key: HistoryEndpointKey;
  label: string;
  tone: "good" | "warn" | "neutral";
  statusBadge: string;
  lastSuccessText: string;
  detailText: string;
}

export interface AdminHistoryWindowRowVm {
  key: string;
  rangeText: string;
  statusBadge: string;
  tone: "good" | "warn";
  detailText: string;
}

export interface AdminHistorySlotAdmissionRowVm {
  key: MonitorSlotKey;
  label: string;
  liveSummaryText: string;
  settledSummaryText: string;
  settledCalibrationText: string;
}

export interface AdminHistoryBucketRowVm {
  key: "wipeout" | "underwater" | "breakEven" | "strictNetGain";
  label: string;
  empiricalCount: number;
  predictedRateText: string;
  empiricalRateText: string;
  gapText: string;
}

export interface AdminHistoryMonitorViewModel {
  isAvailable: boolean;
  tabLabel: string;
  collectorBanner: {
    statusBadge: string;
    tone: "good" | "warn";
    backendLabel: string;
    boardStateLabel: string;
    modelVersionLabel: string;
    summaryText: string;
  };
  endpointRows: AdminHistoryEndpointRowVm[];
  cursorSummary: {
    headline: string;
    completedText: string;
    partialText: string;
    verifiedMatchesText: string;
    queueText: string;
    windowRows: AdminHistoryWindowRowVm[];
  };
  coverageSummary: {
    quoteRangeText: string;
    resultRangeText: string;
    coldShardText: string;
    boundaryNote: string;
  };
  storageSummary: {
    totalText: string;
    breakdownItems: Array<{
      key: "hotDbBytes" | "walBytes" | "coldArchiveBytes" | "backupBytes";
      label: string;
      formattedBytes: string;
      rawBytes: number;
    }>;
  };
  exposureComparison: {
    naturalMissingHeadline: string;
    naturalMissingDetail: string;
    workbenchHeadline: string;
    workbenchDeduplicationDetail: string;
    embargoStatusDetail: string;
  };
  slotAdmissionRows: AdminHistorySlotAdmissionRowVm[];
  calibrationCard: {
    sampleBadge: string;
    scoreHeadline: string;
    brierText: string;
    logLossText: string;
    embargoNote: string;
    bucketRows: AdminHistoryBucketRowVm[];
  };
}

const ENDPOINT_ORDER: HistoryEndpointKey[] = [
  "liveCalculator",
  "uniformMatchResult",
  "fixedBonus",
  "matchHead",
];

const SLOT_ORDER: MonitorSlotKey[] = [
  "max-profit-prob",
  "max-ev-utility",
  "max-cvar-wheel",
  "alpha-radar",
];

export function buildAdminHistoryMonitorViewModel(
  monitor: HistoryMonitorOverview | null | undefined
): AdminHistoryMonitorViewModel {
  if (!monitor) {
    return {
      isAvailable: false,
      tabLabel: ADMIN_HISTORY_MONITOR_TAB_LABEL,
      collectorBanner: {
        statusBadge: "待加载",
        tone: "warn",
        backendLabel: "未知后端",
        boardStateLabel: "暂无盘面状态",
        modelVersionLabel: "出厂冻结内核",
        summaryText: "正在读取单写者历史底座与只读校准监测快照...",
      },
      endpointRows: [],
      cursorSummary: {
        headline: "暂无赛果分窗游标",
        completedText: "0 窗",
        partialText: "0 窗",
        verifiedMatchesText: "0 场",
        queueText: "待补首报 0 场 · 待补近期详情 0 场",
        windowRows: [],
      },
      coverageSummary: {
        quoteRangeText: "暂无行情帧记录",
        resultRangeText: "暂无完场赛果记录",
        coldShardText: "0 个冷档分片",
        boundaryNote: "",
      },
      storageSummary: {
        totalText: "0 B",
        breakdownItems: [],
      },
      exposureComparison: {
        naturalMissingHeadline: "0 段自然缺池区间",
        naturalMissingDetail: "尚未收到有效实盘采样",
        workbenchHeadline: "0 场去重工作台暴露",
        workbenchDeduplicationDetail: "原始评估 0 帧",
        embargoStatusDetail: "待开赛 0 场 · 禁运期 0 场 · 已解禁完场 0 场",
      },
      slotAdmissionRows: [],
      calibrationCard: {
        sampleBadge: "0 个同域完场样本",
        scoreHeadline: "待积累已过结算禁运窗口的同域完场样本",
        brierText: "待积累完场样本",
        logLossText: "待积累完场样本",
        embargoNote: "缺结算公告时刻的冷启动场次统一按 比赛日 + 3 天 禁运。",
        bucketRows: [],
      },
    };
  }

  const backendRaw = monitor.collector.storageBackend;
  const backendLabel =
    backendRaw === "sqlite"
      ? "SQLite WAL 单写者"
      : backendRaw === "jsonl"
        ? "JSONL 追加式降级日志"
        : "进程内存快照（未启常驻采集）";

  const bm = monitor.collector.boardMeta;
  const boardStateLabel =
    bm.boardState === "fresh"
      ? `实盘有效板 (${bm.lastValidBoardClock || "刚刚"})`
      : `只读回退态 (${bm.boardState} · 上次有效 ${bm.lastValidBoardClock || "内置基准"})`;

  const collectorBanner = {
    statusBadge: monitor.collector.isWorkerRunning
      ? "后台单写者运行中"
      : "仅内存只读态",
    tone: (monitor.collector.isWorkerRunning ? "good" : "warn") as
      "good" | "warn",
    backendLabel,
    boardStateLabel,
    modelVersionLabel: monitor.modelVersion,
    summaryText: `快照序号 #${monitor.collector.snapshotSeq} · 校验拦截 ${monitor.collector.rejectedSwapCount} 次 · 生产精算公式 100% 出厂冻结（零自动改参/晋级/熔断）`,
  };

  const endpointRows: AdminHistoryEndpointRowVm[] = ENDPOINT_ORDER.map((k) => {
    const ep = monitor.endpoints[k];
    const hasBackoff = ep.consecutiveFailures > 0 || Boolean(ep.lastError);
    const hasSuccess =
      typeof ep.lastSuccessAt === "number" && ep.lastSuccessAt > 0;
    const tone: "good" | "warn" | "neutral" = hasBackoff
      ? "warn"
      : hasSuccess
        ? "good"
        : "neutral";
    const statusBadge = hasBackoff
      ? `退避重试中 (${Math.round(ep.backoffMs / 1000)}s)`
      : hasSuccess
        ? "同步正常"
        : "待首采";
    const lastSuccessText = formatBeijingTimestampFull(ep.lastSuccessAt);
    const detailText = hasBackoff
      ? `连续失败 ${ep.consecutiveFailures} 次 · 最近错误 ${ep.lastError || "未知"} (${formatBeijingTimestampFull(ep.lastErrorAt)})`
      : hasSuccess
        ? `最近成功同步于 ${lastSuccessText}`
        : "尚未触发该接口请求";
    return {
      key: k,
      label: ep.label,
      tone,
      statusBadge,
      lastSuccessText,
      detailText,
    };
  });

  const cur = monitor.cursors;
  const windowRows: AdminHistoryWindowRowVm[] = Object.values(cur.windows)
    .sort((a, b) => b.beginDate.localeCompare(a.beginDate))
    .slice(0, 12)
    .map((w) => {
      const isOk = w.status === "completed";
      return {
        key: w.key,
        rangeText: `${w.beginDate} ~ ${w.endDate}`,
        statusBadge: isOk ? "已核齐完成" : `待续跑 (第 ${w.nextRetryPage} 页)`,
        tone: isOk ? "good" : "warn",
        detailText: isOk
          ? `已核验 ${w.verifiedPagesCount}/${w.expectedPages ?? 0} 页 · 唯一赛事 ${w.uniqueMatchCount}/${w.expectedTotal ?? 0} 场`
          : `已存 ${w.verifiedPagesCount}/${w.expectedPages ?? "?"} 页 · 唯一赛事 ${w.uniqueMatchCount}/${w.expectedTotal ?? "?"} 场 · 下次从第 ${w.nextRetryPage} 页续跑${w.lastError ? ` (${w.lastError})` : ""}`,
      };
    });

  const cursorSummary = {
    headline: `赛果分窗核齐 ${cur.completedWindows}/${cur.totalWindows} 窗（待续跑 ${cur.partialWindows} 窗）`,
    completedText: `${cur.completedWindows} 窗已完成`,
    partialText: `${cur.partialWindows} 窗待续跑`,
    verifiedMatchesText: `已核齐唯一完场 ${cur.verifiedUniqueMatches} 场`,
    queueText: `异步待补官方归档首报 ${cur.pendingOpenQuoteCount} 场 · 待补近期详情 ${cur.pendingRecentDetailCount} 场`,
    windowRows,
  };

  const cov = monitor.coverage;
  const coverageSummary = {
    quoteRangeText:
      cov.earliestQuoteAt && cov.latestQuoteAt
        ? `${formatBeijingTimestampFull(cov.earliestQuoteAt)} ~ ${formatBeijingTimestampFull(cov.latestQuoteAt)}（共 ${cov.quoteSegmentCount} 段玩法轨迹）`
        : "暂无热库行情轨迹",
    resultRangeText:
      cov.earliestResultDate && cov.latestResultDate
        ? `${cov.earliestResultDate} ~ ${cov.latestResultDate}（热库精简赛果 ${cov.settledResultRecordCount} 场）`
        : "暂无热库赛果记录",
    coldShardText:
      cov.coldArchiveShards.length > 0
        ? `已校验冷档 ${cov.coldArchiveShards.length} 个分片 (${cov.coldArchiveShards.join(", ")})`
        : "暂无满期归档冷分片",
    boundaryNote: cov.coverageBoundaryNote,
  };

  const sb = monitor.storageBytes;
  const storageSummary = {
    totalText: formatMonitorByteSize(sb.totalBytes),
    breakdownItems: [
      {
        key: "hotDbBytes" as const,
        label: "18m 行情与 24m 赛果热库",
        formattedBytes: formatMonitorByteSize(sb.hotDbBytes),
        rawBytes: sb.hotDbBytes,
      },
      {
        key: "walBytes" as const,
        label: "预写日志 WAL",
        formattedBytes: formatMonitorByteSize(sb.walBytes),
        rawBytes: sb.walBytes,
      },
      {
        key: "coldArchiveBytes" as const,
        label: `36m+ 压缩冷档 (${sb.coldShardCount} 片)`,
        formattedBytes: formatMonitorByteSize(sb.coldArchiveBytes),
        rawBytes: sb.coldArchiveBytes,
      },
      {
        key: "backupBytes" as const,
        label: "本地备份快照",
        formattedBytes: formatMonitorByteSize(sb.backupBytes),
        rawBytes: sb.backupBytes,
      },
    ],
  };

  const nmp = monitor.naturalMissingPools;
  const wbe = monitor.workbenchExposures;
  const exposureComparison = {
    naturalMissingHeadline: `自然缺池观测 ${nmp.totalIntervals} 段（涉及 ${nmp.distinctMatchCount} 场，当前未恢复 ${nmp.activeOpenIntervals} 段）`,
    naturalMissingDetail: `仅统计开售有效板：胜平负缺池 ${nmp.hadMissingIntervalCount} 段 · 让球 ${nmp.byPool.HHAD} · 总进球 ${nmp.byPool.TTG} · 半全场 ${nmp.byPool.HAFU} · 比分 ${nmp.byPool.CRS}`,
    workbenchHeadline: `真实工作台去重暴露 ${wbe.deduplicatedMatchCount} 场（其中缺池暴露 ${wbe.deduplicatedMissingPoolMatchCount} 场）`,
    workbenchDeduplicationDetail: `原始有效请求 ${wbe.rawEvaluationFrames} 帧（${wbe.rawMatchExposureFrames} 场次帧）→ 按场去重同域样本 ${wbe.deduplicatedEvaluationCount} 组 · 已过滤空板/回退请求 ${wbe.skippedFallbackEvaluations} 次`,
    embargoStatusDetail: `比赛完场与禁运进度：待完场 ${wbe.pendingMatchCount} 场 · 结算禁运期中 ${wbe.embargoedSettledMatchCount} 场 · 已过禁运可评分 ${wbe.settledUnembargoedMatchCount} 场${wbe.voidMatchCount > 0 ? ` · 无效场次 ${wbe.voidMatchCount} 场` : ""}`,
  };

  const slotAdmissionRows: AdminHistorySlotAdmissionRowVm[] = SLOT_ORDER.map(
    (k) => {
      const live = monitor.slotAdmissions.liveBySlot[k];
      const settled = monitor.slotAdmissions.settledBySlot[k];
      return {
        key: k,
        label: settled.label,
        liveSummaryText: `实时去重：准入 ${live.admittedCount} / 拒单 ${live.rejectedCount} (${formatRatePct(live.admissionRate)})`,
        settledSummaryText: `完场解禁：准入 ${settled.admittedCount} / 拒单 ${settled.rejectedCount} (${formatRatePct(settled.admissionRate)})`,
        settledCalibrationText:
          settled.calibratedSampleCount > 0 && settled.brierScore !== null
            ? `同域已结 ${settled.calibratedSampleCount} 组 · Brier ${settled.brierScore.toFixed(4)} · LogLoss ${(settled.logLoss ?? 0).toFixed(4)}`
            : "暂无已解禁准入样本",
      };
    }
  );

  const cal = monitor.fourBucketCalibration;
  const bucketRows: AdminHistoryBucketRowVm[] = (
    ["wipeout", "underwater", "breakEven", "strictNetGain"] as const
  ).map((bk) => {
    const item = cal.buckets[bk];
    return {
      key: bk,
      label: item.label,
      empiricalCount: item.empiricalCount,
      predictedRateText: formatRatePct(item.meanPredictedProb),
      empiricalRateText: formatRatePct(item.empiricalRate),
      gapText: formatSignedGapPp(item.calibrationGap),
    };
  });

  const calibrationCard = {
    sampleBadge: `已解禁同域样本 ${cal.sampleCount} 组`,
    scoreHeadline:
      cal.sampleCount > 0 && cal.brierScore !== null && cal.logLoss !== null
        ? `无条件四互斥回报桶校准 · 多分类 Brier ${cal.brierScore.toFixed(4)} · Log-Loss ${cal.logLoss.toFixed(4)}`
        : `待积累已解禁完场样本（当前待完场 ${cal.pendingEvaluationCount} 组 · 禁运期拦截 ${cal.embargoHeldEvaluationCount} 组）`,
    brierText:
      cal.brierScore !== null ? cal.brierScore.toFixed(4) : "待积累完场样本",
    logLossText:
      cal.logLoss !== null ? cal.logLoss.toFixed(4) : "待积累完场样本",
    embargoNote:
      "同一比赛多帧评估严格保留最早赛前暴露计 1 个同域样本；缺失结算公告时刻的场次严格执行 比赛日 + 3 天 统计禁运。",
    bucketRows,
  };

  return {
    isAvailable: true,
    tabLabel: ADMIN_HISTORY_MONITOR_TAB_LABEL,
    collectorBanner,
    endpointRows,
    cursorSummary,
    coverageSummary,
    storageSummary,
    exposureComparison,
    slotAdmissionRows,
    calibrationCard,
  };
}
