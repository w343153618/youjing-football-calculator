import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {
  HISTORY_SNAPSHOT_SCHEMA_VERSION,
  buildBoardFreshnessMeta,
  buildEmptySnapshotPayload,
  computeSnapshotChecksum,
  formatBeijingDate,
  parseBeijingDateTimeMs,
  subtractCalendarMonthsMs,
} from "./sportteryHistoryNormalizers.mjs";

function ensurePrivateDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // ignore platform restrictions
  }
}

function ensurePrivateFileMode(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.chmodSync(filePath, 0o600);
    }
  } catch {
    // ignore platform restrictions
  }
}

export async function createHistoryStorage(opts = {}) {
  const dataDir = path.resolve(
    opts.dataDir || path.resolve(process.cwd(), "data")
  );
  const historyDir = path.resolve(
    opts.historyDir || path.join(dataDir, "history")
  );
  const archiveDir = path.join(historyDir, "archive");
  const backupsDir = path.join(historyDir, "backups");
  ensurePrivateDir(dataDir);
  ensurePrivateDir(historyDir);
  ensurePrivateDir(archiveDir);
  ensurePrivateDir(backupsDir);

  const requestedBackend = opts.storageBackend || "auto";
  const sqliteLoader =
    typeof opts.sqliteLoader === "function"
      ? opts.sqliteLoader
      : () => import("node:sqlite");

  let backend = "jsonl";
  let db = null;
  const sqliteFile = path.join(historyDir, "sporttery-history.sqlite");
  const jsonlFile = path.join(historyDir, "sporttery-history-events.jsonl");

  if (requestedBackend !== "jsonl") {
    try {
      const sqliteMod = await sqliteLoader();
      if (sqliteMod && typeof sqliteMod.DatabaseSync === "function") {
        db = new sqliteMod.DatabaseSync(sqliteFile);
        db.exec(`
          PRAGMA journal_mode = WAL;
          PRAGMA synchronous = NORMAL;
          PRAGMA busy_timeout = 5000;
          CREATE TABLE IF NOT EXISTS kv_records (
            bucket TEXT NOT NULL,
            record_key TEXT NOT NULL,
            json_val TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (bucket, record_key)
          );
        `);
        ensurePrivateFileMode(sqliteFile);
        ensurePrivateFileMode(`${sqliteFile}-wal`);
        ensurePrivateFileMode(`${sqliteFile}-shm`);
        backend = "sqlite";
      }
    } catch {
      if (requestedBackend === "sqlite") {
        throw new Error("SQLite backend requested but unavailable");
      }
      db = null;
      backend = "jsonl";
    }
  }

  // In-memory authoritative state mirrored from single-writer WAL / JSONL log
  const state = {
    seq: 0,
    boardMeta: buildBoardFreshnessMeta({
      source: "official-live",
      boardState: "fresh",
      lastValidBoardAt: null,
    }),
    matchesMeta: new Map(),
    quoteSegments: new Map(),
    resultRecords: new Map(),
    naturalMissingPoolIntervals: [],
    samplingIntervals: [],
    lastFreshBoardPools: null,
    cursors: {
      windows: {},
      pendingOpenQuoteIds: [],
      pendingRecentDetailIds: [],
    },
    endpoints: {},
    workbenchExposureState: {
      rawEvaluationFrames: 0,
      rawMatchExposureFrames: 0,
      skippedFallbackEvaluations: 0,
      canonicalMatches: {},
      canonicalEvaluations: [],
    },
  };

  function hydrateBucketRecord(bucket, key, val) {
    if (bucket === "matches_meta") state.matchesMeta.set(key, val);
    else if (bucket === "quote_segments") state.quoteSegments.set(key, val);
    else if (bucket === "result_records") state.resultRecords.set(key, val);
    else if (bucket === "meta" && key === "boardMeta") state.boardMeta = val;
    else if (bucket === "meta" && key === "cursors") state.cursors = val;
    else if (bucket === "meta" && key === "endpoints") state.endpoints = val;
    else if (bucket === "meta" && key === "samplingIntervals")
      state.samplingIntervals = val;
    else if (bucket === "meta" && key === "naturalMissingPoolIntervals")
      state.naturalMissingPoolIntervals = val;
    else if (bucket === "meta" && key === "lastFreshBoardPools")
      state.lastFreshBoardPools = val;
    else if (bucket === "meta" && key === "workbenchExposureState")
      state.workbenchExposureState = val;
  }

  if (backend === "sqlite" && db) {
    const rows = db
      .prepare("SELECT bucket, record_key, json_val FROM kv_records")
      .all();
    for (const row of rows) {
      try {
        hydrateBucketRecord(
          row.bucket,
          row.record_key,
          JSON.parse(row.json_val)
        );
      } catch {
        // skip malformed entry
      }
    }
  } else if (fs.existsSync(jsonlFile)) {
    const lines = fs.readFileSync(jsonlFile, "utf8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.op === "del") {
          if (entry.bucket === "quote_segments")
            state.quoteSegments.delete(entry.key);
          else if (entry.bucket === "result_records")
            state.resultRecords.delete(entry.key);
          else if (entry.bucket === "matches_meta")
            state.matchesMeta.delete(entry.key);
        } else {
          hydrateBucketRecord(entry.bucket, entry.key, entry.val);
        }
      } catch {
        // ignore partial tail line
      }
    }
  }

  const upsertStmt =
    backend === "sqlite" && db
      ? db.prepare(`
          INSERT INTO kv_records (bucket, record_key, json_val, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(bucket, record_key) DO UPDATE SET
            json_val = excluded.json_val,
            updated_at = excluded.updated_at
        `)
      : null;

  const deleteStmt =
    backend === "sqlite" && db
      ? db.prepare(`
          DELETE FROM kv_records WHERE bucket = ? AND record_key = ?
        `)
      : null;

  function persistRecord(bucket, key, val, nowMs = Date.now()) {
    hydrateBucketRecord(bucket, key, val);
    if (upsertStmt) {
      upsertStmt.run(bucket, key, JSON.stringify(val), nowMs);
      ensurePrivateFileMode(sqliteFile);
      ensurePrivateFileMode(`${sqliteFile}-wal`);
    } else {
      fs.appendFileSync(
        jsonlFile,
        JSON.stringify({ op: "put", bucket, key, val, ts: nowMs }) + "\n",
        { encoding: "utf8", mode: 0o600 }
      );
      ensurePrivateFileMode(jsonlFile);
    }
  }

  function deleteRecord(bucket, key, nowMs = Date.now()) {
    if (bucket === "quote_segments") state.quoteSegments.delete(key);
    else if (bucket === "result_records") state.resultRecords.delete(key);
    else if (bucket === "matches_meta") state.matchesMeta.delete(key);

    if (deleteStmt) {
      deleteStmt.run(bucket, key);
      ensurePrivateFileMode(sqliteFile);
      ensurePrivateFileMode(`${sqliteFile}-wal`);
    } else {
      fs.appendFileSync(
        jsonlFile,
        JSON.stringify({ op: "del", bucket, key, ts: nowMs }) + "\n",
        { encoding: "utf8", mode: 0o600 }
      );
      ensurePrivateFileMode(jsonlFile);
    }
  }

  function mergeMatchMeta(incoming, nowMs = Date.now()) {
    if (!incoming?.matchId) return;
    const matchId = String(incoming.matchId);
    const prev = state.matchesMeta.get(matchId) || {
      matchId,
      firstLocallySeenAt: nowMs,
    };
    const preserveLiveOrigin =
      prev.observationOrigin === "live-observed" ||
      incoming.observationOrigin === "live-observed"
        ? "live-observed"
        : incoming.observationOrigin &&
            incoming.observationOrigin !== "result-index-backfill" &&
            incoming.observationOrigin !== "live-open-backfill"
          ? incoming.observationOrigin
          : prev.observationOrigin && prev.observationOrigin !== "unknown"
            ? prev.observationOrigin
            : incoming.observationOrigin || "unknown";

    const next = {
      ...prev,
      matchId,
      matchNumStr: incoming.matchNumStr ?? prev.matchNumStr ?? null,
      matchDate: incoming.matchDate ?? prev.matchDate ?? null,
      businessDate: incoming.businessDate ?? prev.businessDate ?? null,
      kickoffDateTime: incoming.kickoffDateTime ?? prev.kickoffDateTime ?? null,
      kickoffEpochMs: incoming.kickoffEpochMs ?? prev.kickoffEpochMs ?? null,
      leagueId: incoming.leagueId ?? prev.leagueId ?? null,
      leagueName: incoming.leagueName ?? prev.leagueName ?? null,
      homeTeamId: incoming.homeTeamId ?? prev.homeTeamId ?? null,
      homeName: incoming.homeName ?? prev.homeName ?? null,
      awayTeamId: incoming.awayTeamId ?? prev.awayTeamId ?? null,
      awayName: incoming.awayName ?? prev.awayName ?? null,
      seasonId: incoming.seasonId ?? prev.seasonId ?? null,
      seasonName: incoming.seasonName ?? prev.seasonName ?? null,
      phaseName: incoming.phaseName ?? prev.phaseName ?? null,
      hasFixedBonusOpen: Boolean(
        prev.hasFixedBonusOpen || incoming.hasFixedBonusOpen
      ),
      hasHeadDetail: Boolean(prev.hasHeadDetail || incoming.hasHeadDetail),
      observationOrigin: preserveLiveOrigin,
      lastUpdatedAt: nowMs,
    };
    persistRecord("matches_meta", matchId, next, nowMs);
  }

  function upsertQuoteEvent(matchId, evt, nowMs = Date.now()) {
    const normLine =
      evt.poolCode === "HHAD" ? String(evt.goalLine ?? "").trim() : "";
    const segKey = `${String(matchId)}|${String(evt.poolCode)}|${normLine}`;
    const existing = state.quoteSegments.get(segKey) || {
      matchId: String(matchId),
      poolCode: String(evt.poolCode),
      goalLine: normLine,
      hasOfficialArchiveOpen: false,
      frames: [],
    };

    const frames = existing.frames.map((f) => ({ ...f }));
    const hasOfficialOpen = Boolean(
      existing.hasOfficialArchiveOpen ||
      evt.frameOrigin === "official-archive-open"
    );

    // Check if identical state already exists at matching timestamp or as current tail
    const lastIdx = frames.length - 1;
    if (
      !evt.isBackfilled &&
      lastIdx >= 0 &&
      frames[lastIdx].stateSig === evt.stateSig
    ) {
      frames[lastIdx].lastLocallySeenAt = Math.max(
        frames[lastIdx].lastLocallySeenAt ?? nowMs,
        nowMs
      );
      frames[lastIdx].pollCount = (frames[lastIdx].pollCount || 1) + 1;
    } else {
      const dupIdx = frames.findIndex(
        (f) =>
          f.stateSig === evt.stateSig &&
          f.sourcePublishedAt !== null &&
          f.sourcePublishedAt === evt.sourcePublishedAt
      );
      if (dupIdx >= 0) {
        if (evt.frameOrigin === "official-archive-open") {
          frames[dupIdx].frameOrigin = "official-archive-open";
        }
        frames[dupIdx].lastLocallySeenAt = Math.max(
          frames[dupIdx].lastLocallySeenAt ?? nowMs,
          nowMs
        );
      } else {
        frames.push({
          ...evt,
          pollCount: 1,
        });
      }
    }

    // Sort chronologically by sourcePublishedAt (fallback to firstLocallySeenAt), with official-archive-open pinned first when tied
    frames.sort((a, b) => {
      if (
        a.frameOrigin === "official-archive-open" &&
        b.frameOrigin !== "official-archive-open"
      ) {
        const ta = a.sourcePublishedAt ?? -Infinity;
        const tb = b.sourcePublishedAt ?? Infinity;
        if (ta <= tb) return -1;
      }
      if (
        b.frameOrigin === "official-archive-open" &&
        a.frameOrigin !== "official-archive-open"
      ) {
        const tb = b.sourcePublishedAt ?? -Infinity;
        const ta = a.sourcePublishedAt ?? Infinity;
        if (tb <= ta) return 1;
      }
      // Anti-stale-overwrite: backfilled frames never displace a live-observed frame unless both have explicit sourcePublishedAt and backfilled is strictly newer
      if (a.isBackfilled && !b.isBackfilled) {
        if (
          a.sourcePublishedAt !== null &&
          b.sourcePublishedAt !== null &&
          a.sourcePublishedAt > b.sourcePublishedAt
        ) {
          return 1;
        }
        return -1;
      }
      if (!a.isBackfilled && b.isBackfilled) {
        if (
          a.sourcePublishedAt !== null &&
          b.sourcePublishedAt !== null &&
          b.sourcePublishedAt > a.sourcePublishedAt
        ) {
          return -1;
        }
        return 1;
      }
      const ta = a.sourcePublishedAt ?? a.firstLocallySeenAt ?? 0;
      const tb = b.sourcePublishedAt ?? b.firstLocallySeenAt ?? 0;
      if (ta !== tb) return ta - tb;
      return (a.firstLocallySeenAt ?? 0) - (b.firstLocallySeenAt ?? 0);
    });

    const openFrame = frames[0] || null;
    const latestFrame = frames[frames.length - 1] || null;
    const prevFrame = frames.length >= 2 ? frames[frames.length - 2] : null;
    const nextSeg = {
      matchId: String(matchId),
      poolCode: String(evt.poolCode),
      goalLine: normLine,
      hasOfficialArchiveOpen: Boolean(
        hasOfficialOpen || openFrame?.frameOrigin === "official-archive-open"
      ),
      frameCount: frames.length,
      openFrame,
      prevFrame,
      latestFrame,
      frames,
    };
    persistRecord("quote_segments", segKey, nextSeg, nowMs);
  }

  function upsertResultRecords(records = [], nowMs = Date.now()) {
    for (const rec of records) {
      if (!rec?.matchId) continue;
      const matchId = String(rec.matchId);
      const prev = state.resultRecords.get(matchId);
      const preservedPubAt =
        prev?.settlementPublishedAt ?? rec.settlementPublishedAt ?? null;
      const merged = {
        ...prev,
        ...rec,
        settlementPublishedAt: preservedPubAt,
        embargoUntilMs:
          preservedPubAt !== null ? preservedPubAt : rec.embargoUntilMs,
        firstLocallySeenAt: prev?.firstLocallySeenAt ?? nowMs,
      };
      persistRecord("result_records", matchId, merged, nowMs);
      mergeMatchMeta(
        {
          matchId,
          matchNumStr: rec.matchNumStr,
          matchDate: rec.matchDate,
          leagueId: rec.leagueId,
          leagueName: rec.leagueName,
          homeTeamId: rec.homeTeamId,
          homeName: rec.home,
          awayTeamId: rec.awayTeamId,
          awayName: rec.away,
          observationOrigin: rec.observationOrigin,
        },
        nowMs
      );
    }
  }

  function measureStorageBytes() {
    const statSafe = (p) => {
      try {
        return fs.existsSync(p) ? fs.statSync(p).size : 0;
      } catch {
        return 0;
      }
    };
    const hotDbBytes = statSafe(sqliteFile) + statSafe(jsonlFile);
    const walBytes =
      statSafe(`${sqliteFile}-wal`) + statSafe(`${sqliteFile}-shm`);
    let coldArchiveBytes = 0;
    let coldShardCount = 0;
    if (fs.existsSync(archiveDir)) {
      for (const name of fs.readdirSync(archiveDir)) {
        if (name.endsWith(".jsonl.gz")) {
          coldArchiveBytes += statSafe(path.join(archiveDir, name));
          coldShardCount += 1;
        }
      }
    }
    let backupBytes = 0;
    if (fs.existsSync(backupsDir)) {
      for (const name of fs.readdirSync(backupsDir)) {
        backupBytes += statSafe(path.join(backupsDir, name));
      }
    }
    return {
      hotDbBytes,
      walBytes,
      coldArchiveBytes,
      backupBytes,
      totalHistoryBytes: hotDbBytes + walBytes + coldArchiveBytes + backupBytes,
      coldShardCount,
    };
  }

  function computeRecordDigest(record) {
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(record))
      .digest("hex");
  }

  function verifySingleColdShardFile(shardPath, expectedDigests = null) {
    if (!fs.existsSync(shardPath)) {
      throw new Error(`archive_verify_failed: missing shard ${shardPath}`);
    }
    const gzBuf = fs.readFileSync(shardPath);
    const rawText = zlib.gunzipSync(gzBuf).toString("utf8");
    const lines = rawText.split("\n").filter((ln) => ln.trim().length > 0);
    if (lines.length === 0) {
      throw new Error(`archive_verify_failed: empty shard ${shardPath}`);
    }
    const verifiedDigests = new Map();
    for (let i = 0; i < lines.length; i += 1) {
      let row;
      try {
        row = JSON.parse(lines[i]);
      } catch {
        throw new Error(
          `archive_verify_failed: invalid JSON on line ${i + 1} of ${shardPath}`
        );
      }
      if (!row || typeof row.key !== "string" || !row.record) {
        throw new Error(
          `archive_verify_failed: malformed row on line ${i + 1} of ${shardPath}`
        );
      }
      const actualDigest = computeRecordDigest(row.record);
      if (row.digest && row.digest !== actualDigest) {
        throw new Error(
          `archive_verify_failed: digest mismatch for ${row.key} in ${shardPath}`
        );
      }
      verifiedDigests.set(`${row.bucket}|${row.key}`, actualDigest);
    }

    if (expectedDigests instanceof Map) {
      for (const [compKey, expDigest] of expectedDigests.entries()) {
        if (verifiedDigests.get(compKey) !== expDigest) {
          throw new Error(
            `archive_verify_failed: missing or mismatched expected record ${compKey}`
          );
        }
      }
    }

    return {
      ok: true,
      shardName: path.basename(shardPath),
      lineCount: lines.length,
    };
  }

  function verifyColdArchives() {
    ensurePrivateDir(archiveDir);
    const shardFiles = fs
      .readdirSync(archiveDir)
      .filter((f) => f.endsWith(".jsonl.gz"))
      .sort();
    const shards = [];
    let totalVerifiedLines = 0;
    for (const f of shardFiles) {
      const res = verifySingleColdShardFile(path.join(archiveDir, f));
      shards.push(res);
      totalVerifiedLines += res.lineCount;
    }
    return {
      ok: true,
      shardCount: shards.length,
      totalVerifiedLines,
      shards,
    };
  }

  function archiveAndPruneHotStorage({
    nowMs = Date.now(),
    hotQuoteMonths = 18,
    hotResultMonths = 24,
    coldRetentionMonths = 36,
    pruneExpiredColdShards = false,
    simulateCorruptArchiveVerify = false,
  } = {}) {
    const quoteCutoffMs = subtractCalendarMonthsMs(nowMs, hotQuoteMonths);
    const resultCutoffMs = subtractCalendarMonthsMs(nowMs, hotResultMonths);
    const coldCutoffMonthStr = formatBeijingDate(
      subtractCalendarMonthsMs(nowMs, Math.max(36, coldRetentionMonths))
    ).slice(0, 7);

    // Group candidate >18m quote segments and >24m result records by shard file
    const shardBuckets = new Map();
    const pushCandidate = (shardFileName, bucket, key, record) => {
      let map = shardBuckets.get(shardFileName);
      if (!map) {
        map = new Map();
        shardBuckets.set(shardFileName, map);
      }
      map.set(`${bucket}|${key}`, {
        bucket,
        key,
        digest: computeRecordDigest(record),
        archivedAt: nowMs,
        record,
      });
    };

    const quoteKeysToPrune = [];
    for (const [segKey, seg] of state.quoteSegments.entries()) {
      const latestTs =
        seg?.latestFrame?.sourcePublishedAt ??
        seg?.latestFrame?.firstLocallySeenAt ??
        null;
      if (typeof latestTs === "number" && latestTs < quoteCutoffMs) {
        const ym = formatBeijingDate(latestTs).slice(0, 7) || "unknown";
        pushCandidate(`quotes-${ym}.jsonl.gz`, "quote_segments", segKey, seg);
        quoteKeysToPrune.push(segKey);
      }
    }

    const resultKeysToPrune = [];
    for (const [matchId, rec] of state.resultRecords.entries()) {
      const recTs = rec?.matchDate
        ? parseBeijingDateTimeMs(rec.matchDate, "12:00:00")
        : (rec?.firstLocallySeenAt ?? null);
      if (typeof recTs === "number" && recTs < resultCutoffMs) {
        const ym =
          (rec?.matchDate || formatBeijingDate(recTs)).slice(0, 7) || "unknown";
        pushCandidate(`results-${ym}.jsonl.gz`, "result_records", matchId, rec);
        resultKeysToPrune.push(matchId);
      }
    }

    // Step 1: Write candidate .jsonl.gz shards to staging files and run full gunzip line-by-line verification BEFORE touching hot DB!
    const stagedFiles = [];
    try {
      for (const [shardName, candidateMap] of shardBuckets.entries()) {
        const finalPath = path.join(archiveDir, shardName);
        const mergedRows = new Map();
        if (fs.existsSync(finalPath)) {
          const existingRaw = zlib
            .gunzipSync(fs.readFileSync(finalPath))
            .toString("utf8");
          for (const ln of existingRaw.split("\n")) {
            if (!ln.trim()) continue;
            const parsed = JSON.parse(ln);
            mergedRows.set(`${parsed.bucket}|${parsed.key}`, parsed);
          }
        }
        const expectedDigests = new Map();
        for (const [compKey, item] of candidateMap.entries()) {
          mergedRows.set(compKey, item);
          expectedDigests.set(compKey, item.digest);
        }

        const serialized =
          Array.from(mergedRows.values())
            .map((r) => JSON.stringify(r))
            .join("\n") + "\n";
        const stagePath = `${finalPath}.stage.${process.pid}.${Date.now()}`;
        const gzPayload = simulateCorruptArchiveVerify
          ? Buffer.from("corrupted-not-valid-gzip-bytes", "utf8")
          : zlib.gzipSync(Buffer.from(serialized, "utf8"));
        fs.writeFileSync(stagePath, gzPayload, { mode: 0o600 });
        ensurePrivateFileMode(stagePath);
        stagedFiles.push({ stagePath, finalPath, expectedDigests });

        // Mandatory gunzip line-by-line verification on staged shard BEFORE rename & hot prune!
        verifySingleColdShardFile(stagePath, expectedDigests);
      }

      // Promote verified staged shards atomically
      for (const item of stagedFiles) {
        fs.renameSync(item.stagePath, item.finalPath);
        ensurePrivateFileMode(item.finalPath);
        // Re-verify final promoted path on disk
        verifySingleColdShardFile(item.finalPath, item.expectedDigests);
      }
    } catch (err) {
      for (const item of stagedFiles) {
        try {
          if (fs.existsSync(item.stagePath)) fs.unlinkSync(item.stagePath);
        } catch {
          // ignore cleanup error
        }
      }
      throw new Error(
        `archive_verify_failed: ${String(err?.message || err || "unknown")}`
      );
    }

    // Step 2: Only AFTER 100% gunzip verification succeeded, prune archived records from hot storage!
    for (const segKey of quoteKeysToPrune) {
      deleteRecord("quote_segments", segKey, nowMs);
    }
    for (const matchId of resultKeysToPrune) {
      deleteRecord("result_records", matchId, nowMs);
    }

    // Optional expired cold shard cleanup ONLY for shards strictly older than >= 36 months when explicitly enabled
    let prunedColdShards = 0;
    if (pruneExpiredColdShards && fs.existsSync(archiveDir)) {
      for (const name of fs.readdirSync(archiveDir)) {
        const m = name.match(/^(?:quotes|results)-(\d{4}-\d{2})\.jsonl\.gz$/);
        if (m && m[1] < coldCutoffMonthStr) {
          fs.unlinkSync(path.join(archiveDir, name));
          prunedColdShards += 1;
        }
      }
    }

    if (db) {
      try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      } catch {
        // ignore
      }
    }

    return {
      ok: true,
      prunedQuoteSegments: quoteKeysToPrune.length,
      prunedResultRecords: resultKeysToPrune.length,
      prunedColdShards,
      writtenShards: Array.from(shardBuckets.keys()),
      storageBytes: measureStorageBytes(),
    };
  }

  function computeCoverageSummary() {
    let earliestQuoteAt = null;
    let latestQuoteAt = null;
    for (const seg of state.quoteSegments.values()) {
      const openTs =
        seg?.openFrame?.sourcePublishedAt ??
        seg?.openFrame?.firstLocallySeenAt ??
        null;
      const tailTs =
        seg?.latestFrame?.sourcePublishedAt ??
        seg?.latestFrame?.firstLocallySeenAt ??
        null;
      if (typeof openTs === "number") {
        earliestQuoteAt =
          earliestQuoteAt === null ? openTs : Math.min(earliestQuoteAt, openTs);
      }
      if (typeof tailTs === "number") {
        latestQuoteAt =
          latestQuoteAt === null ? tailTs : Math.max(latestQuoteAt, tailTs);
      }
    }
    let earliestResultDate = null;
    let latestResultDate = null;
    for (const rec of state.resultRecords.values()) {
      if (!rec?.matchDate) continue;
      if (earliestResultDate === null || rec.matchDate < earliestResultDate) {
        earliestResultDate = rec.matchDate;
      }
      if (latestResultDate === null || rec.matchDate > latestResultDate) {
        latestResultDate = rec.matchDate;
      }
    }
    const coldArchiveShards = fs.existsSync(archiveDir)
      ? fs
          .readdirSync(archiveDir)
          .filter((n) => n.endsWith(".jsonl.gz"))
          .sort()
      : [];
    return {
      earliestQuoteAt,
      latestQuoteAt,
      earliestResultDate,
      latestResultDate,
      coldArchiveShards,
      coverageBoundaryNote:
        "未即刻全量回补过去 18 个月逐帧明细（近 90～120 天优先详情回补，更早场次按 ID 点补并显式打标）",
    };
  }

  function buildSnapshotEnvelope(nowMs = Date.now()) {
    state.seq += 1;
    const payload = {
      ...buildEmptySnapshotPayload(),
      boardMeta: state.boardMeta,
      matchesMeta: Object.fromEntries(state.matchesMeta.entries()),
      quoteSegments: Object.fromEntries(state.quoteSegments.entries()),
      resultRecords: Object.fromEntries(state.resultRecords.entries()),
      naturalMissingPoolIntervals: state.naturalMissingPoolIntervals,
      samplingIntervals: state.samplingIntervals,
      cursors: state.cursors,
      endpoints: state.endpoints,
      workbenchExposureState: state.workbenchExposureState,
      coverage: computeCoverageSummary(),
      storageBytes: measureStorageBytes(),
    };
    const checksum = computeSnapshotChecksum(payload);
    return {
      seq: state.seq,
      schemaVersion: HISTORY_SNAPSHOT_SCHEMA_VERSION,
      generatedAt: nowMs,
      storageBackend: backend,
      checksum,
      payload,
    };
  }

  function close(nowMs = Date.now()) {
    persistRecord("meta", "cursors", state.cursors, nowMs);
    persistRecord("meta", "endpoints", state.endpoints, nowMs);
    if (db) {
      try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      } catch {
        // ignore checkpoint error on close
      }
      db.close();
      db = null;
    }
  }

  return {
    backend,
    dataDir,
    historyDir,
    archiveDir,
    backupsDir,
    state,
    persistRecord,
    deleteRecord,
    mergeMatchMeta,
    upsertQuoteEvent,
    upsertResultRecords,
    verifyColdArchives,
    archiveAndPruneHotStorage,
    measureStorageBytes,
    buildSnapshotEnvelope,
    close,
  };
}
