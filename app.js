import express from "express";
import { mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { fetchMarketReport } from "./src/fetchData.js";
import { generateReport } from "./src/generateReport.js";
import { analyzeMarket } from "./src/analyzeMarket.js";

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
  const { county, state, propertySubType } = req.body;
  if (!county || !state || !propertySubType) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const { month, year } = lastCompletedMonth();

  try {
    const data = await fetchMarketReport({ county, state, month, year, propertySubType });
    const analysis = await analyzeMarket(data);
    const html = generateReport(data, analysis);

    const pad = n => String(n).padStart(2, "0");
    const filename = `${county.replace(/\s+/g, "-")}-${pad(month)}-${year}.html`;
    const outputDir = resolve(__dirname, "reports");
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(resolve(outputDir, filename), html, "utf-8");

    res.json({ success: true, filename, month, year });
  } catch (err) {
    console.error("Generation error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Market Report UI running at http://localhost:${PORT}`);
});
