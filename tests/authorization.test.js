import assert from "node:assert/strict";
import test from "node:test";
import { validateAuthorization, gatewayAuthConfig } from "../server/authorization.js";
const data = { access: { permissions: ['employee:view'], config: { viewScope: { ownership: "any", stores: ["fuzzy"] } } } };
test("application authorization rejects unknown permissions, scopes and unsupported ownership", () => {
  assert.deepEqual(validateAuthorization(data), data);
  for (const access of [
    { ...data.access, permissions: ["other:admin"] },
    { ...data.access, config: { viewScope: { ownership: "self", stores: "all" } } },
    { ...data.access, config: { viewScope: { ownership: "any", stores: ["unknown"] } } },
    { ...data.access, config: { viewScope: { ownership: "any", stores: "all", override: true } } },
  ]) assert.throws(() => validateAuthorization({ access }), /Unsupported/);
});
test("unified transport accepts only loopback HTTP and an explicit internal secret", () => {
  assert.equal(gatewayAuthConfig({}).mode, "legacy");
  assert.throws(() => gatewayAuthConfig({ ADMIN_AUTH_MODE: "unifed" }), /ADMIN_AUTH_MODE/);
  const env = { ADMIN_AUTH_MODE: "unified", ADMIN_AUTH_INTERNAL_TOKEN: "fixture-secret-00000000000000000000001" };
  assert.equal(gatewayAuthConfig(env).mode, "unified");
  for (const url of ["http://example.test", "http://127.0.0.1/path", "http://secret@127.0.0.1", "https://127.0.0.1", "http://127.0.0.1?x=1"]) {
    assert.throws(() => gatewayAuthConfig({ ...env, ADMIN_AUTH_GATEWAY_URL: url }), /Invalid/);
  }
});
