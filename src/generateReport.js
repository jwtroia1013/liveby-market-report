import { createRequire } from "module";
const require = createRequire(import.meta.url);
const config = require("../config.json");

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

function fmt(val, type = "number") {
  if (val == null || isNaN(val)) return "—";
  if (type === "currency") return "$" + Math.round(val).toLocaleString();
  if (type === "volume") {
    return "$" + (val / 1_000_000).toFixed(2) + "M";
  }
  if (type === "ratio") return (val * 100).toFixed(1) + "%";
  if (type === "percent") return (val >= 0 ? "+" : "") + val.toFixed(1) + "%";
  return Math.round(val).toLocaleString();
}

function pctChange(current, previous) {
  if (!previous || !current) return null;
  return ((current - previous) / previous) * 100;
}

function changeIndicator(current, previous, invertColor = false) {
  const pct = pctChange(current, previous);
  if (pct == null) return "";
  const positive = pct > 0;
  const isGood = invertColor ? !positive : positive;
  const color = isGood ? "#2d7a4f" : "#c0392b";
  const arrow = positive ? "▲" : "▼";
  return `<span style="color:${color};font-size:0.75em;margin-left:4px">${arrow} ${Math.abs(pct).toFixed(1)}%</span>`;
}

function segmentLabel(segments, i) {
  const lo = i === 0 ? 0 : segments[i - 1];
  const hi = segments[i];
  function money(n) {
    return n >= 1000000 ? "$" + (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 2) + "M"
      : "$" + (n / 1000).toFixed(0) + "K";
  }
  if (lo === 0) return `< ${money(hi)}`;
  if (i === segments.length - 1) return `> ${money(lo)}`;
  return `${money(lo)} - ${money(hi)}`;
}

function climateCell(moi) {
  if (moi == null || isNaN(moi)) return `<td>—</td>`;
  if (moi < 4) return `<td><span class="climate sellers">● Sellers</span></td>`;
  if (moi <= 6) return `<td><span class="climate balanced">● Balanced</span></td>`;
  return `<td><span class="climate buyers">● Buyers</span></td>`;
}

function buildPage2Table(data) {
  const { activeBySegment, soldBySegment, soldMonthly, priceSegments, month, year,
          activeSnapshot, underContractCount, currentPeriod } = data;

  function addMonths(y, m, d) {
    let mo = m - 1 + d;
    let yr = y + Math.floor(mo / 12);
    mo = ((mo % 12) + 12) % 12;
    return { year: yr, month: mo + 1 };
  }
  function periodKey(y, m) { return `${y}-M${m}`; }

  // Build a map: segMax -> { period -> count }
  const soldBySegMap = {};
  if (Array.isArray(soldBySegment)) {
    for (const entry of soldBySegment) {
      const segMax = entry.priceRange?.[1];
      if (segMax == null) continue;
      if (!soldBySegMap[segMax]) soldBySegMap[segMax] = {};
      soldBySegMap[segMax][entry.period] = entry.data?.count ?? 0;
    }
  }

  function calcRowStats(activeCount, segMax) {
    const currentKey = periodKey(year, month);
    const currentSales = soldBySegMap[segMax]?.[currentKey] ?? null;

    // Current MOI
    const moi = (activeCount != null && currentSales) ? activeCount / currentSales : null;

    // 3-month trend: MOI change from 3 months ago to now (avg monthly delta)
    const threeMonthAgoInfo = addMonths(year, month, -3);
    const threeMonthAgoKey = periodKey(threeMonthAgoInfo.year, threeMonthAgoInfo.month);
    const threeMonthAgoSales = soldBySegMap[segMax]?.[threeMonthAgoKey] ?? null;
    const moiThreeMonthsAgo = (activeCount != null && threeMonthAgoSales) ? activeCount / threeMonthAgoSales : null;
    const moiTrend = (moi != null && moiThreeMonthsAgo != null) ? Math.abs(moi - moiThreeMonthsAgo) / 3 : null;

    // 6-month average sales
    let totalSales = 0;
    for (let d = -5; d <= 0; d++) {
      const info = addMonths(year, month, d);
      const key = periodKey(info.year, info.month);
      totalSales += soldBySegMap[segMax]?.[key] ?? 0;
    }
    const avgSales6 = totalSales / 6;

    return { currentSales, moi, moiTrend, avgSales6 };
  }

  // "All Price Ranges" summary row using overall data
  const allActiveCount = activeSnapshot?.count ?? null;
  const allCurrentSales = currentPeriod?.count ?? null;
  const allMoi = (allActiveCount && allCurrentSales) ? allActiveCount / allCurrentSales : null;

  // 3-month trend for all: use soldMonthly (no segments)
  const threeAgo = addMonths(year, month, -3);
  const threeAgoEntry = soldMonthly?.find(e => e.period === periodKey(threeAgo.year, threeAgo.month));
  const threeAgoSales = threeAgoEntry?.data?.count ?? null;
  const allMoiThreeAgo = (allActiveCount && threeAgoSales) ? allActiveCount / threeAgoSales : null;
  const allMoiTrend = (allMoi != null && allMoiThreeAgo != null) ? Math.abs(allMoi - allMoiThreeAgo) / 3 : null;

  let allTotal6 = 0;
  for (let d = -5; d <= 0; d++) {
    const info = addMonths(year, month, d);
    const entry = soldMonthly?.find(e => e.period === periodKey(info.year, info.month));
    allTotal6 += entry?.data?.count ?? 0;
  }
  const allAvg6 = allTotal6 / 6;

  const summaryRow = `
    <tr class="summary-row">
      <td><strong>All Price Ranges</strong></td>
      <td>${allActiveCount ?? "—"}</td>
      <td>${allMoi != null ? allMoi.toFixed(1) : "—"}</td>
      <td>${allMoiTrend != null ? allMoiTrend.toFixed(1) : "—"}</td>
      <td>${allCurrentSales ?? "—"}</td>
      <td>${allAvg6 > 0 ? Math.round(allAvg6) : "—"}</td>
      ${climateCell(allMoi)}
    </tr>
  `;

  const segmentRows = priceSegments.map((segMax, i) => {
    const activeSeg = activeBySegment.find(s => s.priceRange?.[1] === segMax);
    const activeCount = activeSeg?.data?.count ?? null;
    const { currentSales, moi, moiTrend, avgSales6 } = calcRowStats(activeCount, segMax);

    return `
      <tr>
        <td>${segmentLabel(priceSegments, i)}</td>
        <td>${activeCount != null ? activeCount : "—"}</td>
        <td>${moi != null ? moi.toFixed(1) : "—"}</td>
        <td>${moiTrend != null ? moiTrend.toFixed(1) : "—"}</td>
        <td>${currentSales != null ? currentSales : "—"}</td>
        <td>${avgSales6 > 0 ? Math.round(avgSales6) : "—"}</td>
        ${climateCell(moi)}
      </tr>
    `;
  }).join("");

  return summaryRow + segmentRows;
}

