/**
 * ─── Logger Utility ─────────────────────────────────────────────
 * Ghi log ra console + file
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOG_DIR = path.join(ROOT, "logs");

// Tạo thư mục logs
fs.mkdirSync(LOG_DIR, { recursive: true });

// Log file tên theo ngày
const today = new Date().toISOString().slice(0, 10);
const logFile = path.join(LOG_DIR, `scrape-${today}.log`);
const logStream = fs.createWriteStream(logFile, { flags: "a" });

function timestamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export function log(msg) {
  const line = `[${timestamp()}] ${msg}`;
  console.log(line);
  logStream.write(line + "\n");
}

export function logError(msg) {
  const line = `[${timestamp()}] ❌ ${msg}`;
  console.error(line);
  logStream.write(line + "\n");
}

export function logWarn(msg) {
  const line = `[${timestamp()}] ⚠️  ${msg}`;
  console.warn(line);
  logStream.write(line + "\n");
}
