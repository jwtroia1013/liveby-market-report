# LiveBy Market Report Generator — Claude Code Plan

## Project Overview

Build a Node.js application that pulls live real estate market data from the LiveBy API and generates a branded Howard Hanna Rand Realty market report as a styled HTML file (printable to PDF). The report should match the layout of the attached reference PDF — two pages: (1) Recent Sales Trends + Current Market snapshot, and (2) Market Conditions by Price Range.

## Authentication

**Method: Bearer Token**

All requests must include this header:
```
Authorization: Bearer REDACTED_LIVEBY_KEY
```

In code:
```js
const API_KEY = "REDACTED_LIVEBY_KEY";
const headers = { "Authorization": `Bearer ${API_KEY}` };
```

Base URL: `https://api.liveby.com`

**DO NOT use x-api-key header — it will return 401. Bearer token is the only supported auth method.**

You can verify auth is working with:
```bash
curl -s -H 'Authorization: Bearer REDACTED_LIVEBY_KEY' \
  "https://api.liveby.com/health/auth"
```

## Step 1: Explore the API and Confirm Geography

Before building anything, run these discovery calls to confirm the correct filter values for the HHRR footprint. Log the full JSON responses so we can inspect what comes back.

```bash
# Find boundary IDs for key HHRR counties
curl -s -H 'Authorization: Bearer REDACTED_LIVEBY_KEY' \
  "https://api.liveby.com/v4/boundaries?search=Westchester&type=county&limit=5"

curl -s -H 'Authorization: Bearer REDACTED_LIVEBY_KEY' \
  "https://api.liveby.com/v4/boundaries?search=Rockland&type=county&limit=5"

# Test a basic sold stats call to confirm the API responds and see the response shape
curl -s -H 'Authorization: Bearer REDACTED_LIVEBY_KEY' \
  "https://api.liveby.com/v4/market-statistics?time-interval=2026-02-01/2026-03-01&area-level-2=Westchester&area-level-1=New%20York&property-type=Residential&property-sub-type=SingleFamilyResidence"
```

If `area-level-2` doesn't work, try using the `boundary-id` returned from the boundaries call instead. If the market-statistics call requires an `&mls=` parameter, here are the paramter/description pairs we know about:
gsmls/Garden State
5061/onekey
5063/Ulster
5069/smart
msx/All Jersey
njmls/New Jersey
5059/Realty MLS

## Step 2: Build the Data Fetching Layer

Create `src/fetchData.js` (or `.ts` if you prefer). This module should export a single function:

```js
async function fetchMarketReport({ county, state, month, year, propertySubType }) → ReportData
```

All fetch calls must use:
```js
const headers = { "Authorization": `Bearer ${API_KEY}` };
```

This function makes the following API calls and returns a unified data object:

### Call 1: Sold Stats — 13 months grouped by month
```
GET /v4/market-statistics
  ?time-interval={13 months ago first of month}/{current month + 1 first of month}
  &area-level-2={county}
  &area-level-1={state}
  &property-type=Residential
  &property-sub-type={propertySubType}
  &group-by=month
```
From the response array, extract:
- **currentMonth**: the object where `period` matches `{year}-M{month}` (zero-padded)
- **lastMonth**: the object for the prior month
- **lastYear**: the object for the same month one year ago

Map these fields from each period's `data` object:

| Report Field | API Field |
|---|---|
| Homes Sold | `count` |
| Median Sale Price | `ClosePrice.median` |
| Median List Price | `ListPrice.median` |
| Sale to List Price Ratio | `saleToListRatio` |
| Sales Volume | `ClosePrice.sum` |
| Median Days on Market | `DaysOnMarket.median` |

### Call 2: Sold Stats — Year to Date
```
GET /v4/market-statistics
  ?time-interval={year}-01-01/{year}-{month+1}-01
  &area-level-2={county}
  &area-level-1={state}
  &property-type=Residential
  &property-sub-type={propertySubType}
```
Use `data[0].data.count` for "Homes Sold Year to Date."

