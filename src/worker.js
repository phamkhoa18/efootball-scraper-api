/**
 * ─── Scraper Worker ─────────────────────────────────────────────
 * Module điều khiển scraper — start/stop/resume từ web server
 */
import { MongoClient } from "mongodb";
import config from "../config/default.js";
import { sleep, randomDelay } from "./utils.js";
import { log, logError, logWarn } from "./logger.js";
import { loadProgress, saveProgress, resetProgress } from "./progress.js";
import { downloadAllImages } from "./downloader.js";
import { mapPlayer } from "./mapper.js";

// ── Live State (shared with server) ──
export const state = {
  status: "idle",
  currentPage: 0,
  playersOnPage: 0,
  playerIndex: 0,
  currentPlayer: "",
  sessionPlayers: 0,
  sessionNew: 0,
  sessionUpdated: 0,
  sessionImages: 0,
  sessionErrors: 0,
  totalPlayers: 0,
  totalNew: 0,
  totalUpdated: 0,
  totalImages: 0,
  lastCompletedPage: 0,
  failedPagesCount: 0,
  startTime: null,
  playersPerMin: 0,
  estimatedPages: 432,
  direction: "old-to-new",
  pagesCompleted: 0,
  recentPlayers: [],
  recentErrors: [],
  config: {
    limit: 100,
    startPage: 1,
    endPage: null,
    skipImages: false,
    reverse: true,
  },
};

let stopRequested = false;
let mongoClient = null;

// ── SSE broadcast function (set by server) ──
let broadcastFn = () => {};
export function setBroadcast(fn) {
  broadcastFn = fn;
}

function broadcast() {
  broadcastFn(state);
}

function updateSpeed() {
  if (!state.startTime || state.sessionPlayers === 0) return;
  const elapsed = (Date.now() - state.startTime) / 60000;
  state.playersPerMin = Math.round(state.sessionPlayers / elapsed);
}

function randomUA() {
  const a = config.api.userAgents;
  return a[Math.floor(Math.random() * a.length)];
}

async function fetchPage(page, limit) {
  const url = `${config.api.baseUrl}?limit=${limit}&page=${page}`;
  for (let attempt = 1; attempt <= config.retry.maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "x-api-key": config.api.key,
          "User-Agent": randomUA(),
          accept: "application/json",
        },
      });
      if (res.status === 429) {
        logWarn(`Rate limited. Chờ ${30 * attempt}s...`);
        await sleep(config.delays.onRateLimit * attempt);
        continue;
      }
      if (res.status === 200) return await res.json();
    } catch (e) {
      if (attempt === config.retry.maxAttempts) throw e;
      await sleep(config.delays.betweenRetries * attempt);
    }
  }
  return null;
}

// ── Public Controls ──

export function isRunning() {
  return state.status === "running";
}

export async function stop() {
  if (state.status !== "running") return;
  stopRequested = true;
  state.status = "stopping";
  broadcast();
  log("🛑 Stop requested...");
}

// Detect last page of the API
async function detectLastPage(limit) {
  log("🔍 Detecting last page...");
  let lo = 1,
    hi = 600,
    lastValid = 1;
  // Binary search for the last page with data
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    try {
      const body = await fetchPage(mid, limit);
      if (body && body.data && body.data.length > 0) {
        lastValid = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    } catch {
      hi = mid - 1;
    }
  }
  log(`📊 Last page detected: ${lastValid}`);
  return lastValid;
}

export async function start(opts = {}) {
  if (state.status === "running") return { error: "Already running" };

  const limit = opts.limit || config.api.playersPerPage;
  const skipImages = opts.skipImages || false;
  const retryFailed = opts.retryFailed || false;
  const reverse = opts.reverse !== false; // default: true (cũ → mới)

  let progress = await loadProgress(config.paths.progress);
  let startPage,
    endPage = opts.endPage || null;

  if (opts.resume) {
    if (progress.direction === "reverse") {
      startPage = progress.lastCompletedPage - 1;
      log(`📂 Resume (ngược) từ page ${startPage}`);
    } else {
      startPage = progress.lastCompletedPage + 1;
      log(`📂 Resume từ page ${startPage}`);
    }
  } else if (retryFailed && progress.failedPages.length > 0) {
    startPage = null;
    log(`🔄 Retry ${progress.failedPages.length} failed pages`);
  } else {
    startPage = opts.startPage || null; // will be detected
    if (!opts.resume && !opts.startPage) progress = resetProgress();
    progress.direction = reverse ? "reverse" : "forward";
  }

  state.direction = reverse ? "old-to-new" : "new-to-old";
  state.config = {
    limit,
    startPage: startPage || "auto",
    endPage: endPage || "auto",
    skipImages,
    reverse,
  };

  // Run in background
  runScraper({
    limit,
    skipImages,
    endPage,
    startPage,
    retryFailed,
    progress,
    reverse,
  }).catch((err) => {
    logError(`Fatal: ${err.message}`);
    state.status = "error";
    broadcast();
  });

  return { ok: true, reverse, startPage };
}

