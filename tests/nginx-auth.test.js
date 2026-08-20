import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const nginx = fs.readFileSync(
  path.join(root, "deploy/nginx/employee-information.locations.conf"),
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
});
