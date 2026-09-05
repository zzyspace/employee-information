import { gatewayAuthConfig, createGatewayAuth } from "./gateway-auth.js";
export { gatewayAuthConfig };
const STORES = ["fuzzy", "fuzzy_qz", "peanut"];
const PERMISSIONS = ["employee:view", "attachment:view", "employee:edit", "employee:delete", "employee:restore"];
export function validateAuthorization(data) {
  const { access } = data;
  const config = access.config;
  const scope = config?.viewScope;
  if (!Array.isArray(access.permissions) || access.permissions.some((value) => !PERMISSIONS.includes(value)) ||
      !config || Object.keys(config).some((key) => key !== "viewScope") || !scope ||
      Object.keys(scope).some((key) => !["stores", "ownership"].includes(key)) || scope.ownership !== "any" ||
      !(scope.stores === "all" || (Array.isArray(scope.stores) && scope.stores.every((store) => STORES.includes(store))))) {
    throw new Error("Unsupported application authorization.");
  }
  return data;
}
export function applicationAuth(legacyAuth, config) {
  // Validate injected settings too; a typo must not silently select legacy mode.
  config = gatewayAuthConfig({ ADMIN_AUTH_MODE: config.mode, ADMIN_AUTH_GATEWAY_URL: config.url, ADMIN_AUTH_INTERNAL_TOKEN: config.token });
  return config.mode === "unified" ? createGatewayAuth({ app: "staff", config, validate: validateAuthorization }) : legacyAuth;
}
export function allowedStores(response) {
  const scope = response.locals.gatewayAuthorization?.access.config.viewScope;
  return scope && scope.stores !== "all" ? scope.stores : undefined;
}
export function storeAllowed(response, store) {
  const stores = allowedStores(response);
  return stores === undefined || stores.includes(store);
}
export function requirePermission(permission) {
  return (_request, response, next) => {
    const auth = response.locals.gatewayAuthorization;
    if (!auth || auth.access.permissions.includes(permission)) return next();
    response.status(403).json({ success: false, error: { message: "当前账号无权执行此操作。" } });
  };
}
export function sessionInfo(response) {
  const auth = response.locals.gatewayAuthorization;
  return { success: true, permissions: auth?.access.permissions ?? PERMISSIONS,
    stores: auth?.access.config.viewScope.stores ?? "all" };
}
