const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

function fmt$(n) {
  if (n == null) return "<span class='na'>—</span>";
  return "$" + Math.round(n).toLocaleString("en-US");
}
function fmtN(n) {
  return n == null ? "<span class='na'>—</span>" : Math.round(n).toLocaleString("en-US");
}
function fmtDOM(n) {
  return n == null ? "<span class='na'>—</span>" : `${Math.round(n)}`;
}
function fmtPct(n) {
  if (n == null) return "<span class='na'>—</span>";
  const sign = n >= 0 ? "+" : "";
  const cls = n > 0 ? "up" : n < 0 ? "down" : "flat";
  const arrow = n > 0 ? "▲" : n < 0 ? "▼" : "●";
  return `<span class="pct ${cls}">${arrow} ${sign}${Math.abs(n).toFixed(1)}%</span>`;
}

function typeLabel(propertySubType) {
  if (propertySubType === "SingleFamilyResidence") return "Single-Family Homes";
  if (propertySubType === "CondoTownhome") return "Condos & Townhomes";
  if (propertySubType === "Condominium") return "Condominiums";
  if (propertySubType === "Townhouse") return "Townhouses";
  return propertySubType;
}

function scriptCards(scripts, agentName) {
  if (!scripts || !scripts.length) return '<p class="no-scripts">No scripts available.</p>';
  return scripts.map((s, i) => `
    <div class="script-card">
      <div class="script-header">
        <span class="script-num">${i + 1}</span>
        <div>
          <div class="script-metric">${s.metric}</div>
          <div class="script-hook">Hook: <strong>${s.hook_framework}</strong> — ${s.hook_rationale}</div>
        </div>
      </div>
      <div class="script-body">${s.script.replace(/\n/g, "<br>")}</div>
    </div>
  `).join("\n");
}

