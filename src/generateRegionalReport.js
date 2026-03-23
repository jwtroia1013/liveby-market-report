import Anthropic from "@anthropic-ai/sdk";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const config = require("../config.json");

const MONTH_NAMES = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];

function fmt(val, type = "number") {
  if (val == null || isNaN(val)) return "—";
  if (type === "currency") return "$" + Math.round(val).toLocaleString();
  if (type === "volume") return "$" + (val / 1_000_000).toFixed(1) + "M";
  if (type === "pct") return (val >= 0 ? "+" : "") + val.toFixed(1) + "%";
  return Math.round(val).toLocaleString();
}

function changeCell(pct) {
  if (pct == null) return `<td style="text-align:center;color:#999">—</td>`;
  const color = pct > 0 ? "#2d7a4f" : pct < 0 ? "#c0392b" : "#666";
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "";
  return `<td style="text-align:center;color:${color};font-size:0.88em">${arrow} ${Math.abs(pct).toFixed(1)}%</td>`;
}

async function analyzeRegional(regions, month, year) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || config.anthropicApiKey });
  const monthName = MONTH_NAMES[month - 1];

  const summary = regions.map(r => `
${r.name} (${r.state}):
- Counties: ${r.counties.join(", ")}
- Homes Sold: ${r.current.count ?? "N/A"} (vs ${r.lastYear.count ?? "N/A"} last year, ${r.change.sales != null ? r.change.sales.toFixed(1) + "% YoY" : "N/A"})
- Avg Sale Price: ${r.current.avgPrice ? "$" + Math.round(r.current.avgPrice).toLocaleString() : "N/A"} (vs ${r.lastYear.avgPrice ? "$" + Math.round(r.lastYear.avgPrice).toLocaleString() : "N/A"} last year)
- Active Listings: ${r.current.active ?? "N/A"}
- Months of Inventory: ${r.current.moi != null ? r.current.moi.toFixed(1) : "N/A"}
- New Listings: ${r.current.newListings ?? "N/A"} (vs ${r.newListingsLastYear ?? "N/A"} last year)
- Under Contract: ${r.current.underContract ?? "N/A"}
- YTD Sales: ${r.ytd.count ?? "N/A"} (vs ${r.priorYtd.count ?? "N/A"} prior year)
`.trim()).join("\n\n");

  const prompt = `You are writing the "Regional Market Analysis" page of a monthly real estate report produced by Howard Hanna Rand Realty for ${monthName} ${year}. This page provides an executive overview comparing real estate conditions across the regions we serve.

Here is the aggregated regional data:

${summary}

Write 2–3 paragraphs of regional market commentary for a real estate professional or sophisticated consumer audience.

Guidelines:
- Compare and contrast the regions — highlight which areas are stronger or weaker and why
- Weave in the specific numbers naturally rather than listing them
- Give context for what the inventory and price trends mean for buyers and sellers
- You may reference broader regional or national housing market trends using your knowledge and web search
- Pure flowing prose — no bullet points, no headers, no sign-off
- Each paragraph should be 3–5 sentences`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{ role: "user", content: prompt }],
  });

  let analysis = response.content.filter(b => b.type === "text").map(b => b.text).join("");

  if (response.stop_reason === "tool_use") {
    const toolResults = response.content
      .filter(b => b.type === "tool_use")
      .map(b => ({ type: "tool_result", tool_use_id: b.id, content: "Search completed." }));
    const followUp = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [
        { role: "user", content: prompt },
        { role: "assistant", content: response.content },
        { role: "user", content: toolResults },
      ],
    });
    analysis = followUp.content.filter(b => b.type === "text").map(b => b.text).join("\n\n");
  }

  return analysis.trim();
}

