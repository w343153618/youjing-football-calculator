import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

function walkFiles(dir, exts) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...walkFiles(full, exts));
    } else if (!exts || exts.some((ext) => ent.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

const errors = [];

// 1. Block staged/tracked runtime state, env secrets, and signing keystores
try {
  const staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
    cwd: ROOT_DIR,
    encoding: "utf8",
  })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const tracked = execFileSync("git", ["ls-files"], {
    cwd: ROOT_DIR,
    encoding: "utf8",
  })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const forbiddenPathRe =
    /^(data\/|\.env($|\.(?!example$))|.*\.(keystore|jks|pem|p12)$)/i;
  for (const rel of new Set([...staged, ...tracked])) {
    if (forbiddenPathRe.test(rel)) {
      errors.push(
        `[secret-path] Forbidden runtime/secret file staged or tracked: ${rel}`
      );
    }
  }
} catch {
  // Ignore if git metadata is unavailable
}

const clientFiles = walkFiles(path.join(ROOT_DIR, "src"), [".ts", ".tsx"]);
const serverFiles = walkFiles(path.join(ROOT_DIR, "server"), [".mjs", ".js"]);

// 2. Enforce client thin-view black-box isolation (zero server quant formulas in src/)
const clientMathLeakRe =
  /\b(devigPoolProbabilities|calibrateMatchCoherentModel|generateParetoPortfolio|evaluateTicketsOnQuotientSpace|roundHalfEvenBigInt|solveExactKnapsackDutching)\b/;
for (const file of clientFiles) {
  const rel = path.relative(ROOT_DIR, file);
  const src = fs.readFileSync(file, "utf8");
  const m = src.match(clientMathLeakRe);
  if (m) {
    errors.push(
      `[blackbox-isolation] Server quant symbol "${m[1]}" leaked into client file ${rel}`
    );
  }
}

// 3. Enforce recursive zero underlying LLM vendor/model leaks across src/, index.html, and server/**
const vendorTokenRe = /\b(DeepSeek|GLM|OpenCode|ChatGPT|Claude|Qwen|Doubao)\b/i;
const vendorAllowedRelPaths = new Set([
  path.join("src", "security", "antiReverseShield.ts"),
  path.join("server", "securityShield.mjs"),
  path.join("server", "xiaogaoCore.mjs"),
]);
const manualQaRelPath = path.join("server", "manualQaEngine.mjs");

for (const file of [
  ...clientFiles,
  path.join(ROOT_DIR, "index.html"),
  ...serverFiles,
]) {
  if (!fs.existsSync(file)) continue;
  const rel = path.relative(ROOT_DIR, file);
  if (vendorAllowedRelPaths.has(rel)) continue;
  const src = fs.readFileSync(file, "utf8");
  if (rel === manualQaRelPath) {
    src.split("\n").forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("/") && /\/[gimsuy]*;$/.test(trimmed)) return;
      const m = line.match(vendorTokenRe);
      if (m) {
        errors.push(
          `[vendor-leak] Underlying model/vendor token "${m[1]}" found in ${rel}:${idx + 1}`
        );
      }
    });
    continue;
  }
  const m = src.match(vendorTokenRe);
  if (m) {
    errors.push(
      `[vendor-leak] Underlying model/vendor token "${m[1]}" found in ${rel}`
    );
  }
}

// 4. Enforce Spec 0009 scientific honesty copy guardrails (zero "零风险" or "单池暗扣" regression)
for (const file of [...clientFiles, ...serverFiles]) {
  const rel = path.relative(ROOT_DIR, file);
  const src = fs.readFileSync(file, "utf8");
  if (src.includes("零风险")) {
    errors.push(
      `[honesty-guardrail] Forbidden misleading phrase "零风险" found in ${rel}`
    );
  }
  if (rel.startsWith(`src${path.sep}`) && src.includes("单池暗扣")) {
    errors.push(
      `[honesty-guardrail] Deprecated misleading parlay vig label "单池暗扣" found in ${rel}`
    );
  }
}

if (errors.length > 0) {
  console.error("[guardrails] FAILED:\n  - " + errors.join("\n  - "));
  process.exit(1);
}

console.log(
  "[guardrails] Passed: 0 secret paths, 0 client math leaks, 0 vendor name leaks, 0 honesty violations."
);