async function runScraper({
  limit,
  skipImages,
  endPage,
  startPage,
  retryFailed,
  progress,
  reverse,
}) {
  stopRequested = false;

  // MongoDB
  if (!mongoClient) {
    mongoClient = new MongoClient(config.mongo.uri, { maxPoolSize: 10 });
    await mongoClient.connect();
  }
  const db = mongoClient.db(config.mongo.dbName);
  const col = db.collection(config.mongo.collection);
  await col.createIndex({ efhubId: 1 }, { unique: true });
  await col.createIndex({ "overall.max": -1 });
  await col.createIndex({ timeAdded: 1 });
  await col.createIndex({ name: "text", nameNormalized: "text" });

  // Detect start page for reverse mode
  if (reverse && !startPage && !retryFailed) {
    state.status = "running";
    state.currentPlayer = "Detecting last page...";
    broadcast();
    startPage = await detectLastPage(limit);
    state.estimatedPages = startPage;
  }

  // Reset session
  state.status = "running";
  state.startTime = Date.now();
  state.pagesCompleted = 0;
  state.sessionPlayers = 0;
  state.sessionNew = 0;
  state.sessionUpdated = 0;
  state.sessionImages = 0;
  state.sessionErrors = 0;
  state.totalPlayers = progress.totalPlayersSynced;
  state.totalNew = progress.totalNewPlayers;
  state.totalUpdated = progress.totalUpdatedPlayers;
  state.totalImages = progress.totalImagesDownloaded;
  state.lastCompletedPage = progress.lastCompletedPage;
  state.failedPagesCount = progress.failedPages.length;
  broadcast();

  const dir = reverse ? "CŨ → MỚI (ngược)" : "MỚI → CŨ";
  log("");
  log("══════════════════════════════════════════════════════");
  log("  ⚽ Scraper BẮT ĐẦU");
  log(
    `  📋 limit=${limit} | start=${startPage || "retry"} | end=${endPage || "auto"}`,
  );
  log(`  🔄 Hướng: ${dir}`);
  log("══════════════════════════════════════════════════════");

  let pagesToRetry = null;
  if (retryFailed && !startPage) {
    pagesToRetry = [...progress.failedPages];
    progress.failedPages = [];
  }

  let page = startPage || 1;
  let emptyStreak = 0;

  while (!stopRequested) {
    let currentPage;
    if (pagesToRetry) {
      if (pagesToRetry.length === 0) break;
      currentPage = pagesToRetry.shift();
    } else {
      currentPage = page;
    }
    if (!reverse && endPage && currentPage > endPage) break;
    if (reverse && endPage && currentPage < endPage) break;
    if (reverse && currentPage < 1) break;

    state.currentPage = currentPage;
    state.playerIndex = 0;
    broadcast();

    log(`📄 Page ${currentPage}`);

    let body;
    try {
      body = await fetchPage(currentPage, limit);
      if (!body) {
        progress.failedPages.push(currentPage);
        state.sessionErrors++;
        state.failedPagesCount = progress.failedPages.length;
        state.recentErrors.unshift({
          page: currentPage,
          msg: "Fetch failed",
          time: new Date().toISOString(),
        });
        if (state.recentErrors.length > 15) state.recentErrors.pop();
        await saveProgress(config.paths.progress, progress);
        broadcast();
        page += reverse ? -1 : 1;
        continue;
      }
    } catch (e) {
      logError(`Page ${currentPage}: ${e.message}`);
      progress.failedPages.push(currentPage);
      state.sessionErrors++;
      await saveProgress(config.paths.progress, progress);
      page += reverse ? -1 : 1;
      continue;
    }

    const players = body.data || [];
    if (players.length === 0) {
      emptyStreak++;
      if (emptyStreak >= 3) {
        log("✅ Hết data!");
        break;
      }
      page += reverse ? -1 : 1;
      continue;
    }
    emptyStreak = 0;
    state.playersOnPage = players.length;

    let pN = 0,
      pU = 0,
      pI = 0;

    for (let i = 0; i < players.length; i++) {
      if (stopRequested) break;
      const raw = players[i];
      state.playerIndex = i + 1;
      state.currentPlayer = raw.name || "";
      if (i % 5 === 0) broadcast();

      let localPaths = {};
      if (!skipImages) {
        const r = await downloadAllImages(raw);
        localPaths = r.localPaths;
        pI += r.downloadCount;
        if (r.failedUrls.length > 0)
          progress.failedImages.push(...r.failedUrls);
      }

      const doc = mapPlayer(raw, localPaths);
      const res = await col.updateOne(
        { efhubId: doc.efhubId },
        { $set: doc, $setOnInsert: { createdAt: new Date() } },
        { upsert: true },
      );

      const isNew = res.upsertedCount > 0;
      if (isNew) pN++;
      else pU++;

      state.recentPlayers.unshift({
        name: raw.name,
        overall: `${doc.overall.base}→${doc.overall.max}`,
        club: raw.team_name || "",
        nationality: raw.nationality || "",
        positions: doc.positions.join(", "),
        isNew,
        time: new Date().toISOString(),
      });
      if (state.recentPlayers.length > 30) state.recentPlayers.pop();
    }

    state.sessionPlayers += players.length;
    state.sessionNew += pN;
    state.sessionUpdated += pU;
    state.sessionImages += pI;
    state.pagesCompleted += 1;
    progress.totalPlayersSynced += players.length;
    progress.totalImagesDownloaded += pI;
    progress.totalNewPlayers += pN;
    progress.totalUpdatedPlayers += pU;
    progress.lastCompletedPage = currentPage;
    progress.failedPages = progress.failedPages.filter(
      (p) => p !== currentPage,
    );

    state.totalPlayers = progress.totalPlayersSynced;
    state.totalNew = progress.totalNewPlayers;
    state.totalUpdated = progress.totalUpdatedPlayers;
    state.totalImages = progress.totalImagesDownloaded;
    state.lastCompletedPage = currentPage;
    state.failedPagesCount = progress.failedPages.length;
    updateSpeed();
    await saveProgress(config.paths.progress, progress);
    broadcast();

    log(
      `   ✅ Page ${currentPage} — ${pN} mới, ${pU} cập nhật, ${pI} ảnh | ${state.playersPerMin}/min`,
    );

    if (!stopRequested) {
      const d = config.delays.betweenPages;
      await sleep(randomDelay(d.min, d.max));
    }
    page += reverse ? -1 : 1;
  }

  progress.finishedAt = new Date().toISOString();
  await saveProgress(config.paths.progress, progress);
  state.status = stopRequested ? "paused" : "done";
  state.currentPlayer = "";
  broadcast();
  log(`🏁 ${state.status === "paused" ? "Tạm dừng" : "Hoàn tất"}!`);
}

