import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { fetchMarketReport } from "./fetchData.js";
import { analyzeMarket } from "./analyzeMarket.js";
import { generateReport } from "./generateReport.js";
import { BATCH_NY, BATCH_NJ, BATCH_CT } from "./batchConfig.js";
import { DATA_DIR } from "./cache.js";

const delay = ms => new Promise(r => setTimeout(r, ms));

function lastCompletedMonth() {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed = previous month in 1-indexed
  const year = now.getFullYear();
  if (month === 0) return { month: 12, year: year - 1 };
  return { month, year };
}

function lastCompletedQuarter() {
  const now = new Date();
  const currentQ = Math.ceil((now.getMonth() + 1) / 3);
  return currentQ === 1
    ? { quarter: 4, year: now.getFullYear() - 1 }
    : { quarter: currentQ - 1, year: now.getFullYear() };
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function propertyTypeSlug(pt) {
  if (pt === "SingleFamilyResidence") return "SingleFamily";
  if (pt === "CondoTownhome") return "CondoTownhome";
  return pt;
}

function buildReportList(states, propertyTypes = null) {
  const configs = [];
  const stateMap = { "New York": BATCH_NY, "New Jersey": BATCH_NJ, "Connecticut": BATCH_CT };
  for (const state of states) {
    const batch = stateMap[state];
    if (!batch) {
      console.warn(`Unknown state: ${state} — skipping`);
      continue;
    }
    const types = propertyTypes
      ? batch.propertyTypes.filter(t => propertyTypes.includes(t))
      : batch.propertyTypes;
    for (const county of batch.counties) {
      for (const propertyType of types) {
        configs.push({ county, state, propertyType });
      }
    }
  }
  return configs;
}

function stateDir(state) {
  return state.replace(/\s+/g, ""); // "New York" → "NewYork" (no spaces in URLs)
}

// Reports are written under DATA_DIR (the Railway volume in production) — the same place
// the server serves /reports from. Writing under the repo would 404 in production.
function saveReport(html, { county, state, propertyType, periodSlug }) {
  const slug = propertyTypeSlug(propertyType);
  const filename = `${county.replace(/\s+/g, "-")}-${slug}-${periodSlug}.html`;
  const dir = resolve(DATA_DIR, "reports", stateDir(state));
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, filename), html, "utf-8");
  return `reports/${stateDir(state)}/${filename}`;
}

/**
 * Run a batch of county reports for either the previous month or the previous quarter.
 *
 * @param {object} options
 * @param {string[]} options.states  - e.g. ["New York"] or ["New York", "New Jersey"]
 * @param {string}  options.period   - "month" (default) or "quarter"
 * @param {object}  options.agent    - { name, email, website } for the report footer
 * @param {function} options.onProgress - callback({ current, total, county, state, propertyType })
 * @returns {Promise<object[]>} - array of result objects with status/path/error per report
 */
export async function runBatch({ states, propertyTypes = null, agent = {}, onProgress, collectData = false, period = "month" } = {}) {
  const isQuarter = period === "quarter";
  const { month, year } = isQuarter ? { month: undefined, year: lastCompletedQuarter().year } : lastCompletedMonth();
  const quarter = isQuarter ? lastCompletedQuarter().quarter : undefined;
  const periodSlug = isQuarter ? `Q${quarter}-${year}` : `${pad(month)}-${year}`;
  const periodLabel = isQuarter ? `Q${quarter} ${year}` : `${pad(month)}/${year}`;

  const configs = buildReportList(states, propertyTypes);
  const total = configs.length;
  const results = [];

  console.log(`Starting batch: ${total} reports for ${periodLabel}`);

  for (let i = 0; i < configs.length; i++) {
    const { county, state, propertyType } = configs[i];

    onProgress?.({ current: i + 1, total, county, state, propertyType });

    try {
      console.log(`[${i + 1}/${total}] Fetching: ${county}, ${state} — ${propertyType}`);
      // CondoTownhome is fetched as a single query over both sub-types, so the API
      // returns the true combined median rather than an average of two medians.
      const data = await fetchMarketReport({
        county, state, year, period, month, quarter, propertySubType: propertyType,
      });

      console.log(`[${i + 1}/${total}] Analyzing: ${county}, ${state} — ${propertyType}`);
      const analysis = await analyzeMarket(data);

      const html = generateReport(data, analysis, agent.name || agent.email || agent.website ? agent : null);
      const path = saveReport(html, { county, state, propertyType, periodSlug });

      console.log(`[${i + 1}/${total}] Saved: ${path}`);
      results.push({ county, state, propertyType, month: data.month, year, quarter, period, status: "success", path,
        ...(collectData ? { data } : {}) });
    } catch (err) {
      console.error(`[${i + 1}/${total}] FAILED: ${county}, ${state} — ${propertyType}: ${err.message}`);
      results.push({ county, state, propertyType, month, year, quarter, period, status: "error", error: err.message });
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
