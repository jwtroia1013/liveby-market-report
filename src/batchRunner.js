import { mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { fetchMarketReport } from "./fetchData.js";
import { analyzeMarket } from "./analyzeMarket.js";
import { generateReport } from "./generateReport.js";
import { BATCH_NY, BATCH_NJ, BATCH_CT } from "./batchConfig.js";

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
  if (pt === "CondoTownhome") return "CondoTownhome";
  return pt;
}

function mergePeriod(a, b) {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  const count = (a.count ?? 0) + (b.count ?? 0);
  const salesVolume = (a.salesVolume ?? 0) + (b.salesVolume ?? 0);
  const aW = a.count ?? 0, bW = b.count ?? 0, totalW = aW + bW;
  const wavg = (av, bv) =>
    totalW > 0 && (av != null || bv != null)
      ? ((av ?? 0) * aW + (bv ?? 0) * bW) / totalW
      : null;
  return {
    count,
    salesVolume,
    medianSalePrice: salesVolume && count ? salesVolume / count : null,
    medianListPrice: wavg(a.medianListPrice, b.medianListPrice),
    saleToListRatio: wavg(a.saleToListRatio, b.saleToListRatio),
    medianDaysOnMarket: wavg(a.medianDaysOnMarket, b.medianDaysOnMarket),
  };
}

function mergeMarketData(a, b) {
  const soldByCalendarMonth = a.soldByCalendarMonth.map((aMonth, i) => {
    const bMonth = b.soldByCalendarMonth[i];
    const merged = { label: aMonth.label };
    for (const key of Object.keys(aMonth)) {
      if (key === "label") continue;
      merged[key] = (aMonth[key] ?? 0) + (bMonth?.[key] ?? 0);
    }
    return merged;
  });

  const saleToListTrend = a.saleToListTrend.map((aEntry, i) => {
    const bEntry = b.saleToListTrend[i];
    const aCount = a.currentPeriod?.count ?? 1;
    const bCount = b.currentPeriod?.count ?? 1;
    const total = aCount + bCount;
    const value = (aEntry.value != null || bEntry?.value != null)
      ? ((aEntry.value ?? 0) * aCount + (bEntry?.value ?? 0) * bCount) / total
      : null;
    return { label: aEntry.label, shortLabel: aEntry.shortLabel, value };
  });

  const activeBySegment = a.activeBySegment.map((aSeg, i) => {
    const bSeg = b.activeBySegment[i];
    return { ...aSeg, data: { ...aSeg.data, count: (aSeg.data?.count ?? 0) + (bSeg?.data?.count ?? 0) } };
  });

  const soldBySegment = a.soldBySegment.map((aPeriod) => {
    const bPeriod = b.soldBySegment.find(p => p.period === aPeriod.period);
    return { ...aPeriod, data: { ...aPeriod.data, count: (aPeriod.data?.count ?? 0) + (bPeriod?.data?.count ?? 0) } };
  });

  const aW = a.activeSnapshot?.count ?? 0, bW = b.activeSnapshot?.count ?? 0, totW = aW + bW;
  const awavg = (av, bv) => totW > 0 ? ((av ?? 0) * aW + (bv ?? 0) * bW) / totW : null;

  return {
    county: a.county,
    state: a.state,
    month: a.month,
    year: a.year,
    propertySubType: "CondoTownhome",
    soldMonthly: a.soldMonthly,
    currentPeriod: mergePeriod(a.currentPeriod, b.currentPeriod),
    lastMonthPeriod: mergePeriod(a.lastMonthPeriod, b.lastMonthPeriod),
    lastYearPeriod: mergePeriod(a.lastYearPeriod, b.lastYearPeriod),
    threeMonthPeriods: a.threeMonthPeriods.map((p, i) => mergePeriod(p, b.threeMonthPeriods[i])),
    ytdCount: (a.ytdCount ?? 0) + (b.ytdCount ?? 0),
    lastMonthYtdCount: (a.lastMonthYtdCount ?? 0) + (b.lastMonthYtdCount ?? 0),
    priorYtdCount: (a.priorYtdCount ?? 0) + (b.priorYtdCount ?? 0),
    activeSnapshot: {
      count: aW + bW,
      medianListPrice: awavg(a.activeSnapshot?.medianListPrice, b.activeSnapshot?.medianListPrice),
      highPrice: Math.max(a.activeSnapshot?.highPrice ?? 0, b.activeSnapshot?.highPrice ?? 0) || null,
      lowPrice: Math.min(a.activeSnapshot?.lowPrice ?? Infinity, b.activeSnapshot?.lowPrice ?? Infinity) || null,
      medianDaysOnSite: awavg(a.activeSnapshot?.medianDaysOnSite, b.activeSnapshot?.medianDaysOnSite),
    },
    underContractCount: (a.underContractCount ?? 0) + (b.underContractCount ?? 0),
    newListingsCurrent: (a.newListingsCurrent ?? 0) + (b.newListingsCurrent ?? 0),
    newListingsLastMonth: (a.newListingsLastMonth ?? 0) + (b.newListingsLastMonth ?? 0),
    newListingsLastYear: (a.newListingsLastYear ?? 0) + (b.newListingsLastYear ?? 0),
    priceSegments: a.priceSegments,
    activeBySegment,
    soldBySegment,
    soldByCalendarMonth,
    saleToListTrend,
  };
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
export async function runBatch({ states, propertyTypes = null, agent = {}, onProgress, collectData = false } = {}) {
  const { month, year } = lastCompletedMonth();
  const configs = buildReportList(states, propertyTypes);
  const total = configs.length;
  const results = [];

  console.log(`Starting batch: ${total} reports for ${month}/${year}`);

  for (let i = 0; i < configs.length; i++) {
    const { county, state, propertyType } = configs[i];

    onProgress?.({ current: i + 1, total, county, state, propertyType });

    try {
      console.log(`[${i + 1}/${total}] Fetching: ${county}, ${state} — ${propertyType}`);
      let data;
      if (propertyType === "CondoTownhome") {
        const [condoData, townhouseData] = await Promise.all([
          fetchMarketReport({ county, state, month, year, propertySubType: "Condominium" }),
          fetchMarketReport({ county, state, month, year, propertySubType: "Townhouse" }),
        ]);
        data = mergeMarketData(condoData, townhouseData);
      } else {
        data = await fetchMarketReport({ county, state, month, year, propertySubType: propertyType });
      }

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
