import { timingSafeEqual } from "node:crypto";

function hasValue(value) {
  return typeof value === "string" && value.length > 0;
}

function secureCompare(left, right) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseBasicAuthHeader(header) {
  if (typeof header !== "string" || !header.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex === -1) return null;
    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

export function setPrivateResponseHeaders(response) {
  response.set("Cache-Control", "no-store");
  response.set("X-Content-Type-Options", "nosniff");
}

function sendAuthError(request, response, statusCode, message, headers = {}) {
  setPrivateResponseHeaders(response);
  response.set(headers);
  if (request.originalUrl.includes("/api/")) {
    response.status(statusCode).json({ success: false, error: { message } });
    return;
  }
  response.status(statusCode).type("text/plain; charset=utf-8").send(message);
}

export function createAdminAuthMiddleware({
  username,
  password,
  realm = "Employee Information Admin",
} = {}) {
  const isConfigured = hasValue(username) && hasValue(password);
  return (request, response, next) => {
    if (!isConfigured) {
      sendAuthError(request, response, 503, "员工信息后台尚未配置账号密码。");
      return;
    }

    const credentials = parseBasicAuthHeader(request.headers.authorization);
    if (
      !credentials ||
      !secureCompare(credentials.username, username) ||
      !secureCompare(credentials.password, password)
    ) {
      sendAuthError(request, response, 401, "需要管理员身份验证。", {
        "WWW-Authenticate": `Basic realm="${realm}", charset="UTF-8"`,
      });
      return;
    }

    request.adminUsername = credentials.username;
    setPrivateResponseHeaders(response);
    next();
  };
}