Also fetch prior year YTD for comparison:
```
GET /v4/market-statistics
  ?time-interval={year-1}-01-01/{year-1}-{month+1}-01
  &area-level-2={county}
  &area-level-1={state}
  &property-type=Residential
  &property-sub-type={propertySubType}
```

### Call 3: Active Market Stats (current inventory snapshot)
```
GET /v4/market-statistics/active
  ?area-level-2={county}
  &area-level-1={state}
  &property-type=Residential
  &property-sub-type={propertySubType}
  &status=Active
```
Map: `count` → New Homes for Sale, `ListPrice.median` → Median List Price, `ListPrice.maximum` → High Price, `ListPrice.minimum` → Low Price, `daysOnSite.median` → Median Days on Market.

### Call 4: Under Contract count
```
GET /v4/market-statistics/active
  ?area-level-2={county}
  &area-level-1={state}
  &property-type=Residential
  &property-sub-type={propertySubType}
  &status=Pending
  &status=ActiveUnderContract
```
Map: `count` → Homes under Contract.

### Call 5: Active by Price Segment (for Page 2)
```
GET /v4/market-statistics/active
  ?area-level-2={county}
  &area-level-1={state}
  &property-type=Residential
  &property-sub-type={propertySubType}
  &price-segment=200000
  &price-segment=400000
  &price-segment=600000
  &price-segment=800000
  &price-segment=1000000
  &price-segment=1200000
  &price-segment=1400000
  &price-segment=1600000
  &price-segment=1800000
  &price-segment=2000000
```

### Call 6: Sold by Price Segment — 6 months grouped by month (for MOI calculation)
```
GET /v4/market-statistics
  ?time-interval={6 months ago}/{month+1 first of month}
  &area-level-2={county}
  &area-level-1={state}
  &property-type=Residential
  &property-sub-type={propertySubType}
  &price-segment=200000&price-segment=400000
  &price-segment=600000&price-segment=800000
  &price-segment=1000000&price-segment=1200000
  &price-segment=1400000&price-segment=1600000
  &price-segment=1800000&price-segment=2000000
  &group-by=month
```

### Client-Side Calculations for Page 2

For each price segment:
- **Months of Inventory** = Active Listings ÷ Current Month Sales
- **3 Month Trend** = Average MOI over the last 3 months
- **6 Month Avg Sales** = Total sales over 6 months ÷ 6
- **Market Climate**: < 4 months inventory = "Sellers", 4–6 = "Balanced", > 6 = "Buyers"
- **% Change** between any two periods = ((current - previous) / previous) × 100

## Step 3: Build the HTML Report Generator

Create `src/generateReport.js` that takes the `ReportData` object and outputs a self-contained HTML file. The HTML should:

1. Be print-friendly (use `@media print` CSS, page breaks between the two pages)
2. Match the Howard Hanna Rand Realty branding:
   - Primary green: `#1a4a3a`
   - Gold accent: `#c8963e`
   - Clean serif header font (use Google Fonts "Playfair Display")
   - Body font: "Source Sans 3" from Google Fonts
3. Include both report pages in a single HTML file with a CSS page break between them

### Page 1 Layout
- Large county name header in Playfair Display
- Subtitle: "{Month Year} Market Update / Residential - Single Family Residence"
- "Recent Sales Trends" section with a 7-row × 6-column comparison table
- "Current Market" section with 6 stat cards in a 3×2 grid
- Footer with agent info (left) and Howard Hanna Rand Realty wordmark (right)
- Disclaimer line at bottom

### Page 2 Layout
- Same header
- "Market Conditions by Price Range" table with columns: Price Range, Active Listings, Months of Inventory (current), 3 Month Trend, Sales (current), 6 Month Avg, Market Climate
- Color-coded climate indicators: green dot = Sellers, yellow = Balanced, red = Buyers
- Legend boxes at bottom explaining the three market types
- Same footer and disclaimer

### Page 3 Layout — Market Analysis (AI-generated)
- Same header
- "Market Analysis" section title
- Meta line: county, state, month/year, "Prepared for homeowners and prospective buyers"
- 3–4 paragraphs of consumer-facing narrative prose written by Claude (claude-sonnet-4-6)
- Written for people who live in or are considering moving to the market
- Incorporates the actual report numbers naturally — not a bullet list
- Draws on broader regional/national housing context via web search tool
- Honest but constructive tone; explains what the data means for buyers and sellers
- Same footer and disclaimer
- **This page is required on every report — always call `analyzeMarket()` before `generateReport()`**

