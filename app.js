import express from "express";
import { mkdirSync, writeFileSync, readdirSync, readFileSync, statSync, unlinkSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { fetchMarketReport, fetchMonthlyRegion } from "./src/fetchData.js";
import { fetchSnapshot } from "./src/fetchSnapshot.js";
import { generateReport } from "./src/generateReport.js";
import { generateSnapshot, renderScriptCards } from "./src/generateSnapshot.js";
import { generateScripts } from "./src/generateScripts.js";
import { analyzeMarket } from "./src/analyzeMarket.js";
import { runBatch } from "./src/batchRunner.js";
import { BATCH_NY, BATCH_NJ, BATCH_CT } from "./src/batchConfig.js";
import { buildMonthlyRegionRows, buildQuarterlyRegionRows, buildQuarterlyCountyRows, REGIONS } from "./src/regionalData.js";
import { fetchQuarterlyData, fetchQuarterlyRegion, previousQuarter } from "./src/fetchQuarterlyData.js";
import { generateQuarterlyRegionalReport } from "./src/generateQuarterlyRegionalReport.js";
import { generateRegionalReport } from "./src/generateRegionalReport.js";
import { generateIndex } from "./src/generateIndex.js";
import { DATA_DIR, cacheStats, cacheClear } from "./src/cache.js";
import { areaSlug, areaHeading } from "./src/areas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Reports live on the Railway volume in production so they survive redeploys.
const REPORTS_DIR = resolve(DATA_DIR, "reports");
mkdirSync(REPORTS_DIR, { recursive: true });

app.use(express.json());
app.use(express.static(resolve(__dirname, "public")));
app.use("/reports", express.static(REPORTS_DIR));

// Determine last completed month from today's date
function lastCompletedMonth() {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed, so this is already "previous" month in 1-indexed
  const year = now.getFullYear();
  if (month === 0) return { month: 12, year: year - 1 };
  return { month, year };
}

app.get("/api/current-period", (req, res) => {
  const { quarter, year: quarterYear } = previousQuarter();
  res.json({ ...lastCompletedMonth(), quarter, quarterYear });
});

app.get("/api/cache", (req, res) => {
  const { entries, bytes } = cacheStats();
  res.json({ dataDir: DATA_DIR, entries, kb: Math.round(bytes / 1024) });
});

app.delete("/api/cache", (req, res) => {
  res.json({ cleared: cacheClear() });
});

// Everything the volume is currently holding, so generated reports are discoverable
// without having to remember their filenames.
app.get("/api/files", (req, res) => {
  const walk = (dir, rel = "") => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries.flatMap(e => {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) return walk(resolve(dir, e.name), relPath);
      if (!e.name.endsWith(".html")) return [];
      const { size, mtimeMs } = statSync(resolve(dir, e.name));
      return [{ path: `reports/${relPath}`, name: e.name, folder: rel || "/", size, modified: mtimeMs }];
    });
  };

  const files = walk(REPORTS_DIR).sort((a, b) => b.modified - a.modified);
  const { entries, bytes } = cacheStats();
  res.json({
    dataDir: DATA_DIR,
    onVolume: DATA_DIR !== resolve(__dirname),
    cache: { entries, kb: Math.round(bytes / 1024) },
    totalFiles: files.length,
    totalKb: Math.round(files.reduce((s, f) => s + f.size, 0) / 1024),
    files,
  });
});

/**
 * Delete generated reports from the volume.
 *
 * Resolves each path and confirms it really sits inside REPORTS_DIR before unlinking,
 * so a crafted path (../../, an absolute path, a symlink) cannot reach anything else.
 */
