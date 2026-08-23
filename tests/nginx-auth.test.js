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
  path.join(root, "deploy/deploy-employee-information.sh"),
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

test("employee portal exposes a POST logout action", () => {
  assert.match(portalHtml, /<form class="logout-form" method="post" action="\/admin-logout">/);
  assert.match(portalHtml, /name="returnTo" value="\/employee\/portal"/);
  assert.match(portalHtml, /<nav class="topbar" aria-label="员工中心导航">/);
  assert.match(portalHtml, /<span>员工中心<\/span>/);
  assert.match(portalHtml, /id="theme-icon" aria-hidden="true">🌙<\/span>/);
  assert.match(portalHtml, /themeIcon\.textContent = normalizedTheme === "dark" \? "☀️" : "🌙"/);
  assert.match(portalHtml, /window\.localStorage\.setItem\(THEME_STORAGE_KEY, normalizedTheme\)/);
  assert.match(portalHtml, /\.topbar \{[^}]*min-height: 52px;[^}]*border-radius: 13px;/s);
  assert.match(portalHtml, /\.hero \{[^}]*align-content: center;[^}]*min-height: 145px;[^}]*margin: 0 -14px 0;[^}]*padding: 0 48px;/s);
  assert.doesNotMatch(portalHtml, /class="hero-art"/);
});

test("employee deployment leaves the shared Nginx entry to server-infra", () => {
  assert.doesNotMatch(deployScript, /\/etc\/nginx\/sites-(available|enabled)/);
  assert.doesNotMatch(deployScript, /\/etc\/nginx\/snippets/);
  assert.doesNotMatch(deployScript, /\bnginx -t\b/);
  assert.doesNotMatch(deployScript, /systemctl reload nginx/);
});
