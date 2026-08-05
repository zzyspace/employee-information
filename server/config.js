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
export const adminUsername = process.env.INVOICE_ADMIN_USERNAME || "";
export const adminPassword = process.env.INVOICE_ADMIN_PASSWORD || "";
