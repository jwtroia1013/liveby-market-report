import { createRequire } from "module";
const require = createRequire(import.meta.url);
const config = require("../config.json");

const BASE_URL = "https://api.liveby.com";
const headers = { "Authorization": `Bearer ${process.env.LIVEBY_API_KEY || config.apiKey}` };

function pad(n) { return String(n).padStart(2, "0"); }

const BOUNDARY_ID_RE = /^[0-9a-f]{24}$/i;

function areaParams(county, state) {
  return BOUNDARY_ID_RE.test(county)
    ? `boundary-id=${county}`
    : `area-level-2=${encodeURIComponent(county)}&area-level-1=${encodeURIComponent(state)}`;
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

// Returns "YYYY-MM-01/YYYY-MM-01" spanning the full quarter (exclusive end)
function quarterInterval(q, year) {
  const startMonth = (q - 1) * 3 + 1;
  const endYear  = q === 4 ? year + 1 : year;
  const endMonth = q === 4 ? 1 : q * 3 + 1;
  return `${year}-${pad(startMonth)}-01/${endYear}-${pad(endMonth)}-01`;
}

export function previousQuarter() {
  const now = new Date();
  const month = now.getMonth() + 1; // 1–12
  const year  = now.getFullYear();
  const currentQ = Math.ceil(month / 3);
  const prevQ     = currentQ === 1 ? 4 : currentQ - 1;
  const prevQYear = currentQ === 1 ? year - 1 : year;
  return { quarter: prevQ, year: prevQYear };
}

export function quarterLabel(q, year) {
  return `Q${q} ${year}`;
}

function extractPeriod(data) {
  if (!data || !data[0]) return null;
  const d = data[0].data;
  return {
    count:               d.count               ?? null,
    medianSalePrice:     d.ClosePrice?.median  ?? null,
    salesVolume:         d.ClosePrice?.sum      ?? null,
    medianDaysOnMarket:  d.DaysOnMarket?.median ?? null,
    saleToListRatio:     d.saleToListRatio      ?? null,
  };
}

export async function fetchQuarterlyData({ county, state, quarter, year, propertySubType = "SingleFamilyResidence" }) {
  const area = areaParams(county, state);
  const base = `${area}&property-type=Residential&property-sub-type=${propertySubType}`;

  const currentInterval = quarterInterval(quarter, year);
  const priorInterval   = quarterInterval(quarter, year - 1);

  const [
    currentSold, priorSold,
    activeData, contractData,
    newListingsCurrent, newListingsPrior,
  ] = await Promise.all([
    apiFetch(`/v4/market-statistics?time-interval=${currentInterval}&${base}`),
    apiFetch(`/v4/market-statistics?time-interval=${priorInterval}&${base}`),
    apiFetch(`/v4/market-statistics/active?${base}&status=Active`),
    apiFetch(`/v4/market-statistics/active?${base}&status=Pending&status=ActiveUnderContract`),
    apiFetch(`/v4/market-statistics/added-to-market?time-interval=${currentInterval}&${base}`),
    apiFetch(`/v4/market-statistics/added-to-market?time-interval=${priorInterval}&${base}`),
  ]);

  return {
    county,
    state,
    quarter,
    year,
    propertySubType,
    current:            extractPeriod(currentSold),
    prior:              extractPeriod(priorSold),
    activeSnapshot: {
      count:           activeData[0]?.data?.count            ?? 0,
      medianListPrice: activeData[0]?.data?.ListPrice?.median ?? null,
    },
    underContractCount:   contractData[0]?.data?.count        ?? 0,
    newListingsCurrent:   newListingsCurrent[0]?.data?.count  ?? 0,
    newListingsPrior:     newListingsPrior[0]?.data?.count    ?? 0,
  };
}
