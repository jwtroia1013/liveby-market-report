import { createRequire } from "module";
const require = createRequire(import.meta.url);
const config = require("../config.json");

const BASE_URL = "https://api.liveby.com";
const headers = { "Authorization": `Bearer ${process.env.LIVEBY_API_KEY || config.apiKey}` };

function pad(n) { return String(n).padStart(2, "0"); }
function firstOfMonth(year, month) { return `${year}-${pad(month)}-01`; }
function addMonths(year, month, delta) {
  let m = month - 1 + delta;
  let y = year + Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return { year: y, month: m + 1 };
}
function periodKey(year, month) { return `${year}-M${month}`; }

async function apiFetch(path) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status} for ${url}: ${text}`);
  }
  const json = await res.json();
  if (!json.success) throw new Error(`API error for ${url}: ${JSON.stringify(json)}`);
  return json.data;
}

// areaType: "county" → area-level-2=X&area-level-1=Y
// areaType: "city"   → city=X&area-level-1=Y
function buildAreaParam(areaType, area, state) {
  const s = encodeURIComponent(state);
  if (areaType === "city") {
    return `city=${encodeURIComponent(area)}&area-level-1=${s}`;
  }
  return `area-level-2=${encodeURIComponent(area)}&area-level-1=${s}`;
}

async function fetchSnapshotRaw({ areaType, area, state, month, year, propertySubType }) {
  const areaParam = buildAreaParam(areaType, area, state);
  const base = `${areaParam}&property-type=Residential&property-sub-type=${propertySubType}`;

  // 36-month window to cover current + prior month + prior year
  const start36 = addMonths(year, month, -35);
  const interval36 = `${firstOfMonth(start36.year, start36.month)}/${firstOfMonth(addMonths(year, month, 1).year, addMonths(year, month, 1).month)}`;

  const [soldMonthly, addedToMarket] = await Promise.all([
    apiFetch(`/v4/market-statistics?time-interval=${interval36}&${base}&group-by=month`),
    apiFetch(`/v4/market-statistics/added-to-market?time-interval=${interval36}&${base}&group-by=month`),
  ]);

  const currentKey   = periodKey(year, month);
  const lastMonthKey = periodKey(...Object.values(addMonths(year, month, -1)));
  const lastYearKey  = periodKey(...Object.values(addMonths(year, month, -12)));

  function findPeriod(data, key) { return data.find(d => d.period === key) || null; }

  function extractMetrics(periodObj) {
    if (!periodObj) return null;
    const d = periodObj.data;
    return {
      count: d.count ?? null,
      medianSalePrice: d.ClosePrice?.median ?? null,
      medianListPrice: d.ListPrice?.median ?? null,
      medianDaysOnMarket: d.DaysOnMarket?.median ?? null,
    };
  }

  return {
    current:   extractMetrics(findPeriod(soldMonthly, currentKey)),
    prevMonth: extractMetrics(findPeriod(soldMonthly, lastMonthKey)),
    prevYear:  extractMetrics(findPeriod(soldMonthly, lastYearKey)),
    newListings: {
      current:   findPeriod(addedToMarket, currentKey)?.data?.count ?? null,
      prevMonth: findPeriod(addedToMarket, lastMonthKey)?.data?.count ?? null,
      prevYear:  findPeriod(addedToMarket, lastYearKey)?.data?.count ?? null,
    },
  };
}

function pctDiff(a, b) {
  if (a == null || b == null || b === 0) return null;
  return ((a - b) / Math.abs(b)) * 100;
}

function mergeRaw(a, b) {
  if (!a && !b) return { current: null, prevMonth: null, prevYear: null, newListings: { current: null, prevMonth: null, prevYear: null } };
  if (!a) return b;
  if (!b) return a;

  function mergePeriod(ap, bp) {
    if (!ap && !bp) return null;
    if (!ap) return bp;
    if (!bp) return ap;
    const countA = ap.count ?? 0, countB = bp.count ?? 0, total = countA + countB;
    const wavg = (av, bv) =>
      total > 0 && (av != null || bv != null)
        ? ((av ?? 0) * countA + (bv ?? 0) * countB) / total
        : null;
    return {
      count: total,
      medianSalePrice: wavg(ap.medianSalePrice, bp.medianSalePrice),
      medianListPrice: wavg(ap.medianListPrice, bp.medianListPrice),
      medianDaysOnMarket: wavg(ap.medianDaysOnMarket, bp.medianDaysOnMarket),
    };
  }

  return {
    current:   mergePeriod(a.current,   b.current),
    prevMonth: mergePeriod(a.prevMonth, b.prevMonth),
    prevYear:  mergePeriod(a.prevYear,  b.prevYear),
    newListings: {
      current:   (a.newListings.current ?? 0) + (b.newListings.current ?? 0),
      prevMonth: (a.newListings.prevMonth ?? 0) + (b.newListings.prevMonth ?? 0),
      prevYear:  (a.newListings.prevYear ?? 0) + (b.newListings.prevYear ?? 0),
    },
  };
}

export async function fetchSnapshot({ areaType, area, state, month, year, propertySubType }) {
  let raw;
  if (propertySubType === "CondoTownhome") {
    const [condoRaw, townhouseRaw] = await Promise.all([
      fetchSnapshotRaw({ areaType, area, state, month, year, propertySubType: "Condominium" }),
      fetchSnapshotRaw({ areaType, area, state, month, year, propertySubType: "Townhouse" }),
    ]);
    raw = mergeRaw(condoRaw, townhouseRaw);
  } else {
    raw = await fetchSnapshotRaw({ areaType, area, state, month, year, propertySubType });
  }

  const { current, prevMonth, prevYear, newListings } = raw;

  const prevMonthLabel = (() => {
    const pm = addMonths(year, month, -1);
    return `${MONTH_NAMES[pm.month - 1]} ${pm.year}`;
  })();
  const prevYearLabel = (() => {
    const py = addMonths(year, month, -12);
    return `${MONTH_NAMES[py.month - 1]} ${py.year}`;
  })();

  return {
    areaType, area, state, month, year, propertySubType,
    currentLabel:   `${MONTH_NAMES[month - 1]} ${year}`,
    prevMonthLabel,
    prevYearLabel,
    metrics: {
      homesSold: {
        current:       current?.count ?? null,
        prevMonth:     prevMonth?.count ?? null,
        prevYear:      prevYear?.count ?? null,
        pctVsPrevMonth: pctDiff(current?.count, prevMonth?.count),
        pctVsPrevYear:  pctDiff(current?.count, prevYear?.count),
      },
      newListings: {
        current:       newListings.current,
        prevMonth:     newListings.prevMonth,
        prevYear:      newListings.prevYear,
        pctVsPrevMonth: pctDiff(newListings.current, newListings.prevMonth),
        pctVsPrevYear:  pctDiff(newListings.current, newListings.prevYear),
      },
      medianSalePrice: {
        current:       current?.medianSalePrice ?? null,
        prevMonth:     prevMonth?.medianSalePrice ?? null,
        prevYear:      prevYear?.medianSalePrice ?? null,
        pctVsPrevMonth: pctDiff(current?.medianSalePrice, prevMonth?.medianSalePrice),
        pctVsPrevYear:  pctDiff(current?.medianSalePrice, prevYear?.medianSalePrice),
      },
      medianListPrice: {
        current:       current?.medianListPrice ?? null,
        prevMonth:     prevMonth?.medianListPrice ?? null,
        prevYear:      prevYear?.medianListPrice ?? null,
        pctVsPrevMonth: pctDiff(current?.medianListPrice, prevMonth?.medianListPrice),
        pctVsPrevYear:  pctDiff(current?.medianListPrice, prevYear?.medianListPrice),
      },
      daysOnMarket: {
        current:       current?.medianDaysOnMarket ?? null,
        prevMonth:     prevMonth?.medianDaysOnMarket ?? null,
        prevYear:      prevYear?.medianDaysOnMarket ?? null,
        pctVsPrevMonth: pctDiff(current?.medianDaysOnMarket, prevMonth?.medianDaysOnMarket),
        pctVsPrevYear:  pctDiff(current?.medianDaysOnMarket, prevYear?.medianDaysOnMarket),
      },
    },
  };
}

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];
