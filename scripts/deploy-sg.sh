#!/usr/bin/env bash
set -euo pipefail

SSH_HOST="${SSH_HOST:-sg}"
APP_ROOT="/opt/youjing-calculator"
SERVICE_NAME="youjing-calculator.service"
LOCAL_PORT="18768"

if [[ "${1:-}" == "--rollback" ]]; then
  echo "==> Rolling back ${SERVICE_NAME} on ${SSH_HOST} to previous release..."
  ssh "${SSH_HOST}" bash -s <<EOF
set -euo pipefail
CUR=\$(readlink -f "${APP_ROOT}/current" || true)
PREV=\$(ls -1dt "${APP_ROOT}/releases/"* 2>/dev/null | grep -v "^\${CUR}\$" | head -n 1 || true)
if [[ -z "\${PREV}" ]]; then
  echo "No previous release found to roll back to!" >&2
  exit 1
fi
ln -sfn "\${PREV}" "${APP_ROOT}/current"
systemctl restart "${SERVICE_NAME}"
sleep 1
curl -fsS "http://127.0.0.1:${LOCAL_PORT}/api/health"
echo ""
echo "Rolled back successfully to: \${PREV}"
EOF
  exit 0
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT_DIR}"

echo "==> [1/5] Running TDD seam tests, TypeScript check & Vite production build..."
pnpm test
pnpm run build

TS="$(date -u +%Y%m%dT%H%M%SZ)"
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "${STAGE_DIR}"' EXIT

cp -R dist "${STAGE_DIR}/dist"
mkdir -p "${STAGE_DIR}/server"
cp server/index.mjs "${STAGE_DIR}/server/index.mjs"
cp server/xiaogaoCore.mjs "${STAGE_DIR}/server/xiaogaoCore.mjs"
cp package.json "${STAGE_DIR}/package.json"

echo "==> [2/5] Fetching fresh China Sports Lottery snapshot seed (if reachable)..."
SNAP_TMP="${STAGE_DIR}/sporttery-snapshot.json"
if curl -fsSL -m 8 "https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c" -o "${SNAP_TMP}" 2>/dev/null; then
  echo "    Live snapshot captured ($(wc -c < "${SNAP_TMP}" | tr -d ' ') bytes)."
else
  rm -f "${SNAP_TMP}"
  echo "    Skipped local snapshot seed (will keep server existing cache)."
fi

echo "==> [3/5] Uploading release ${TS} to ${SSH_HOST}:${APP_ROOT}/releases/${TS}..."
ssh "${SSH_HOST}" "mkdir -p '${APP_ROOT}/releases/${TS}' '${APP_ROOT}/data'"
tar -C "${STAGE_DIR}" -czf - dist server package.json | ssh "${SSH_HOST}" "tar -C '${APP_ROOT}/releases/${TS}' -xzf -"

if [[ -f "${SNAP_TMP}" ]]; then
  scp -q "${SNAP_TMP}" "${SSH_HOST}:${APP_ROOT}/data/sporttery-snapshot.json"
fi

echo "==> [4/5] Switching current symlink & restarting ${SERVICE_NAME}..."
ssh "${SSH_HOST}" bash -s <<EOF
set -euo pipefail
ln -sfn "${APP_ROOT}/releases/${TS}" "${APP_ROOT}/current"
systemctl daemon-reload
systemctl restart "${SERVICE_NAME}"
# Retain latest 5 releases for quick rollback
ls -1dt "${APP_ROOT}/releases/"* | tail -n +6 | xargs -r rm -rf
EOF

echo "==> [5/5] Verifying service health on ${SSH_HOST} (127.0.0.1:${LOCAL_PORT})..."
ssh "${SSH_HOST}" "sleep 1 && curl -fsS http://127.0.0.1:${LOCAL_PORT}/api/health && echo '' && curl -fsS http://127.0.0.1:${LOCAL_PORT}/api/xiaogao/status && echo ''"
echo "✅ Release ${TS} deployed cleanly!"
