#!/usr/bin/env node

/**
 * ─── Status Checker ─────────────────────────────────────────────
 * Xem trạng thái cào hiện tại
 *
 * Chạy: npm run status
 */
import { loadProgress } from "./progress.js";
import config from "../config/default.js";
import { MongoClient } from "mongodb";

async function main() {
  const progress = await loadProgress(config.paths.progress);

  console.log("");
  console.log("══════════════════════════════════════════════════════════════");
  console.log("  ⚽ eFootball Scraper — TRẠNG THÁI");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  📄 Page cuối hoàn thành : ${progress.lastCompletedPage}`);
  console.log(`  👤 Tổng players đã cào  : ${progress.totalPlayersSynced}`);
  console.log(`  🖼️  Tổng ảnh đã tải     : ${progress.totalImagesDownloaded}`);
  console.log(`  ✨ Players mới          : ${progress.totalNewPlayers}`);
  console.log(`  🔄 Players cập nhật     : ${progress.totalUpdatedPlayers}`);
  console.log(
    `  ⏱️  Bắt đầu lúc         : ${progress.startedAt || "Chưa chạy"}`,
  );
  console.log(`  ⏱️  Cập nhật cuối        : ${progress.updatedAt || "Chưa"}`);
  console.log(
    `  ⏱️  Hoàn thành lúc       : ${progress.finishedAt || "Chưa xong"}`,
  );

  if (progress.failedPages.length > 0) {
    console.log(
      `  ⚠️  Pages lỗi (${progress.failedPages.length}): [${progress.failedPages.join(", ")}]`,
    );
  }

  if (progress.failedImages && progress.failedImages.length > 0) {
    console.log(`  ⚠️  Ảnh lỗi: ${progress.failedImages.length}`);
  }

  // Check MongoDB
  try {
    const client = new MongoClient(config.mongo.uri);
    await client.connect();
    const db = client.db(config.mongo.dbName);
    const count = await db.collection(config.mongo.collection).countDocuments();
    console.log(
      "  ────────────────────────────────────────────────────────────",
    );
    console.log(`  💾 MongoDB (${config.mongo.dbName}): ${count} documents`);
    await client.close();
  } catch (error) {
    console.log(`  💾 MongoDB: ❌ Không kết nối được — ${error.message}`);
  }

  console.log("══════════════════════════════════════════════════════════════");
  console.log("");
}

main().catch(console.error);