export function generateSnapshot(snapshot, scripts, agentName) {
  const { area, state, month, year, propertySubType, currentLabel, prevMonthLabel, prevYearLabel, metrics } = snapshot;
  const m = metrics;
  const pad = n => String(n).padStart(2, "0");
  const generatedAt = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

  const tableRows = [
    { label: "Homes Sold", unit: "count", cur: fmtN(m.homesSold.current), pm: fmtN(m.homesSold.prevMonth), py: fmtN(m.homesSold.prevYear), dpm: fmtPct(m.homesSold.pctVsPrevMonth), dpy: fmtPct(m.homesSold.pctVsPrevYear) },
    { label: "New Listings", unit: "count", cur: fmtN(m.newListings.current), pm: fmtN(m.newListings.prevMonth), py: fmtN(m.newListings.prevYear), dpm: fmtPct(m.newListings.pctVsPrevMonth), dpy: fmtPct(m.newListings.pctVsPrevYear) },
    { label: "Median Sale Price", unit: "price", cur: fmt$(m.medianSalePrice.current), pm: fmt$(m.medianSalePrice.prevMonth), py: fmt$(m.medianSalePrice.prevYear), dpm: fmtPct(m.medianSalePrice.pctVsPrevMonth), dpy: fmtPct(m.medianSalePrice.pctVsPrevYear) },
    { label: "Median List Price", unit: "price", cur: fmt$(m.medianListPrice.current), pm: fmt$(m.medianListPrice.prevMonth), py: fmt$(m.medianListPrice.prevYear), dpm: fmtPct(m.medianListPrice.pctVsPrevMonth), dpy: fmtPct(m.medianListPrice.pctVsPrevYear) },
    { label: "Days on Market", unit: "days", cur: fmtDOM(m.daysOnMarket.current), pm: fmtDOM(m.daysOnMarket.prevMonth), py: fmtDOM(m.daysOnMarket.prevYear), dpm: fmtPct(m.daysOnMarket.pctVsPrevMonth), dpy: fmtPct(m.daysOnMarket.pctVsPrevYear) },
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${area}, ${state} — Market Snapshot ${currentLabel}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Source Sans 3", sans-serif; background: #f5f5f0; color: #1a1a1a; font-size: 15px; }
    .page { max-width: 900px; margin: 0 auto; padding: 32px 24px 60px; }

    /* Header */
    .header { background: #1a4a3a; color: white; border-radius: 10px; padding: 28px 32px; margin-bottom: 28px; }
    .header h1 { font-family: "Playfair Display", serif; font-size: 26px; font-weight: 700; }
    .header .sub { font-size: 13px; color: rgba(255,255,255,0.7); margin-top: 6px; }
    .header .meta { display: flex; gap: 20px; margin-top: 14px; flex-wrap: wrap; }
    .header .tag { background: rgba(255,255,255,0.12); border-radius: 4px; padding: 4px 10px; font-size: 12px; font-weight: 600; }

    /* Data table */
    .section-title { font-family: "Playfair Display", serif; font-size: 18px; color: #1a4a3a; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 2px solid #1a4a3a; }
    .table-wrap { overflow-x: auto; margin-bottom: 36px; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.07); }
    thead th { background: #1a4a3a; color: white; padding: 12px 14px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; }
    thead th.center { text-align: center; }
    tbody tr:nth-child(even) { background: #f9f9f6; }
    tbody td { padding: 13px 14px; border-bottom: 1px solid #eee; font-size: 14px; vertical-align: middle; }
    tbody td.metric { font-weight: 700; color: #1a4a3a; white-space: nowrap; }
    tbody td.center { text-align: center; }
    .pct { font-weight: 700; font-size: 13px; white-space: nowrap; }
    .pct.up { color: #1a7a4a; }
    .pct.down { color: #c0392b; }
    .pct.flat { color: #888; }
    .na { color: #bbb; }

    /* Period header row */
    .period-header { font-size: 11px; color: rgba(255,255,255,0.65); font-weight: 400; display: block; margin-top: 2px; }

    /* Scripts section */
    .scripts-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #1a4a3a; }
    .scripts-header .section-title { margin-bottom: 0; border-bottom: none; padding-bottom: 0; }
    .regen-btn { background: #c8963e; color: white; border: none; border-radius: 5px; padding: 8px 18px; font-family: "Source Sans 3", sans-serif; font-size: 13px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; }
    .regen-btn:hover { background: #b07d2e; }
    .regen-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .script-card { background: white; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.07); margin-bottom: 18px; overflow: hidden; }
    .script-header { display: flex; align-items: flex-start; gap: 14px; padding: 16px 20px; background: #f0f4f1; border-bottom: 1px solid #dde8e2; }
    .script-num { background: #1a4a3a; color: white; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; flex-shrink: 0; margin-top: 2px; }
    .script-metric { font-weight: 700; font-size: 15px; color: #1a4a3a; }
    .script-hook { font-size: 12px; color: #666; margin-top: 3px; }
    .script-body { padding: 18px 20px; line-height: 1.7; font-size: 14px; color: #333; white-space: pre-wrap; }

    .agent-line { font-size: 12px; color: #999; text-align: right; margin-top: -10px; margin-bottom: 18px; }

    /* Spinner overlay for regen */
    #regen-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 100; align-items: center; justify-content: center; }
    #regen-overlay.active { display: flex; }
    .spinner-box { background: white; border-radius: 10px; padding: 28px 36px; text-align: center; }
    .spinner { width: 36px; height: 36px; border: 3px solid #ddd; border-top-color: #1a4a3a; border-radius: 50%; animation: spin 0.7s linear infinite; margin: 0 auto 12px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner-box p { font-size: 14px; color: #555; }

    @media(max-width:640px) {
      .page { padding: 16px 12px 48px; }
      .header { padding: 20px 18px; }
      .header h1 { font-size: 20px; }
    }
  </style>
</head>
<body>
<div class="page">
  <div class="header">
    <h1>${area}, ${state} — Market Snapshot</h1>
    <div class="sub">Generated ${generatedAt}</div>
    <div class="meta">
      <span class="tag">${currentLabel}</span>
      <span class="tag">${typeLabel(propertySubType)}</span>
      ${agentName ? `<span class="tag">Agent: ${agentName}</span>` : ""}
    </div>
  </div>

  <h2 class="section-title">Market Data Comparison</h2>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Metric</th>
          <th class="center">Current<span class="period-header">${currentLabel}</span></th>
          <th class="center">Prior Month<span class="period-header">${prevMonthLabel}</span></th>
          <th class="center">vs Prior Month</th>
          <th class="center">Prior Year<span class="period-header">${prevYearLabel}</span></th>
          <th class="center">vs Prior Year</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows.map(r => `
        <tr>
          <td class="metric">${r.label}${r.unit === "days" ? " <small style='font-weight:400;color:#888'>(median days)</small>" : ""}</td>
          <td class="center">${r.cur}</td>
          <td class="center">${r.pm}</td>
          <td class="center">${r.dpm}</td>
          <td class="center">${r.py}</td>
          <td class="center">${r.dpy}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>

  <div class="scripts-header">
    <h2 class="section-title">Video Scripts</h2>
    <button class="regen-btn" id="regenBtn" onclick="regenScripts()">↻ Re-run Scripts</button>
  </div>
  ${agentName ? `<div class="agent-line">Agent: ${agentName}</div>` : ""}
  <div id="scripts-container">
    ${scriptCards(scripts, agentName)}
  </div>
</div>

<div id="regen-overlay">
  <div class="spinner-box">
    <div class="spinner"></div>
    <p>Writing new scripts…</p>
  </div>
</div>

<script>
  const SNAPSHOT_DATA = ${JSON.stringify({ snapshot, agentName })};

  async function regenScripts() {
    const btn = document.getElementById("regenBtn");
    const overlay = document.getElementById("regen-overlay");
    btn.disabled = true;
    overlay.classList.add("active");
    try {
      const res = await fetch("/api/regen-scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(SNAPSHOT_DATA),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      document.getElementById("scripts-container").innerHTML = data.scriptsHtml;
    } catch (e) {
      alert("Failed to regenerate scripts: " + e.message);
    } finally {
      btn.disabled = false;
      overlay.classList.remove("active");
    }
  }
</script>
</body>
</html>`;
}

// Render just the script cards HTML (used by /api/regen-scripts)
export function renderScriptCards(scripts, agentName) {
  return scriptCards(scripts, agentName);
}
