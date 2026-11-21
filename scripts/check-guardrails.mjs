import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT_DIR = path.resolve(path.dirname(SELF_PATH), "..");

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

export function runRepositoryGuardrails({ rootDir = DEFAULT_ROOT_DIR } = {}) {
  const errors = [];
  let canonicalVersion = "";

  // 1. Block staged/tracked runtime state, env secrets, and signing keystores (when inside a git repository root)
  if (fs.existsSync(path.join(rootDir, ".git"))) {
    try {
      const staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
        cwd: rootDir,
        encoding: "utf8",
      })
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const tracked = execFileSync("git", ["ls-files"], {
        cwd: rootDir,
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
  }

  const clientFiles = walkFiles(path.join(rootDir, "src"), [".ts", ".tsx"]);
  const serverFiles = walkFiles(path.join(rootDir, "server"), [".mjs", ".js"]);

  // 2. Enforce client thin-view black-box isolation (zero server quant formulas in src/)
  const clientMathLeakRe =
    /\b(devigPoolProbabilities|calibrateMatchCoherentModel|generateParetoPortfolio|evaluateTicketsOnQuotientSpace|roundHalfEvenBigInt|solveExactKnapsackDutching)\b/;
  for (const file of clientFiles) {
    const rel = path.relative(rootDir, file);
    const src = fs.readFileSync(file, "utf8");
    const m = src.match(clientMathLeakRe);
    if (m) {
      errors.push(
        `[blackbox-isolation] Server quant symbol "${m[1]}" leaked into client file ${rel}`
      );
    }
  }

  // 3. Enforce recursive zero underlying LLM vendor/model leaks across src/, index.html, and server/**
  const vendorTokenRe =
    /\b(DeepSeek|GLM|OpenCode|ChatGPT|Claude|Qwen|Doubao)\b/i;
  const vendorAllowedRelPaths = new Set([
    path.join("src", "security", "antiReverseShield.ts"),
    path.join("server", "securityShield.mjs"),
    path.join("server", "xiaogaoCore.mjs"),
  ]);
  const manualQaRelPath = path.join("server", "manualQaEngine.mjs");

  for (const file of [
    ...clientFiles,
    path.join(rootDir, "index.html"),
    ...serverFiles,
  ]) {
    if (!fs.existsSync(file)) continue;
    const rel = path.relative(rootDir, file);
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

  // 4. Enforce Spec 0009/0011 scientific honesty copy & mechanical anti-bypass guardrails
  const emptyTicketsNullishBypassRe = /\.tickets\?\.length\s*\?\?(?!\s*0\b)/;
  for (const file of [...clientFiles, ...serverFiles]) {
    const rel = path.relative(rootDir, file);
    const src = fs.readFileSync(file, "utf8");
    if (src.includes("零风险")) {
      errors.push(
        `[honesty-guardrail] Forbidden misleading phrase "零风险" found in ${rel}`
      );
    }
    if (src.includes("保本锁回")) {
      errors.push(
        `[honesty-guardrail] Forbidden misleading negative-hedge phrase "保本锁回" found in ${rel}`
      );
    }
    if (src.includes("锁死最小保本护盾注数")) {
      errors.push(
        `[honesty-guardrail] Outdated shield-lock claim "锁死最小保本护盾注数" found in ${rel}`
      );
    }
    if (src.includes("标「互斥」拦截")) {
      errors.push(
        `[honesty-guardrail] Retired mutex-block copy "标「互斥」拦截" found in ${rel} (ADR-0015 uses smooth pool switch + undo)`
      );
    }
    if (src.includes("一键无损切换单场出票")) {
      errors.push(
        `[honesty-guardrail] Retired misleading 2-way synthetic claim "一键无损切换单场出票" found in ${rel}`
      );
    }
    if (rel.startsWith(`src${path.sep}`) && src.includes("单池暗扣")) {
      errors.push(
        `[honesty-guardrail] Deprecated misleading parlay vig label "单池暗扣" found in ${rel}`
      );
    }
    if (emptyTicketsNullishBypassRe.test(src)) {
      errors.push(
        `[ticket-gate-bypass] Unsafe ".tickets?.length ??" pattern in ${rel} (empty tickets=[] evaluates to 0; use Math.max(rep.tickets?.length ?? 0, rep.betCount))`
      );
    }
  }

  // 5. Enforce 4-way release version & Android versionCode parity across package.json, build.gradle.kts, securityShield.mjs & MainActivity.kt
  const pkgPath = path.join(rootDir, "package.json");
  const gradlePath = path.join(rootDir, "android", "app", "build.gradle.kts");
  const shieldPath = path.join(rootDir, "server", "securityShield.mjs");
  const mainActivityPath = path.join(
    rootDir,
    "android",
    "app",
    "src",
    "main",
    "kotlin",
    "io",
    "yjty",
    "jisuanqi",
    "MainActivity.kt"
  );

  if (!fs.existsSync(pkgPath)) {
    errors.push(`[version-parity] Missing package.json at ${pkgPath}`);
  } else {
    let semverMatch = null;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      canonicalVersion = String(pkg?.version || "").trim();
      semverMatch = canonicalVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);
    } catch {
      semverMatch = null;
    }

    if (!semverMatch) {
      errors.push(
        `[version-parity] package.json version "${canonicalVersion}" must match strict X.Y.Z semver`
      );
    } else {
      const expectedVersionCode =
        Number(semverMatch[1]) * 100 +
        Number(semverMatch[2]) * 10 +
        Number(semverMatch[3]);

      if (!fs.existsSync(gradlePath)) {
        errors.push(`[version-parity] Missing android/app/build.gradle.kts`);
      } else {
        const gradleSrc = fs.readFileSync(gradlePath, "utf8");
        const vNameMatch = gradleSrc.match(/\bversionName\s*=\s*"([^"]+)"/);
        const vCodeMatch = gradleSrc.match(/\bversionCode\s*=\s*(\d+)/);
        const actualVName = vNameMatch?.[1] ?? "<missing>";
        const actualVCode = vCodeMatch ? Number(vCodeMatch[1]) : NaN;
        if (actualVName !== canonicalVersion) {
          errors.push(
            `[version-parity] android/app/build.gradle.kts versionName "${actualVName}" !== package.json "${canonicalVersion}"`
          );
        }
        if (actualVCode !== expectedVersionCode) {
          errors.push(
            `[version-parity] android/app/build.gradle.kts versionCode ${actualVCode} !== expected ${expectedVersionCode} (from ${canonicalVersion})`
          );
        }
      }

      if (!fs.existsSync(shieldPath)) {
        errors.push(`[version-parity] Missing server/securityShield.mjs`);
      } else {
        const shieldSrc = fs.readFileSync(shieldPath, "utf8");
        const healthVerMatch = shieldSrc.match(
          /\bversion:\s*"(\d+\.\d+\.\d+)"/
        );
        const actualHealthVer = healthVerMatch?.[1] ?? "<missing>";
        if (actualHealthVer !== canonicalVersion) {
          errors.push(
            `[version-parity] server/securityShield.mjs /api/health version "${actualHealthVer}" !== package.json "${canonicalVersion}"`
          );
        }
      }

      if (!fs.existsSync(mainActivityPath)) {
        errors.push(
          `[version-parity] Missing android/app/src/main/kotlin/io/yjty/jisuanqi/MainActivity.kt`
        );
      } else {
        const ktSrc = fs.readFileSync(mainActivityPath, "utf8");
        const uaMatch = ktSrc.match(/YouJingAndroid\/(\d+\.\d+\.\d+)/);
        const actualUaVer = uaMatch?.[1] ?? "<missing>";
        if (actualUaVer !== canonicalVersion) {
          errors.push(
            `[version-parity] MainActivity.kt YouJingAndroid/${actualUaVer} !== package.json "${canonicalVersion}"`
          );
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    version: canonicalVersion,
    errors,
  };
}

const isMainModule =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === SELF_PATH;

if (isMainModule) {
  const result = runRepositoryGuardrails();
  if (!result.ok) {
    console.error("[guardrails] FAILED:\n  - " + result.errors.join("\n  - "));
    process.exit(1);
  }
  console.log(
    `[guardrails] Passed: 0 secret paths, 0 client math leaks, 0 vendor name leaks, 0 honesty violations, version parity v${result.version} verified.`
  );
}
