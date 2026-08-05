#!/usr/bin/env bash

set -euo pipefail

DEFAULT_SERVER="${EMPLOYEE_INFORMATION_DEPLOY_SERVER:-root@139.196.140.215}"
SERVER="${1:-${DEFAULT_SERVER}}"
APP_DIR="/opt/employee-information/current"
DATA_ROOT="/var/lib/employee-information"
SERVICE_NAME="employee-information.service"
SERVICE_USER="employeeinfo"
SYSTEMD_TARGET="/etc/systemd/system/${SERVICE_NAME}"
NGINX_SITE="/etc/nginx/sites-available/invoice-submit"
NGINX_SNIPPET="/etc/nginx/snippets/employee-information.locations.conf"
NGINX_INCLUDE_LINE="  include ${NGINX_SNIPPET};"
NODE_HEALTH="http://127.0.0.1:8789/employee/healthz"
WEB_HEALTH="http://127.0.0.1:8080/employee/healthz"

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

ensure_nginx_include() {
  local site_path="$1"
  local include_line="$2"
  local rendered_path
  if grep -Fqx "${include_line}" "${site_path}"; then
    return 0
  fi
  rendered_path="$(mktemp /tmp/employee-information-nginx.XXXXXX)"
  awk -v include_line="${include_line}" '
    { lines[NR] = $0; if ($0 ~ /^[[:space:]]*}[[:space:]]*$/) last_brace = NR }
    END {
      if (!last_brace) exit 1
      for (i = 1; i <= NR; i++) {
        if (i == last_brace) print include_line
        print lines[i]
      }
    }
  ' "${site_path}" > "${rendered_path}" || {
    rm -f "${rendered_path}"
    echo "Unable to add snippet include to ${site_path}" >&2
    exit 1
  }
  install -m 644 -o root -g root "${rendered_path}" "${site_path}"
  rm -f "${rendered_path}"
}

run_release() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "Run this deployment as root." >&2
    exit 1
  fi
  for cmd in awk curl git install nginx node npm systemctl useradd; do
    command -v "${cmd}" >/dev/null 2>&1 || { echo "Missing command: ${cmd}" >&2; exit 1; }
  done
  [[ -d "${APP_DIR}/.git" ]] || { echo "Checkout missing: ${APP_DIR}" >&2; exit 1; }
  [[ -f "${NGINX_SITE}" ]] || { echo "Nginx site missing: ${NGINX_SITE}" >&2; exit 1; }

  if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
    useradd --system --home-dir "${DATA_ROOT}" --shell /usr/sbin/nologin "${SERVICE_USER}"
  fi
  install -d -m 700 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${DATA_ROOT}" "${DATA_ROOT}/data" "${DATA_ROOT}/uploads"
  install -d -m 755 /etc/nginx/snippets

  echo "[deploy] Pulling origin/main"
  GIT_TERMINAL_PROMPT=0 git -C "${APP_DIR}" pull --ff-only origin main
  echo "[deploy] Installing dependencies and validating static pages"
  npm --prefix "${APP_DIR}" ci --omit=dev
  npm --prefix "${APP_DIR}" run build

  install -m 644 "${APP_DIR}/deploy/systemd/employee-information.service" "${SYSTEMD_TARGET}"
  install -m 644 "${APP_DIR}/deploy/nginx/employee-information.locations.conf" "${NGINX_SNIPPET}"
  ensure_nginx_include "${NGINX_SITE}" "${NGINX_INCLUDE_LINE}"

  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}" >/dev/null
  nginx -t
  systemctl restart "${SERVICE_NAME}"
  systemctl reload nginx

  wait_for_http_ok "Node service" "${NODE_HEALTH}"
  wait_for_http_ok "Nginx route" "${WEB_HEALTH}"
  systemctl --no-pager --full status "${SERVICE_NAME}"
}

if [[ "${SERVER}" == "local" || "${SERVER}" == "localhost" ]]; then
  run_release
else
  ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=10 "${SERVER}" \
    "$(declare -f wait_for_http_ok); $(declare -f ensure_nginx_include); $(declare -f run_release); APP_DIR='${APP_DIR}'; DATA_ROOT='${DATA_ROOT}'; SERVICE_NAME='${SERVICE_NAME}'; SERVICE_USER='${SERVICE_USER}'; SYSTEMD_TARGET='${SYSTEMD_TARGET}'; NGINX_SITE='${NGINX_SITE}'; NGINX_SNIPPET='${NGINX_SNIPPET}'; NGINX_INCLUDE_LINE='${NGINX_INCLUDE_LINE}'; NODE_HEALTH='${NODE_HEALTH}'; WEB_HEALTH='${WEB_HEALTH}'; run_release"
fi
