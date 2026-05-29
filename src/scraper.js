#!/usr/bin/env node

/**
 * ====================================================================
 *  ⚽ eFootball Scraper — Optimized + Web Dashboard
 * ====================================================================
 *
 *   npm run scrape                  # Cào + Dashboard tại http://localhost:4000
 *   npm run scrape:resume           # Tiếp tục + Dashboard
 *   node src/scraper.js --endPage 5 # Test 5 pages
 */

import { MongoClient } from "mongodb";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import config from "../config/default.js";
import { sleep, randomDelay, parseArgs } from "./utils.js";
import { log, logError, logWarn } from "./logger.js";
import { loadProgress, saveProgress, resetProgress } from "./progress.js";
import { downloadAllImages } from "./downloader.js";
import { mapPlayer } from "./mapper.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DASHBOARD_PORT = 4000;

// ── SSE clients ──
const sseClients = new Set();

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(msg);
    } catch {
      sseClients.delete(res);
    }
  }
}

// ── Live state ──
const liveState = {
  status: "idle", // idle | running | paused | done | error
  currentPage: 0,
  playersOnPage: 0,
  playerIndex: 0,
  currentPlayer: "",
  // Session
  sessionPlayers: 0,
  sessionNew: 0,
  sessionUpdated: 0,
  sessionImages: 0,
  sessionErrors: 0,
  // Total
  totalPlayers: 0,
  totalNew: 0,
  totalUpdated: 0,
  totalImages: 0,
  lastCompletedPage: 0,
  failedPagesCount: 0,
  // Speed
  startTime: null,
  playersPerMin: 0,
  estimatedPages: 432,
  // Recent
  recentPlayers: [], // last 20
  recentErrors: [], // last 10
};

function updateSpeed() {
  if (!liveState.startTime || liveState.sessionPlayers === 0) return;
  const elapsed = (Date.now() - liveState.startTime) / 60000; // minutes
  liveState.playersPerMin = Math.round(liveState.sessionPlayers / elapsed);
}

// ── Dashboard HTML ──
function getDashboardHTML() {
  return fs.readFile(path.join(ROOT, "src", "dashboard.html"), "utf8");
}

// ── HTTP Server ──
async function startDashboard() {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write(`data: ${JSON.stringify(liveState)}\n\n`);
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    if (req.url === "/api/state") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(liveState));
      return;
    }

    // Serve dashboard
    try {
      const html = await getDashboardHTML();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(500);
      res.end("Dashboard not found");
    }
  });

  server.listen(DASHBOARD_PORT, () => {
    log(`🌐 Dashboard: http://localhost:${DASHBOARD_PORT}`);
  });

  return server;
}

// ── API Fetch ──
function randomUserAgent() {
  const agents = config.api.userAgents;
  return agents[Math.floor(Math.random() * agents.length)];
}

async function fetchPage(page, limit) {
  const url = `${config.api.baseUrl}?limit=${limit}&page=${page}`;
  const maxAttempts = config.retry.maxAttempts;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          "x-api-key": config.api.key,
          "User-Agent": randomUserAgent(),
          accept: "application/json",
        },
      });

      if (res.status === 429) {
        const w = config.delays.onRateLimit * attempt;
        logWarn(`Rate limited (429). Chờ ${w / 1000}s...`);
        await sleep(w);
        continue;
      }
      if (res.status === 200) return await res.json();
      logWarn(`HTTP ${res.status} (attempt ${attempt}/${maxAttempts})`);
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      await sleep(config.delays.betweenRetries * attempt);
    }
  }
  return null;
}

