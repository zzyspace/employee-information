import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..");

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 3;
export const serverHost = process.env.EMPLOYEE_INFORMATION_HOST || "127.0.0.1";
export const serverPort = Number(process.env.PORT || 8789);
export const dataRoot =
  process.env.EMPLOYEE_INFORMATION_DATA_ROOT || path.join(projectRoot, ".data");
export const dbFilePath = path.join(dataRoot, "data", "employee-information.db");
export const uploadsRoot = path.join(dataRoot, "uploads");
export const dbInitSqlPath = path.join(projectRoot, "db", "init.sql");
export const publicDir = path.join(projectRoot, "public");
export const pdfJsBuildDir = path.join(projectRoot, "node_modules", "pdfjs-dist", "build");
export const adminUsername = process.env.INVOICE_ADMIN_USERNAME || "";
export const adminPassword = process.env.INVOICE_ADMIN_PASSWORD || "";
export const idCardModelProvider = (
  process.env.EMPLOYEE_INFORMATION_ID_CARD_MODEL_PROVIDER ||
  process.env.WECHATY_REIMBURSEMENT_EXTRACTION_PROVIDER ||
  "openai"
).toLowerCase();
export const idCardModelBaseUrl =
  process.env.EMPLOYEE_INFORMATION_ID_CARD_MODEL_BASE_URL ||
  process.env.WECHATY_REIMBURSEMENT_EXTRACTION_BASE_URL ||
  (idCardModelProvider === "qwen"
    ? "https://dashscope.aliyuncs.com/compatible-mode/v1"
    : "https://api.openai.com/v1");
export const idCardModelApiKey =
  process.env.EMPLOYEE_INFORMATION_ID_CARD_MODEL_API_KEY ||
  process.env.WECHATY_REIMBURSEMENT_EXTRACTION_API_KEY ||
  "";
export const idCardModelName =
  process.env.EMPLOYEE_INFORMATION_ID_CARD_MODEL_NAME ||
  process.env.WECHATY_REIMBURSEMENT_EXTRACTION_MODEL ||
  (idCardModelProvider === "qwen" ? "qwen3.5-flash" : "gpt-5.6-luna");
export const idCardModelProxyUrl =
  process.env.EMPLOYEE_INFORMATION_ID_CARD_MODEL_PROXY_URL ||
  process.env.WECHATY_REIMBURSEMENT_OPENAI_PROXY_URL ||
  "";
export const idCardModelTimeoutMs = Number(
  process.env.EMPLOYEE_INFORMATION_ID_CARD_MODEL_TIMEOUT_MS || 60_000
);
