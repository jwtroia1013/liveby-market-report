import { createRequire } from "module";
const require = createRequire(import.meta.url);
const config = require("../config.json");

const MONTH_NAMES = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];

const TYPE_LABELS = {
  SingleFamilyResidence: "Single Family",
  CondoTownhome: "Condos/Townhomes",
};

export function generateIndex(batchResults, { month, year, regionalPath = null, indexUrl = null }) {
  const { branding } = config;
  const monthName = MONTH_NAMES[month - 1];
  const succeeded = batchResults.filter(r => r.status === "success");
  const failed = batchResults.filter(r => r.status === "error");

  // Group by state → county
  const byState = {};
  for (const r of succeeded) {
    if (!byState[r.state]) byState[r.state] = {};
    if (!byState[r.state][r.county]) byState[r.state][r.county] = [];
    byState[r.state][r.county].push(r);
  }

  const stateBlocks = Object.entries(byState).map(([state, counties]) => {
    const countyRows = Object.entries(counties).map(([county, reports]) => {
      const typeLinks = reports.map(r =>
        `<a href="/${r.path}" target="_blank" style="color:${branding.primaryColor};font-weight:600;text-decoration:none;padding:3px 8px;border:1px solid #d8d4cc;border-radius:3px;font-size:12px;transition:background 0.1s" onmouseover="this.style.background='#f2f0ec'" onmouseout="this.style.background=''">${TYPE_LABELS[r.propertyType] || r.propertyType} ↗</a>`
      ).join(" ");
      return `
        <tr>
          <td style="padding:9px 16px;font-weight:600;color:#333">${county} County</td>
          <td style="padding:9px 16px">${typeLinks}</td>
        </tr>`;
    }).join("");

    const stateKey = state.replace(/\s+/g, "");
    const pad = n => String(n).padStart(2, "0");
    const combinedUrl = `/reports/combined/${stateKey}?month=${pad(month)}&year=${year}`;

    return `
      <div style="margin-bottom:28px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="font-family:'Playfair Display',serif;font-size:1.1em;font-weight:700;color:${branding.primaryColor};border-left:4px solid ${branding.accentColor};padding-left:10px">${state}</div>
          <a href="${combinedUrl}" target="_blank" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:#fff;background:${branding.primaryColor};text-decoration:none;padding:5px 12px;border-radius:3px">⬇ Print All as PDF</a>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <tbody>
            ${countyRows}
          </tbody>
        </table>
      </div>`;
  }).join("");

  const regionalBlock = regionalPath ? `
    <div style="margin-bottom:28px;padding:16px 20px;background:#f0f5f2;border-radius:5px;border-left:4px solid ${branding.primaryColor}">
      <div style="font-family:'Playfair Display',serif;font-size:1.05em;font-weight:700;color:${branding.primaryColor};margin-bottom:6px">Regional Overview</div>
      <div style="font-size:12px;color:#555;margin-bottom:10px">Aggregated summary across all counties and regions.</div>
      <a href="/${regionalPath}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;background:${branding.primaryColor};color:white;text-decoration:none;padding:8px 16px;border-radius:4px;font-size:13px;font-weight:700">View Regional Overview ↗</a>
    </div>` : "";

  const failedBlock = failed.length ? `
    <div style="margin-top:24px;padding:14px 16px;background:#fdf0f0;border:1px solid #f0c0c0;border-radius:4px;font-size:12px;color:#c0392b">
      <strong>${failed.length} report${failed.length > 1 ? "s" : ""} failed:</strong>
      <ul style="margin-top:6px;padding-left:18px">
        ${failed.map(r => `<li>${r.county} County, ${r.state} — ${TYPE_LABELS[r.propertyType] || r.propertyType}: ${r.error}</li>`).join("")}
      </ul>
    </div>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${monthName} ${year} Market Reports — Howard Hanna Rand Realty</title>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Source+Sans+3:wght@300;400;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Source Sans 3", sans-serif; background: #f2f0ec; min-height: 100vh; padding: 40px 20px 60px; color: #222; }
    .container { max-width: 680px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 32px; }
    .brand { font-family: "Playfair Display", serif; font-size: 18px; font-weight: 700; color: ${branding.primaryColor}; letter-spacing: 0.04em; }
    .brand-div { color: ${branding.accentColor}; margin: 0 8px; }
    h1 { font-family: "Playfair Display", serif; font-size: 28px; font-weight: 700; color: ${branding.primaryColor}; margin-top: 10px; }
    .subtitle { font-size: 14px; color: #666; margin-top: 4px; font-weight: 300; }
    .card { background: #fff; border-radius: 6px; border: 1px solid #d8d4cc; padding: 28px 32px; box-shadow: 0 2px 16px rgba(0,0,0,0.06); }
    .meta { font-size:11px; color:#999; margin-top:20px; text-align:center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">
        ${branding.company}<span class="brand-div">|</span>${branding.division}
      </div>
      <h1>${monthName} ${year} Market Reports</h1>
      <p class="subtitle">${succeeded.length} reports generated &bull; ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
    </div>

    <div class="card">
      ${regionalBlock}
      ${stateBlocks}
      ${failedBlock}
    </div>

    <p class="meta">Generated by Howard Hanna Rand Realty Market Report System</p>
  </div>
</body>
</html>`;
}
