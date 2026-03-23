import express from "express";
import { mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { fetchMarketReport } from "./src/fetchData.js";
import { generateReport } from "./src/generateReport.js";
import { analyzeMarket } from "./src/analyzeMarket.js";
import { runBatch } from "./src/batchRunner.js";
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
  const { states, agent, includeRegional = true } = req.body;
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

app.listen(PORT, () => {
  console.log(`Market Report UI running at http://localhost:${PORT}`);
});
