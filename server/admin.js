import fs from "node:fs";

import {
  cleanupUncommittedAttachments,
  writeAttachmentVersion,
} from "./file-storage.js";
import {
  getAttachmentRow,
  getSubmissionRow,
  insertAttachmentVersion,
  insertRevision,
  serializeAttachment,
  serializeSubmission,
} from "./repository.js";
import {
  ALLOWED_STORE_KEYS,
  getSingleUploadedFile,
  normalizeEmployeePayload,
  validateEmployeePayload,
} from "./submissions.js";

export class AdminOperationError extends Error {
  constructor(message, { field = null, statusCode = 400 } = {}) {
    super(message);
    this.name = "AdminOperationError";
    this.field = field;
    this.statusCode = statusCode;
  }
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeLikePattern(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export function normalizeAdminListQuery(query = {}) {
  const search = normalizeString(query.search);
  const requestedStoreKey = normalizeString(query.storeKey ?? query.store_key);
  const storeKey = requestedStoreKey === "all" ? "" : requestedStoreKey;
  const status = normalizeString(query.status) || "active";

  if (storeKey && !ALLOWED_STORE_KEYS.has(storeKey)) {
    throw new AdminOperationError("门店筛选参数无效。", { field: "storeKey" });
  }
  if (!["active", "deleted", "all"].includes(status)) {
    throw new AdminOperationError("状态筛选参数无效。", { field: "status" });
  }

  const parsedLimit = Number.parseInt(String(query.limit ?? "50"), 10);
  const parsedOffset = Number.parseInt(String(query.offset ?? "0"), 10);
  return {
    search,
    storeKey,
    status,
    limit: Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50,
    offset: Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0,
  };
}

function buildListWhereClause({ search, storeKey, status }) {
  const clauses = [];
  const params = {};
  if (status === "active") clauses.push("deleted_at IS NULL");
  if (status === "deleted") clauses.push("deleted_at IS NOT NULL");
  if (storeKey) {
    clauses.push("store_key = @storeKey");
    params.storeKey = storeKey;
  }
  if (search) {
    clauses.push(
      `(name LIKE @search ESCAPE '\\'
        OR phone LIKE @search ESCAPE '\\'
        OR identity_card_number LIKE @search ESCAPE '\\'
        OR id LIKE @search ESCAPE '\\'
        OR CAST(submit_id AS TEXT) LIKE @search ESCAPE '\\')`
    );
    params.search = `%${escapeLikePattern(search)}%`;
  }
  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export function listEmployeeSubmissions(db, query) {
  const normalized = normalizeAdminListQuery(query);
  const { whereSql, params } = buildListWhereClause(normalized);
  const rows = db
    .prepare(
      `SELECT *
      FROM employee_submissions
      ${whereSql}
      ORDER BY created_at DESC, submit_id DESC
      LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit: normalized.limit, offset: normalized.offset });
  const total = db
    .prepare(`SELECT COUNT(*) AS count FROM employee_submissions ${whereSql}`)
    .get(params).count;
  return {
    total,
    limit: normalized.limit,
    offset: normalized.offset,
    items: rows.map((row) => serializeSubmission(db, row)),
  };
}

export function getEmployeeSubmissionDetail(db, submissionId) {
  return serializeSubmission(db, getSubmissionRow(db, submissionId));
}

export function getEmployeeSubmissionHistory(db, submissionId) {
  const submission = getSubmissionRow(db, submissionId);
  if (!submission) return null;

  const revisions = db
    .prepare(
      `SELECT *
      FROM employee_submission_revisions
      WHERE submission_id = ?
      ORDER BY version DESC`
    )
    .all(submissionId);

  return revisions.map((revision) => ({
    revisionId: revision.revision_id,
    version: revision.version,
    action: revision.action,
    name: revision.name,
    phone: revision.phone,
    position: revision.position,
    identityCardNumber: revision.identity_card_number,
    storeKey: revision.store_key,
    changedAt: revision.changed_at,
    actorUsername: revision.actor_username,
    attachments: {
      idCardFront: serializeAttachment(
        getAttachmentRow(db, revision.id_card_front_attachment_id)
      ),
      idCardBack: serializeAttachment(
        getAttachmentRow(db, revision.id_card_back_attachment_id)
      ),
      healthCertificate: serializeAttachment(
        getAttachmentRow(db, revision.health_certificate_attachment_id)
      ),
    },
  }));
}

export function getAdminAttachment(db, attachmentVersionId) {
  const row = getAttachmentRow(db, attachmentVersionId);
  if (!row || !fs.existsSync(row.storage_path)) return null;
  return row;
}

function isTruthyFormValue(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

export async function updateEmployeeSubmission({
  db,
  submissionId,
  body,
  files,
  uploadsRoot,
  actorUsername,
  now = new Date(),
  generateId = () => crypto.randomUUID(),
}) {
  const existing = getSubmissionRow(db, submissionId);
  if (!existing) {
    throw new AdminOperationError("员工记录不存在。", { statusCode: 404 });
  }
  if (existing.deleted_at) {
    throw new AdminOperationError("已删除记录需要先恢复后才能编辑。", { statusCode: 409 });
  }

  const payload = validateEmployeePayload(
    normalizeEmployeePayload(body, body.storeKey ?? body.store_key)
  );
  const idCardFront = getSingleUploadedFile(files, "idCardFront");
  const idCardBack = getSingleUploadedFile(files, "idCardBack");
  const healthCertificate = getSingleUploadedFile(files, "healthCertificate");
  const removeHealthCertificate = isTruthyFormValue(body.removeHealthCertificate);

  if (healthCertificate && removeHealthCertificate) {
    throw new AdminOperationError("不能同时上传并移除健康证。", {
      field: "healthCertificate",
    });
  }

  const hasFieldChange =
    payload.name !== existing.name ||
    payload.phone !== existing.phone ||
    payload.position !== existing.position ||
    payload.storeKey !== existing.store_key;
  const hasAttachmentChange =
    Boolean(idCardFront || idCardBack || healthCertificate) ||
    (removeHealthCertificate && Boolean(existing.current_health_certificate_attachment_id));
  if (!hasFieldChange && !hasAttachmentChange) {
    throw new AdminOperationError("没有检测到需要保存的更改。", { statusCode: 400 });
  }

  const pendingAttachments = [];
  const changedAt = now.toISOString();
  try {
    for (const descriptor of [
      [idCardFront, "idCardFront", "id_card_front"],
      [idCardBack, "idCardBack", "id_card_back"],
      [healthCertificate, "healthCertificate", "health_certificate"],
    ]) {
      const [file, field, kind] = descriptor;
      if (!file) continue;
      pendingAttachments.push(
        await writeAttachmentVersion({
          file,
          field,
          kind,
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
    const idCardFrontAttachmentId =
      byKind.id_card_front?.attachmentVersionId ||
      existing.current_id_card_front_attachment_id;
    const idCardBackAttachmentId =
      byKind.id_card_back?.attachmentVersionId || existing.current_id_card_back_attachment_id;
    const healthCertificateAttachmentId = removeHealthCertificate
      ? null
      : byKind.health_certificate?.attachmentVersionId ||
        existing.current_health_certificate_attachment_id;
    const nextVersion = existing.current_version + 1;

    db.transaction(() => {
      for (const attachment of pendingAttachments) {
        insertAttachmentVersion(db, attachment);
      }
      db.prepare(
        `UPDATE employee_submissions
        SET
          name = ?,
          phone = ?,
          position = ?,
          store_key = ?,
          current_id_card_front_attachment_id = ?,
          current_id_card_back_attachment_id = ?,
          current_health_certificate_attachment_id = ?,
          current_version = ?,
          updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`
      ).run(
        payload.name,
        payload.phone,
        payload.position,
        payload.storeKey,
        idCardFrontAttachmentId,
        idCardBackAttachmentId,
        healthCertificateAttachmentId,
        nextVersion,
        changedAt,
        submissionId
      );
      insertRevision(db, {
        submissionId,
        version: nextVersion,
        action: "updated",
        ...payload,
        identityCardNumber: existing.identity_card_number,
        idCardFrontAttachmentId,
        idCardBackAttachmentId,
        healthCertificateAttachmentId,
        changedAt,
        actorUsername,
      });
    })();
  } catch (error) {
    await cleanupUncommittedAttachments(pendingAttachments);
    throw error;
  }

  return getEmployeeSubmissionDetail(db, submissionId);
}

function changeDeletionState({ db, submissionId, actorUsername, now, action }) {
  const existing = getSubmissionRow(db, submissionId);
  if (!existing) {
    throw new AdminOperationError("员工记录不存在。", { statusCode: 404 });
  }

  if (action === "deleted" && existing.deleted_at) {
    throw new AdminOperationError("该记录已经在回收站中。", { statusCode: 409 });
  }
  if (action === "restored" && !existing.deleted_at) {
    throw new AdminOperationError("该记录当前未被删除。", { statusCode: 409 });
  }

  const changedAt = now.toISOString();
  const nextVersion = existing.current_version + 1;
  const deletedAt = action === "deleted" ? changedAt : null;

  db.transaction(() => {
    db.prepare(
      `UPDATE employee_submissions
      SET deleted_at = ?, current_version = ?, updated_at = ?
      WHERE id = ?`
    ).run(deletedAt, nextVersion, changedAt, submissionId);
    insertRevision(db, {
      submissionId,
      version: nextVersion,
      action,
      name: existing.name,
      phone: existing.phone,
      position: existing.position,
      identityCardNumber: existing.identity_card_number,
      storeKey: existing.store_key,
      idCardFrontAttachmentId: existing.current_id_card_front_attachment_id,
      idCardBackAttachmentId: existing.current_id_card_back_attachment_id,
      healthCertificateAttachmentId: existing.current_health_certificate_attachment_id,
      changedAt,
      actorUsername,
    });
  })();

  return getEmployeeSubmissionDetail(db, submissionId);
}

export function softDeleteEmployeeSubmission(options) {
  return changeDeletionState({ ...options, action: "deleted" });
}

export function restoreEmployeeSubmission(options) {
  return changeDeletionState({ ...options, action: "restored" });
}
