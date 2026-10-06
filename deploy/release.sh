# Release hooks for comeover/scripts/deploy-release.sh (sourced as root on the server).
# Shared Nginx entry is managed by server-infra. The server reaches the npm
# registry through a local proxy, used only if dependencies must be reinstalled.
SERVICES=(employee-information.service)
UNIT_FILES=(deploy/systemd/employee-information.service)
HEALTH_URL=http://127.0.0.1:8789/health/staff
EMPLOYEE_INFORMATION_PROXY_URL=${EMPLOYEE_INFORMATION_PROXY_URL:-http://127.0.0.1:7890}

release_prepare() {
  if ! id employeeinfo >/dev/null 2>&1; then
    useradd --system --home-dir /var/lib/employee-information --shell /usr/sbin/nologin employeeinfo
  fi
  install -d -m 700 -o employeeinfo -g employeeinfo \
    /var/lib/employee-information /var/lib/employee-information/data /var/lib/employee-information/uploads
  HTTPS_PROXY=$EMPLOYEE_INFORMATION_PROXY_URL HTTP_PROXY=$EMPLOYEE_INFORMATION_PROXY_URL install_node_modules
  node -e 'const Database=require("./node_modules/better-sqlite3");const db=new Database(":memory:");db.prepare("SELECT 1").get();db.close()'
  npm run build
}

release_test() {
  run_isolated node --test tests/*.test.js
}

release_verify() {
  expect_status https://comeover.cn/health/staff 200
  expect_status https://comeover.cn/staff 303
}
