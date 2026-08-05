import {
  cleanupUncommittedAttachments,
  writeAttachmentVersion,
} from "./file-storage.js";
import { insertAttachmentVersion, insertRevision } from "./repository.js";

export const ALLOWED_STORE_KEYS = new Set(["fuzzy", "fuzzy_qz", "peanut"]);
export const ALLOWED_POSITIONS = new Set(["front_of_house", "back_of_house"]);
const PHONE_PATTERN = /^1[3-9]\d{9}$/;

export class SubmissionValidationError extends Error {
  constructor(message, field = null, statusCode = 400) {
    super(message);
    this.name = "SubmissionValidationError";
    this.field = field;
    this.statusCode = statusCode;
  }
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeEmployeePayload(body = {}, storeKey = "") {
  return {
    name: normalizeString(body.name),
    phone: normalizeString(body.phone),
    position: normalizeString(body.position),
    storeKey: normalizeString(storeKey || body.storeKey || body.store_key),
  };
}

export function validateEmployeePayload(payload) {
  if (!payload.name) {
    throw new SubmissionValidationError("请填写姓名。", "name");
  }
  if (payload.name.length > 50) {
    throw new SubmissionValidationError("姓名长度不能超过 50 个字符。", "name");
  }
  if (!PHONE_PATTERN.test(payload.phone)) {
    throw new SubmissionValidationError("请输入有效的中国大陆 11 位手机号。", "phone");
  }
  if (!ALLOWED_POSITIONS.has(payload.position)) {
    throw new SubmissionValidationError("请选择岗位。", "position");
  }
  if (!ALLOWED_STORE_KEYS.has(payload.storeKey)) {
    throw new SubmissionValidationError("门店链接无效，请使用门店提供的专属链接。", "storeKey");
  }
  return payload;
}

export function getSingleUploadedFile(files, fieldName) {
  const entries = files && files[fieldName];
  return Array.isArray(entries) ? entries[0] || null : null;
}

export async function createEmployeeSubmission({
  body,
  files,
  storeKey,
  db,
  uploadsRoot,
  now = new Date(),
  generateId = () => crypto.randomUUID(),
}) {
  const payload = validateEmployeePayload(normalizeEmployeePayload(body, storeKey));
  const idCardFront = getSingleUploadedFile(files, "idCardFront");
  const idCardBack = getSingleUploadedFile(files, "idCardBack");
  const healthCertificate = getSingleUploadedFile(files, "healthCertificate");

  if (!idCardFront) {
    throw new SubmissionValidationError("请上传身份证正面。", "idCardFront");
  }
  if (!idCardBack) {
    throw new SubmissionValidationError("请上传身份证反面。", "idCardBack");
  }

  const submissionId = generateId();
  const createdAt = now.toISOString();
  const pendingAttachments = [];

  try {
    pendingAttachments.push(
      await writeAttachmentVersion({
        file: idCardFront,
        field: "idCardFront",
        kind: "id_card_front",
        submissionId,
        uploadsRoot,
        now,
        generateId,
      })
    );
    pendingAttachments.push(
      await writeAttachmentVersion({
        file: idCardBack,
        field: "idCardBack",
        kind: "id_card_back",
        submissionId,
        uploadsRoot,
        now,
        generateId,
      })
    );
    if (healthCertificate) {
      pendingAttachments.push(
        await writeAttachmentVersion({
          file: healthCertificate,
          field: "healthCertificate",
          kind: "health_certificate",
          submissionId,
          uploadsRoot,
          now,
          generateId,
        })
      );
    }

    const byKind = Object.fromEntries(
      pendingAttachments.map((attachment) => [attachment.kind, attachment])
    );

    db.transaction(() => {
      db.prepare(
        `INSERT INTO employee_submissions (
          id, name, phone, position, store_key, current_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(
        submissionId,
        payload.name,
        payload.phone,
        payload.position,
        payload.storeKey,
        createdAt,
        createdAt
      );

      for (const attachment of pendingAttachments) {
        insertAttachmentVersion(db, attachment);
      }

      db.prepare(
        `UPDATE employee_submissions
        SET
          current_id_card_front_attachment_id = ?,
          current_id_card_back_attachment_id = ?,
          current_health_certificate_attachment_id = ?,
          current_version = 1
        WHERE id = ?`
      ).run(
        byKind.id_card_front.attachmentVersionId,
        byKind.id_card_back.attachmentVersionId,
        byKind.health_certificate?.attachmentVersionId || null,
        submissionId
      );

      insertRevision(db, {
        submissionId,
        version: 1,
        action: "created",
        ...payload,
        idCardFrontAttachmentId: byKind.id_card_front.attachmentVersionId,
        idCardBackAttachmentId: byKind.id_card_back.attachmentVersionId,
        healthCertificateAttachmentId: byKind.health_certificate?.attachmentVersionId || null,
        changedAt: createdAt,
        actorUsername: null,
      });
    })();
  } catch (error) {
    await cleanupUncommittedAttachments(pendingAttachments);
    throw error;
  }

  return { id: submissionId, createdAt, version: 1 };
}