app.delete("/api/files", (req, res) => {
  const paths = Array.isArray(req.body?.paths) ? req.body.paths : [];
  if (!paths.length) return res.status(400).json({ error: "No paths supplied." });

  const deleted = [], rejected = [];
  for (const p of paths) {
    const rel = String(p).replace(/^reports\//, "");
    const target = resolve(REPORTS_DIR, rel);
    const inside = target.startsWith(REPORTS_DIR + "/") && target.endsWith(".html");
    if (!inside) {
      rejected.push({ path: p, reason: "outside the reports directory" });
      continue;
    }
    try {
      unlinkSync(target);
      deleted.push(p);
    } catch (err) {
      rejected.push({ path: p, reason: err.code === "ENOENT" ? "not found" : err.message });
    }
  }
  res.json({ deleted: deleted.length, rejected, deletedPaths: deleted });
});

app.post("/api/generate", async (req, res) => {
  const { county, state, propertySubType, agentName, agentEmail, agentWebsite, period = "month" } = req.body;
  if (!county || !state || !propertySubType) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const isQuarter = period === "quarter";
  const { quarter, year: qYear } = previousQuarter();
  const { month, year: mYear } = lastCompletedMonth();
  const year = isQuarter ? qYear : mYear;

  // Stream status updates back to the client as each step completes
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (type, payload) => res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);

  try {
    send("status", { message: `Fetching live market data for ${isQuarter ? `Q${quarter} ${year}` : `${month}/${year}`}…` });
    const data = await fetchMarketReport({ county, state, year, period, month, quarter, propertySubType });

    send("status", { message: "Writing the market analysis…" });
    const analysis = await analyzeMarket(data);

    send("status", { message: "Building your report…" });
    const agentOverride = (agentName || agentEmail || agentWebsite)
      ? { name: agentName, email: agentEmail, website: agentWebsite }
      : null;
    const html = generateReport(data, analysis, agentOverride);

    const filename = `${areaSlug(county)}-${data.periodMeta.slug}.html`;
    mkdirSync(REPORTS_DIR, { recursive: true });
    writeFileSync(resolve(REPORTS_DIR, filename), html, "utf-8");

    send("done", { filename, month: data.month, year, quarter, period, label: data.periodMeta.headingLabel });
  } catch (err) {
    console.error("Generation error:", err);
    send("error", { message: err.message });
  } finally {
    res.end();
  }
});

app.post("/api/batch-generate", async (req, res) => {
  const { states, propertyTypes, agent, includeRegional = true, period = "month" } = req.body;
  if (!states || !states.length) {
    return res.status(400).json({ error: "Missing required field: states" });
  }
  const isQuarterBatch = period === "quarter";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (type, payload) => res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);

  // Keep connection alive every 20s for long-running batches
  const keepalive = setInterval(() => res.write(": ping\n\n"), 20000);

  const pad = n => String(n).padStart(2, "0");

  try {
    const { quarter, year: qYear } = previousQuarter();
    const { month, year: mYear } = lastCompletedMonth();
    const year = isQuarterBatch ? qYear : mYear;
    const periodSlug = isQuarterBatch ? `Q${quarter}-${year}` : `${pad(month)}-${year}`;

    const results = await runBatch({
      states,
      period,
      propertyTypes: propertyTypes && propertyTypes.length ? propertyTypes : null,
      agent: agent || {},
      collectData: includeRegional,
      onProgress: ({ current, total, county, state, propertyType }) => {
        send("progress", { current, total, county, state, propertyType,
          message: `Generating report ${current} of ${total}: ${areaHeading(county)}, ${state} — ${propertyType}` });
      },
    });

    // A quarterly batch pairs with the quarterly regional overview, a monthly batch with
    // the monthly one. Either way the region is fetched as its own combined area — a
    // region's median cannot be derived from the county reports above.
    let regionalPath = null;
    if (includeRegional && results.some(r => r.status === "success")) {
      send("status", { message: "Generating Regional Overview…" });
      if (isQuarterBatch) {
        const fetches = await Promise.all(REGIONS.map(region =>
          fetchQuarterlyRegion({ region, quarter, year, propertySubType: "SingleFamilyResidence" })
            .catch(err => { console.error(`Failed region ${region.name}: ${err.message}`); return null; })));
        const regions = buildQuarterlyRegionRows(fetches.filter(Boolean));
        if (regions.length) {
          const html = await generateQuarterlyRegionalReport(regions, { quarter, year });
          const file = `Quarterly-Overview-Q${quarter}-${year}.html`;
          writeFileSync(resolve(REPORTS_DIR, file), html, "utf-8");
          regionalPath = `reports/${file}`;
        }
      } else {
        const fetches = await Promise.all(REGIONS.map(region =>
          fetchMonthlyRegion({ region, month, year, propertySubType: "SingleFamilyResidence" })
            .catch(err => { console.error(`Failed region ${region.name}: ${err.message}`); return null; })));
        const regions = buildMonthlyRegionRows(fetches.filter(Boolean));
        if (regions.length) {
          const html = await generateRegionalReport(regions, { month, year });
          const file = `Regional-Overview-${pad(month)}-${year}.html`;
          writeFileSync(resolve(REPORTS_DIR, file), html, "utf-8");
          regionalPath = `reports/${file}`;
        }
      }
    }

    send("status", { message: "Building report index…" });
    const indexHtml = generateIndex(results, { month, year, quarter, period, regionalPath });
    const indexFile = `index-${periodSlug}.html`;
    mkdirSync(REPORTS_DIR, { recursive: true });
    writeFileSync(resolve(REPORTS_DIR, indexFile), indexHtml, "utf-8");
    const indexPath = `reports/${indexFile}`;

    const succeeded = results.filter(r => r.status === "success");
    const failed = results.filter(r => r.status === "error");
    send("done", { results, regionalPath, indexPath, succeeded: succeeded.length, failed: failed.length,
      month, year, quarter, period });
  } catch (err) {
    console.error("Batch generation error:", err);
    send("error", { message: err.message });
  } finally {
    clearInterval(keepalive);
    res.end();
  }
});

