import fs from "node:fs/promises";
import path from "node:path";

import { MAX_FILE_BYTES } from "./config.js";

const EXTENSION_TO_TYPE = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".heic", "image/heic"],
  [".heif", "image/heif"],
  [".pdf", "application/pdf"],
]);

const TYPE_TO_EXTENSION = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/heic", ".heic"],
  ["image/heif", ".heif"],
  ["application/pdf", ".pdf"],
]);

const ACCEPTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/octet-stream",
  "",
]);

export const ATTACHMENT_KINDS = new Set([
  "id_card_front",
  "id_card_back",
  "health_certificate",
]);

export class UploadValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = "UploadValidationError";
    this.field = field;
    this.statusCode = 400;
  }
}

function looksLikeJpeg(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function looksLikePng(buffer) {
  return (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  );
}

function looksLikePdf(buffer) {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

function detectHeifType(buffer, extension) {
  if (buffer.length < 16 || buffer.subarray(4, 8).toString("ascii") !== "ftyp") {
    return null;
  }

  const brands = new Set();
  for (let offset = 8; offset + 4 <= Math.min(buffer.length, 64); offset += 4) {
    brands.add(buffer.subarray(offset, offset + 4).toString("ascii"));
  }

  const heicBrands = ["heic", "heix", "hevc", "hevx", "heis", "heim", "hevm", "hevs"];
  if (heicBrands.some((brand) => brands.has(brand))) {
    return "image/heic";
  }

  if (brands.has("mif1") || brands.has("msf1") || extension === ".heif") {
    return "image/heif";
  }

  return null;
}

export function detectFileType(buffer, extension) {
  if (looksLikeJpeg(buffer)) return "image/jpeg";
  if (looksLikePng(buffer)) return "image/png";
  if (looksLikePdf(buffer)) return "application/pdf";
  return detectHeifType(buffer, extension);
}

export function validateUploadFile(file, field) {
  if (!file) {
    throw new UploadValidationError("请选择需要上传的文件。", field);
  }

  if (!Buffer.isBuffer(file.buffer) || file.size <= 0) {
    throw new UploadValidationError("上传文件不能为空。", field);
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new UploadValidationError("每个文件大小不能超过 20MB。", field);
  }

  const extension = path.extname(file.originalname || "").toLowerCase();
  const expectedType = EXTENSION_TO_TYPE.get(extension);
  if (!expectedType) {
    throw new UploadValidationError("仅支持 JPG、PNG、HEIC、HEIF、PDF 文件。", field);
  }

  const declaredType = String(file.mimetype || "").toLowerCase();
  if (!ACCEPTED_MIME_TYPES.has(declaredType)) {
    throw new UploadValidationError("文件类型不受支持。", field);
  }

  const detectedType = detectFileType(file.buffer, extension);
  if (!detectedType) {
    throw new UploadValidationError("文件内容与支持的格式不符。", field);
  }

  const expectedFamily = expectedType.startsWith("image/hei") ? "heif" : expectedType;
  const detectedFamily = detectedType.startsWith("image/hei") ? "heif" : detectedType;
  if (expectedFamily !== detectedFamily) {
    throw new UploadValidationError("文件扩展名与文件内容不一致。", field);
  }

  if (
    declaredType &&
    declaredType !== "application/octet-stream" &&
    !(declaredType === "image/jpg" && detectedType === "image/jpeg")
  ) {
    const declaredFamily = declaredType.startsWith("image/hei") ? "heif" : declaredType;
    if (declaredFamily !== detectedFamily) {
      throw new UploadValidationError("浏览器报告的文件类型与文件内容不一致。", field);
    }
  }

  return {
    contentType: detectedType,
    extension: TYPE_TO_EXTENSION.get(detectedType),
  };
}

export async function writeAttachmentVersion({
  file,
  field,
  kind,
  submissionId,
  uploadsRoot,
  now = new Date(),
  generateId = () => crypto.randomUUID(),
}) {
  if (!ATTACHMENT_KINDS.has(kind)) {
    throw new Error(`Unsupported attachment kind: ${kind}`);
  }

  const validated = validateUploadFile(file, field);
  const attachmentVersionId = generateId();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const relativePath = path.join(year, month, `${attachmentVersionId}${validated.extension}`);
  const storagePath = path.join(uploadsRoot, relativePath);

  await fs.mkdir(path.dirname(storagePath), { recursive: true });
  await fs.writeFile(storagePath, file.buffer, { flag: "wx" });

  return {
    attachmentVersionId,
    submissionId,
    kind,
    storagePath,
    originalName: path.basename(file.originalname || `upload${validated.extension}`),
    contentType: validated.contentType,
    sizeBytes: file.size,
    createdAt: now.toISOString(),
  };
}

export async function cleanupUncommittedAttachments(attachments) {
  await Promise.all(
    attachments.map(async (attachment) => {
      try {
        await fs.rm(attachment.storagePath, { force: true });
      } catch {
        // Cleanup is best-effort; callers preserve the original failure.
      }
    })
  );
}
