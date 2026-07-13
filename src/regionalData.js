export const REGIONS = [
  {
    name: "Westchester & Hudson Valley",
    state: "New York",
    counties: ["Westchester", "Putnam", "Rockland", "Orange", "Ulster", "Sullivan", "Dutchess", "Bronx"],
  },
  {
    name: "Northern New Jersey",
    state: "New Jersey",
    counties: ["Bergen", "Essex", "Hudson", "Hunterdon", "Middlesex", "Monmouth", "Morris", "Passaic", "Somerset", "Sussex", "Union", "Warren"],
  },
  {
    name: "Western Connecticut/Gold Coast",
    state: "Connecticut",
    counties: ["69a5effad74f79343900cdcd"], // Western Connecticut planning region boundary ID
  },
];

// Counties identified by a LiveBy boundary ID rather than a name need a display label.
const COUNTY_DISPLAY_NAMES = {
  "69a5effad74f79343900cdcd": "Western Connecticut/Gold Coast",
};

function pctChange(current, prior) {
  if (!prior || !current) return null;
  return ((current - prior) / prior) * 100;
}

function medianOfArray(arr) {
  const sorted = arr.filter(v => v != null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function aggregatePeriod(countyDataList, periodKey) {
  let totalCount = 0, totalVolume = 0;
  const medianPrices = [], medianDoms = [], ratios = [], ratioWeights = [];

  for (const { data } of countyDataList) {
    const p = data[periodKey];
    if (!p) continue;
    totalCount += p.count ?? 0;
    totalVolume += p.salesVolume ?? 0;
    if (p.medianSalePrice != null) medianPrices.push(p.medianSalePrice);
    if (p.medianDaysOnMarket != null) medianDoms.push(p.medianDaysOnMarket);
    if (p.saleToListRatio != null && p.count) {
      ratios.push(p.saleToListRatio * p.count);
      ratioWeights.push(p.count);
    }
  }

  return {
    count: totalCount || null,
    salesVolume: totalVolume || null,
    avgPrice: (totalVolume && totalCount) ? totalVolume / totalCount : null,
    medianPrice: medianOfArray(medianPrices),
    medianDaysOnMarket: medianOfArray(medianDoms),
    saleToListRatio: ratioWeights.length
      ? ratios.reduce((a, b) => a + b, 0) / ratioWeights.reduce((a, b) => a + b, 0)
      : null,
  };
}

/**
 * Aggregate batch results into regional summaries.
 *
 * @param {object[]} batchResults - results from runBatch with collectData:true
 * @returns {object[]} - array of region summary objects
 */
export function aggregateRegions(batchResults) {
  const successful = batchResults.filter(r => r.status === "success" && r.data && r.propertyType === "SingleFamilyResidence");
  const regionResults = [];

  for (const region of REGIONS) {
    const countyDataList = successful.filter(
      r => r.state === region.state && region.counties.includes(r.county)
    );
    if (!countyDataList.length) continue;

    const current = aggregatePeriod(countyDataList, "currentPeriod");
    const lastYear = aggregatePeriod(countyDataList, "lastYearPeriod");
    const lastMonth = aggregatePeriod(countyDataList, "lastMonthPeriod");

    const totalActive = countyDataList.reduce((s, r) => s + (r.data.activeSnapshot?.count ?? 0), 0);
    const totalUnderContract = countyDataList.reduce((s, r) => s + (r.data.underContractCount ?? 0), 0);
    const totalNewListings = countyDataList.reduce((s, r) => s + (r.data.newListingsCurrent ?? 0), 0);
    const totalNewListingsLastYear = countyDataList.reduce((s, r) => s + (r.data.newListingsLastYear ?? 0), 0);
    const totalYtd = countyDataList.reduce((s, r) => s + (r.data.ytdCount ?? 0), 0);
    const totalPriorYtd = countyDataList.reduce((s, r) => s + (r.data.priorYtdCount ?? 0), 0);
    // MOI uses 3-month trailing average monthly sales rate
    const trailingCounts = [0, 1, 2].map(i =>
      countyDataList.reduce((s, r) => s + (r.data.threeMonthPeriods?.[i]?.count ?? 0), 0)
    );
    const trailingAvg = trailingCounts.reduce((a, b) => a + b, 0) / 3;
    const moi = (totalActive && trailingAvg) ? totalActive / trailingAvg : null;

    const propertyTypes = [...new Set(countyDataList.map(r => r.propertyType))];
    const countyNames = [...new Set(countyDataList.map(r => r.county))];

    regionResults.push({
      name: region.name,
      state: region.state,
      counties: countyNames,
      propertyTypes,
      current: { ...current, active: totalActive, underContract: totalUnderContract, newListings: totalNewListings, moi },
      lastYear,
      lastMonth,
      ytd: { count: totalYtd },
      priorYtd: { count: totalPriorYtd },
      newListingsLastYear: totalNewListingsLastYear,
      change: {
        sales: pctChange(current.count, lastYear.count),
        avgPrice: pctChange(current.avgPrice, lastYear.avgPrice),
        medianPrice: pctChange(current.medianPrice, lastYear.medianPrice),
        newListings: pctChange(totalNewListings, totalNewListingsLastYear),
        ytd: pctChange(totalYtd, totalPriorYtd),
      },
    });
  }

  return regionResults;
}

/**
 * Shape one quarterly fetch result — a whole region or a single county — into the
 * row the report generator renders. Both come back from the API in the same form,
 * so the same mapping serves both reports.
 */
function toQuarterlyRow(r, { name, group }) {
  const active        = r.activeSnapshot?.count ?? 0;
  const underContract = r.underContractCount    ?? 0;
  const newListings   = r.newListingsCurrent    ?? 0;
  // MOI uses the quarter's average monthly sales rate.
  const moi = (active && r.current.count) ? active / (r.current.count / 3) : null;

  return {
    name,
    state: r.state,
    group,
    counties: r.counties,
    quarter: r.quarter,
    year:    r.year,
    current: {
      count:              r.current.count,
      salesVolume:        r.current.salesVolume,
      medianPrice:        r.current.medianSalePrice,
      medianDaysOnMarket: r.current.medianDaysOnMarket,
      saleToListRatio:    r.current.saleToListRatio,
      active,
      underContract,
      newListings,
      moi,
    },
    prior: {
      count:              r.prior.count,
      salesVolume:        r.prior.salesVolume,
      medianPrice:        r.prior.medianSalePrice,
      medianDaysOnMarket: r.prior.medianDaysOnMarket,
      saleToListRatio:    r.prior.saleToListRatio,
    },
    newListingsPrior: r.newListingsPrior ?? 0,
    change: {
      sales:       pctChange(r.current.count,           r.prior.count),
      medianPrice: pctChange(r.current.medianSalePrice, r.prior.medianSalePrice),
      newListings: pctChange(r.newListingsCurrent,      r.newListingsPrior),
    },
  };
}

/**
 * Build region rows from whole-region fetches (see fetchQuarterlyRegion).
 *
 * These figures are the API's own aggregates over each region's combined sales.
 * They are NOT derived from the county numbers: a median cannot be summed or
 * averaged, so the previous median-of-county-medians understated regions whose
 * sales are concentrated in their most expensive county.
 */
export function buildQuarterlyRegionRows(regionResults) {
  return regionResults
    .filter(r => r && r.current && r.prior)
    .map(r => toQuarterlyRow(r, { name: r.name, group: undefined }));
}

/**
 * Build one row per county from quarterly fetch results, rather than rolling
 * counties up into regions. Emits the same row shape as aggregateQuarterlyRegions
 * so both reports can share a generator.
 *
 * Median price, median DOM and sale-to-list come straight from the API per county —
 * no cross-county aggregation, so no median-of-medians approximation.
 *
 * @param {object[]} countyResults - results from fetchQuarterlyData per county
 * @returns {object[]} - array of county row objects, grouped NY -> NJ -> CT
 */
export function buildQuarterlyCountyRows(countyResults) {
  const successful = countyResults.filter(r => r.current && r.prior);
  const rows = [];

  // Iterate REGIONS so counties keep their configured order and stay grouped by state.
  for (const region of REGIONS) {
    for (const county of region.counties) {
      const r = successful.find(x => x.state === region.state && x.county === county);
      if (!r) continue;

      rows.push(toQuarterlyRow(r, {
        name:  COUNTY_DISPLAY_NAMES[county] ?? county,
        group: region.state,
      }));
    }
  }

  return rows;
}
