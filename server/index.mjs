import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { createYouJingRuntime } from "./runtimeApp.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(
  process.env.DIST_DIR || path.resolve(__dirname, "../dist")
);
const DATA_DIR = path.resolve(
  process.env.DATA_DIR || path.resolve(__dirname, "../data")
);
const ADMIN_CREDS_FILE =
  process.env.ADMIN_CREDS_FILE || path.join(DATA_DIR, "admin-credentials.txt");
const PORT = Number(process.env.PORT || 18768);
const HOST = process.env.HOST || "127.0.0.1";
const API_KEY = process.env.OPENCODE_API_KEY || "";

const runtime = createYouJingRuntime({
  dataDir: DATA_DIR,
  adminCredsFile: ADMIN_CREDS_FILE,
  getApiKey: () => API_KEY,
  enableHistoryCollector: true,
});
const { gateway } = runtime;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function sendJson(res, statusCode, payload) {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  res.end(JSON.stringify(payload));
}

function isSafeInsideDir(baseDir, candidatePath) {
  const rel = path.relative(baseDir, candidatePath);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || "/", "http://localhost");
    const pathname = u.pathname;

    // 1. Unified 4-Layer Security Shield & Server Black-Box Quant Gateway
    const handled = await gateway.handleRequest(req, res, pathname);
    if (handled) return;

    // 2. Unknown /api/* routes MUST return 404 JSON rather than SPA index.html
    if (pathname.startsWith("/api/")) {
      sendJson(res, 404, { ok: false, error: "API endpoint not found" });
      return;
    }

    // 3. Static Assets Serving from DIST_DIR with strict path.relative containment & no-index headers
    let decodedPath = "/";
    try {
      decodedPath = decodeURIComponent(pathname);
    } catch {
      sendJson(res, 400, { ok: false, error: "Malformed URI" });
      return;
    }

    // Never serve sourcemaps in production
    if (decodedPath.endsWith(".map")) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    const relReq =
      decodedPath === "/" || decodedPath === ""
        ? "index.html"
        : decodedPath.replace(/^\/+/, "");
    let filePath = path.resolve(DIST_DIR, relReq);

    if (
      !isSafeInsideDir(DIST_DIR, filePath) ||
      !fs.existsSync(filePath) ||
      fs.statSync(filePath).isDirectory()
    ) {
      filePath = path.join(DIST_DIR, "index.html");
    }

    if (!fs.existsSync(filePath)) {
      res.statusCode = 404;
      res.end("Build artifacts not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    res.setHeader("Content-Type", mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader(
      "X-Robots-Tag",
      "noindex, nofollow, noarchive, nosnippet, noimageindex"
    );
    res.setHeader("Referrer-Policy", "no-referrer");

    if (pathname.startsWith("/assets/")) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      res.setHeader("Cache-Control", "no-cache");
    }

    const rawBuf = await fsp.readFile(filePath);
    const acceptEnc = String(req.headers["accept-encoding"] || "");
    if (
      acceptEnc.includes("gzip") &&
      rawBuf.length > 1024 &&
      [".html", ".js", ".mjs", ".css", ".json", ".svg"].includes(ext)
    ) {
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Vary", "Accept-Encoding");
      res.end(zlib.gzipSync(rawBuf));
      return;
    }

    res.end(rawBuf);
  } catch (err) {
    console.error("[youjing-prod] request error:", err);
    sendJson(res, 502, {
      ok: false,
      error: "服务请求繁忙，请稍后再试",
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[youjing-calculator] listening on http://${HOST}:${PORT}`);
});

let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  await runtime.dispose().catch(() => {});
  if (signal === "SIGINT" || signal === "SIGTERM") {
    process.exit(0);
  }
}

server.once("close", () => {
  void runtime.dispose();
});
process.once("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});