app.post("/api/regional-overview", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (type, payload) => res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
  const keepalive = setInterval(() => res.write(": ping\n\n"), 20000);

  try {
    const { month, year } = lastCompletedMonth();

    send("status", { message: `Fetching data for ${REGIONS.length} regions…` });

    // Each region is fetched as one combined area so the API returns its true median.
    const fetched = await Promise.all(
      REGIONS.map(region =>
        fetchMonthlyRegion({ region, month, year, propertySubType: "SingleFamilyResidence" })
          .catch(err => {
            console.error(`Failed to fetch region ${region.name}: ${err.message}`);
            return null;
          })
      )
    );

    const valid = fetched.filter(Boolean);
    const failed = fetched.length - valid.length;
    if (failed) console.warn(`Regional overview: ${failed} regions failed to fetch`);

    send("status", { message: "Generating narrative…" });
    const regions = buildMonthlyRegionRows(valid);
    if (!regions.length) throw new Error("No regional data could be fetched.");

    const regionalHtml = await generateRegionalReport(regions, { month, year });
    const pad = n => String(n).padStart(2, "0");
    const regionalFile = `Regional-Overview-${pad(month)}-${year}.html`;
    const outputDir = REPORTS_DIR;
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(resolve(outputDir, regionalFile), regionalHtml, "utf-8");

    send("done", { path: `reports/${regionalFile}`, succeeded: valid.length, failed, month, year });
  } catch (err) {
    console.error("Regional overview error:", err);
    send("error", { message: err.message });
  } finally {
    clearInterval(keepalive);
    res.end();
  }
});

app.post("/api/quarterly-overview", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (type, payload) => res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
  const keepalive = setInterval(() => res.write(": ping\n\n"), 20000);

  try {
    const { quarter, year } = previousQuarter();

    send("status", { message: `Fetching Q${quarter} ${year} data for ${REGIONS.length} regions…` });

    // Each region is fetched as a single combined area, so the API returns the region's
    // true median rather than us approximating one from the county medians.
    const results = await Promise.all(
      REGIONS.map(region =>
        fetchQuarterlyRegion({ region, quarter, year, propertySubType: "SingleFamilyResidence" })
          .catch(err => {
            console.error(`Failed quarterly fetch for region ${region.name}: ${err.message}`);
            return null;
          })
      )
    );

    const valid = results.filter(Boolean);
    const failed = results.length - valid.length;
    if (failed) console.warn(`Quarterly overview: ${failed} regions failed`);

    send("status", { message: "Generating narrative…" });
    const regions = buildQuarterlyRegionRows(valid);
    if (!regions.length) throw new Error("No regional data could be fetched.");

    const html = await generateQuarterlyRegionalReport(regions, { quarter, year });
    const filename = `Quarterly-Overview-Q${quarter}-${year}.html`;
    const outputDir = REPORTS_DIR;
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(resolve(outputDir, filename), html, "utf-8");

    send("done", { path: `reports/${filename}`, quarter, year, succeeded: valid.length, failed });
  } catch (err) {
    console.error("Quarterly overview error:", err);
    send("error", { message: err.message });
  } finally {
    clearInterval(keepalive);
    res.end();
  }
});

