import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSportteryHistoryCoordinator } from "../server/history/historyCoordinator.mjs";
import { summarizeResultWindowCursors } from "../server/history/sportteryHistoryNormalizers.mjs";

const SELF_PATH = fileURLToPath(import.meta.url);
const DEFAULT_DATA_DIR = path.resolve(
  path.dirname(SELF_PATH),
  "..",
  process.env.DATA_DIR || "data"
);

function parseCliFlags(argv = []) {
  const cmd = String(argv[0] || "status").trim();
  const flags = {};
  for (let i = 1; i < argv.length; i += 1) {
    const token = String(argv[i]);
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !String(next).startsWith("--")) {
      flags[key] = String(next);
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return { cmd, flags };
}

export async function runHistoryCtlCli(
  argv = process.argv.slice(2),
  envOpts = {}
) {
  const { cmd, flags } = parseCliFlags(argv);
  const dataDir = path.resolve(
    flags["data-dir"] || envOpts.dataDir || DEFAULT_DATA_DIR
  );
  const storageBackend = flags.backend || envOpts.storageBackend || "auto";
  const silent = Boolean(flags.silent || envOpts.silent);

  const coordinator = createSportteryHistoryCoordinator({
    dataDir,
    enableCollector: true,
    autoPoll: false,
    storageBackend,
    fetchFn: envOpts.fetchFn,
    nowFn: envOpts.nowFn,
  });

  await coordinator.start();
  try {
    if (cmd === "status" || cmd === "verify-cursors") {
      const snap = coordinator.getSnapshot();
      const cursors = summarizeResultWindowCursors(snap?.telemetry?.cursors);
      const out = {
        ok: cmd === "verify-cursors" ? cursors.partialWindows === 0 : true,
        command: cmd,
        storageBackend: snap.storageBackend,
        seq: snap.seq,
        boardMeta: snap.boardMeta,
        coverage: snap.telemetry.coverage,
        storageBytes: snap.telemetry.storageBytes,
        cursors,
      };
      if (!silent) {
        console.log(JSON.stringify(out, null, 2));
      }
      return out;
    }

    if (cmd === "backfill") {
      const months = flags.months ? Number(flags.months) : 24;
      const force = Boolean(flags.force);
      let backfill = null;
      let matchDetail = null;

      if (flags["match-id"]) {
        matchDetail = await coordinator.fetchMatchDetailOnDemand(
          String(flags["match-id"])
        );
      } else {
        backfill = await coordinator.backfillResultsRange({
          beginDate: typeof flags.begin === "string" ? flags.begin : undefined,
          endDate: typeof flags.end === "string" ? flags.end : undefined,
          months,
          force,
        });
      }

      if (flags["open-quotes"]) {
        await coordinator.drainPendingOpenQuotes({
          maxItems: Number(flags["max-items"] || 64),
        });
      }
      if (flags["recent-details"]) {
        await coordinator.drainPendingRecentDetails({
          maxItems: Number(flags["max-items"] || 64),
        });
      }

      const snap = coordinator.getSnapshot();
      const out = {
        ok: backfill ? Boolean(backfill.allCompleted) : true,
        command: cmd,
        backfill,
        matchDetail,
        cursors: summarizeResultWindowCursors(snap?.telemetry?.cursors),
        storageBytes: snap.telemetry.storageBytes,
      };
      if (!silent) {
        console.log(JSON.stringify(out, null, 2));
      }
      return out;
    }

    if (cmd === "archive" || cmd === "compact") {
      const archive = await coordinator.archiveAndPruneHotStorage({
        pruneExpiredColdShards: Boolean(flags["prune-expired-cold"]),
      });
      const verification = await coordinator.verifyColdArchives();
      const out = {
        ok: Boolean(archive?.ok && verification?.ok),
        command: cmd,
        archive,
        verification,
      };
      if (!silent) {
        console.log(JSON.stringify(out, null, 2));
      }
      return out;
    }

    if (cmd === "verify-archive") {
      const verification = await coordinator.verifyColdArchives();
      const out = {
        ok: Boolean(verification?.ok),
        command: cmd,
        verification,
      };
      if (!silent) {
        console.log(JSON.stringify(out, null, 2));
      }
      return out;
    }

    throw new Error(
      `Unknown history-ctl command "${cmd}". Supported: status | verify-cursors | backfill | archive | verify-archive`
    );
  } finally {
    await coordinator.dispose();
  }
}

const isMainModule =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === SELF_PATH;

if (isMainModule) {
  runHistoryCtlCli()
    .then((res) => {
      if (!res?.ok) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("[history-ctl] FAILED:", err?.message || err);
      process.exit(1);
    });
}
