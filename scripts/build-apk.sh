#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT_DIR}"

echo "==> [1/4] Verifying 4-way release version parity & guardrails..."
pnpm run check:guardrails

VERSION="$(node -p "JSON.parse(require('node:fs').readFileSync('package.json','utf8')).version")"
KS_FILE="${YJ_KEYSTORE_FILE:-${ROOT_DIR}/data/android-release.keystore}"
KS_PASS_FILE="${ROOT_DIR}/data/android-keystore-pass.txt"

if [[ -z "${JAVA_HOME:-}" || ! -x "${JAVA_HOME}/bin/java" ]]; then
  for d in "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home" \
           "/Applications/Android Studio.app/Contents/jbr/Contents/Home"; do
    if [[ -x "${d}/bin/java" ]]; then
      export JAVA_HOME="${d}"
      export PATH="${JAVA_HOME}/bin:${PATH}"
      break
    fi
  done
fi

if [[ ! -f "${KS_FILE}" ]]; then
  echo "Missing signing keystore at ${KS_FILE}" >&2
  exit 1
fi

echo "==> [2/4] Compiling & R8-minifying signed Release APK (v${VERSION})..."
(
  KS_PASS="${YJ_KEYSTORE_PASSWORD:-$(tr -d '\r\n' < "${KS_PASS_FILE}")}"
  export YJ_KEYSTORE_FILE="${KS_FILE}"
  export YJ_KEYSTORE_PASSWORD="${KS_PASS}"
  export YJ_KEY_ALIAS="${YJ_KEY_ALIAS:-youjing}"
  export YJ_KEY_PASSWORD="${YJ_KEY_PASSWORD:-${KS_PASS}}"
  cd "${ROOT_DIR}/android"
  ./gradlew assembleRelease --console=plain
)

APK_SRC="${ROOT_DIR}/android/app/build/outputs/apk/release/app-release.apk"
APK_DST="${ROOT_DIR}/data/youjing-calculator-v${VERSION}.apk"
cp "${APK_SRC}" "${APK_DST}"

echo "==> [3/4] Verifying V2+V3 signature & zero static web asset leakage..."
SDK_DIR="${ANDROID_HOME:-/Users/yawen/Library/Android/sdk}"
APKSIGNER="$(ls -1 "${SDK_DIR}"/build-tools/*/apksigner | sort -V | tail -n 1)"
AAPT2="$(ls -1 "${SDK_DIR}"/build-tools/*/aapt2 | sort -V | tail -n 1)"

"${AAPT2}" dump badging "${APK_DST}" | head -n 2
"${APKSIGNER}" verify --verbose --print-certs "${APK_DST}" | grep -E "Verified using v[23] scheme|Signer #1 certificate SHA-256"

if unzip -Z1 "${APK_DST}" | grep -Eq '^assets/|\.js$|\.html$|\.keystore$'; then
  echo "[apk-gate] FAILED: Forbidden static web asset or secret detected inside APK!" >&2
  exit 1
fi

echo "==> [4/4] Signed APK ready:"
ls -lh "${APK_DST}"
shasum -a 256 "${APK_DST}"