// ── DB Queries (for API) ──

export async function getDbStats() {
  if (!mongoClient) {
    mongoClient = new MongoClient(config.mongo.uri);
    await mongoClient.connect();
  }
  const db = mongoClient.db(config.mongo.dbName);
  const col = db.collection(config.mongo.collection);
  const total = await col.countDocuments();
  const pipeline = [
    {
      $group: {
        _id: null,
        avgOvr: { $avg: "$overall.max" },
        maxOvr: { $max: "$overall.max" },
      },
    },
  ];
  const [agg] = await col.aggregate(pipeline).toArray();
  return {
    total,
    avgOverall: Math.round(agg?.avgOvr || 0),
    maxOverall: agg?.maxOvr || 0,
  };
}

export async function getPlayers({
  page = 1,
  limit = 20,
  search = "",
  sort = "overall.max",
}) {
  if (!mongoClient) {
    mongoClient = new MongoClient(config.mongo.uri);
    await mongoClient.connect();
  }
  const db = mongoClient.db(config.mongo.dbName);
  const col = db.collection(config.mongo.collection);

  const filter = search ? { name: { $regex: search, $options: "i" } } : {};

  const total = await col.countDocuments(filter);
  const players = await col
    .find(filter, { projection: { _raw: 0 } })
    .sort({ [sort]: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();

  return { players, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function getPlayer(efhubId) {
  if (!mongoClient) {
    mongoClient = new MongoClient(config.mongo.uri);
    await mongoClient.connect();
  }
  const db = mongoClient.db(config.mongo.dbName);
  return db
    .collection(config.mongo.collection)
    .findOne({ efhubId }, { projection: { _raw: 0 } });
}
