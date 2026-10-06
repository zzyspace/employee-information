import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const nginx = fs.readFileSync(
  path.join(root, "deploy/nginx/employee-information.locations.conf"),
  "utf8",
);
const deployScript = fs.readFileSync(
  path.join(root, "deploy/release.sh"),
  "utf8",
);
const portalHtml = fs.readFileSync(path.join(root, "public/portal.html"), "utf8");

test("nginx protects employee portal and admin API before the public prefix", () => {
  for (const location of ["/employee/portal", "/employee/portal/"]) {
    const escaped = location.replaceAll("/", "\\/");
    assert.match(nginx, new RegExp(`location = ${escaped} \\{[\\s\\S]*?admin-auth-invoice\\.inc;`));
  }
  assert.match(nginx, /location \^~ \/employee\/api\/admin\/ \{[\s\S]*admin-auth-invoice\.inc;/);
  assert.ok(
    nginx.indexOf("location ^~ /employee/api/admin/") <
      nginx.indexOf("location ^~ /employee/ {"),
  );
});

test("employee portal uses the shared admin top bar with a POST logout back to /staff", () => {
  // The switcher, theme toggle and logout form come from admin-auth-gateway (/auth/accounts/admin-shell.*).
  assert.match(portalHtml, /<nav class="topbar" aria-label="员工中心导航" data-admin-center="staff" data-return-to="\/staff"><\/nav>/);
  const order = ["/auth/accounts/admin-shell.css", "/auth/accounts/admin-theme.js", "<style>", "/auth/accounts/admin-shell.js", "/auth/accounts/user-menu.js", "<nav class=\"topbar\""].map(text => portalHtml.indexOf(text));
  assert.ok(order.every(index => index > 0), "shared shell assets and placeholder are present");
  assert.deepEqual([...order].sort((x, y) => x - y), order, "theme before page styles; admin-shell.js before user-menu.js");
  assert.match(portalHtml, /<script src="\/auth\/accounts\/admin-shell\.js" defer><\/script>/);
  // No local copies left to drift from the shared shell.
  assert.doesNotMatch(portalHtml, /center-switcher|centerSwitcher|theme-toggle|THEME_STORAGE_KEY|employee-portal-theme/);
  assert.doesNotMatch(portalHtml, /\.topbar\s*\{/);
  assert.doesNotMatch(portalHtml, /class="hero-art"/);
});

test("employee deployment leaves the shared Nginx entry to server-infra", () => {
  assert.doesNotMatch(deployScript, /\/etc\/nginx\/sites-(available|enabled)/);
  assert.doesNotMatch(deployScript, /\/etc\/nginx\/snippets/);
  assert.doesNotMatch(deployScript, /\bnginx -t\b/);
  assert.doesNotMatch(deployScript, /systemctl reload nginx/);
});
