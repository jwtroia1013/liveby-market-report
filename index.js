import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { fetchMarketReport } from "./src/fetchData.js";
import { generateReport } from "./src/generateReport.js";
import { analyzeMarket } from "./src/analyzeMarket.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    county: "Westchester",
    state: "New York",
    month: 2,
    year: 2026,
    propertySubType: "SingleFamilyResidence",
    output: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--county": opts.county = args[++i]; break;
      case "--state": opts.state = args[++i]; break;
      case "--month": opts.month = parseInt(args[++i], 10); break;
      case "--year": opts.year = parseInt(args[++i], 10); break;
      case "--type": opts.propertySubType = args[++i]; break;
      case "--output": opts.output = args[++i]; break;
    }
  }

  if (!opts.output) {
    const pad = n => String(n).padStart(2, "0");
    opts.output = resolve(__dirname, `reports/${opts.county.replace(/\s+/g, "-")}-${pad(opts.month)}-${opts.year}.html`);
  }

  return opts;
}

async function main() {
  const opts = parseArgs();
  const { county, state, month, year, propertySubType, output } = opts;

  console.log(`Fetching market data for ${county} County, ${state} — ${month}/${year}...`);

  const data = await fetchMarketReport({ county, state, month, year, propertySubType });

  console.log("Data fetched. Generating market analysis...");
  const analysis = await analyzeMarket(data);

  console.log("Analysis complete. Generating report...");
  const html = generateReport(data, analysis);

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, html, "utf-8");

  console.log(`Report written to: ${output}`);
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
