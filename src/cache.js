import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync, accessSync, constants } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// In production a Railway volume is mounted at /data; locally we fall back to the repo.
// If DATA_DIR is set but unwritable (volume not attached yet), degrade to the repo dir
// rather than crashing on boot — output is then ephemeral, but the app still runs.
function resolveDataDir() {
  const desired = process.env.DATA_DIR;
  if (!desired) return REPO_ROOT;
  try {
    mkdirSync(desired, { recursive: true });
    accessSync(desired, constants.W_OK);
    return desired;
  } catch (err) {
    console.warn(`DATA_DIR "${desired}" is not writable (${err.code}); falling back to ${REPO_ROOT}. Output will not survive redeploys.`);
    return REPO_ROOT;
  }
}

export const DATA_DIR = resolveDataDir();
const CACHE_DIR = resolve(DATA_DIR, "cache");

// Closed-period sold data never changes, so it is cached forever. Active-listing
// and under-contract snapshots are live and must not be served stale.
const LIVE_ENDPOINTS = ["/market-statistics/active"];
const LIVE_TTL_MS = 60 * 60 * 1000; // 1 hour

function isLive(url) {
  return LIVE_ENDPOINTS.some(e => url.includes(e));
}

function keyFor(url) {
  return createHash("sha256").update(url).digest("hex").slice(0, 32);
}

function pathFor(url) {
  return resolve(CACHE_DIR, `${keyFor(url)}.json`);
}

/**
 * Return cached data for a URL, or null on miss/expiry.
 * Live endpoints expire after LIVE_TTL_MS; everything else is permanent.
 */
export function cacheGet(url) {
  if (process.env.CACHE_DISABLED === "1") return null;
  const file = pathFor(url);
  if (!existsSync(file)) return null;

  try {
    const entry = JSON.parse(readFileSync(file, "utf-8"));
    if (isLive(url) && Date.now() - entry.fetchedAt > LIVE_TTL_MS) return null;
    return entry.data;
  } catch {
    return null; // corrupt entry — treat as a miss
  }
}

export function cacheSet(url, data) {
  if (process.env.CACHE_DISABLED === "1") return;
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(pathFor(url), JSON.stringify({ url, fetchedAt: Date.now(), data }), "utf-8");
  } catch (err) {
    console.warn(`Cache write failed for ${url}: ${err.message}`);
  }
}

export function cacheStats() {
  if (!existsSync(CACHE_DIR)) return { entries: 0, bytes: 0 };
  const files = readdirSync(CACHE_DIR).filter(f => f.endsWith(".json"));
  const bytes = files.reduce((s, f) => s + statSync(resolve(CACHE_DIR, f)).size, 0);
  return { entries: files.length, bytes };
}

export function cacheClear() {
  if (!existsSync(CACHE_DIR)) return 0;
  const files = readdirSync(CACHE_DIR).filter(f => f.endsWith(".json"));
  for (const f of files) unlinkSync(resolve(CACHE_DIR, f));
  return files.length;
}
