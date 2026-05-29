#!/usr/bin/env node

/**
 * ─── Export Tool ────────────────────────────────────────────────
 * Xuất data từ DB scraper ra JSON để import vào project chính
 *
 * Chạy: npm run export
 *       npm run export -- --output ./data/export.json
 *       npm run export -- --noRaw    (bỏ field _raw để file nhỏ hơn)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import config from "../config/default.js";
import { parseArgs } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = path.resolve(
    ROOT,
    args.output || "data/export-players.json",
  );
  const noRaw = args.noRaw === "true";

  console.log(`🔌 Connecting MongoDB: ${config.mongo.uri}`);
  const client = new MongoClient(config.mongo.uri);
  await client.connect();
  const db = client.db(config.mongo.dbName);
  const collection = db.collection(config.mongo.collection);

  const count = await collection.countDocuments();
  console.log(`📊 Tổng documents: ${count}`);

  // Projection
  const projection = noRaw ? { _raw: 0, _id: 0 } : { _id: 0 };

  const players = await collection
    .find({}, { projection })
    .sort({ "overall.max": -1 })
    .toArray();

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(players, null, 2), "utf8");

  const fileSizeMB = (
    Buffer.byteLength(JSON.stringify(players)) /
    1024 /
    1024
  ).toFixed(1);
  console.log(
    `💾 Exported ${players.length} players → ${outputPath} (${fileSizeMB} MB)`,
  );

  await client.close();
  console.log("✅ Done!");
}

main().catch(console.error);
