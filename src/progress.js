/**
 * ─── Progress Manager ───────────────────────────────────────────
 * Quản lý tiến trình cào — hỗ trợ resume khi bị dừng
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function getProgressPath(configPath) {
  return path.join(ROOT, configPath);
}

const DEFAULT_PROGRESS = {
  version: 2,
  lastCompletedPage: 0,
  totalPlayersSynced: 0,
  totalImagesDownloaded: 0,
  totalNewPlayers: 0,
  totalUpdatedPlayers: 0,
  failedPages: [],
  failedImages: [],
  startedAt: null,
  updatedAt: null,
  finishedAt: null,
};

export async function loadProgress(configPath) {
  const filePath = getProgressPath(configPath);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return { ...DEFAULT_PROGRESS, startedAt: new Date().toISOString() };
  }
}

export async function saveProgress(configPath, progress) {
  const filePath = getProgressPath(configPath);
  progress.updatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(progress, null, 2), "utf8");
}

export function resetProgress() {
  return { ...DEFAULT_PROGRESS, startedAt: new Date().toISOString() };
}
