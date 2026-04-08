import express from "express";
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { fetchMarketReport } from "./src/fetchData.js";
import { generateReport } from "./src/generateReport.js";
import { analyzeMarket } from "./src/analyzeMarket.js";
import { runBatch } from "./src/batchRunner.js";
import { BATCH_NY, BATCH_NJ, BATCH_CT } from "./src/batchConfig.js";
import { aggregateRegions } from "./src/regionalData.js";
import { generateRegionalReport } from "./src/generateRegionalReport.js";
import { generateIndex } from "./src/generateIndex.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(resolve(__dirname, "public")));
app.use("/reports", express.static(resolve(__dirname, "reports")));

// Determine last completed month from today's date
function lastCompletedMonth() {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed, so this is already "previous" month in 1-indexed
  const year = now.getFullYear();
  if (month === 0) return { month: 12, year: year - 1 };
  return { month, year };
}

app.get("/api/current-period", (req, res) => {
  res.json(lastCompletedMonth());
});

app.post("/api/generate", async (req, res) => {
  const { county, state, propertySubType, agentName, agentEmail, agentWebsite } = req.body;
  if (!county || !state || !propertySubType) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const { month, year } = lastCompletedMonth();

  // Stream status updates back to the client as each step completes
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (type, payload) => res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);

  try {
    send("status", { message: "Fetching live market data…" });
    const data = await fetchMarketReport({ county, state, month, year, propertySubType });

    send("status", { message: "Writing the market analysis…" });
    const analysis = await analyzeMarket(data);

    send("status", { message: "Building your report…" });
    const agentOverride = (agentName || agentEmail || agentWebsite)
      ? { name: agentName, email: agentEmail, website: agentWebsite }
      : null;
    const html = generateReport(data, analysis, agentOverride);

    const pad = n => String(n).padStart(2, "0");
    const filename = `${county.replace(/\s+/g, "-")}-${pad(month)}-${year}.html`;
    const outputDir = resolve(__dirname, "reports");
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(resolve(outputDir, filename), html, "utf-8");

    send("done", { filename, month, year });
  } catch (err) {
    console.error("Generation error:", err);
    send("error", { message: err.message });
  } finally {
    res.end();
  }
});

app.post("/api/batch-generate", async (req, res) => {
  const { states, propertyTypes, agent, includeRegional = true } = req.body;
  if (!states || !states.length) {
    return res.status(400).json({ error: "Missing required field: states" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (type, payload) => res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);

  // Keep connection alive every 20s for long-running batches
  const keepalive = setInterval(() => res.write(": ping\n\n"), 20000);

  try {
    const { month, year } = lastCompletedMonth();

    const results = await runBatch({
      states,
      propertyTypes: propertyTypes && propertyTypes.length ? propertyTypes : null,
      agent: agent || {},
      collectData: includeRegional,
      onProgress: ({ current, total, county, state, propertyType }) => {
        send("progress", { current, total, county, state, propertyType,
          message: `Generating report ${current} of ${total}: ${county} County, ${state} — ${propertyType}` });
      },
    });

    let regionalPath = null;
    if (includeRegional) {
      const successWithData = results.filter(r => r.status === "success" && r.data);
      if (successWithData.length > 0) {
        send("status", { message: "Generating Regional Overview…" });
        const regions = aggregateRegions(successWithData);
        if (regions.length > 0) {
          const regionalHtml = await generateRegionalReport(regions, { month, year });
          const pad = n => String(n).padStart(2, "0");
          const regionalFile = `Regional-Overview-${pad(month)}-${year}.html`;
          const outputDir = resolve(__dirname, "reports");
          mkdirSync(outputDir, { recursive: true });
          writeFileSync(resolve(outputDir, regionalFile), regionalHtml, "utf-8");
          regionalPath = `reports/${regionalFile}`;
        }
      }
    }

    send("status", { message: "Building report index…" });
    const indexHtml = generateIndex(results, { month, year, regionalPath });
    const pad = n => String(n).padStart(2, "0");
    const indexFile = `index-${pad(month)}-${year}.html`;
    const reportsDir = resolve(__dirname, "reports");
    mkdirSync(reportsDir, { recursive: true });
    writeFileSync(resolve(reportsDir, indexFile), indexHtml, "utf-8");
    const indexPath = `reports/${indexFile}`;

    const succeeded = results.filter(r => r.status === "success");
    const failed = results.filter(r => r.status === "error");
    send("done", { results, regionalPath, indexPath, succeeded: succeeded.length, failed: failed.length, month, year });
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

    // Build fetch list — SFR only across all regions
    const allCounties = [
      ...BATCH_NY.counties.map(c => ({ county: c, state: BATCH_NY.state })),
      ...BATCH_NJ.counties.map(c => ({ county: c, state: BATCH_NJ.state })),
      ...BATCH_CT.counties.map(c => ({ county: c, state: BATCH_CT.state })),
    ];

    send("status", { message: `Fetching data for ${allCounties.length} counties…` });

    const fetched = await Promise.all(
      allCounties.map(({ county, state }) =>
        fetchMarketReport({ county, state, month, year, propertySubType: "SingleFamilyResidence" })
          .then(data => ({ status: "success", county, state, propertyType: "SingleFamilyResidence", data }))
          .catch(err => {
            console.error(`Failed to fetch ${county}, ${state}: ${err.message}`);
            return { status: "error", county, state, propertyType: "SingleFamilyResidence", error: err.message };
          })
      )
    );

    const succeeded = fetched.filter(r => r.status === "success");
    const failed = fetched.filter(r => r.status === "error");
    if (failed.length) {
      console.warn(`Regional overview: ${failed.length} counties failed to fetch`);
    }

    send("status", { message: "Aggregating regional data and generating narrative…" });
    const regions = aggregateRegions(fetched);
    if (!regions.length) throw new Error("No regional data could be aggregated.");

    const regionalHtml = await generateRegionalReport(regions, { month, year });
    const pad = n => String(n).padStart(2, "0");
    const regionalFile = `Regional-Overview-${pad(month)}-${year}.html`;
    const outputDir = resolve(__dirname, "reports");
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(resolve(outputDir, regionalFile), regionalHtml, "utf-8");

    send("done", { path: `reports/${regionalFile}`, succeeded: succeeded.length, failed: failed.length, month, year });
  } catch (err) {
    console.error("Regional overview error:", err);
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
  const { month, year } = req.query;

  const dir = resolve(__dirname, "reports", state);
  let files;
  try {
    files = readdirSync(dir)
      .filter(f => f.endsWith(".html"))
      .filter(f => (month && year) ? f.includes(`-${month}-${year}.html`) : true)
      .sort();
  } catch {
    return res.status(404).send("<h2>No reports found for this state.</h2>");
  }
  if (!files.length) return res.status(404).send("<h2>No reports found.</h2>");

  const stateName = STATE_DISPLAY[state] || state;
  const dateMatch = files[0].match(/-(\d{2})-(\d{4})\.html$/);
  const monthName = dateMatch ? MONTH_NAMES_FULL[parseInt(dateMatch[1]) - 1] : "";
  const reportYear = dateMatch ? dateMatch[2] : "";

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

app.listen(PORT, () => {
  console.log(`Market Report UI running at http://localhost:${PORT}`);
});
