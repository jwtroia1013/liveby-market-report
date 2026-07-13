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

/**
 * "CondoTownhome" is Condominium + Townhouse. Passing both sub-types in one query lets
 * the API aggregate them, so the combined median is its real median — merging two
 * per-sub-type reports afterwards would average two medians, which is not a median.
 */
export const SUB_TYPE_GROUPS = {
  CondoTownhome: ["Condominium", "Townhouse"],
};

function subTypeParams(propertySubType) {
  const types = SUB_TYPE_GROUPS[propertySubType] ?? [propertySubType];
  return types.map(t => `property-sub-type=${encodeURIComponent(t)}`).join("&");
}

// Quarter q of `year` as "YYYY-MM-01/YYYY-MM-01" (end exclusive).
function quarterInterval(q, year) {
  const startMonth = (q - 1) * 3 + 1;
  const end = addMonths(year, startMonth, 3);
  return `${firstOfMonth(year, startMonth)}/${firstOfMonth(end.year, end.month)}`;
}

function previousQuarterOf(q, year) {
  return q === 1 ? { quarter: 4, year: year - 1 } : { quarter: q - 1, year };
}

/**
 * Fetch a county report for either the previous month or the previous quarter.
 *
 * Quarterly figures come from direct quarter-long interval queries — NOT from combining
 * three monthly figures. Counts and volume would be safe to sum, but medians, days on
 * market and sale-to-list ratio would not be.
 *
 * The month-based sections (price-range table, charts, inventory gauge) are keyed to the
 * quarter's final month, so they carry over unchanged.
 */
