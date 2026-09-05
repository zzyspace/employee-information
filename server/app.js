import { applicationAuth, gatewayAuthConfig, allowedStores, storeAllowed, requirePermission, sessionInfo } from "./authorization.js";
import path from "node:path";

import express from "express";
import multer from "multer";

import {
  AdminOperationError,
  getAdminAttachment,
  getEmployeeSubmissionDetail,
  getEmployeeSubmissionHistory,
  listEmployeeSubmissions,
  restoreEmployeeSubmission,
  softDeleteEmployeeSubmission,
  updateEmployeeSubmission,
} from "./admin.js";
import { createAdminAuthMiddleware, setPrivateResponseHeaders } from "./auth.js";
import {
  MAX_FILE_BYTES,
  MAX_UPLOAD_FILES,
  adminPassword,
  adminUsername,
  dbFilePath,
  dbInitSqlPath,
  idCardModelApiKey,
  idCardModelBaseUrl,
  idCardModelName,
  idCardModelProvider,
  idCardModelProxyUrl,
  idCardModelTimeoutMs,
  pdfJsBuildDir,
  publicDir,
  uploadsRoot,
} from "./config.js";
import { createDatabase } from "./database.js";
import { UploadValidationError, normalizeUploadOriginalName } from "./file-storage.js";
import {
  IdentityCardRecognitionError,
  createIdentityCardRecognizer,
} from "./identity-card-recognizer.js";
import {
  ALLOWED_STORE_KEYS,
  SubmissionValidationError,
  createEmployeeSubmission,
} from "./submissions.js";

const PUBLIC_BASE_PATH = "/staff";
const LEGACY_BASE_PATH = "/employee";
const STORE_ROUTE_SLUGS = new Map([
  ["fuzzy", "fuzzy"],
  ["fuzzy_qz", "fuzzy-qz"],
  ["peanut", "peanut"],
]);
const uploadFields = [
  { name: "idCardFront", maxCount: 1 },
  { name: "idCardBack", maxCount: 1 },
  { name: "healthCertificate", maxCount: 1 },
];

function createUploadMiddleware() {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      // Busboy marks a file as limited when it reaches the configured byte count,
      // so leave one byte for the application validator to allow exactly 20MB.
      fileSize: MAX_FILE_BYTES + 1,
      files: MAX_UPLOAD_FILES,
      fields: 10,
      parts: 15,
    },
  });
}

function sendNotFound(_request, response) {
  response.status(404).type("text/plain; charset=utf-8").send("Not found");
}

