#!/usr/bin/env node

/**
 * ====================================================================
 *  ⚽ eFootball Scraper — Web Server
 * ====================================================================
 *  Dashboard + API + Scraper Control
 *
 *  npm start               # Mở http://localhost:4000
 *  npm run dev              # Mở + tự restart khi sửa code
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  state,
  setBroadcast,
  start,
  stop,
  isRunning,
  getDbStats,
  getPlayers,
  getPlayer,
  loadSavedProgress,
  getProgressInfo,
} from "./worker.js";
import { log } from "./logger.js";
import config from "../config/default.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = config.dashboard.port;

// ── SSE ──
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

setBroadcast(broadcast);

// ── Parse body ──
function parseBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function parseQuery(url) {
  const params = {};
  const q = url.split("?")[1];
  if (!q) return params;
  q.split("&").forEach((p) => {
    const [k, v] = p.split("=");
    params[decodeURIComponent(k)] = decodeURIComponent(v || "");
  });
  return params;
}

function json(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

async function serveFile(res, filePath, contentType) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

// ── Server ──
const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split("?")[0];
  const method = req.method;

  // CORS
  if (method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // ── SSE ──
  if (urlPath === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  // ── API Routes ──
  if (urlPath === "/api/state" && method === "GET") {
    return json(res, state);
  }

  if (urlPath === "/api/start" && method === "POST") {
    const body = await parseBody(req);
    const result = await start({
      startPage: body.startPage ? Number(body.startPage) : undefined,
      endPage: body.endPage ? Number(body.endPage) : undefined,
      limit: body.limit ? Number(body.limit) : undefined,
      skipImages: body.skipImages || false,
      reverse: body.reverse !== false, // default true
      forceReset: body.forceReset || false,
    });
    return json(res, result);
  }

  if (urlPath === "/api/stop" && method === "POST") {
    await stop();
    return json(res, { ok: true });
  }

  if (urlPath === "/api/resume" && method === "POST") {
    const result = await start({ resume: true });
    return json(res, result);
  }

  if (urlPath === "/api/retry" && method === "POST") {
    const result = await start({ retryFailed: true });
    return json(res, result);
  }

  if (urlPath === "/api/progress" && method === "GET") {
    const progress = getProgressInfo();
    return json(res, progress || { lastCompletedPage: 0, totalPlayersSynced: 0 });
  }

  if (urlPath === "/api/stats" && method === "GET") {
    try {
      const stats = await getDbStats();
      return json(res, stats);
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  if (urlPath === "/api/players" && method === "GET") {
    const q = parseQuery(req.url);
    try {
      const result = await getPlayers({
        page: Number(q.page || 1),
        limit: Number(q.limit || 20),
        search: q.search || "",
        sort: q.sort || "overall.max",
      });
      return json(res, result);
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  if (urlPath.startsWith("/api/players/") && method === "GET") {
    const id = urlPath.split("/api/players/")[1];
    try {
      const player = await getPlayer(id);
      if (!player) return json(res, { error: "Not found" }, 404);
      return json(res, player);
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ── Pages ──
  if (urlPath === "/" || urlPath === "/dashboard") {
    return serveFile(
      res,
      path.join(__dirname, "views", "dashboard.html"),
      "text/html; charset=utf-8",
    );
  }

  if (urlPath === "/docs") {
    return serveFile(
      res,
      path.join(__dirname, "views", "docs.html"),
      "text/html; charset=utf-8",
    );
  }

  // 404
  json(res, { error: "Not found" }, 404);
});

server.listen(PORT, async () => {
  log("");
  log("══════════════════════════════════════════════════════");
  log("  ⚽ eFootball Scraper Server");
  log(`  🌐 Dashboard:  http://localhost:${PORT}`);
  log(`  📚 API Docs:   http://localhost:${PORT}/docs`);
  log(`  💾 Database:   ${config.mongo.dbName}`);
  log("══════════════════════════════════════════════════════");
  log("");

  // Load saved progress để dashboard hiển thị ngay
  try {
    const progress = await loadSavedProgress();
    if (progress.lastCompletedPage > 0 && !progress.finishedAt) {
      log(`⚠️  Scraper đã dừng ở page ${progress.lastCompletedPage} (${progress.totalPlayersSynced} players)`);
      log(`👉 Vào dashboard và bấm Resume để tiếp tục!`);
    } else if (progress.lastCompletedPage > 0 && progress.finishedAt) {
      log(`✅ Lần chạy trước đã hoàn tất (${progress.totalPlayersSynced} players)`);
    }
  } catch (e) {
    log(`⚠️  Không load được progress: ${e.message}`);
  }
});