function svgBarChart(years, months) {
  const W = 680, H = 230, mL = 40, mR = 10, mT = 15, mB = 34;
  const cW = W - mL - mR, cH = H - mT - mB;
  const allVals = months.flatMap(m => years.map(y => m[y]).filter(v => v != null));
  if (!allVals.length) return "";
  const maxV = Math.ceil(Math.max(...allVals) / 10) * 10 || 10;
  const colors = ["#1a4a3a", "#c8963e", "#aaa"];
  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">`;
  for (let i = 0; i <= 5; i++) {
    const v = maxV * i / 5;
    const y = (mT + cH - (v / maxV) * cH).toFixed(1);
    s += `<line x1="${mL}" y1="${y}" x2="${W - mR}" y2="${y}" stroke="#ebebeb" stroke-width="1"/>`;
    s += `<text x="${mL - 4}" y="${(+y + 3.5).toFixed(1)}" text-anchor="end" font-size="9" fill="#aaa">${Math.round(v)}</text>`;
  }
  const gW = cW / 12;
  const bW = Math.max(Math.min((gW - 8) / 3 - 1, 14), 5);
  months.forEach((m, gi) => {
    const cx = mL + (gi + 0.5) * gW;
    const totalW = years.length * bW + (years.length - 1) * 2;
    years.forEach((yr, bi) => {
      const v = m[yr];
      if (!v) return;
      const bh = ((v / maxV) * cH).toFixed(1);
      const bx = (cx - totalW / 2 + bi * (bW + 2)).toFixed(1);
      const by = (mT + cH - +bh).toFixed(1);
      s += `<rect x="${bx}" y="${by}" width="${bW}" height="${bh}" fill="${colors[bi]}"/>`;
    });
    s += `<text x="${cx.toFixed(1)}" y="${H - mB + 13}" text-anchor="middle" font-size="9" fill="#aaa">${m.label}</text>`;
  });
  s += `<line x1="${mL}" y1="${mT}" x2="${mL}" y2="${mT + cH}" stroke="#ddd" stroke-width="1"/>`;
  s += `<line x1="${mL}" y1="${mT + cH}" x2="${W - mR}" y2="${mT + cH}" stroke="#ddd" stroke-width="1"/>`;
  s += `</svg>`;
  return s;
}