function safeDownloadName(name) {
  return normalizeUploadOriginalName(name)
    .replace(/[\r\n]/g, " ")
    .replace(/["\\]/g, "-");
}

export function createApp({
  db = createDatabase({ dbFilePath, dbInitSqlPath }),
  upload = createUploadMiddleware(),
  staticDir = publicDir,
  uploadDirectory = uploadsRoot,
  adminCredentials = { username: adminUsername, password: adminPassword },
  gatewayAuth = gatewayAuthConfig(),
  identityCardRecognizer = createIdentityCardRecognizer({
    baseUrl: idCardModelBaseUrl,
    apiKey: idCardModelApiKey,
    model: idCardModelName,
    provider: idCardModelProvider,
    proxyUrl: idCardModelProxyUrl,
    timeoutMs: idCardModelTimeoutMs,
  }),
} = {}) {
  const app = express();
  const adminAuth = applicationAuth(createAdminAuthMiddleware(adminCredentials), gatewayAuth);
  const parseEmployeeFiles = upload.fields(uploadFields);

  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  const checkRecord = (request, response, next) => {
    const record = db.prepare("SELECT store_key FROM employee_submissions WHERE id = ?").get(request.params.id);
    if (!record || !storeAllowed(response, record.store_key)) return response.status(404).json({ success: false, error: { message: "员工记录不存在。" } });
    next();
  };

  app.get(["/health/staff", `${PUBLIC_BASE_PATH}/healthz`, `${LEGACY_BASE_PATH}/healthz`], (_request, response) => {
    response.status(200).json({ ok: true });
  });

  app.get([
    `${PUBLIC_BASE_PATH}/assets/finance-wechat-qr.png`,
    `${LEGACY_BASE_PATH}/assets/finance-wechat-qr.png`,
  ], (_request, response) => {
    response
      .set("Cache-Control", "public, max-age=3600")
      .set("X-Content-Type-Options", "nosniff")
      .sendFile(path.join(staticDir, "assets", "finance-wechat-qr.png"));
  });

  for (const assetName of ["pdf.min.mjs", "pdf.worker.min.mjs"]) {
    app.get([
      `${PUBLIC_BASE_PATH}/assets/pdfjs/${assetName}`,
      `${LEGACY_BASE_PATH}/assets/pdfjs/${assetName}`,
    ], (_request, response) => {
      response
        .set("Cache-Control", "public, max-age=604800")
        .set("X-Content-Type-Options", "nosniff")
        .type("text/javascript; charset=utf-8")
        .sendFile(path.join(pdfJsBuildDir, assetName));
    });
  }

  for (const storeKey of ALLOWED_STORE_KEYS) {
    const routeSlug = STORE_ROUTE_SLUGS.get(storeKey);
    app.get(
      [`${PUBLIC_BASE_PATH}/${routeSlug}`, `${PUBLIC_BASE_PATH}/${routeSlug}/`],
      (_request, response) => response.sendFile(path.join(staticDir, "index.html"))
    );
    app.get(
      [`${LEGACY_BASE_PATH}/${storeKey}`, `${LEGACY_BASE_PATH}/${storeKey}/`],
      (_request, response) => response.sendFile(path.join(staticDir, "index.html"))
    );
  }

  app.post([
    `${PUBLIC_BASE_PATH}/api/submissions/:storeKey`,
    `${LEGACY_BASE_PATH}/api/submissions/:storeKey`,
  ], parseEmployeeFiles, async (request, response, next) => {
    try {
      const storeKey = request.params.storeKey === "fuzzy-qz"
        ? "fuzzy_qz"
        : request.params.storeKey;
      const result = await createEmployeeSubmission({
        body: request.body,
        files: request.files,
        storeKey,
        db,
        uploadsRoot: uploadDirectory,
        identityCardRecognizer,
      });
      response.status(201).json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  app.get([PUBLIC_BASE_PATH, `${PUBLIC_BASE_PATH}/`], adminAuth, requirePermission("employee:view"), (_request, response) => {
    response.sendFile(path.join(staticDir, "portal.html"));
  });

  app.get([`${LEGACY_BASE_PATH}/portal`, `${LEGACY_BASE_PATH}/portal/`], adminAuth, requirePermission("employee:view"), (_request, response) => {
    response.sendFile(path.join(staticDir, "portal.html"));
  });

  app.use([`${PUBLIC_BASE_PATH}/api/admin`, `${LEGACY_BASE_PATH}/api/admin`], adminAuth);

  app.get([`${PUBLIC_BASE_PATH}/api/admin/session`, `${LEGACY_BASE_PATH}/api/admin/session`],
    (_request, response) => response.json(sessionInfo(response)));

  app.get([
    `${PUBLIC_BASE_PATH}/api/admin/submissions`,
    `${LEGACY_BASE_PATH}/api/admin/submissions`,
  ], requirePermission("employee:view"), (request, response, next) => {
    try {
      response.status(200).json({
        success: true,
        ...listEmployeeSubmissions(db, request.query, allowedStores(response)),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get([
    `${PUBLIC_BASE_PATH}/api/admin/submissions/:id`,
    `${LEGACY_BASE_PATH}/api/admin/submissions/:id`,
  ], requirePermission("employee:view"), checkRecord, (request, response, next) => {
    try {
      const item = getEmployeeSubmissionDetail(db, request.params.id);
      if (!item) {
        throw new AdminOperationError("员工记录不存在。", { statusCode: 404 });
      }
      response.status(200).json({ success: true, item });
    } catch (error) {
      next(error);
    }
  });

  app.get([
    `${PUBLIC_BASE_PATH}/api/admin/submissions/:id/history`,
    `${LEGACY_BASE_PATH}/api/admin/submissions/:id/history`,
  ], requirePermission("employee:view"), checkRecord, (request, response, next) => {
    try {
      const items = getEmployeeSubmissionHistory(db, request.params.id, allowedStores(response));
      if (!items) {
        throw new AdminOperationError("员工记录不存在。", { statusCode: 404 });
      }
      response.status(200).json({ success: true, items });
    } catch (error) {
      next(error);
    }
  });

  app.get([
    `${PUBLIC_BASE_PATH}/api/admin/attachments/:attachmentVersionId`,
    `${LEGACY_BASE_PATH}/api/admin/attachments/:attachmentVersionId`,
  ], requirePermission("attachment:view"), (request, response, next) => {
    try {
      const attachment = getAdminAttachment(db, request.params.attachmentVersionId, allowedStores(response));
      if (!attachment) {
        throw new AdminOperationError("附件不存在或文件已丢失。", { statusCode: 404 });
      }
      setPrivateResponseHeaders(response);
      response.type(attachment.content_type);
      response.set(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(safeDownloadName(attachment.original_name))}`
      );
      response.sendFile(attachment.storage_path);
    } catch (error) {
      next(error);
    }
  });

  app.patch([
    `${PUBLIC_BASE_PATH}/api/admin/submissions/:id`,
    `${LEGACY_BASE_PATH}/api/admin/submissions/:id`,
  ], requirePermission("employee:edit"), checkRecord, parseEmployeeFiles, async (request, response, next) => {
    try {
      const item = await updateEmployeeSubmission({
        db,
        submissionId: request.params.id,
        body: request.body,
        files: request.files,
        uploadsRoot: uploadDirectory,
        actorUsername: request.adminUsername,
        allowedStores: allowedStores(response),
      });
      response.status(200).json({ success: true, item });
    } catch (error) {
      next(error);
    }
  });

  app.delete([
    `${PUBLIC_BASE_PATH}/api/admin/submissions/:id`,
    `${LEGACY_BASE_PATH}/api/admin/submissions/:id`,
  ], requirePermission("employee:delete"), checkRecord, (request, response, next) => {
    try {
      const item = softDeleteEmployeeSubmission({
        db,
        submissionId: request.params.id,
        actorUsername: request.adminUsername,
        now: new Date(),
      });
      response.status(200).json({ success: true, item });
    } catch (error) {
      next(error);
    }
  });

  app.post([
    `${PUBLIC_BASE_PATH}/api/admin/submissions/:id/restore`,
    `${LEGACY_BASE_PATH}/api/admin/submissions/:id/restore`,
  ], requirePermission("employee:restore"), checkRecord, (request, response, next) => {
    try {
      const item = restoreEmployeeSubmission({
        db,
        submissionId: request.params.id,
        actorUsername: request.adminUsername,
        now: new Date(),
      });
      response.status(200).json({ success: true, item });
    } catch (error) {
      next(error);
    }
  });

  app.use(sendNotFound);

  app.use((error, _request, response, _next) => {
    if (
      error instanceof SubmissionValidationError ||
      error instanceof UploadValidationError ||
      error instanceof AdminOperationError ||
      error instanceof IdentityCardRecognitionError
    ) {
      response.status(error.statusCode || 400).json({
        success: false,
        error: { field: error.field || undefined, message: error.message },
      });
      return;
    }

    if (error instanceof multer.MulterError) {
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? "每个文件大小不能超过 20MB。"
          : error.code === "LIMIT_FILE_COUNT"
            ? "一次最多上传三个文件。"
            : error.code === "LIMIT_UNEXPECTED_FILE"
              ? "上传字段或文件数量无效。"
              : "上传内容无效。";
      response.status(400).json({
        success: false,
        error: { field: error.field || undefined, message },
      });
      return;
    }

    console.error("Unexpected employee-information error:", error);
    response.status(500).json({
      success: false,
      error: { message: "操作失败，请稍后重试。" },
    });
  });

  return app;
}

export { LEGACY_BASE_PATH, PUBLIC_BASE_PATH };
