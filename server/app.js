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
  publicDir,
  uploadsRoot,
} from "./config.js";
import { createDatabase } from "./database.js";
import { UploadValidationError } from "./file-storage.js";
import {
  IdentityCardRecognitionError,
  createIdentityCardRecognizer,
} from "./identity-card-recognizer.js";
import {
  ALLOWED_STORE_KEYS,
  SubmissionValidationError,
  createEmployeeSubmission,
} from "./submissions.js";

const PUBLIC_BASE_PATH = "/employee";
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
  return String(name || "attachment")
    .replace(/[\r\n]/g, " ")
    .replace(/["\\]/g, "-");
}

export function createApp({
  db = createDatabase({ dbFilePath, dbInitSqlPath }),
  upload = createUploadMiddleware(),
  staticDir = publicDir,
  uploadDirectory = uploadsRoot,
  adminCredentials = { username: adminUsername, password: adminPassword },
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
  const adminAuth = createAdminAuthMiddleware(adminCredentials);
  const parseEmployeeFiles = upload.fields(uploadFields);

  app.disable("x-powered-by");

  app.get(`${PUBLIC_BASE_PATH}/healthz`, (_request, response) => {
    response.status(200).json({ ok: true });
  });

  app.get(`${PUBLIC_BASE_PATH}/assets/finance-wechat-qr.png`, (_request, response) => {
    response
      .set("Cache-Control", "public, max-age=3600")
      .set("X-Content-Type-Options", "nosniff")
      .sendFile(path.join(staticDir, "assets", "finance-wechat-qr.png"));
  });

  for (const storeKey of ALLOWED_STORE_KEYS) {
    app.get(
      [`${PUBLIC_BASE_PATH}/${storeKey}`, `${PUBLIC_BASE_PATH}/${storeKey}/`],
      (_request, response) => response.sendFile(path.join(staticDir, "index.html"))
    );
  }

  app.post(`${PUBLIC_BASE_PATH}/api/submissions/:storeKey`, parseEmployeeFiles, async (request, response, next) => {
    try {
      const result = await createEmployeeSubmission({
        body: request.body,
        files: request.files,
        storeKey: request.params.storeKey,
        db,
        uploadsRoot: uploadDirectory,
        identityCardRecognizer,
      });
      response.status(201).json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  app.get([`${PUBLIC_BASE_PATH}/portal`, `${PUBLIC_BASE_PATH}/portal/`], adminAuth, (_request, response) => {
    response.sendFile(path.join(staticDir, "portal.html"));
  });

  app.use(`${PUBLIC_BASE_PATH}/api/admin`, adminAuth);

  app.get(`${PUBLIC_BASE_PATH}/api/admin/submissions`, (request, response, next) => {
    try {
      response.status(200).json({
        success: true,
        ...listEmployeeSubmissions(db, request.query),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get(`${PUBLIC_BASE_PATH}/api/admin/submissions/:id`, (request, response, next) => {
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

  app.get(`${PUBLIC_BASE_PATH}/api/admin/submissions/:id/history`, (request, response, next) => {
    try {
      const items = getEmployeeSubmissionHistory(db, request.params.id);
      if (!items) {
        throw new AdminOperationError("员工记录不存在。", { statusCode: 404 });
      }
      response.status(200).json({ success: true, items });
    } catch (error) {
      next(error);
    }
  });

  app.get(`${PUBLIC_BASE_PATH}/api/admin/attachments/:attachmentVersionId`, (request, response, next) => {
    try {
      const attachment = getAdminAttachment(db, request.params.attachmentVersionId);
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

  app.patch(`${PUBLIC_BASE_PATH}/api/admin/submissions/:id`, parseEmployeeFiles, async (request, response, next) => {
    try {
      const item = await updateEmployeeSubmission({
        db,
        submissionId: request.params.id,
        body: request.body,
        files: request.files,
        uploadsRoot: uploadDirectory,
        actorUsername: request.adminUsername,
      });
      response.status(200).json({ success: true, item });
    } catch (error) {
      next(error);
    }
  });

  app.delete(`${PUBLIC_BASE_PATH}/api/admin/submissions/:id`, (request, response, next) => {
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

  app.post(`${PUBLIC_BASE_PATH}/api/admin/submissions/:id/restore`, (request, response, next) => {
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

export { PUBLIC_BASE_PATH };