function svgLineChart(points) {
  const valid = points.filter(p => p.value != null);
  if (!valid.length) return "";
  const W = 490, H = 175, mL = 44, mR = 10, mT = 14, mB = 28;
  const cW = W - mL - mR, cH = H - mT - mB;
  const vals = valid.map(p => p.value * 100);
  const minV = Math.floor(Math.min(...vals)) - 1;
  const maxV = Math.ceil(Math.max(...vals)) + 1;
  const rng = maxV - minV;
  const n = points.length;
  const toX = i => (mL + (i / (n - 1)) * cW).toFixed(1);
  const toY = v => (mT + cH - ((v * 100 - minV) / rng) * cH).toFixed(1);
  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">`;
  for (let v = minV; v <= maxV; v++) {
    const y = toY(v / 100);
    s += `<line x1="${mL}" y1="${y}" x2="${W - mR}" y2="${y}" stroke="#eee" stroke-width="1"/>`;
    s += `<text x="${mL - 4}" y="${(+y + 3.5).toFixed(1)}" text-anchor="end" font-size="9" fill="#aaa">${v}%</text>`;
  }
  if (minV < 100 && maxV > 100) {
    s += `<line x1="${mL}" y1="${toY(1.0)}" x2="${W - mR}" y2="${toY(1.0)}" stroke="#c8963e" stroke-width="1" stroke-dasharray="4,3" opacity="0.5"/>`;
  }
  let d = "";
  points.forEach((p, i) => { if (p.value != null) d += `${d ? "L" : "M"}${toX(i)},${toY(p.value)} `; });
  s += `<path d="${d.trim()}" fill="none" stroke="#1a4a3a" stroke-width="2"/>`;
  points.forEach((p, i) => { if (p.value != null) s += `<circle cx="${toX(i)}" cy="${toY(p.value)}" r="3" fill="#1a4a3a"/>`; });
  points.forEach((p, i) => {
    if (i % 2 !== 0 && i !== n - 1) return;
    s += `<text x="${toX(i)}" y="${H - mB + 12}" text-anchor="middle" font-size="9" fill="#aaa">${p.shortLabel}</text>`;
  });
  s += `<line x1="${mL}" y1="${mT}" x2="${mL}" y2="${mT + cH}" stroke="#ddd" stroke-width="1"/>`;
  s += `<line x1="${mL}" y1="${mT + cH}" x2="${W - mR}" y2="${mT + cH}" stroke="#ddd" stroke-width="1"/>`;
  s += `</svg>`;
  return s;
}

function svgGauge(moi) {
  const W = 300, H = 168, cx = 150, cy = 155, ro = 118, ri = 95;
  const maxMOI = 10;
  const clamp = moi != null ? Math.min(Math.max(moi, 0), maxMOI) : 5;
  // angle: 0 = right (Seller's, low MOI), π = left (Buyer's, high MOI)
  const toAng = v => (v / maxMOI) * Math.PI;
  function arc(a1, a2, fill) {
    const [c1, s1, c2, s2] = [Math.cos(a1), Math.sin(a1), Math.cos(a2), Math.sin(a2)];
    const xo1 = (cx + ro * c1).toFixed(1), yo1 = (cy - ro * s1).toFixed(1);
    const xo2 = (cx + ro * c2).toFixed(1), yo2 = (cy - ro * s2).toFixed(1);
    const xi1 = (cx + ri * c1).toFixed(1), yi1 = (cy - ri * s1).toFixed(1);
    const xi2 = (cx + ri * c2).toFixed(1), yi2 = (cy - ri * s2).toFixed(1);
    return `<path d="M${xo1},${yo1} A${ro},${ro} 0 0,0 ${xo2},${yo2} L${xi2},${yi2} A${ri},${ri} 0 0,1 ${xi1},${yi1} Z" fill="${fill}"/>`;
  }
  const needleA = toAng(clamp);
  const nX = (cx + 86 * Math.cos(needleA)).toFixed(1);
  const nY = (cy - 86 * Math.sin(needleA)).toFixed(1);
  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:260px;height:auto;display:block;margin:0 auto">`;
  s += arc(toAng(0), toAng(4), "#2d7a4f");
  s += arc(toAng(4), toAng(6), "#c8963e");
  s += arc(toAng(6), toAng(10), "#c0392b");
  s += `<line x1="${cx}" y1="${cy}" x2="${nX}" y2="${nY}" stroke="#222" stroke-width="3" stroke-linecap="round"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="6" fill="#222"/>`;
  s += `<text x="${cx}" y="${cy - 18}" text-anchor="middle" font-family="serif" font-size="22" font-weight="700" fill="#1a4a3a">${moi != null ? moi.toFixed(1) : "—"}</text>`;
  s += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="9" fill="#666">Months of Inventory</text>`;
  s += `<text x="${cx - ro - 2}" y="${cy + 14}" text-anchor="end" font-size="8" fill="#c0392b" font-weight="700">Buyer's</text>`;
  s += `<text x="${cx + ro + 2}" y="${cy + 14}" text-anchor="start" font-size="8" fill="#2d7a4f" font-weight="700">Seller's</text>`;
  s += `</svg>`;
  return s;
}