Implementation: `src/analyzeMarket.js`
- Uses `@anthropic-ai/sdk` with `claude-sonnet-4-6`
- Web search tool enabled (`web_search_20250305`) for current market context
- API key stored in `config.json` (`anthropicApiKey`) and `~/.claude/.env` (`ANTHROPIC_API_KEY`)
- Called in both `index.js` (CLI) and `app.js` (web UI) before report generation
- `generateReport(data, analysis)` — second argument is the analysis string

### Change Indicators
- Up arrow (green triangle) for positive changes
- Down arrow (red triangle) for negative changes
- For "Days on Market," invert the color logic (fewer days = green = good)

## Step 4: CLI Entry Point

Create `index.js` as the CLI entry point:

```js
// Usage: node index.js --county "Westchester" --state "New York" --month 2 --year 2026
```

Parse command-line args. Defaults:
- county: "Westchester"
- state: "New York"
- month: 2
- year: 2026
- propertySubType: "SingleFamilyResidence"
- output: "./reports/{county}-{month}-{year}.html"

Run the fetch, generate the HTML, write it to disk, and log the output path.

## Step 5: Agent Info Configuration

Create a `config.json` file for agent-specific info that gets injected into the report:

```json
{
  "agent": {
    "name": "James Troia",
    "email": "jamie.troia@randrealty.com",
    "website": "jamietroia.agent.randcenter.com",
    "photoUrl": ""
  },
  "branding": {
    "company": "HOWARD HANNA",
    "division": "RAND REALTY",
    "primaryColor": "#1a4a3a",
    "accentColor": "#c8963e"
  },
  "mlsSources": "NJMLS-New Jersey MLS, and OneKey MLS",
  "apiKey": "REDACTED_LIVEBY_KEY"
}
```

## Step 6: Test and Validate

1. Run the tool for Westchester County, February 2026
2. Open the output HTML in a browser and compare to the reference PDF
3. Test print-to-PDF to confirm page breaks work
4. Run for a second county (Rockland) to confirm parameterization works

## File Structure

```
liveby-market-report/
├── index.js              # CLI entry point
├── config.json           # Agent info, branding, API key
├── package.json
├── src/
│   ├── fetchData.js      # All LiveBy API calls
│   └── generateReport.js # HTML report generator
└── reports/              # Output directory for generated HTML files
```

## Important Notes

- **Auth is Bearer token, NOT x-api-key** — use `Authorization: Bearer {token}` header
- All parameters that accept arrays use repeated query params (e.g., `&status=Pending&status=ActiveUnderContract`)
- Time intervals use ISO 8601 format: `2026-02-01/2026-03-01` means all of February. **The start date is excluded from results**, so use `2025-12-31/P3M` if you want Dec 31 included, or ISO duration notation like `P1Y/2026-03-01` (trailing end date) or `2026-01-01/P3M` (leading start date)
- **State abbreviations work** for `area-level-1` (e.g., `NY` instead of `New York`)
- `area-level-2` (county name) and `area-level-1` (state) are the preferred geography params; `boundary-id` is equally performant but less readable
- The API has rate limiting (429 responses) — add a small delay between calls if needed
- The API cleans outliers by default — the defaults are sensible, no need to override unless you see weird data
- If `area-level-2` doesn't return data, fall back to using `boundary-id` from the boundaries search

## Added-to-Market Endpoint

For tracking new listings added over a historical time period, use:
```
GET /v4/market-statistics/added-to-market
  ?time-interval={start}/{duration or end date}
  &area-level-2={county}
  &area-level-1={state}
  &property-type=Residential
  &property-sub-type={propertySubType}
```

Example: `?time-interval=2026-01-01/P3M&area-level-2=Westchester&area-level-1=NY`

Note: **No pending/under-contract status is available** in this endpoint yet — active listings only. This endpoint is useful for showing new listing volume trends over time.