app.post("/api/quarterly-county-overview", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (type, payload) => res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
  const keepalive = setInterval(() => res.write(": ping\n\n"), 20000);

  try {
    const { quarter, year } = previousQuarter();

    const allCounties = [
      ...BATCH_NY.counties.map(c => ({ county: c, state: BATCH_NY.state })),
      ...BATCH_NJ.counties.map(c => ({ county: c, state: BATCH_NJ.state })),
      ...BATCH_CT.counties.map(c => ({ county: c, state: BATCH_CT.state })),
    ];

    send("status", { message: `Fetching Q${quarter} ${year} data for ${allCounties.length} counties…` });

    const results = await Promise.all(
      allCounties.map(({ county, state }) =>
        fetchQuarterlyData({ county, state, quarter, year, propertySubType: "SingleFamilyResidence" })
          .catch(err => {
            console.error(`Failed quarterly fetch for ${county}, ${state}: ${err.message}`);
            return null;
          })
      )
    );

    const valid = results.filter(Boolean);
    const failed = results.length - valid.length;
    if (failed) console.warn(`Quarterly county overview: ${failed} counties failed`);

    send("status", { message: "Building county rows and generating narrative…" });
    const rows = buildQuarterlyCountyRows(valid);
    if (!rows.length) throw new Error("No county data could be aggregated.");

    const html = await generateQuarterlyRegionalReport(rows, {
      quarter,
      year,
      rowLabel: "County",
      title: "Quarterly County Overview",
      analysisTitle: "Quarterly County Analysis",
      layout: "paged",
      analysisFirst: true,
    });

    const filename = `Quarterly-County-Overview-Q${quarter}-${year}.html`;
    const outputDir = REPORTS_DIR;
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(resolve(outputDir, filename), html, "utf-8");

    send("done", { path: `reports/${filename}`, quarter, year, counties: rows.length, succeeded: valid.length, failed });
  } catch (err) {
    console.error("Quarterly county overview error:", err);
    send("error", { message: err.message });
  } finally {
    clearInterval(keepalive);
    res.end();
  }
});

const STATE_DISPLAY = { NewYork: "New York", NewJersey: "New Jersey", Connecticut: "Connecticut" };
const MONTH_NAMES_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];

