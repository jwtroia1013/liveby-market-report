import { createRequire } from "module";
import { cacheGet, cacheSet } from "./cache.js";
const require = createRequire(import.meta.url);
const config = require("../config.json");

const BASE_URL = "https://api.liveby.com";
const headers = { "Authorization": `Bearer ${process.env.LIVEBY_API_KEY || config.apiKey}` };

function pad(n) {
  return String(n).padStart(2, "0");
}

function firstOfMonth(year, month) {
  return `${year}-${pad(month)}-01`;
}

function addMonths(year, month, delta) {
  let m = month - 1 + delta;
  let y = year + Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return { year: y, month: m + 1 };
}

async function apiFetch(path) {
  const url = `${BASE_URL}${path}`;

  const cached = cacheGet(url);
  if (cached) return cached;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status} for ${url}: ${text}`);
  }
  const json = await res.json();
  if (!json.success) {
    throw new Error(`API error for ${url}: ${JSON.stringify(json)}`);
  }
  cacheSet(url, json.data);
  return json.data;
}

function periodKey(year, month) {
  return `${year}-M${month}`;
}

// CT planning regions use boundary IDs instead of area-level-2 names
const BOUNDARY_ID_RE = /^[0-9a-f]{24}$/i;

/**
 * Area params covering every county in a region at once.
 *
 * The API accepts repeated area-level-2 values and aggregates over the combined set,
 * so medians come back as the region's true median rather than a median of medians.
 */
function regionAreaParams(region) {
  const boundaryIds = region.counties.filter(c => BOUNDARY_ID_RE.test(c));
  const names       = region.counties.filter(c => !BOUNDARY_ID_RE.test(c));

  if (boundaryIds.length && !names.length) {
    return boundaryIds.map(id => `boundary-id=${id}`).join("&");
  }
  if (boundaryIds.length) {
    throw new Error(`Region "${region.name}" mixes boundary IDs and county names, which cannot be combined in one query.`);
  }
  return [
    ...names.map(c => `area-level-2=${encodeURIComponent(c)}`),
    `area-level-1=${encodeURIComponent(region.state)}`,
  ].join("&");
}

/**
 * Fetch a whole region for the monthly Regional Overview in one set of queries.
 *
 * Only the fields the regional report actually renders are fetched — the price
 * segments and 36-month chart series that the per-county report needs are not.
 */
export async function fetchMonthlyRegion({ region, month, year, propertySubType = "SingleFamilyResidence" }) {
  const base = `${regionAreaParams(region)}&property-type=Residential&property-sub-type=${propertySubType}`;

  const start36 = addMonths(year, month, -35);
  const next    = addMonths(year, month, 1);
  const interval36 = `${firstOfMonth(start36.year, start36.month)}/${firstOfMonth(next.year, next.month)}`;

  const ytdInterval      = `${year}-01-01/${firstOfMonth(next.year, next.month)}`;
  const priorEndYear     = month + 1 > 12 ? year : year - 1;
  const priorYtdInterval = `${year - 1}-01-01/${firstOfMonth(priorEndYear, next.month)}`;

  const [soldMonthly, addedToMarket, ytdData, priorYtdData, activeData, contractData] = await Promise.all([
    apiFetch(`/v4/market-statistics?time-interval=${interval36}&${base}&group-by=month`),
    apiFetch(`/v4/market-statistics/added-to-market?time-interval=${interval36}&${base}&group-by=month`),
    apiFetch(`/v4/market-statistics?time-interval=${ytdInterval}&${base}`),
    apiFetch(`/v4/market-statistics?time-interval=${priorYtdInterval}&${base}`),
    apiFetch(`/v4/market-statistics/active?${base}&status=Active`),
    apiFetch(`/v4/market-statistics/active?${base}&status=Pending&status=ActiveUnderContract`),
  ]);

  const currentKey   = periodKey(year, month);
  const lastYearInfo = addMonths(year, month, -12);
  const lastYearKey  = periodKey(lastYearInfo.year, lastYearInfo.month);

  const findPeriod = (data, key) => data.find(d => d.period === key) || null;
  const extract = (p) => {
    if (!p) return null;
    const d = p.data;
    return {
      count:              d.count,
      medianSalePrice:    d.ClosePrice?.median,
      salesVolume:        d.ClosePrice?.sum,
      medianDaysOnMarket: d.DaysOnMarket?.median,
      saleToListRatio:    d.saleToListRatio,
    };
  };

  return {
    name:     region.name,
    state:    region.state,
    counties: region.counties,
    month,
    year,
    propertySubType,
    current:  extract(findPeriod(soldMonthly, currentKey)),
    lastYear: extract(findPeriod(soldMonthly, lastYearKey)),
    // MOI uses the 3-month trailing average monthly sales rate.
    threeMonthPeriods: [-2, -1, 0].map(delta => {
      const info = addMonths(year, month, delta);
      return extract(findPeriod(soldMonthly, periodKey(info.year, info.month)));
    }),
    ytdCount:            ytdData[0]?.data?.count              ?? 0,
    priorYtdCount:       priorYtdData[0]?.data?.count         ?? 0,
    ytdMedianPrice:      ytdData[0]?.data?.ClosePrice?.median      ?? null,
    priorYtdMedianPrice: priorYtdData[0]?.data?.ClosePrice?.median ?? null,
    activeCount:        activeData[0]?.data?.count   ?? 0,
    underContractCount: contractData[0]?.data?.count ?? 0,
    newListingsCurrent:  findPeriod(addedToMarket, currentKey)?.data?.count  ?? 0,
    newListingsLastYear: findPeriod(addedToMarket, lastYearKey)?.data?.count ?? 0,
  };
}

export async function fetchMarketReport({ county, state, month, year, propertySubType = "SingleFamilyResidence" }) {
  const stateEncoded = encodeURIComponent(state);
  const areaParam = BOUNDARY_ID_RE.test(county)
    ? `boundary-id=${county}`
    : `area-level-2=${encodeURIComponent(county)}&area-level-1=${stateEncoded}`;
  const base = `${areaParam}&property-type=Residential&property-sub-type=${propertySubType}`;

  // Compute all URL parameters synchronously before firing requests
  const start36 = addMonths(year, month, -35);
  const interval36 = `${firstOfMonth(start36.year, start36.month)}/${firstOfMonth(addMonths(year, month, 1).year, addMonths(year, month, 1).month)}`;

  const endMonth = month + 1 > 12 ? 1 : month + 1;
  const endYear  = month + 1 > 12 ? year + 1 : year;
  const ytdInterval = `${year}-01-01/${firstOfMonth(endYear, endMonth)}`;
  const lastMonthYtdInterval = `${year}-01-01/${firstOfMonth(year, month)}`;

  const priorEndYear  = month + 1 > 12 ? year : year - 1;
  const priorYtdInterval = `${year - 1}-01-01/${firstOfMonth(priorEndYear, endMonth)}`;

  const priceSegments = [250000, 500000, 750000, 1000000, 1250000, 1500000, 1750000, 2000000, 2250000, 2500000];
  const segParams = priceSegments.map(p => `price-segment=${p}`).join("&");

  const start6 = addMonths(year, month, -5);
  const interval6 = `${firstOfMonth(start6.year, start6.month)}/${firstOfMonth(endYear, endMonth)}`;

  // Fire all 10 API calls in parallel — they are all independent
  const [
    soldMonthly, addedToMarket, ytdData, lastMonthYtdData, priorYtdData,
    activeData, contractData, allStatusData, activeBySegment, soldBySegment,
  ] = await Promise.all([
    apiFetch(`/v4/market-statistics?time-interval=${interval36}&${base}&group-by=month`),
    apiFetch(`/v4/market-statistics/added-to-market?time-interval=${interval36}&${base}&group-by=month`),
    apiFetch(`/v4/market-statistics?time-interval=${ytdInterval}&${base}`),
    apiFetch(`/v4/market-statistics?time-interval=${lastMonthYtdInterval}&${base}`),
    apiFetch(`/v4/market-statistics?time-interval=${priorYtdInterval}&${base}`),
    apiFetch(`/v4/market-statistics/active?${base}&status=Active`),
    apiFetch(`/v4/market-statistics/active?${base}&status=Pending&status=ActiveUnderContract`),
    apiFetch(`/v4/market-statistics/active?${base}&status=Active&status=Pending&status=ActiveUnderContract`),
    apiFetch(`/v4/market-statistics/active?${base}&status=Active&${segParams}`),
    apiFetch(`/v4/market-statistics?time-interval=${interval6}&${base}&${segParams}&group-by=month`),
  ]);

  // Process results
  const currentKey   = periodKey(year, month);
  const lastMonthKey = periodKey(...Object.values(addMonths(year, month, -1)));
  const lastYearKey  = periodKey(...Object.values(addMonths(year, month, -12)));

  function findPeriod(data, key) {
    return data.find(d => d.period === key) || null;
  }

  function extractPeriodData(periodObj) {
    if (!periodObj) return null;
    const d = periodObj.data;
    return {
      count: d.count,
      medianSalePrice: d.ClosePrice?.median,
      medianListPrice: d.ListPrice?.median,
      saleToListRatio: d.saleToListRatio,
      salesVolume: d.ClosePrice?.sum,
      medianDaysOnMarket: d.DaysOnMarket?.median,
    };
  }

  const currentPeriod   = extractPeriodData(findPeriod(soldMonthly, currentKey));
  const lastMonthPeriod = extractPeriodData(findPeriod(soldMonthly, lastMonthKey));
  const lastYearPeriod  = extractPeriodData(findPeriod(soldMonthly, lastYearKey));

  const threeMonthPeriods = [-2, -1, 0].map(delta => {
    const info = addMonths(year, month, delta);
    return extractPeriodData(findPeriod(soldMonthly, periodKey(info.year, info.month)));
  });

  const newListingsCurrent   = findPeriod(addedToMarket, currentKey)?.data?.count ?? null;
  const newListingsLastMonth = findPeriod(addedToMarket, lastMonthKey)?.data?.count ?? null;
  const newListingsLastYear  = findPeriod(addedToMarket, lastYearKey)?.data?.count ?? null;

  const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const soldByCalendarMonth = Array.from({ length: 12 }, (_, i) => ({
    label: MONTH_ABBR[i],
    [year]:     findPeriod(soldMonthly, periodKey(year,     i + 1))?.data?.count ?? null,
    [year - 1]: findPeriod(soldMonthly, periodKey(year - 1, i + 1))?.data?.count ?? null,
    [year - 2]: findPeriod(soldMonthly, periodKey(year - 2, i + 1))?.data?.count ?? null,
  }));

  const saleToListTrend = Array.from({ length: 13 }, (_, i) => {
    const info = addMonths(year, month, i - 12);
    const entry = findPeriod(soldMonthly, periodKey(info.year, info.month));
    return {
      label: `${MONTH_ABBR[info.month - 1]} ${info.year}`,
      shortLabel: MONTH_ABBR[info.month - 1],
      value: entry?.data?.saleToListRatio ?? null,
      count: entry?.data?.count ?? 0,
    };
  });

  const ytdCount         = ytdData[0]?.data?.count ?? 0;
  const lastMonthYtdCount = lastMonthYtdData[0]?.data?.count ?? 0;
  const priorYtdCount    = priorYtdData[0]?.data?.count ?? 0;

  const active    = activeData[0]?.data ?? {};
  const allStatus = allStatusData[0]?.data ?? {};
  const underContractCount = contractData[0]?.data?.count ?? 0;

  const activeSnapshot = {
    count: active.count,
    medianListPrice: allStatus.ListPrice?.median,
    highPrice: allStatus.ListPrice?.maximum,
    lowPrice: allStatus.ListPrice?.minimum,
  };

  return {
    county,
    state,
    month,
    year,
    propertySubType,
    soldMonthly,
    currentPeriod,
    lastMonthPeriod,
    lastYearPeriod,
    threeMonthPeriods,
    ytdCount,
    lastMonthYtdCount,
    priorYtdCount,
    activeSnapshot,
    underContractCount,
    activeBySegment,
    soldBySegment,
    priceSegments,
    newListingsCurrent,
    newListingsLastMonth,
    newListingsLastYear,
    soldByCalendarMonth,
    saleToListTrend,
  };
}
