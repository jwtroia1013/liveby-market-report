const REGIONS = [
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
    counties: ["Western Connecticut"],
  },
];

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
    const moi = (totalActive && current.count) ? totalActive / current.count : null;

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
        newListings: pctChange(totalNewListings, totalNewListingsLastYear),
        ytd: pctChange(totalYtd, totalPriorYtd),
      },
    });
  }

  return regionResults;
}
