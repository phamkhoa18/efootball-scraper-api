/**
 * ─── Image Downloader (Optimized) ───────────────────────────────
 * Tải song song hình ảnh với concurrency limit
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sleep } from "./utils.js";
import config from "../config/default.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function randomUserAgent() {
  const agents = config.api.userAgents;
  return agents[Math.floor(Math.random() * agents.length)];
}

/**
 * Download 1 ảnh với retry
 */
async function downloadOne(
  url,
  localPath,
  retries = config.retry.imageAttempts,
) {
  if (!url) return false;

  // Đã tải rồi → skip
  try {
    const stat = await fs.stat(localPath);
    if (stat.size > 100) return true;
  } catch {
    // Chưa tải
  }

  await fs.mkdir(path.dirname(localPath), { recursive: true });

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": randomUserAgent(),
          accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          referer: "https://efootbase.com/",
        },
      });

      if (res.status === 200) {
        const buffer = await res.arrayBuffer();
        if (buffer.byteLength > 100) {
          await fs.writeFile(localPath, Buffer.from(buffer));
          return true;
        }
      }

      if (res.status === 404) return false;
    } catch (error) {
      if (attempt === retries) return false;
      await sleep(1000 * attempt);
    }
  }
  return false;
}

/**
 * Chạy song song với giới hạn concurrency
 */
async function parallelLimit(tasks, limit = 5) {
  const results = [];
  let index = 0;

  async function runNext() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () =>
    runNext(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * Download TẤT CẢ ảnh của 1 cầu thủ — SONG SONG
 */
export async function downloadAllImages(player) {
  const efhubId = String(player.id);
  const localPaths = {};
  let downloadCount = 0;
  const failedUrls = [];

  // Build danh sách tất cả ảnh cần tải
  const downloadTasks = [];

  // ── Card images ──
  const cardImages = player.card_images || {};
  const cardTypes = ["transparent", "front", "back", "mobile", "dynamic"];

  for (const type of cardTypes) {
    const url = cardImages[type];
    if (!url) continue;

    let localPath, relativePath;
    if (type === "transparent") {
      localPath = path.join(ROOT, config.paths.players, `${efhubId}.png`);
      relativePath = `${config.paths.players}/${efhubId}.png`;
    } else {
      localPath = path.join(ROOT, config.paths.cards, efhubId, `${type}.png`);
      relativePath = `${config.paths.cards}/${efhubId}/${type}.png`;
    }

    downloadTasks.push({
      key: `card_${type}`,
      url,
      localPath,
      relativePath,
    });
  }

  // ── Emblem images ──
  const emblemImages = player.emblem_images || {};
  const emblemTypes = ["nationality", "league", "team"];

  for (const type of emblemTypes) {
    const url = emblemImages[type];
    if (!url) continue;

    const fileName = url.split("/").pop();
    const localPath = path.join(ROOT, config.paths.emblems, fileName);
    const relativePath = `${config.paths.emblems}/${fileName}`;

    downloadTasks.push({
      key: `emblem_${type}`,
      url,
      localPath,
      relativePath,
    });
  }

  // ── Tải song song (max 5 concurrent) ──
  const taskFns = downloadTasks.map((task) => async () => {
    const success = await downloadOne(task.url, task.localPath);
    return { ...task, success };
  });

  const results = await parallelLimit(taskFns, 5);

  for (const r of results) {
    if (r.success) {
      localPaths[r.key] = r.relativePath;
      downloadCount += 1;
    } else {
      failedUrls.push({ type: r.key, url: r.url, efhubId });
    }
  }

  return { localPaths, downloadCount, failedUrls };
}
