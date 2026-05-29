/**
 * ─── eFootball Scraper Config ───────────────────────────────────
 */
import "dotenv/config";

export default {
  // ── API ──
  api: {
    baseUrl: "https://api2.efootbase.com/api/players",
    key: "L-}i@R-KwsGk&nB;C4)RBSB+_AQsTSK5Sxa&d:>oz54",
    userAgents: [
      "Dart/3.3 (dart:io)",
      "Dart/3.2 (dart:io)",
      "Dart/3.4 (dart:io)",
      "Dart/3.1 (dart:io)",
    ],
    playersPerPage: 100,
  },

  // ── MongoDB ──
  mongo: {
    uri:
      process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/efootball_scraper",
    dbName: process.env.MONGODB_DB_NAME || "efootball_scraper",
    collection: "players",
  },

  // ── Delays (ms) — tối ưu tốc độ nhưng vẫn an toàn ──
  delays: {
    betweenPages: { min: 1500, max: 3000 }, // Delay giữa mỗi page
    betweenImages: { min: 50, max: 150 }, // Delay giữa mỗi ảnh (giảm vì đã song song)
    onRateLimit: 30000, // Delay khi bị 429
    betweenRetries: 2000, // Delay giữa retry (x attempt)
  },

  // ── Retry ──
  retry: {
    maxAttempts: 3,
    imageAttempts: 2, // Giảm retry ảnh để nhanh hơn
  },

  // ── Concurrency ──
  imageConcurrency: 6, // Tải song song 6 ảnh cùng lúc

  // ── Thư mục lưu ──
  paths: {
    players: "data/images/players",
    cards: "data/images/cards",
    emblems: "data/images/emblems",
    progress: "data/sync-progress.json",
    logs: "logs",
  },

  // ── Dashboard ──
  dashboard: {
    port: process.env.PORT || 4000,
  },

  // ── Mapping ──
  playstyleMap: {
    0: "None",
    1: "Goal Poacher",
    2: "Dummy Runner",
    3: "Fox in the Box",
    4: "Prolific Winger",
    5: "Roaming Flank",
    6: "Hole Player",
    7: "Box-to-Box",
    8: "Anchor Man",
    9: "The Destroyer",
    10: "Orchestrator",
    11: "Offensive Full-back",
    12: "Defensive Full-back",
    13: "Classic No. 10",
    14: "Creative Playmaker",
    15: "Build Up",
    16: "Offensive Goalkeeper",
    17: "Defensive Goalkeeper",
    18: "Deep-Lying Forward",
    19: "Cross Specialist",
    20: "Orchestrator",
    22: "Target Man",
  },

  positionFields: [
    "amf",
    "cb",
    "cf",
    "cmf",
    "dmf",
    "gk",
    "lb",
    "lmf",
    "lwf",
    "rb",
    "rmf",
    "rwf",
    "ss",
  ],
};
