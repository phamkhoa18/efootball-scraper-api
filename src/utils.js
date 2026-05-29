/**
 * ─── Utilities ──────────────────────────────────────────────────
 */

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

export function parseArgs(argv) {
  const output = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      output[key] = "true";
      continue;
    }
    output[key] = value;
    i += 1;
  }
  return output;
}
