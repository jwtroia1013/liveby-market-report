import { createRequire } from "module";
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
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status} for ${url}: ${text}`);
  }
  const json = await res.json();
  if (!json.success) {
    throw new Error(`API error for ${url}: ${JSON.stringify(json)}`);
  }
  return json.data;
}

function periodKey(year, month) {
  return `${year}-M${month}`;
}

export async function fetchMarketReport({ county, state, month, year, propertySubType = "SingleFamilyResidence" }) {
  const countyEncoded = encodeURIComponent(county);
  const stateEncoded = encodeURIComponent(state);
  const base = `area-level-2=${countyEncoded}&area-level-1=${stateEncoded}&property-type=Residential&property-sub-type=${propertySubType}`;

  // --- Call 1: Sold stats — 36 months grouped by month (covers 13-month trend + 3-year bar chart) ---
  const start36 = addMonths(year, month, -35);
  const end36 = addMonths(year, month, 1);
  const interval36 = `${firstOfMonth(start36.year, start36.month)}/${firstOfMonth(end36.year, end36.month)}`;
  const soldMonthly = await apiFetch(`/v4/market-statistics?time-interval=${interval36}&${base}&group-by=month`);

  const currentKey = periodKey(year, month);
  const lastMonthInfo = addMonths(year, month, -1);
  const lastYearInfo = addMonths(year, month, -12);
  const lastMonthKey = periodKey(lastMonthInfo.year, lastMonthInfo.month);
  const lastYearKey = periodKey(lastYearInfo.year, lastYearInfo.month);

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

  const currentPeriod = extractPeriodData(findPeriod(soldMonthly, currentKey));
  const lastMonthPeriod = extractPeriodData(findPeriod(soldMonthly, lastMonthKey));
  const lastYearPeriod = extractPeriodData(findPeriod(soldMonthly, lastYearKey));

  // Last 3 months for trend calcs
  const threeMonthPeriods = [-2, -1, 0].map(delta => {
    const info = addMonths(year, month, delta);
    return extractPeriodData(findPeriod(soldMonthly, periodKey(info.year, info.month)));
  });

  // --- Call 1b: New listings added — same 36-month window grouped by month ---
  const addedToMarket = await apiFetch(`/v4/market-statistics/added-to-market?time-interval=${interval36}&${base}&group-by=month`);
  const newListingsCurrent  = findPeriod(addedToMarket, currentKey)?.data?.count ?? null;
  const newListingsLastMonth = findPeriod(addedToMarket, lastMonthKey)?.data?.count ?? null;
  const newListingsLastYear  = findPeriod(addedToMarket, lastYearKey)?.data?.count ?? null;

  // --- Chart data: homes sold by calendar month for 3 years (Page 4 bar chart) ---
  const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const soldByCalendarMonth = Array.from({ length: 12 }, (_, i) => ({
    label: MONTH_ABBR[i],
    [year]:     findPeriod(soldMonthly, periodKey(year,     i + 1))?.data?.count ?? null,
    [year - 1]: findPeriod(soldMonthly, periodKey(year - 1, i + 1))?.data?.count ?? null,
    [year - 2]: findPeriod(soldMonthly, periodKey(year - 2, i + 1))?.data?.count ?? null,
  }));

  // --- Chart data: sale-to-list ratio for last 13 months (Page 4 line chart) ---
  const saleToListTrend = Array.from({ length: 13 }, (_, i) => {
    const info = addMonths(year, month, i - 12);
    const entry = findPeriod(soldMonthly, periodKey(info.year, info.month));
    return {
      label: `${MONTH_ABBR[info.month - 1]} ${info.year}`,
      shortLabel: MONTH_ABBR[info.month - 1],
      value: entry?.data?.saleToListRatio ?? null,
    };
  });

  // --- Call 2: YTD sold stats ---
  const endMonth = month + 1 > 12 ? 1 : month + 1;
  const endYear = month + 1 > 12 ? year + 1 : year;
  const ytdInterval = `${year}-01-01/${firstOfMonth(endYear, endMonth)}`;
  const ytdData = await apiFetch(`/v4/market-statistics?time-interval=${ytdInterval}&${base}`);
  const ytdCount = ytdData[0]?.data?.count ?? 0;

  // Last month's YTD (one month less) — for YTD row change comparison
  const lastMonthYtdEnd = addMonths(year, month, 0); // same as current month start
  const lastMonthYtdInterval = `${year}-01-01/${firstOfMonth(year, month)}`;
  const lastMonthYtdData = await apiFetch(`/v4/market-statistics?time-interval=${lastMonthYtdInterval}&${base}`);
  const lastMonthYtdCount = lastMonthYtdData[0]?.data?.count ?? 0;

  const priorEndMonth = month + 1 > 12 ? 1 : month + 1;
  const priorEndYear = month + 1 > 12 ? year : year - 1;
  const priorYtdInterval = `${year - 1}-01-01/${firstOfMonth(priorEndYear, priorEndMonth)}`;
  const priorYtdData = await apiFetch(`/v4/market-statistics?time-interval=${priorYtdInterval}&${base}`);
  const priorYtdCount = priorYtdData[0]?.data?.count ?? 0;

  // --- Call 3: Active market snapshot (count + prices from active-only) ---
  const activeData = await apiFetch(`/v4/market-statistics/active?${base}&status=Active`);
  const active = activeData[0]?.data ?? {};

  // --- Call 4: Under contract count ---
  const contractData = await apiFetch(`/v4/market-statistics/active?${base}&status=Pending&status=ActiveUnderContract`);
  const underContractCount = contractData[0]?.data?.count ?? 0;

  // DOM snapshot: active + under contract combined (matches LiveBy's median DOM calculation)
  const allStatusData = await apiFetch(`/v4/market-statistics/active?${base}&status=Active&status=Pending&status=ActiveUnderContract`);
  const allStatus = allStatusData[0]?.data ?? {};

  const activeSnapshot = {
    count: active.count,
    medianListPrice: allStatus.ListPrice?.median,
    highPrice: allStatus.ListPrice?.maximum,
    lowPrice: allStatus.ListPrice?.minimum,
    medianDaysOnSite: allStatus.daysOnSite?.median,
  };

  // --- Call 5: Active by price segment ---
  const priceSegments = [250000, 500000, 750000, 1000000, 1250000, 1500000, 1750000, 2000000, 2250000, 2500000];
  const segParams = priceSegments.map(p => `price-segment=${p}`).join("&");
  const activeBySegment = await apiFetch(`/v4/market-statistics/active?${base}&status=Active&${segParams}`);

  // --- Call 6: Sold by price segment — 6 months grouped by month ---
  const start6 = addMonths(year, month, -5);
  const end6 = addMonths(year, month, 1);
  const interval6 = `${firstOfMonth(start6.year, start6.month)}/${firstOfMonth(end6.year, end6.month)}`;
  const soldBySegment = await apiFetch(`/v4/market-statistics?time-interval=${interval6}&${base}&${segParams}&group-by=month`);

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
