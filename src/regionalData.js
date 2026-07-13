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

/**
 * Build monthly region rows from whole-region fetches (see fetchMonthlyRegion).
 *
 * As with the quarterly report, every figure here is the API's own aggregate over
 * the region's combined sales — not a median of county medians.
 */
export function buildMonthlyRegionRows(regionResults) {
  return regionResults
    .filter(r => r && r.current)
    .map(r => {
      const trailing = r.threeMonthPeriods.map(p => p?.count ?? 0);
      const trailingAvg = trailing.reduce((a, b) => a + b, 0) / 3;
      const moi = (r.activeCount && trailingAvg) ? r.activeCount / trailingAvg : null;

      const current = {
        count:              r.current.count,
        salesVolume:        r.current.salesVolume,
        medianPrice:        r.current.medianSalePrice,
        medianDaysOnMarket: r.current.medianDaysOnMarket,
        saleToListRatio:    r.current.saleToListRatio,
        active:             r.activeCount,
        underContract:      r.underContractCount,
        newListings:        r.newListingsCurrent,
        moi,
      };
      const lastYear = {
        count:       r.lastYear?.count ?? null,
        medianPrice: r.lastYear?.medianSalePrice ?? null,
      };

      return {
        name:     r.name,
        state:    r.state,
        counties: r.counties,
        current,
        lastYear,
        ytd:      { count: r.ytdCount },
        priorYtd: { count: r.priorYtdCount },
        newListingsLastYear: r.newListingsLastYear,
        change: {
          sales:       pctChange(current.count,       lastYear.count),
          medianPrice: pctChange(current.medianPrice, lastYear.medianPrice),
          newListings: pctChange(r.newListingsCurrent, r.newListingsLastYear),
          ytd:         pctChange(r.ytdCount,           r.priorYtdCount),
        },
      };
    });
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
