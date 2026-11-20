import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runRepositoryGuardrails } from "../scripts/check-guardrails.mjs";

function writeReleaseFixture(
  dir: string,
  overrides: {
    pkgVersion?: string;
    gradleVersionName?: string;
    gradleVersionCode?: number;
    healthVersion?: string;
    androidUaVersion?: string;
  } = {}
) {
  const pkgVersion = overrides.pkgVersion ?? "2.5.1";
  const gradleVersionName = overrides.gradleVersionName ?? pkgVersion;
  const gradleVersionCode = overrides.gradleVersionCode ?? 251;
  const healthVersion = overrides.healthVersion ?? pkgVersion;
  const androidUaVersion = overrides.androidUaVersion ?? pkgVersion;

  fs.mkdirSync(path.join(dir, "server"), { recursive: true });
  fs.mkdirSync(path.join(dir, "android/app/src/main/kotlin/io/yjty/jisuanqi"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "youjing-football-calculator",
      version: pkgVersion,
    }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "android/app/build.gradle.kts"),
    `android {\n  defaultConfig {\n    versionCode = ${gradleVersionCode}\n    versionName = "${gradleVersionName}"\n  }\n}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "server/securityShield.mjs"),
    `export function health() {\n  return {\n    ok: true,\n    version: "${healthVersion}",\n    uptimeSec: 1,\n  };\n}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(
      dir,
      "android/app/src/main/kotlin/io/yjty/jisuanqi/MainActivity.kt"
    ),
    `class MainActivity {\n  fun ua(base: String) = "$base YouJingAndroid/${androidUaVersion}"\n}\n`,
    "utf8"
  );
}

describe("Repository Guardrails · Four-Way Release Version & versionCode Parity", () => {
  it("passes on the live repository and detects version or versionCode drift across all 4 release surfaces", () => {
    const liveRes = runRepositoryGuardrails({ rootDir: process.cwd() });
    assert.equal(
      liveRes.ok,
      true,
      `Expected live repo guardrails to pass, got: ${liveRes.errors.join("; ")}`
    );

    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "yj-guardrails-"));
    try {
      const alignedDir = path.join(tmpBase, "aligned");
      writeReleaseFixture(alignedDir);
      const alignedRes = runRepositoryGuardrails({ rootDir: alignedDir });
      assert.equal(alignedRes.ok, true);
      assert.deepEqual(alignedRes.errors, []);

      const staleHealthDir = path.join(tmpBase, "stale-health");
      writeReleaseFixture(staleHealthDir, { healthVersion: "2.4.0" });
      const staleHealthRes = runRepositoryGuardrails({
        rootDir: staleHealthDir,
      });
      assert.equal(staleHealthRes.ok, false);
      assert.ok(
        staleHealthRes.errors.some(
          (e: string) =>
            e.includes("[version-parity]") && e.includes("securityShield.mjs")
        )
      );

      const staleGradleNameDir = path.join(tmpBase, "stale-gradle-name");
      writeReleaseFixture(staleGradleNameDir, { gradleVersionName: "2.5.0" });
      const staleGradleNameRes = runRepositoryGuardrails({
        rootDir: staleGradleNameDir,
      });
      assert.equal(staleGradleNameRes.ok, false);
      assert.ok(
        staleGradleNameRes.errors.some(
          (e: string) =>
            e.includes("[version-parity]") && e.includes("versionName")
        )
      );

      const staleGradleCodeDir = path.join(tmpBase, "stale-gradle-code");
      writeReleaseFixture(staleGradleCodeDir, { gradleVersionCode: 240 });
      const staleGradleCodeRes = runRepositoryGuardrails({
        rootDir: staleGradleCodeDir,
      });
      assert.equal(staleGradleCodeRes.ok, false);
      assert.ok(
        staleGradleCodeRes.errors.some(
          (e: string) =>
            e.includes("[version-parity]") && e.includes("versionCode")
        )
      );

      const staleUaDir = path.join(tmpBase, "stale-ua");
      writeReleaseFixture(staleUaDir, { androidUaVersion: "2.3.0" });
      const staleUaRes = runRepositoryGuardrails({ rootDir: staleUaDir });
      assert.equal(staleUaRes.ok, false);
      assert.ok(
        staleUaRes.errors.some(
          (e: string) =>
            e.includes("[version-parity]") && e.includes("MainActivity.kt")
        )
      );
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});
