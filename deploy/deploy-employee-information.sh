#!/usr/bin/env bash

set -euo pipefail

DEFAULT_SERVER="${EMPLOYEE_INFORMATION_DEPLOY_SERVER:-root@139.196.140.215}"
SERVER="${1:-${DEFAULT_SERVER}}"
APP_DIR="/opt/employee-information/current"
DATA_ROOT="/var/lib/employee-information"
SERVICE_NAME="employee-information.service"
SERVICE_USER="employeeinfo"
SYSTEMD_TARGET="/etc/systemd/system/${SERVICE_NAME}"
NODE_HEALTH="http://127.0.0.1:8789/employee/healthz"
WEB_HEALTH="https://comeover.cn/employee/healthz"
GIT_PROXY_URL="${EMPLOYEE_INFORMATION_GIT_PROXY_URL:-http://127.0.0.1:7890}"
GIT_PULL_TIMEOUT_SECONDS="${EMPLOYEE_INFORMATION_GIT_PULL_TIMEOUT_SECONDS:-60}"

wait_for_http_ok() {
  local label="$1"
  local url="$2"
  local attempt
  for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error "${url}" >/dev/null 2>&1; then
      echo "[deploy] ${label} is healthy"
      return 0
    fi
    sleep 1
  done
  echo "[deploy] ${label} failed: ${url}" >&2
  return 1
}

run_git_pull() {
  local status=0

  HTTPS_PROXY="${GIT_PROXY_URL}" \
  HTTP_PROXY="${GIT_PROXY_URL}" \
  GIT_TERMINAL_PROMPT=0 \
    timeout "${GIT_PULL_TIMEOUT_SECONDS}" \
      git -C "${APP_DIR}" pull --ff-only --progress origin main || status=$?

  if [[ "${status}" -eq 124 ]]; then
    echo "[deploy] Git pull timed out after ${GIT_PULL_TIMEOUT_SECONDS}s via ${GIT_PROXY_URL}" >&2
  elif [[ "${status}" -ne 0 ]]; then
    echo "[deploy] Git pull failed with exit code ${status}" >&2
  fi
  return "${status}"
}

validate_installed_dependency_tree() {
  APP_DIR_ENV="${APP_DIR}" node <<'EOF'
const fs = require("node:fs");
const path = require("node:path");

const appDir = process.env.APP_DIR_ENV;
const lockfile = JSON.parse(
  fs.readFileSync(path.join(appDir, "package-lock.json"), "utf8"),
);

for (const [relativePath, pkg] of Object.entries(lockfile.packages || {})) {
  if (!relativePath || pkg.dev) {
    continue;
  }

  const packageJsonPath = path.join(appDir, relativePath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    if (pkg.optional) {
      continue;
    }
    console.log(`missing ${relativePath}/package.json`);
    process.exit(1);
  }

  const installedPackage = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (installedPackage.version !== pkg.version) {
    console.log(
      `version mismatch for ${relativePath}: expected ${pkg.version}, found ${installedPackage.version}`,
    );
    process.exit(1);
  }
}

try {
  const Database = require(path.join(appDir, "node_modules", "better-sqlite3"));
  const database = new Database(":memory:");
  database.prepare("SELECT 1").get();
  database.close();
} catch (error) {
  console.log(`better-sqlite3 runtime check failed: ${error.message}`);
  process.exit(1);
}
EOF
}

install_dependencies_if_needed() {
  local install_reason tree_validation_output

  if [[ ! -d "${APP_DIR}/node_modules" ]]; then
    install_reason="node_modules is missing"
  elif ! tree_validation_output="$(validate_installed_dependency_tree 2>&1)"; then
    install_reason="${tree_validation_output}"
  fi

  if [[ -z "${install_reason:-}" ]]; then
    echo "[deploy] Skipping npm ci (installed production dependencies match package-lock.json)"
    return
  fi

  echo "[deploy] Installing production dependencies with npm ci (${install_reason})"
  HTTPS_PROXY="${GIT_PROXY_URL}" \
  HTTP_PROXY="${GIT_PROXY_URL}" \
    npm --prefix "${APP_DIR}" ci --omit=dev
}

run_release() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "Run this deployment as root." >&2
    exit 1
  fi
  for cmd in curl git install node npm systemctl timeout useradd; do
    command -v "${cmd}" >/dev/null 2>&1 || { echo "Missing command: ${cmd}" >&2; exit 1; }
  done
  [[ -d "${APP_DIR}/.git" ]] || { echo "Checkout missing: ${APP_DIR}" >&2; exit 1; }

  if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
    useradd --system --home-dir "${DATA_ROOT}" --shell /usr/sbin/nologin "${SERVICE_USER}"
  fi
  install -d -m 700 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${DATA_ROOT}" "${DATA_ROOT}/data" "${DATA_ROOT}/uploads"

  echo "[deploy] Pulling origin/main"
  run_git_pull
  install_dependencies_if_needed
  echo "[deploy] Validating static pages"
  npm --prefix "${APP_DIR}" run build

  install -m 644 "${APP_DIR}/deploy/systemd/employee-information.service" "${SYSTEMD_TARGET}"
  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}" >/dev/null
  systemctl restart "${SERVICE_NAME}"
  echo "[deploy] Shared Nginx entry is managed by server-infra"

  wait_for_http_ok "Node service" "${NODE_HEALTH}"
  wait_for_http_ok "Nginx route" "${WEB_HEALTH}"
  systemctl --no-pager --full status "${SERVICE_NAME}"
}

if [[ "${SERVER}" == "local" || "${SERVER}" == "localhost" ]]; then
  run_release
elif [[ -d "${APP_DIR}/.git" && "${SERVER}" == "${DEFAULT_SERVER}" ]]; then
  run_release
else
  ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=10 "${SERVER}" \
    "$(declare -f wait_for_http_ok); $(declare -f run_git_pull); $(declare -f validate_installed_dependency_tree); $(declare -f install_dependencies_if_needed); $(declare -f run_release); APP_DIR='${APP_DIR}'; DATA_ROOT='${DATA_ROOT}'; SERVICE_NAME='${SERVICE_NAME}'; SERVICE_USER='${SERVICE_USER}'; SYSTEMD_TARGET='${SYSTEMD_TARGET}'; NODE_HEALTH='${NODE_HEALTH}'; WEB_HEALTH='${WEB_HEALTH}'; GIT_PROXY_URL='${GIT_PROXY_URL}'; GIT_PULL_TIMEOUT_SECONDS='${GIT_PULL_TIMEOUT_SECONDS}'; run_release"
fi