export function generateReport(data, analysis = null, agentOverride = null) {
  const { county, state, month, year, propertySubType,
          currentPeriod, lastMonthPeriod, lastYearPeriod,
          ytdCount, lastMonthYtdCount, priorYtdCount, activeSnapshot, underContractCount,
          newListingsCurrent, newListingsLastMonth, newListingsLastYear,
          soldByCalendarMonth, saleToListTrend } = data;

  const monthName = MONTH_NAMES[month - 1];
  const subtypeLabel = propertySubType === "SingleFamilyResidence" ? "Single Family Residence"
    : propertySubType === "CondoTownhome" ? "Condos / Townhomes"
    : propertySubType;
  const { branding } = config;
  const agent = agentOverride || config.agent;

  const salesRows = [
    {
      label: "Homes Sold",
      field: "count",
      type: "number",
      invert: false,
    },
    {
      label: "New Listings Added",
      field: "_newListings",
      type: "number",
      invert: false,
    },
    {
      label: "Median Sale Price",
      field: "medianSalePrice",
      type: "currency",
      invert: false,
    },
    {
      label: "Median List Price",
      field: "medianListPrice",
      type: "currency",
      invert: false,
    },
    {
      label: "Sale to List Price Ratio",
      field: "saleToListRatio",
      type: "ratio",
      invert: false,
    },
    {
      label: "Sales Volume",
      field: "salesVolume",
      type: "volume",
      invert: false,
    },
    {
      label: "Median Days on Market",
      field: "medianDaysOnMarket",
      type: "number",
      invert: true,
    },
  ];

  function changePct(cur, prev, invert = false) {
    const pct = pctChange(cur, prev);
    if (pct == null) return "—";
    const positive = pct > 0;
    const isGood = invert ? !positive : positive;
    const color = pct === 0 ? "#666" : (isGood ? "#2d7a4f" : "#c0392b");
    const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "";
    return `<span style="color:${color}">${arrow} ${Math.abs(pct).toFixed(0)}%</span>`;
  }

  function changeDays(cur, prev, invert = false) {
    if (cur == null || prev == null) return "—";
    const delta = cur - prev;
    const isGood = invert ? delta < 0 : delta > 0;
    const color = delta === 0 ? "#666" : (isGood ? "#2d7a4f" : "#c0392b");
    const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "";
    return `<span style="color:${color}">${arrow} ${Math.abs(delta)} days</span>`;
  }

  const lastMonthName = MONTH_NAMES[data.lastMonthPeriod ? ((month - 2 + 12) % 12) : month - 1];
  const lastMonthYear = month === 1 ? year - 1 : year;

  const trendTableRows = salesRows.map(({ label, field, type, invert }) => {
    const isNewListings = field === "_newListings";
    const cur = isNewListings ? newListingsCurrent  : currentPeriod?.[field];
    const lm  = isNewListings ? newListingsLastMonth : lastMonthPeriod?.[field];
    const ly  = isNewListings ? newListingsLastYear  : lastYearPeriod?.[field];
    const changeFromLastMonth = type === "number" && field === "medianDaysOnMarket"
      ? changeDays(cur, lm, invert)
      : changePct(cur, lm, invert);
    const changeFromLastYear = type === "number" && field === "medianDaysOnMarket"
      ? changeDays(cur, ly, invert)
      : changePct(cur, ly, invert);
    return `
      <tr>
        <td class="row-label">${label}</td>
        <td>${fmt(cur, type)}</td>
        <td>${fmt(lm, type)}</td>
        <td class="change-col">${changeFromLastMonth}</td>
        <td>${fmt(ly, type)}</td>
        <td class="change-col">${changeFromLastYear}</td>
      </tr>
    `;
  }).join("");

  // YTD row — current YTD vs last month's YTD (prior month's running total) and prior year
  const ytdVsLastMonth = changePct(ytdCount, data.lastMonthYtdCount);
  const ytdVsLastYear = changePct(ytdCount, priorYtdCount);
  const ytdRow = `
    <tr>
      <td class="row-label">Homes Sold Year to Date</td>
      <td>${fmt(ytdCount)}</td>
      <td>${fmt(data.lastMonthYtdCount)}</td>
      <td class="change-col">${ytdVsLastMonth}</td>
      <td>${fmt(priorYtdCount)}</td>
      <td class="change-col">${ytdVsLastYear}</td>
    </tr>
  `;

  const statCards = [
    { label: "Homes for Sale", value: fmt(activeSnapshot.count) },
    { label: "Median List Price", value: fmt(activeSnapshot.medianListPrice, "currency") },
    { label: "Median Days on Market", value: fmt(activeSnapshot.medianDaysOnSite) },
    { label: "Homes Under Contract", value: fmt(underContractCount) },
    { label: "High Price", value: fmt(activeSnapshot.highPrice, "currency") },
    { label: "Low Price", value: fmt(activeSnapshot.lowPrice, "currency") },
  ].map(({ label, value }) => `
    <div class="stat-card">
      <div class="stat-value">${value}</div>
      <div class="stat-label">${label}</div>
    </div>
  `).join("");

  const page2Rows = buildPage2Table(data);
  const mlsSource = state === "New Jersey" ? "NJMLS-New Jersey MLS"
    : state === "Connecticut" ? "SmartMLS"
    : "OneKey MLS";
  const disclaimer = `Data sourced from ${mlsSource}. Information is deemed reliable but not guaranteed. Report generated ${monthName} ${year}.`;

  const agentLines = [
    agent.name ? `<strong>${agent.name}</strong>` : null,
    [
      agent.email ? `<a href="mailto:${agent.email}">${agent.email}</a>` : null,
      agent.website ? `<a href="https://${agent.website}">${agent.website}</a>` : null
    ].filter(Boolean).join(" &bull; ")
  ].filter(Boolean).join("<br>");

  const footer = `
    <div class="footer">
      <div class="footer-agent">${agentLines}</div>
      <div class="footer-brand">
        <span class="brand-company">${branding.company}</span>
        <span class="brand-divider"> | </span>
        <span class="brand-division">${branding.division}</span>
      </div>
    </div>
    <div class="disclaimer">${disclaimer}</div>
  `;

  const pageHeader = (subtitle) => `
    <div class="page-header">
      <div class="header-county">${county} County</div>
      <div class="header-subtitle">${subtitle}</div>
    </div>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${county} County Market Report — ${monthName} ${year}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Source+Sans+3:wght@300;400;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: "Source Sans 3", sans-serif;
      font-size: 13px;
      color: #222;
      background: #fff;
    }

    a { color: inherit; }

    .page {
      width: 8.5in;
      min-height: 11in;
      padding: 0.55in 0.6in 0.4in;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
    }

    .page-header {
      border-bottom: 3px solid ${branding.primaryColor};
      padding-bottom: 10px;
      margin-bottom: 22px;
    }

    .header-county {
      font-family: "Playfair Display", serif;
      font-size: 2.4em;
      font-weight: 700;
      color: ${branding.primaryColor};
      letter-spacing: -0.5px;
    }

    .header-subtitle {
      font-size: 0.95em;
      color: #555;
      margin-top: 2px;
      font-weight: 300;
      letter-spacing: 0.3px;
    }

    /* --- Section headings --- */
    .section-title {
      font-family: "Playfair Display", serif;
      font-size: 1.1em;
      font-weight: 700;
      color: ${branding.primaryColor};
      border-left: 4px solid ${branding.accentColor};
      padding-left: 10px;
      margin-bottom: 12px;
      margin-top: 24px;
    }

    /* --- Trend table --- */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9em;
    }

    thead th {
      background: ${branding.primaryColor};
      color: #fff;
      padding: 7px 10px;
      text-align: center;
      font-weight: 600;
      font-size: 0.85em;
      letter-spacing: 0.3px;
    }

    thead th:first-child { text-align: left; }

    tbody tr:nth-child(even) { background: #f5f7f5; }
    tbody tr:nth-child(odd) { background: #fff; }

    tbody td {
      padding: 7px 10px;
      text-align: center;
      border-bottom: 1px solid #e0e5e0;
    }

    tbody td.row-label {
      text-align: left;
      font-weight: 600;
      color: #333;
    }

    tbody td.change-col {
      font-size: 0.88em;
    }

    tr.summary-row td {
      background: ${branding.primaryColor};
      color: #fff;
      font-weight: 700;
    }

    tr.summary-row td span {
      color: #fff !important;
    }

    /* --- Stat cards --- */
    .stat-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
      margin-top: 4px;
    }

    .stat-card {
      border: 1px solid #d8dfd8;
      border-top: 3px solid ${branding.accentColor};
      border-radius: 3px;
      padding: 14px 16px;
      text-align: center;
    }

    .stat-value {
      font-family: "Playfair Display", serif;
      font-size: 1.6em;
      font-weight: 700;
      color: ${branding.primaryColor};
    }

    .stat-label {
      font-size: 0.8em;
      color: #666;
      margin-top: 4px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }

    /* --- Market climate --- */
    .climate {
      font-weight: 600;
      font-size: 0.85em;
    }
    .climate.sellers { color: #2d7a4f; }
    .climate.balanced { color: #c8963e; }
    .climate.buyers { color: #c0392b; }

    /* --- Legend --- */
    .legend {
      display: flex;
      gap: 16px;
      margin-top: 20px;
      flex-wrap: wrap;
    }

    .legend-item {
      border: 1px solid #ccc;
      border-radius: 4px;
      padding: 10px 14px;
      flex: 1;
      min-width: 160px;
    }

    .legend-item .legend-title {
      font-weight: 700;
      font-size: 0.85em;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      margin-bottom: 4px;
    }

    .legend-item.sellers .legend-title { color: #2d7a4f; }
    .legend-item.balanced .legend-title { color: #c8963e; }
    .legend-item.buyers .legend-title { color: #c0392b; }

    .legend-item p { font-size: 0.8em; color: #555; }

    /* --- Footer --- */
    .spacer { flex: 1; }

    .footer {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-top: 2px solid ${branding.primaryColor};
      padding-top: 10px;
      margin-top: 20px;
      font-size: 0.85em;
    }

    .footer-agent { color: #333; line-height: 1.5; }

    .footer-brand {
      font-family: "Playfair Display", serif;
      font-size: 1.15em;
      color: ${branding.primaryColor};
      font-weight: 700;
      text-align: right;
    }

    .brand-divider { color: ${branding.accentColor}; }

    .disclaimer {
      font-size: 0.7em;
      color: #888;
      margin-top: 6px;
      line-height: 1.4;
    }

    /* --- Print button --- */
    .pdf-bar {
      position: sticky;
      top: 0;
      z-index: 100;
      background: ${branding.primaryColor};
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 24px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }

    .pdf-bar-title {
      font-family: "Playfair Display", serif;
      font-size: 14px;
      color: rgba(255,255,255,0.85);
      letter-spacing: 0.03em;
    }

    .pdf-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: ${branding.accentColor};
      color: white;
      border: none;
      border-radius: 4px;
      padding: 8px 20px;
      font-family: "Source Sans 3", sans-serif;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.04em;
      cursor: pointer;
      transition: opacity 0.15s;
    }

    .pdf-btn:hover { opacity: 0.88; }

    /* --- Print --- */
    @media print {
      body { background: #fff; }
      .pdf-bar { display: none; }
      .page { margin: 0; padding: 0.5in 0.6in 0.4in; page-break-after: always; }
      .page:last-child { page-break-after: avoid; }
      @page { size: letter; margin: 0; }
    }

    .page-break { page-break-after: always; }

    /* --- Page 3: Market Analysis --- */
    .analysis-page .section-title {
      font-size: 1.4em;
      margin-top: 0;
      margin-bottom: 20px;
    }

    .analysis-meta {
      font-size: 0.8em;
      color: #888;
      margin-bottom: 24px;
      padding-bottom: 12px;
      border-bottom: 1px solid #e0e5e0;
      font-style: italic;
    }

    .analysis-body p {
      font-size: 0.97em;
      line-height: 1.75;
      color: #2a2a2a;
      margin-bottom: 18px;
    }

    .analysis-body p:last-child {
      margin-bottom: 0;
    }

    .analysis-generating {
      color: #888;
      font-style: italic;
      font-size: 0.95em;
      padding: 24px 0;
    }
  </style>
</head>
<body>

<div class="pdf-bar">
  <span class="pdf-bar-title">${county} County &mdash; ${monthName} ${year} Market Report</span>
  <button class="pdf-btn" onclick="window.print()">⬇ Download PDF</button>
</div>

<!-- PAGE 1 -->
<div class="page">
  ${pageHeader(`${monthName} ${year} Market Update &bull; Residential &mdash; ${subtypeLabel}`)}

  <div class="section-title">Recent Sales Trends</div>
  <table>
    <thead>
      <tr>
        <th></th>
        <th>Current Period<br><span style="font-weight:400;font-size:0.85em">${monthName} ${year}</span></th>
        <th>Last Month<br><span style="font-weight:400;font-size:0.85em">${lastMonthName} ${lastMonthYear}</span></th>
        <th>Change From<br><span style="font-weight:400;font-size:0.85em">Last Month</span></th>
        <th>Last Year<br><span style="font-weight:400;font-size:0.85em">${monthName} ${year - 1}</span></th>
        <th>Change From<br><span style="font-weight:400;font-size:0.85em">Last Year</span></th>
      </tr>
    </thead>
    <tbody>
      ${trendTableRows}
      ${ytdRow}
    </tbody>
  </table>

  <div class="section-title">Current Market</div>
  <div class="stat-grid">
    ${statCards}
  </div>

  <div class="spacer"></div>
  ${footer}
</div>

<!-- PAGE 2 -->
<div class="page">
  ${pageHeader(`${monthName} ${year} Market Update &bull; Residential &mdash; ${subtypeLabel}`)}

  <div class="section-title">Market Conditions by Price Range</div>
  <table>
    <thead>
      <tr>
        <th>Price Range</th>
        <th>Active Listings</th>
        <th>Months of Inventory</th>
        <th>3 Month Trend</th>
        <th>Sales (Current Mo.)</th>
        <th>6 Month Avg Sales</th>
        <th>Market Climate</th>
      </tr>
    </thead>
    <tbody>
      ${page2Rows}
    </tbody>
  </table>

  <div class="legend">
    <div class="legend-item sellers">
      <div class="legend-title">● Sellers Market</div>
      <p>Less than 4 months of inventory. High demand relative to supply — favorable conditions for sellers.</p>
    </div>
    <div class="legend-item balanced">
      <div class="legend-title">● Balanced Market</div>
      <p>4–6 months of inventory. Supply and demand are roughly in equilibrium.</p>
    </div>
    <div class="legend-item buyers">
      <div class="legend-title">● Buyers Market</div>
      <p>More than 6 months of inventory. More supply than demand — favorable conditions for buyers.</p>
    </div>
  </div>

  <div class="spacer"></div>
  ${footer}
</div>

<!-- PAGE 3: MARKET ANALYSIS -->
<div class="page analysis-page">
  ${pageHeader(`${monthName} ${year} Market Update &bull; Residential &mdash; ${subtypeLabel}`)}

  <div class="section-title">Market Analysis</div>
  <div class="analysis-meta">
    ${county} County, ${state} &nbsp;&bull;&nbsp; ${monthName} ${year} &nbsp;&bull;&nbsp;
    Prepared for homeowners and prospective buyers
  </div>

  <div class="analysis-body">
    ${analysis
      ? analysis.split(/\n\n+/).filter(p => p.trim()).map(p => `<p>${p.trim()}</p>`).join("\n    ")
      : `<p class="analysis-generating">Market analysis unavailable.</p>`
    }
  </div>

  <div class="spacer"></div>
  ${footer}
</div>

<!-- PAGE 4 -->
<div class="page">
  ${pageHeader(`${monthName} ${year} Market Update &bull; Residential &mdash; ${subtypeLabel}`)}

  <div class="section-title">Homes Sold</div>
  ${svgBarChart([year, year - 1, year - 2], soldByCalendarMonth)}
  <div style="display:flex;gap:18px;margin:8px 0 20px;font-size:11px;align-items:center">
    <span style="display:flex;align-items:center;gap:5px"><span style="display:inline-block;width:12px;height:12px;background:#1a4a3a;border-radius:2px"></span> ${year}</span>
    <span style="display:flex;align-items:center;gap:5px"><span style="display:inline-block;width:12px;height:12px;background:#c8963e;border-radius:2px"></span> ${year - 1}</span>
    <span style="display:flex;align-items:center;gap:5px"><span style="display:inline-block;width:12px;height:12px;background:#aaa;border-radius:2px"></span> ${year - 2}</span>
  </div>

  <div class="section-title">Sale to List Price Ratio</div>
  <div style="display:flex;gap:20px;align-items:center">
    <div style="flex:0 0 148px;border:1px solid #d8d4cc;border-radius:5px;padding:18px 14px;text-align:center">
      <div style="font-size:11px;color:#888;font-style:italic;margin-bottom:4px">Average</div>
      <div style="font-family:'Playfair Display',serif;font-size:34px;font-weight:700;color:${branding.primaryColor};line-height:1">
        ${currentPeriod?.saleToListRatio != null ? (currentPeriod.saleToListRatio * 100).toFixed(0) + "%" : "—"}
      </div>
      <div style="font-size:10px;color:#666;margin-top:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;line-height:1.4">
        Sale to List<br>Price Ratio
      </div>
      <div style="font-size:10px;color:#999;margin-top:6px">${monthName} ${year}</div>
    </div>
    <div style="flex:1;min-width:0">${svgLineChart(saleToListTrend)}</div>
  </div>

  <div class="spacer"></div>
  ${footer}
</div>

<!-- PAGE 5 -->
<div class="page">
  ${pageHeader("Market Conditions")}

  <div style="display:flex;gap:14px;align-items:center;justify-content:center;margin-bottom:28px">
    <div style="flex:0 0 148px;border:1px solid #d8d4cc;border-top:3px solid ${branding.accentColor};border-radius:4px;padding:18px 14px;text-align:center">
      <div style="font-family:'Playfair Display',serif;font-size:38px;font-weight:700;color:${branding.primaryColor};line-height:1">
        ${currentPeriod?.medianDaysOnMarket ?? "—"}
      </div>
      <div style="font-size:10px;color:#666;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-top:8px;line-height:1.4">
        Median Days<br>on Market
      </div>
    </div>
    <div style="flex:1;min-width:0;text-align:center">
      ${(() => {
        const moi = (activeSnapshot.count && currentPeriod?.count)
          ? activeSnapshot.count / currentPeriod.count
          : null;
        return `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#888;margin-bottom:4px">Balanced Market</div>
                ${svgGauge(moi)}`;
      })()}
    </div>
    <div style="flex:0 0 148px;border:1px solid #d8d4cc;border-top:3px solid ${branding.accentColor};border-radius:4px;padding:18px 14px;text-align:center">
      <div style="font-family:'Playfair Display',serif;font-size:38px;font-weight:700;color:${branding.primaryColor};line-height:1">
        ${currentPeriod?.saleToListRatio != null ? (currentPeriod.saleToListRatio * 100).toFixed(0) + "%" : "—"}
      </div>
      <div style="font-size:10px;color:#666;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-top:8px;line-height:1.4">
        Avg Sale to<br>List Price Ratio
      </div>
      <div style="font-size:10px;color:#999;margin-top:6px">${monthName} ${year}</div>
    </div>
  </div>

  <div class="section-title">Buyer's vs. Seller's Market</div>
  <p style="font-size:11.5px;color:#555;margin-bottom:14px">This graphic explains the key similarities and differences between a buyer's and seller's market, and how these market factors impact each group.</p>

  <table style="border-collapse:collapse;width:100%;font-size:11.5px">
    <thead>
      <tr>
        <th style="width:22%;padding:8px 12px;background:transparent;border:none"></th>
        <th style="padding:9px 14px;background:#c0392b;color:#fff;text-align:center;border-radius:3px 3px 0 0;font-size:11px;letter-spacing:0.4px">Buyer's Market<br><span style="font-weight:400;font-size:10px;opacity:0.85">More homes than buyers</span></th>
        <th style="padding:9px 14px;background:#2d7a4f;color:#fff;text-align:center;border-radius:3px 3px 0 0;font-size:11px;letter-spacing:0.4px">Seller's Market<br><span style="font-weight:400;font-size:10px;opacity:0.85">More buyers than homes</span></th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="padding:10px 12px;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:${branding.primaryColor};background:#f5f7f5;vertical-align:top;border:1px solid #e0e5e0">How it Impacts<br>Buyers</td>
        <td style="padding:10px 14px;background:#fdf5f5;border:1px solid #e0e5e0;vertical-align:top">
          <div style="display:flex;flex-direction:column;gap:6px">
            <div style="display:flex;align-items:flex-start;gap:7px"><span style="color:#c0392b;font-weight:700;flex-shrink:0">—</span><span>More homes to choose from</span></div>
            <div style="display:flex;align-items:flex-start;gap:7px"><span style="color:#c0392b;font-weight:700;flex-shrink:0">—</span><span>Could spend less than asking price</span></div>
            <div style="display:flex;align-items:flex-start;gap:7px"><span style="color:#c0392b;font-weight:700;flex-shrink:0">—</span><span>Price reductions more common</span></div>
            <div style="display:flex;align-items:flex-start;gap:7px"><span style="color:#c0392b;font-weight:700;flex-shrink:0">—</span><span>Rarely competing offers</span></div>
          </div>
        </td>
        <td style="padding:10px 14px;background:#f0f7f3;border:1px solid #e0e5e0;vertical-align:top">
          <div style="display:flex;flex-direction:column;gap:6px">
            <div style="display:flex;align-items:flex-start;gap:7px"><span style="color:#2d7a4f;font-weight:700;flex-shrink:0">—</span><span>Fewer homes to choose from</span></div>
            <div style="display:flex;align-items:flex-start;gap:7px"><span style="color:#2d7a4f;font-weight:700;flex-shrink:0">—</span><span>Need to be able to close quickly</span></div>
            <div style="display:flex;align-items:flex-start;gap:7px"><span style="color:#2d7a4f;font-weight:700;flex-shrink:0">—</span><span>May pay more than asking price</span></div>
            <div style="display:flex;align-items:flex-start;gap:7px"><span style="color:#2d7a4f;font-weight:700;flex-shrink:0">—</span><span>Competition from other buyers</span></div>
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 12px;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:${branding.primaryColor};background:#f5f7f5;vertical-align:top;border:1px solid #e0e5e0">How it Impacts<br>Sellers</td>
        <td style="padding:10px 14px;background:#fdf5f5;border:1px solid #e0e5e0;vertical-align:top">
          <div style="display:flex;flex-direction:column;gap:6px">
            <div style="display:flex;align-items:flex-start;gap:7px"><span style="color:#c0392b;font-weight:700;flex-shrink:0">—</span><span>Takes more time to sell</span></div>
            <div style="display:flex;align-items:flex-start;gap:7px"><span style="color:#c0392b;font-weight:700;flex-shrink:0">—</span><span>Fewer offers received</span></div>
            <div style="display:flex;align-items:flex-start;gap:7px"><span style="color:#c0392b;font-weight:700;flex-shrink:0">—</span><span>Could get less than asking price</span></div>
            <div style="display:flex;align-items:flex-start;gap:7px"><span style="color:#c0392b;font-weight:700;flex-shrink:0">—</span><span>May need to make repairs or concessions</span></div>
          </div>
        </td>
        <td style="padding:10px 14px;background:#f0f7f3;border:1px solid #e0e5e0;vertical-align:top">
          <div style="display:flex;flex-direction:column;gap:6px">
            <div style="display:flex;align-items:flex-start;gap:7px"><span style="color:#2d7a4f;font-weight:700;flex-shrink:0">—</span><span>Homes sell quickly</span></div>
            <div style="display:flex;align-items:flex-start;gap:7px"><span style="color:#2d7a4f;font-weight:700;flex-shrink:0">—</span><span>Multiple offers likely</span></div>
            <div style="display:flex;align-items:flex-start;gap:7px"><span style="color:#2d7a4f;font-weight:700;flex-shrink:0">—</span><span>Could get more than asking price</span></div>
            <div style="display:flex;align-items:flex-start;gap:7px"><span style="color:#2d7a4f;font-weight:700;flex-shrink:0">—</span><span>Buyers willing to overlook repairs</span></div>
          </div>
        </td>
      </tr>
    </tbody>
  </table>

  <div class="spacer"></div>
  ${footer}
</div>

</body>
</html>`;
}
