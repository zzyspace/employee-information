export function insertAttachmentVersion(db, attachment) {
  db.prepare(
    `INSERT INTO employee_attachment_versions (
      attachment_version_id,
      submission_id,
      kind,
      storage_path,
      original_name,
      content_type,
      size_bytes,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    attachment.attachmentVersionId,
    attachment.submissionId,
    attachment.kind,
    attachment.storagePath,
    attachment.originalName,
    attachment.contentType,
    attachment.sizeBytes,
    attachment.createdAt
  );
}

export function insertRevision(db, {
  submissionId,
  version,
  action,
  name,
  phone,
  position,
  storeKey,
  idCardFrontAttachmentId,
  idCardBackAttachmentId,
  healthCertificateAttachmentId,
  changedAt,
  actorUsername,
}) {
  db.prepare(
    `INSERT INTO employee_submission_revisions (
      submission_id,
      version,
      action,
      name,
      phone,
      position,
      store_key,
      id_card_front_attachment_id,
      id_card_back_attachment_id,
      health_certificate_attachment_id,
      changed_at,
      actor_username
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    submissionId,
    version,
    action,
    name,
    phone,
    position,
    storeKey,
    idCardFrontAttachmentId,
    idCardBackAttachmentId,
    healthCertificateAttachmentId || null,
    changedAt,
    actorUsername || null
  );
}

export function getSubmissionRow(db, submissionId) {
  return db
    .prepare(
      `SELECT
        submit_id,
        id,
        name,
        phone,
        position,
        store_key,
        current_id_card_front_attachment_id,
        current_id_card_back_attachment_id,
        current_health_certificate_attachment_id,
        current_version,
        created_at,
        updated_at,
        deleted_at
      FROM employee_submissions
      WHERE id = ?`
    )
    .get(submissionId);
}

export function getAttachmentRow(db, attachmentVersionId) {
  if (!attachmentVersionId) return null;
  return db
    .prepare(
      `SELECT
        attachment_version_id,
        submission_id,
        kind,
        storage_path,
        original_name,
        content_type,
        size_bytes,
        created_at
      FROM employee_attachment_versions
      WHERE attachment_version_id = ?`
    )
    .get(attachmentVersionId);
}

export function serializeAttachment(row) {
  if (!row) return null;
  return {
    attachmentVersionId: row.attachment_version_id,
    kind: row.kind,
    originalName: row.original_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    url: `/employee/api/admin/attachments/${encodeURIComponent(row.attachment_version_id)}`,
  };
}

export function serializeSubmission(db, row) {
  if (!row) return null;
  return {
    submitId: row.submit_id,
    id: row.id,
    name: row.name,
    phone: row.phone,
    position: row.position,
    storeKey: row.store_key,
    version: row.current_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    status: row.deleted_at ? "deleted" : "active",
    attachments: {
      idCardFront: serializeAttachment(
        getAttachmentRow(db, row.current_id_card_front_attachment_id)
      ),
      idCardBack: serializeAttachment(
        getAttachmentRow(db, row.current_id_card_back_attachment_id)
      ),
      healthCertificate: serializeAttachment(
        getAttachmentRow(db, row.current_health_certificate_attachment_id)
      ),
    },
  };
}
