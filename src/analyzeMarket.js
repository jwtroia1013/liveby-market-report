import Anthropic from "@anthropic-ai/sdk";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const config = require("../config.json");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || config.anthropicApiKey });

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

function fmt$(n) {
  if (n == null) return "N/A";
  return "$" + Math.round(n).toLocaleString("en-US");
}
function fmtPct(n) {
  if (n == null) return "N/A";
  return (n * 100).toFixed(1) + "%";
}

export async function analyzeMarket(data) {
  const { county, state, month, year, propertySubType,
          currentPeriod, lastMonthPeriod, lastYearPeriod,
          ytdCount, priorYtdCount, activeSnapshot, underContractCount,
          newListingsCurrent, newListingsLastYear } = data;

  const monthName = MONTH_NAMES[month - 1];
  const subtypeLabel = propertySubType === "SingleFamilyResidence" ? "single family homes"
    : propertySubType === "CondoTownhome" ? "condominiums and townhomes"
    : propertySubType === "Condominium" ? "condominiums"
    : "townhouses";

  const cur = currentPeriod ?? {};
  const lm  = lastMonthPeriod ?? {};
  const ly  = lastYearPeriod ?? {};

  const pctChg = (a, b) => {
    if (!a || !b) return null;
    return ((a - b) / b * 100).toFixed(1);
  };

  const soldYoY      = pctChg(cur.count, ly.count);
  const priceYoY     = pctChg(cur.medianSalePrice, ly.medianSalePrice);
  const domYoY       = pctChg(cur.medianDaysOnMarket, ly.medianDaysOnMarket);
  const listingsYoY  = pctChg(newListingsCurrent, newListingsLastYear);
  const ytdYoY       = pctChg(ytdCount, priorYtdCount);

  const marketSummary = `
MARKET DATA SUMMARY — ${county} County, ${state} | ${monthName} ${year} | ${subtypeLabel}

RECENT SALES (${monthName} ${year}):
- Homes Sold: ${cur.count ?? "N/A"} (vs ${ly.count ?? "N/A"} last year, ${soldYoY != null ? soldYoY + "% YoY" : "N/A"})
- Median Sale Price: ${fmt$(cur.medianSalePrice)} (vs ${fmt$(ly.medianSalePrice)} last year, ${priceYoY != null ? priceYoY + "% YoY" : "N/A"})
- Median List Price: ${fmt$(cur.medianListPrice)} (vs ${fmt$(lm.medianListPrice)} last month)
- Sale-to-List Ratio: ${fmtPct(cur.saleToListRatio)} (homes selling ${cur.saleToListRatio >= 1 ? "above" : "below"} asking price on average)
- Sales Volume: ${fmt$(cur.salesVolume)}
- Median Days on Market: ${cur.medianDaysOnMarket ?? "N/A"} days (vs ${ly.medianDaysOnMarket ?? "N/A"} last year, ${domYoY != null ? domYoY + "% YoY" : "N/A"})
- New Listings Added: ${newListingsCurrent ?? "N/A"} (vs ${newListingsLastYear ?? "N/A"} last year, ${listingsYoY != null ? listingsYoY + "% YoY" : "N/A"})

YEAR TO DATE (Jan–${monthName} ${year}):
- Homes Sold YTD: ${ytdCount ?? "N/A"} (vs ${priorYtdCount ?? "N/A"} same period last year, ${ytdYoY != null ? ytdYoY + "% YoY" : "N/A"})

CURRENT INVENTORY (live snapshot):
- Active Listings: ${activeSnapshot?.count ?? "N/A"}
- Homes Under Contract: ${underContractCount ?? "N/A"}
- Median List Price (active): ${fmt$(activeSnapshot?.medianListPrice)}
- Median Days on Site (active): ${activeSnapshot?.medianDaysOnSite ?? "N/A"} days
- Price Range: ${fmt$(activeSnapshot?.lowPrice)} – ${fmt$(activeSnapshot?.highPrice)}
`.trim();

  const prompt = `You are writing the "Market Analysis" page of a monthly real estate market report for ${county} County, ${state}. The report is produced by Howard Hanna Rand Realty and is distributed to homeowners and prospective buyers in the area.

Here is the market data for ${monthName} ${year}:

${marketSummary}

Write 3–4 paragraphs of market commentary aimed at a consumer — someone who either currently lives in ${county} County or is considering buying or selling a home there.

Guidelines:
- Use plain, conversational language. Avoid jargon.
- Weave in the specific numbers above naturally — don't just list them.
- Give the reader useful context for what the numbers mean (e.g., what a sale-to-list ratio above 100% signals, what low inventory means for buyers vs. sellers).
- Reference broader regional or national housing market trends where relevant and accurate, drawing on your knowledge of the housing market.
- Be honest but constructive. If it's a tough market for buyers, say so — but help them understand what they can do.
- Do NOT use bullet points or headers. Pure flowing prose only.
- Do NOT include a sign-off, byline, or salutation.
- Each paragraph should be 3–5 sentences.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  }, { timeout: 60000 });

  return response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim();
}