export async function fetchMarketReport({
  county, state, year,
  period = "month",
  month, quarter,
  propertySubType = "SingleFamilyResidence",
}) {
  const isQuarter = period === "quarter";
  // Month the month-based sections key off: the quarter's last month in quarterly mode.
  const effMonth = isQuarter ? quarter * 3 : month;

  const stateEncoded = encodeURIComponent(state);
  const areaParam = BOUNDARY_ID_RE.test(county)
    ? `boundary-id=${county}`
    : `area-level-2=${encodeURIComponent(county)}&area-level-1=${stateEncoded}`;
  const base = `${areaParam}&property-type=Residential&${subTypeParams(propertySubType)}`;

  // Compute all URL parameters synchronously before firing requests
  const start36 = addMonths(year, effMonth, -35);
  const next    = addMonths(year, effMonth, 1);
  const interval36 = `${firstOfMonth(start36.year, start36.month)}/${firstOfMonth(next.year, next.month)}`;

  const endMonth = next.month;
  const endYear  = next.year;
  const ytdInterval = `${year}-01-01/${firstOfMonth(endYear, endMonth)}`;

  // YTD through the end of the *prior* period: last month, or the prior quarter's end.
  const priorPeriodYtdEnd = isQuarter
    ? firstOfMonth(year, (quarter - 1) * 3 + 1)   // Jan 1 → start of this quarter
    : firstOfMonth(year, effMonth);               // Jan 1 → start of this month
  const priorPeriodYtdInterval = `${year}-01-01/${priorPeriodYtdEnd}`;

  const priorEndYear  = effMonth + 1 > 12 ? year : year - 1;
  const priorYtdInterval = `${year - 1}-01-01/${firstOfMonth(priorEndYear, endMonth)}`;

  const priceSegments = [250000, 500000, 750000, 1000000, 1250000, 1500000, 1750000, 2000000, 2250000, 2500000];
  const segParams = priceSegments.map(p => `price-segment=${p}`).join("&");

  const start6 = addMonths(year, effMonth, -5);
  const interval6 = `${firstOfMonth(start6.year, start6.month)}/${firstOfMonth(endYear, endMonth)}`;

  // In quarterly mode, three extra interval queries give the API's true quarterly
  // medians, DOM and sale-to-list — figures that cannot be derived from monthly data.
  // New-listing counts are NOT summable across months: the API dedupes within a period,
  // so a property relisted inside the quarter counts once in a quarter query but twice
  // when you add up the months. Query each quarter directly.
  const priorQ = isQuarter ? previousQuarterOf(quarter, year) : null;
  const quarterCalls = isQuarter ? [
    apiFetch(`/v4/market-statistics?time-interval=${quarterInterval(quarter, year)}&${base}`),
    apiFetch(`/v4/market-statistics?time-interval=${quarterInterval(priorQ.quarter, priorQ.year)}&${base}`),
    apiFetch(`/v4/market-statistics?time-interval=${quarterInterval(quarter, year - 1)}&${base}`),
    apiFetch(`/v4/market-statistics/added-to-market?time-interval=${quarterInterval(quarter, year)}&${base}`),
    apiFetch(`/v4/market-statistics/added-to-market?time-interval=${quarterInterval(priorQ.quarter, priorQ.year)}&${base}`),
    apiFetch(`/v4/market-statistics/added-to-market?time-interval=${quarterInterval(quarter, year - 1)}&${base}`),
  ] : [];

  const [
    soldMonthly, addedToMarket, ytdData, priorPeriodYtdData, priorYtdData,
    activeData, contractData, allStatusData, activeBySegment, soldBySegment,
    ...quarterResults
  ] = await Promise.all([
    apiFetch(`/v4/market-statistics?time-interval=${interval36}&${base}&group-by=month`),
    apiFetch(`/v4/market-statistics/added-to-market?time-interval=${interval36}&${base}&group-by=month`),
    apiFetch(`/v4/market-statistics?time-interval=${ytdInterval}&${base}`),
    apiFetch(`/v4/market-statistics?time-interval=${priorPeriodYtdInterval}&${base}`),
    apiFetch(`/v4/market-statistics?time-interval=${priorYtdInterval}&${base}`),
    apiFetch(`/v4/market-statistics/active?${base}&status=Active`),
    apiFetch(`/v4/market-statistics/active?${base}&status=Pending&status=ActiveUnderContract`),
    apiFetch(`/v4/market-statistics/active?${base}&status=Active&status=Pending&status=ActiveUnderContract`),
    apiFetch(`/v4/market-statistics/active?${base}&status=Active&${segParams}`),
    apiFetch(`/v4/market-statistics?time-interval=${interval6}&${base}&${segParams}&group-by=month`),
    ...quarterCalls,
  ]);

  // Process results
  const currentKey   = periodKey(year, effMonth);
  const lastMonthKey = periodKey(...Object.values(addMonths(year, effMonth, -1)));
  const lastYearKey  = periodKey(...Object.values(addMonths(year, effMonth, -12)));

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

  // The trends table: monthly figures come from the grouped series; quarterly figures
  // come from the dedicated interval queries above.
  const extractInterval = (res) => extractPeriodData(res?.[0] ? { data: res[0].data } : null);

  const currentPeriod = isQuarter
    ? extractInterval(quarterResults[0])
    : extractPeriodData(findPeriod(soldMonthly, currentKey));
  const priorPeriod = isQuarter
    ? extractInterval(quarterResults[1])
    : extractPeriodData(findPeriod(soldMonthly, lastMonthKey));
  const lastYearPeriod = isQuarter
    ? extractInterval(quarterResults[2])
    : extractPeriodData(findPeriod(soldMonthly, lastYearKey));

  const threeMonthPeriods = [-2, -1, 0].map(delta => {
    const info = addMonths(year, effMonth, delta);
    return extractPeriodData(findPeriod(soldMonthly, periodKey(info.year, info.month)));
  });

  const newListingsCurrent = isQuarter
    ? quarterResults[3]?.[0]?.data?.count ?? null
    : findPeriod(addedToMarket, currentKey)?.data?.count ?? null;
  const newListingsPrior = isQuarter
    ? quarterResults[4]?.[0]?.data?.count ?? null
    : findPeriod(addedToMarket, lastMonthKey)?.data?.count ?? null;
  const newListingsLastYear = isQuarter
    ? quarterResults[5]?.[0]?.data?.count ?? null
    : findPeriod(addedToMarket, lastYearKey)?.data?.count ?? null;

  const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const soldByCalendarMonth = Array.from({ length: 12 }, (_, i) => ({
    label: MONTH_ABBR[i],
    [year]:     findPeriod(soldMonthly, periodKey(year,     i + 1))?.data?.count ?? null,
    [year - 1]: findPeriod(soldMonthly, periodKey(year - 1, i + 1))?.data?.count ?? null,
    [year - 2]: findPeriod(soldMonthly, periodKey(year - 2, i + 1))?.data?.count ?? null,
  }));

  const saleToListTrend = Array.from({ length: 13 }, (_, i) => {
    const info = addMonths(year, effMonth, i - 12);
    const entry = findPeriod(soldMonthly, periodKey(info.year, info.month));
    return {
      label: `${MONTH_ABBR[info.month - 1]} ${info.year}`,
      shortLabel: MONTH_ABBR[info.month - 1],
      value: entry?.data?.saleToListRatio ?? null,
      count: entry?.data?.count ?? 0,
    };
  });

  const ytdCount           = ytdData[0]?.data?.count ?? 0;
  const priorPeriodYtdCount = priorPeriodYtdData[0]?.data?.count ?? 0;
  const priorYtdCount      = priorYtdData[0]?.data?.count ?? 0;

  const active    = activeData[0]?.data ?? {};
  const allStatus = allStatusData[0]?.data ?? {};
  const underContractCount = contractData[0]?.data?.count ?? 0;

  const activeSnapshot = {
    count: active.count,
    medianListPrice: allStatus.ListPrice?.median,
    highPrice: allStatus.ListPrice?.maximum,
    lowPrice: allStatus.ListPrice?.minimum,
  };

  const MONTH_NAMES = ["January","February","March","April","May","June",
    "July","August","September","October","November","December"];

  // Labels the report renders; everything period-specific is decided here.
  const periodMeta = isQuarter
    ? {
        type: "quarter",
        quarter,
        currentLabel:  `Q${quarter} ${year}`,
        priorLabel:    `Q${priorQ.quarter} ${priorQ.year}`,
        lastYearLabel: `Q${quarter} ${year - 1}`,
        priorChangeLabel: "Last Quarter",
        headingLabel:  `Q${quarter} ${year}`,
        slug:          `Q${quarter}-${year}`,
      }
    : {
        type: "month",
        currentLabel:  `${MONTH_NAMES[effMonth - 1]} ${year}`,
        priorLabel:    (() => { const p = addMonths(year, effMonth, -1); return `${MONTH_NAMES[p.month - 1]} ${p.year}`; })(),
        lastYearLabel: `${MONTH_NAMES[effMonth - 1]} ${year - 1}`,
        priorChangeLabel: "Last Month",
        headingLabel:  `${MONTH_NAMES[effMonth - 1]} ${year}`,
        slug:          `${pad(effMonth)}-${year}`,
      };

  return {
    county,
    state,
    month: effMonth,
    year,
    period,
    quarter: isQuarter ? quarter : undefined,
    periodMeta,
    propertySubType,
    soldMonthly,
    currentPeriod,
    priorPeriod,
    lastYearPeriod,
    threeMonthPeriods,
    ytdCount,
    priorPeriodYtdCount,
    priorYtdCount,
    activeSnapshot,
    underContractCount,
    activeBySegment,
    soldBySegment,
    priceSegments,
    newListingsCurrent,
    newListingsPrior,
    newListingsLastYear,
    soldByCalendarMonth,
    saleToListTrend,
  };
}