export async function generateRegionalReport(regions, { month, year }) {
  const { branding } = config;
  const monthName = MONTH_NAMES[month - 1];

  const analysis = await analyzeRegional(regions, month, year);

  const tableRow = (r, valueField, formatType) => `
    <tr>
      <td style="font-weight:600;color:#333;padding:7px 10px">${r.name}</td>
      <td style="text-align:center;padding:7px 10px">${fmt(r.current[valueField], formatType)}</td>
      <td style="text-align:center;padding:7px 10px">${fmt(r.lastYear[valueField], formatType)}</td>
      ${changeCell(r.change[valueField === "count" ? "sales" : valueField === "avgPrice" ? "avgPrice" : null])}
      <td style="text-align:center;padding:7px 10px">${fmt(r.ytd?.count, "number")}</td>
      <td style="text-align:center;padding:7px 10px">${fmt(r.priorYtd?.count, "number")}</td>
      ${changeCell(r.change.ytd)}
    </tr>`;

  const tableHeader = `
    <thead>
      <tr>
        <th style="text-align:left;padding:7px 10px">Region</th>
        <th style="padding:7px 10px">Current Period<br><span style="font-weight:400;font-size:0.85em">${monthName} ${year}</span></th>
        <th style="padding:7px 10px">Prior Period<br><span style="font-weight:400;font-size:0.85em">${monthName} ${year - 1}</span></th>
        <th style="padding:7px 10px">Change</th>
        <th style="padding:7px 10px">YTD ${year}</th>
        <th style="padding:7px 10px">YTD ${year - 1}</th>
        <th style="padding:7px 10px">YTD Change</th>
      </tr>
    </thead>`;

  const footer = `
    <div style="display:flex;justify-content:space-between;align-items:flex-end;border-top:2px solid ${branding.primaryColor};padding-top:10px;margin-top:20px;font-size:0.85em">
      <div style="color:#555">Regional Market Overview &bull; ${monthName} ${year}</div>
      <div style="font-family:'Playfair Display',serif;font-size:1.15em;color:${branding.primaryColor};font-weight:700">
        ${branding.company} <span style="color:${branding.accentColor}">|</span> ${branding.division}
      </div>
    </div>
    <div style="font-size:0.7em;color:#888;margin-top:6px">Data sourced from ${config.mlsSources}. Information is deemed reliable but not guaranteed.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Regional Market Overview — ${monthName} ${year}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Source+Sans+3:wght@300;400;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Source Sans 3", sans-serif; font-size: 13px; color: #222; background: #fff; }
    .page { width: 8.5in; min-height: 11in; padding: 0.55in 0.6in 0.4in; margin: 0 auto; display: flex; flex-direction: column; }
    .page-header { border-bottom: 3px solid ${branding.primaryColor}; padding-bottom: 10px; margin-bottom: 22px; }
    .header-title { font-family: "Playfair Display", serif; font-size: 2.4em; font-weight: 700; color: ${branding.primaryColor}; }
    .header-sub { font-size: 0.95em; color: #555; margin-top: 2px; font-weight: 300; }
    .section-title { font-family: "Playfair Display", serif; font-size: 1.1em; font-weight: 700; color: ${branding.primaryColor}; border-left: 4px solid ${branding.accentColor}; padding-left: 10px; margin-bottom: 12px; margin-top: 24px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
    thead th { background: ${branding.primaryColor}; color: #fff; padding: 7px 10px; text-align: center; font-weight: 600; font-size: 0.85em; }
    thead th:first-child { text-align: left; }
    tbody tr:nth-child(even) { background: #f5f7f5; }
    tbody tr:nth-child(odd) { background: #fff; }
    tbody td { border-bottom: 1px solid #e0e5e0; }
    .spacer { flex: 1; }
    .analysis-body p { font-size: 0.97em; line-height: 1.75; color: #2a2a2a; margin-bottom: 18px; }
    .analysis-body p:last-child { margin-bottom: 0; }
    .pdf-bar { position: sticky; top: 0; z-index: 100; background: ${branding.primaryColor}; display: flex; align-items: center; justify-content: space-between; padding: 10px 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
    .pdf-bar-title { font-family: "Playfair Display", serif; font-size: 14px; color: rgba(255,255,255,0.85); }
    .pdf-btn { display: inline-flex; align-items: center; gap: 8px; background: ${branding.accentColor}; color: white; border: none; border-radius: 4px; padding: 8px 20px; font-family: "Source Sans 3", sans-serif; font-size: 13px; font-weight: 700; cursor: pointer; }
    @media print { .pdf-bar { display: none; } .page { margin: 0; padding: 0.5in 0.6in 0.4in; page-break-after: always; } .page:last-child { page-break-after: avoid; } @page { size: letter; margin: 0; } }
  </style>
</head>
<body>

<div class="pdf-bar">
  <span class="pdf-bar-title">Regional Market Overview &mdash; ${monthName} ${year}</span>
  <button class="pdf-btn" onclick="window.print()">⬇ Download PDF</button>
</div>

<!-- PAGE 1: Data Tables -->
<div class="page">
  <div class="page-header">
    <div class="header-title">Regional Overview</div>
    <div class="header-sub">${monthName} ${year} Market Update &bull; Howard Hanna Rand Realty</div>
  </div>

  <div class="section-title">Sales</div>
  <table>
    ${tableHeader}
    <tbody>${regions.map(r => tableRow(r, "count", "number")).join("")}</tbody>
  </table>

  <div class="section-title">Pending Sales</div>
  <table>
    <thead>
      <tr>
        <th style="text-align:left;padding:7px 10px">Region</th>
        <th style="padding:7px 10px">Currently Under Contract</th>
        <th style="padding:7px 10px">Active Listings</th>
        <th style="padding:7px 10px">Months of Inventory</th>
        <th style="padding:7px 10px">New Listings</th>
        <th style="padding:7px 10px">Avg Sale-to-List</th>
      </tr>
    </thead>
    <tbody>
      ${regions.map(r => `
        <tr>
          <td style="font-weight:600;color:#333;padding:7px 10px">${r.name}</td>
          <td style="text-align:center;padding:7px 10px">${fmt(r.current.underContract)}</td>
          <td style="text-align:center;padding:7px 10px">${fmt(r.current.active)}</td>
          <td style="text-align:center;padding:7px 10px">${r.current.moi != null ? r.current.moi.toFixed(1) : "—"}</td>
          <td style="text-align:center;padding:7px 10px">${fmt(r.current.newListings)}</td>
          <td style="text-align:center;padding:7px 10px">${r.current.saleToListRatio != null ? (r.current.saleToListRatio * 100).toFixed(1) + "%" : "—"}</td>
        </tr>`).join("")}
    </tbody>
  </table>

  <div class="section-title">Average Prices</div>
  <table>
    ${tableHeader.replace(/YTD \d+/g, m => m).replace(/count/g, "avgPrice")}
    <tbody>${regions.map(r => tableRow(r, "avgPrice", "currency")).join("")}</tbody>
  </table>

  <div class="spacer"></div>
  ${footer}
</div>

<!-- PAGE 2: Regional Analysis -->
<div class="page">
  <div class="page-header">
    <div class="header-title">Regional Analysis</div>
    <div class="header-sub">${monthName} ${year} &bull; Prepared for Howard Hanna Rand Realty</div>
  </div>

  <div class="section-title">Market Commentary</div>
  <div style="font-size:0.8em;color:#888;margin-bottom:20px;font-style:italic">
    ${regions.map(r => r.name).join(" &bull; ")} &bull; ${monthName} ${year}
  </div>

  <div class="analysis-body">
    ${analysis.split(/\n\n+/).filter(p => p.trim()).map(p => `<p>${p.trim()}</p>`).join("\n    ")}
  </div>

  <div class="spacer"></div>
  ${footer}
</div>

</body>
</html>`;
}