app.get("/reports/combined/:state", (req, res) => {
  const { state } = req.params;
  const { month, year, quarter } = req.query;

  // Quarterly reports are named "...-Q2-2026.html", monthly ones "...-06-2026.html".
  const periodSlug = quarter ? `Q${quarter}` : month;

  const dir = resolve(REPORTS_DIR, state);
  let files;
  try {
    files = readdirSync(dir)
      .filter(f => f.endsWith(".html"))
      .filter(f => (periodSlug && year) ? f.includes(`-${periodSlug}-${year}.html`) : true)
      .sort();
  } catch {
    return res.status(404).send("<h2>No reports found for this state.</h2>");
  }
  if (!files.length) return res.status(404).send("<h2>No reports found.</h2>");

  const stateName = STATE_DISPLAY[state] || state;
  const qMatch = files[0].match(/-Q([1-4])-(\d{4})\.html$/);
  const dateMatch = files[0].match(/-(\d{2})-(\d{4})\.html$/);
  const periodName = qMatch
    ? `Q${qMatch[1]}`
    : (dateMatch ? MONTH_NAMES_FULL[parseInt(dateMatch[1]) - 1] : "");
  const reportYear = qMatch ? qMatch[2] : (dateMatch ? dateMatch[2] : "");
  const monthName = periodName;

  let sharedHead = "";
  const bodyParts = [];

  for (let i = 0; i < files.length; i++) {
    const html = readFileSync(resolve(dir, files[i]), "utf-8");
    if (i === 0) {
      const m = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
      if (m) sharedHead = m[1].replace(/<title>[\s\S]*?<\/title>/i, "");
    }
    const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (m) {
      // Strip individual pdf-bar (no nested divs inside it, so first </div> closes it)
      bodyParts.push(m[1].replace(/<div class="pdf-bar">[\s\S]*?<\/div>/, ""));
    }
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${stateName} — ${monthName} ${reportYear} Combined Reports</title>
  ${sharedHead}
  <style>
    .pdf-bar { display: none !important; }
    .combined-bar { position: sticky; top: 0; z-index: 200; background: #1a4a3a; display: flex; align-items: center; justify-content: space-between; padding: 10px 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
    .combined-bar span { font-family: "Playfair Display", serif; font-size: 14px; color: rgba(255,255,255,0.85); }
    .combined-bar button { display: inline-flex; align-items: center; gap: 8px; background: #c8963e; color: white; border: none; border-radius: 4px; padding: 8px 20px; font-family: "Source Sans 3", sans-serif; font-size: 13px; font-weight: 700; cursor: pointer; }
    @media print { .combined-bar { display: none; } }
  </style>
</head>
<body>
  <div class="combined-bar">
    <span>${stateName} &mdash; ${monthName} ${reportYear} Market Reports &bull; ${files.length} reports</span>
    <button onclick="window.print()">⬇ Save as PDF</button>
  </div>
  ${bodyParts.join("\n")}
</body>
</html>`);
});

app.post("/api/snapshot", async (req, res) => {
  const { areaType, area, state, propertySubType, agentName } = req.body;
  if (!areaType || !area || !state || !propertySubType) {
    return res.status(400).json({ error: "Missing required fields: areaType, area, state, propertySubType" });
  }

  const { month, year } = lastCompletedMonth();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (type, payload) => res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);

  try {
    send("status", { message: "Fetching market data from LiveBy…" });
    const snapshot = await fetchSnapshot({ areaType, area, state, month, year, propertySubType });

    send("status", { message: "Writing video scripts with AI…" });
    const { scripts } = await generateScripts(snapshot, agentName || "");

    send("status", { message: "Building your snapshot page…" });
    const html = generateSnapshot(snapshot, scripts, agentName || "");

    // Save HTML + JSON for re-run
    const pad = n => String(n).padStart(2, "0");
    const stateSlug = state.replace(/\s+/g, "");
    const areaSlug  = area.replace(/\s+/g, "-");
    const typeSlug  = propertySubType === "SingleFamilyResidence" ? "SFR"
      : propertySubType === "CondoTownhome" ? "Condo"
      : propertySubType;
    const agentSlug = agentName ? `-${agentName.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "")}` : "";
    const base = `${areaSlug}-${typeSlug}${agentSlug}-${pad(month)}-${year}`;
    const dir  = resolve(REPORTS_DIR, "snapshots", stateSlug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `${base}.html`), html, "utf-8");
    writeFileSync(resolve(dir, `${base}.json`), JSON.stringify({ snapshot, agentName, scripts }, null, 2), "utf-8");

    const path = `reports/snapshots/${stateSlug}/${base}.html`;
    send("done", { path, month, year });
  } catch (err) {
    console.error("Snapshot error:", err);
    send("error", { message: err.message });
  } finally {
    res.end();
  }
});

app.post("/api/regen-scripts", async (req, res) => {
  const { snapshot, agentName } = req.body;
  if (!snapshot) return res.status(400).json({ error: "Missing snapshot data" });

  try {
    const { scripts } = await generateScripts(snapshot, agentName || "");
    const scriptsHtml = renderScriptCards(scripts, agentName || "");

    // Overwrite the saved files with new scripts
    const { area, state, month, year, propertySubType } = snapshot;
    const pad = n => String(n).padStart(2, "0");
    const stateSlug = state.replace(/\s+/g, "");
    const areaSlug  = area.replace(/\s+/g, "-");
    const typeSlug  = propertySubType === "SingleFamilyResidence" ? "SFR"
      : propertySubType === "CondoTownhome" ? "Condo"
      : propertySubType;
    const agentSlug = agentName ? `-${agentName.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "")}` : "";
    const base = `${areaSlug}-${typeSlug}${agentSlug}-${pad(month)}-${year}`;
    const dir  = resolve(REPORTS_DIR, "snapshots", stateSlug);
    mkdirSync(dir, { recursive: true });
    const updatedHtml = generateSnapshot(snapshot, scripts, agentName || "");
    writeFileSync(resolve(dir, `${base}.html`), updatedHtml, "utf-8");
    writeFileSync(resolve(dir, `${base}.json`), JSON.stringify({ snapshot, agentName, scripts }, null, 2), "utf-8");

    res.json({ scriptsHtml });
  } catch (err) {
    console.error("Regen scripts error:", err);
    res.status(500).json({ error: err.message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Market Report UI running at http://localhost:${PORT}`);
});

// Railway sends SIGTERM when a deploy is superseded. Without this the process dies on
// a non-zero exit and npm logs it as an error, which looks like a crash in the logs.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`Received ${signal}, shutting down.`);
    server.close(() => process.exit(0));
    // Don't let an in-flight report generation hold the container open indefinitely.
    setTimeout(() => process.exit(0), 10000).unref();
  });
}