// ── MAIN ──
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help === "true") {
    console.log(
      [
        "",
        "  ⚽ eFootball Scraper + Dashboard",
        "",
        "  node src/scraper.js              # Cào từ đầu",
        "  node src/scraper.js --resume     # Tiếp tục",
        "  node src/scraper.js --retryFailed",
        "  node src/scraper.js --startPage 50 --endPage 100",
        "  node src/scraper.js --skipImages",
        "  node src/scraper.js --noDash     # Không mở dashboard",
        "",
      ].join("\n"),
    );
    return;
  }

  const limit = Math.min(
    100,
    Math.max(1, Number(args.limit || config.api.playersPerPage)),
  );
  const skipImages = args.skipImages === "true";
  const retryFailed = args.retryFailed === "true";
  const endPage = args.endPage ? Number(args.endPage) : null;
  const noDash = args.noDash === "true";

  // ── Progress ──
  let progress = await loadProgress(config.paths.progress);

  let startPage;
  if (args.resume === "true") {
    startPage = progress.lastCompletedPage + 1;
    log(`📂 Resume từ page ${startPage}`);
  } else if (retryFailed && progress.failedPages.length > 0) {
    log(`🔄 Retry ${progress.failedPages.length} failed pages`);
    startPage = null;
  } else {
    startPage = Math.max(1, Number(args.startPage || 1));
    if (!args.startPage) progress = resetProgress();
  }

  // ── MongoDB ──
  log(`🔌 MongoDB: ${config.mongo.uri}`);
  const client = new MongoClient(config.mongo.uri, { maxPoolSize: 10 });
  await client.connect();
  const db = client.db(config.mongo.dbName);
  const collection = db.collection(config.mongo.collection);

  await collection.createIndex({ efhubId: 1 }, { unique: true });
  await collection.createIndex({ "overall.max": -1 });
  await collection.createIndex({ timeAdded: 1 });

  // ── Dashboard ──
  let server;
  if (!noDash) {
    server = await startDashboard();
  }

  // ── Init live state ──
  liveState.status = "running";
  liveState.startTime = Date.now();
  liveState.totalPlayers = progress.totalPlayersSynced;
  liveState.totalNew = progress.totalNewPlayers;
  liveState.totalUpdated = progress.totalUpdatedPlayers;
  liveState.totalImages = progress.totalImagesDownloaded;
  liveState.lastCompletedPage = progress.lastCompletedPage;
  liveState.failedPagesCount = progress.failedPages.length;

  log("");
  log("══════════════════════════════════════════════════════");
  log("  ⚽ eFootball Scraper — BẮT ĐẦU");
  log(
    `  📋 limit=${limit} | start=${startPage || "retry"} | end=${endPage || "auto"}`,
  );
  log(`  🖼️  Ảnh: ${skipImages ? "BỎ QUA" : "SONG SONG (5x)"}`);
  if (!noDash) log(`  🌐 Dashboard: http://localhost:${DASHBOARD_PORT}`);
  log("══════════════════════════════════════════════════════");
  log("");

  // ── Pages ──
  let pagesToRetry = null;
  if (retryFailed && startPage === null) {
    pagesToRetry = [...progress.failedPages];
    progress.failedPages = [];
  }

  let page = startPage || 1;
  let emptyStreak = 0;
  let stopping = false;

  process.on("SIGINT", async () => {
    if (stopping) process.exit(1);
    stopping = true;
    liveState.status = "paused";
    broadcast(liveState);
    log("\n🛑 Ctrl+C — Lưu progress...");
    await saveProgress(config.paths.progress, progress);
    log("💾 Đã lưu. Chạy: npm run scrape:resume");
    await client.close();
    if (server) server.close();
    process.exit(0);
  });

  // ── Main Loop ──
  while (!stopping) {
    let currentPage;
    if (pagesToRetry) {
      if (pagesToRetry.length === 0) break;
      currentPage = pagesToRetry.shift();
    } else {
      currentPage = page;
    }

    if (endPage && currentPage > endPage) {
      log(`✅ Đã đến endPage ${endPage}`);
      break;
    }

    liveState.currentPage = currentPage;
    liveState.playerIndex = 0;
    broadcast(liveState);

    log(`📄 Page ${currentPage} — Fetching...`);

    let body;
    try {
      body = await fetchPage(currentPage, limit);
      if (!body) {
        logError(`Page ${currentPage} — Thất bại`);
        progress.failedPages.push(currentPage);
        liveState.sessionErrors += 1;
        liveState.failedPagesCount = progress.failedPages.length;
        liveState.recentErrors.unshift({
          page: currentPage,
          time: new Date().toISOString(),
        });
        if (liveState.recentErrors.length > 10) liveState.recentErrors.pop();
        await saveProgress(config.paths.progress, progress);
        broadcast(liveState);
        page += 1;
        continue;
      }
    } catch (error) {
      logError(`Page ${currentPage} — ${error.message}`);
      progress.failedPages.push(currentPage);
      liveState.sessionErrors += 1;
      await saveProgress(config.paths.progress, progress);
      page += 1;
      continue;
    }

    const players = body.data || [];

    if (players.length === 0) {
      emptyStreak += 1;
      if (emptyStreak >= 3) {
        log("✅ Đã cào hết toàn bộ!");
        break;
      }
      page += 1;
      continue;
    }
    emptyStreak = 0;

    liveState.playersOnPage = players.length;
    log(`📄 Page ${currentPage} — ${players.length} cầu thủ`);

    let pNew = 0,
      pUpd = 0,
      pImg = 0;

    // ── Batch: xử lý từng cầu thủ ──
    for (let i = 0; i < players.length; i += 1) {
      if (stopping) break;

      const raw = players[i];
      liveState.playerIndex = i + 1;
      liveState.currentPlayer = raw.name || "";
      broadcast(liveState);

      // Download ảnh song song
      let localPaths = {};
      if (!skipImages) {
        const r = await downloadAllImages(raw);
        localPaths = r.localPaths;
        pImg += r.downloadCount;
        if (r.failedUrls.length > 0)
          progress.failedImages.push(...r.failedUrls);
      }

      // Map & upsert
      const doc = mapPlayer(raw, localPaths);
      const res = await collection.updateOne(
        { efhubId: doc.efhubId },
        { $set: doc, $setOnInsert: { createdAt: new Date() } },
        { upsert: true },
      );

      const isNew = res.upsertedCount > 0;
      if (isNew) {
        pNew += 1;
        if (pNew <= 3 || (i + 1) % 25 === 0) {
          log(
            `   ✨ [MỚI] ${raw.name} (OVR: ${doc.overall.base}→${doc.overall.max}) [${i + 1}/${players.length}]`,
          );
        }
      } else {
        pUpd += 1;
      }

      // Update recent
      liveState.recentPlayers.unshift({
        name: raw.name,
        overall: `${doc.overall.base}→${doc.overall.max}`,
        club: raw.team_name || "",
        isNew,
        time: new Date().toISOString(),
      });
      if (liveState.recentPlayers.length > 20) liveState.recentPlayers.pop();
    }

    // ── Update counters ──
    liveState.sessionPlayers += players.length;
    liveState.sessionNew += pNew;
    liveState.sessionUpdated += pUpd;
    liveState.sessionImages += pImg;

    progress.totalPlayersSynced += players.length;
    progress.totalImagesDownloaded += pImg;
    progress.totalNewPlayers += pNew;
    progress.totalUpdatedPlayers += pUpd;
    progress.lastCompletedPage = currentPage;
    progress.failedPages = progress.failedPages.filter(
      (p) => p !== currentPage,
    );

    liveState.totalPlayers = progress.totalPlayersSynced;
    liveState.totalNew = progress.totalNewPlayers;
    liveState.totalUpdated = progress.totalUpdatedPlayers;
    liveState.totalImages = progress.totalImagesDownloaded;
    liveState.lastCompletedPage = currentPage;
    liveState.failedPagesCount = progress.failedPages.length;

    updateSpeed();
    await saveProgress(config.paths.progress, progress);
    broadcast(liveState);

    log(
      `   ✅ Page ${currentPage} — ${pNew} mới, ${pUpd} cập nhật, ${pImg} ảnh | Speed: ${liveState.playersPerMin}/min`,
    );

    // Delay
    if (!stopping) {
      const d = config.delays.betweenPages;
      const delay = randomDelay(d.min, d.max);
      log(`   ⏳ ${(delay / 1000).toFixed(1)}s...`);
      await sleep(delay);
    }

    page += 1;
  }

  // ── Done ──
  liveState.status = "done";
  progress.finishedAt = new Date().toISOString();
  await saveProgress(config.paths.progress, progress);
  broadcast(liveState);

  log("");
  log("══════════════════════════════════════════════════════");
  log("  📋 HOÀN TẤT");
  log(`  👤 Phiên: ${liveState.sessionPlayers} (${liveState.sessionNew} mới)`);
  log(`  🖼️  Ảnh: ${liveState.sessionImages}`);
  log(`  👤 Tổng: ${progress.totalPlayersSynced}`);
  if (progress.failedPages.length > 0) {
    log(
      `  ⚠️  Lỗi: ${progress.failedPages.length} pages → npm run scrape:retry`,
    );
  }
  log("══════════════════════════════════════════════════════");

  await client.close();
  log("🔌 Done! 🎉");

  // Keep dashboard alive 30s after done
  if (server) {
    log("🌐 Dashboard còn mở 60s để xem kết quả...");
    await sleep(60000);
    server.close();
  }
}

main().catch((error) => {
  logError(`Fatal: ${error.message}`);
  liveState.status = "error";
  broadcast(liveState);
  console.error(error);
  process.exit(1);
});
