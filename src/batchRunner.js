import { mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { fetchMarketReport } from "./fetchData.js";
import { analyzeMarket } from "./analyzeMarket.js";
import { generateReport } from "./generateReport.js";
import { BATCH_NY, BATCH_NJ } from "./batchConfig.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const delay = ms => new Promise(r => setTimeout(r, ms));

function lastCompletedMonth() {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed = previous month in 1-indexed
  const year = now.getFullYear();
  if (month === 0) return { month: 12, year: year - 1 };
  return { month, year };
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function propertyTypeSlug(pt) {
  if (pt === "SingleFamilyResidence") return "SingleFamily";
  if (pt === "Condominium") return "Condo";
  return pt;
}

function buildReportList(states) {
  const configs = [];
  const stateMap = { "New York": BATCH_NY, "New Jersey": BATCH_NJ };
  for (const state of states) {
    const batch = stateMap[state];
    if (!batch) {
      console.warn(`Unknown state: ${state} — skipping`);
      continue;
    }
    for (const county of batch.counties) {
      for (const propertyType of batch.propertyTypes) {
        configs.push({ county, state, propertyType });
      }
    }
  }
  return configs;
}

function stateDir(state) {
  return state.replace(/\s+/g, ""); // "New York" → "NewYork" (no spaces in URLs)
}

function saveReport(html, { county, state, propertyType, month, year }) {
  const slug = propertyTypeSlug(propertyType);
  const filename = `${county.replace(/\s+/g, "-")}-${slug}-${pad(month)}-${year}.html`;
  const dir = resolve(__dirname, "../reports", stateDir(state));
  mkdirSync(dir, { recursive: true });
  const filePath = resolve(dir, filename);
  writeFileSync(filePath, html, "utf-8");
  return `reports/${stateDir(state)}/${filename}`;
}

/**
 * Run a batch of county reports.
 *
 * @param {object} options
 * @param {string[]} options.states  - e.g. ["New York"] or ["New York", "New Jersey"]
 * @param {object}  options.agent   - { name, email, website } for the report footer
 * @param {function} options.onProgress - callback({ current, total, county, state, propertyType })
 * @returns {Promise<object[]>} - array of result objects with status/path/error per report
 */
export async function runBatch({ states, agent = {}, onProgress, collectData = false } = {}) {
  const { month, year } = lastCompletedMonth();
  const configs = buildReportList(states);
  const total = configs.length;
  const results = [];

  console.log(`Starting batch: ${total} reports for ${month}/${year}`);

  for (let i = 0; i < configs.length; i++) {
    const { county, state, propertyType } = configs[i];

    onProgress?.({ current: i + 1, total, county, state, propertyType });

    try {
      console.log(`[${i + 1}/${total}] Fetching: ${county}, ${state} — ${propertyType}`);
      const data = await fetchMarketReport({ county, state, month, year, propertySubType: propertyType });

      // Breathing room before Anthropic API call
      await delay(2000);

      console.log(`[${i + 1}/${total}] Analyzing: ${county}, ${state} — ${propertyType}`);
      const analysis = await analyzeMarket(data);

      const html = generateReport(data, analysis, agent.name || agent.email || agent.website ? agent : null);
      const path = saveReport(html, { county, state, propertyType, month, year });

      console.log(`[${i + 1}/${total}] Saved: ${path}`);
      results.push({ county, state, propertyType, month, year, status: "success", path,
        ...(collectData ? { data } : {}) });
    } catch (err) {
      console.error(`[${i + 1}/${total}] FAILED: ${county}, ${state} — ${propertyType}: ${err.message}`);
      results.push({ county, state, propertyType, month, year, status: "error", error: err.message });
    }

    // Rate limit buffer between reports (skip after last one)
    if (i < configs.length - 1) {
      await delay(500);
    }
  }

  const succeeded = results.filter(r => r.status === "success").length;
  const failed = results.filter(r => r.status === "error").length;
  console.log(`\nBatch complete: ${succeeded} succeeded, ${failed} failed`);

  return results;
}
