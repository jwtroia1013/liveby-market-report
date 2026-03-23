# Batch Report Generation + Regional Overview — Claude Code Plan

## Context

The liveby-market-report project is a working Node.js/Express app deployed on Railway. It already generates individual 3-page HTML market reports (sales trends, price range breakdown, AI analysis) for any county via a web UI. See the project briefing doc for full architecture details.

**This plan adds two capabilities:**
1. Batch generation — produce all county reports in one run
2. Regional overview — a new summary page that aggregates across counties

**Do not break anything that already works.** The existing single-report flow (UI → POST /api/generate → SSE → report) must continue to work exactly as it does now.

---

## Part 1: Batch Generation

### 1A: Define the batch configuration

Create `src/batchConfig.js` that exports the report matrix — every county × property type combination that should be generated in a batch run.

```js
export const BATCH_NY = {
  state: "New York",
  counties: ["Westchester", "Putnam", "Rockland", "Orange", "Ulster", "Sullivan", "Dutchess", "Bronx"],
  propertyTypes: ["SingleFamilyResidence", "Condominium"]
};

export const BATCH_NJ = {
  state: "New Jersey",
  counties: ["Bergen", "Essex", "Hudson", "Hunterdon", "Middlesex", "Monmouth", "Morris", "Passaic", "Somerset", "Sussex", "Union", "Warren"],
  propertyTypes: ["SingleFamilyResidence", "Condominium", "Townhouse"]
};

// Default agent info for batch runs (can be overridden)
export const DEFAULT_AGENT = {
  name: "",
  email: "",
  website: ""
};
```

### 1B: Build the batch runner

Create `src/batchRunner.js` that:

1. Accepts a batch config (NY, NJ, or both) and optional agent info
2. Iterates through every county × property type combination
3. Calls the existing `fetchMarketReport()` from `src/fetchData.js` for each
4. Calls `analyzeMarket()` from `src/analyzeMarket.js` for each
5. Calls `generateReport()` from `src/generateReport.js` for each
6. Saves each report to `reports/{State}/{County}-{PropertyType}-{MM}-{YYYY}.html`
7. Tracks progress and results (success/fail per report)
8. Returns a summary object with all generated report paths

**Critical: Rate limiting.** The LiveBy API has rate limits (10,000 requests per reset window based on the headers we saw). Each report makes ~8 API calls. A full NY batch (8 counties × 2 types = 16 reports) = ~128 API calls. A full NJ batch (12 counties × 3 types = 36 reports) = ~288 API calls. Total for both = ~416 calls. This is well within limits, but add a 500ms delay between reports to be safe. Also add a 200ms delay between individual API calls within each report.

**Critical: Anthropic API rate limiting.** The AI analysis calls Claude's API. Add a 2-second delay between analyzeMarket() calls to avoid rate limiting on the Anthropic side.

**Error handling:** If one county/type fails, log the error and continue to the next. Don't abort the whole batch. Return a summary at the end showing which reports succeeded and which failed (with error messages).

```js
// Pseudo-structure:
export async function runBatch({ states, agent, onProgress }) {
  const results = [];
  const configs = buildReportList(states); // expand to individual county/type pairs
  
  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    onProgress?.({ current: i + 1, total: configs.length, county: config.county, propertyType: config.propertyType });
    
    try {
      const data = await fetchMarketReport(config);
      await delay(2000); // breathing room before AI call
      const analysis = await analyzeMarket(data);
      const html = generateReport(data, analysis, agent);
      const path = saveReport(html, config);
      results.push({ ...config, status: "success", path });
    } catch (err) {
      results.push({ ...config, status: "error", error: err.message });
    }
    
    await delay(500); // rate limit buffer between reports
  }
  
  return results;
}
```

### 1C: Add a batch API endpoint

In `app.js`, add:

```
POST /api/batch-generate
```

Request body:
```json
{
  "states": ["New York"],
  "agent": { "name": "James Troia", "email": "jamie.troia@randrealty.com", "website": "jamietroia.agent.randcenter.com" }
}
```

Or for everything:
```json
{
  "states": ["New York", "New Jersey"],
  "agent": {}
}
```

This endpoint should use SSE (same pattern as the existing /api/generate) to stream progress back to the browser:
- "Generating report 1 of 16: Westchester County — Single Family..."
- "Generating report 2 of 16: Westchester County — Condominium..."
- etc.
- Final event: summary with all report links

### 1D: Add batch UI to the web interface

Add a new section to `public/index.html` — either a separate tab/panel or a section below the existing single-report form. It should have:

- Checkboxes: ☑ New York  ☑ New Jersey (select which state batches to run)
- Optional agent info fields (same as existing form)
- "Generate All Reports" button
- Progress display showing: current report name, progress bar (X of Y), elapsed time
- When complete: a list of all generated reports as clickable links, organized by state → county

### 1E: Add a CLI entry point for batch runs

Create `batch.js` at the project root:

```bash
# Generate all NY reports
node batch.js --state "New York"

# Generate all NJ reports  
node batch.js --state "New Jersey"

# Generate everything
node batch.js --state "New York" --state "New Jersey"

# With agent info
node batch.js --state "New York" --agent-name "James Troia" --agent-email "jamie.troia@randrealty.com"
```

This uses the same `runBatch()` function but with console output instead of SSE. Useful for running via cron or manually from terminal.

---

## Part 2: Regional Overview Report

### 2A: Build the regional data aggregator

Create `src/regionalData.js` that:

1. Takes an array of individual county report data objects (the output of fetchMarketReport for each county)
2. Aggregates them into regional summaries

The Q4 report groups data into these regions:
- **Westchester & Hudson Valley (SF)**: Westchester, Putnam, Rockland, Orange, Ulster, Sullivan, Dutchess
- **Northern NJ (All)**: Bergen, Essex, Hudson, Passaic + other NJ counties

For aggregation, calculate:
- **Total sales**: sum of all county `count` values
- **Average sale price**: weighted average (total ClosePrice.sum ÷ total count)
- **Median sale price**: use the median of all county medians (this is an approximation — the API doesn't give us a cross-county median directly)
- **Total new listings**: sum of added-to-market counts
- **Total pending**: sum of pending counts
- **Active listings**: sum of active counts
- **Months of inventory**: total active ÷ (total sales for the month)
- **Sales volume**: sum of ClosePrice.sum across counties

Also include prior period values so we can calculate change percentages.

The output should be structured as:
```js
{
  regions: [
    {
      name: "Westchester & Hudson Valley",
      propertyType: "Single Family",
      current: { sales, avgPrice, medianPrice, newListings, pending, active, moi, volume },
      prior: { /* same structure for prior quarter/year */ },
      change: { /* calculated % changes */ }
    },
    // ... more regions
  ]
}
```

### 2B: Build the regional overview HTML generator

Create `src/generateRegionalReport.js` that produces a new HTML page matching the style of the Q4 report's pages 2-3:

**Page layout:**
- Same header branding (county name replaced with "Regional Overview")
- Same fonts, colors, styling as existing reports

**Three data tables, same column structure:**
| Region | Current Period | Prior Period | Change (Period) | Rolling Year Current | Rolling Year Prior | Change (Year) |

Tables:
1. **SALES** — total closings per region
2. **PENDING SALES** — total pending per region  
3. **AVERAGE PRICES** — weighted average sale price per region

**Below the tables:** AI-generated regional narrative (2-3 paragraphs) covering:
- Cross-region trends and comparisons
- Which areas are outperforming/underperforming
- Inventory story
- What to expect going forward

Use the same analyzeMarket.js approach but with a different prompt tailored to regional analysis. Feed it the aggregated regional data rather than single-county data.

### 2C: Wire regional overview into the batch flow

After all individual county reports are generated in a batch run:

1. Collect all the county data objects
2. Run them through the regional aggregator
3. Generate the regional AI narrative
4. Build the regional overview HTML
5. Save as `reports/Regional-Overview-{MM}-{YYYY}.html`

The regional overview should be the FIRST link shown in the batch results UI — it's the executive summary that someone would read before drilling into individual counties.

### 2D: Add a regional overview option to the UI

Add a checkbox or toggle in the batch UI section:
- ☑ Include Regional Overview

When checked, the batch generates the overview page after all county reports complete. The progress display should show "Generating Regional Overview..." as the final step.

---

## Part 3: Report Index Page

### 3A: Auto-generated index

After a batch run completes, generate `reports/index-{MM}-{YYYY}.html` — a single branded page that links to everything:

```
February 2026 Market Reports
├── Regional Overview
├── New York
│   ├── Westchester County — Single Family | Condominium
│   ├── Putnam County — Single Family | Condominium
│   ├── Rockland County — Single Family | Condominium
│   └── ... etc
└── New Jersey
    ├── Bergen County — Single Family | Condominium | Townhouse
    └── ... etc
```

Style this page with the same branding. This becomes the landing page you link to from the agent emails — one URL, all reports accessible.

---

## Implementation Order

Do these in sequence, testing each before moving on:

1. **batchConfig.js** — define the matrix
2. **batchRunner.js** — the core batch logic with rate limiting
3. **batch.js** — CLI entry point (test with just 2 counties first to verify)
4. **POST /api/batch-generate** — server endpoint with SSE
5. **Batch UI** — add to public/index.html
6. **regionalData.js** — aggregation logic
7. **generateRegionalReport.js** — HTML output
8. **Wire regional into batch flow**
9. **Report index page generator**

Start with step 1 and work through sequentially. After step 3, do a test run with `node batch.js --state "New York"` and verify all 16 NY reports generate correctly before proceeding.

---

## Important Notes

- **Use the existing functions.** Do not rewrite fetchData.js, generateReport.js, or analyzeMarket.js. Import and call them as-is.
- **Bearer token auth.** All LiveBy API calls use `Authorization: Bearer {LIVEBY_API_KEY}`. This is already handled in fetchData.js.
- **Period key format.** LiveBy returns `2026-M2` not `2026-M02`. This is already handled in fetchData.js.
- **AI analysis is MANDATORY** on every individual report (Page 3). It must also be generated for the regional overview.
- **Rate limiting.** 500ms between reports, 200ms between API calls within a report, 2 seconds before each Anthropic API call.
- **Error resilience.** Never abort a batch because one county fails. Log and continue.
- **File organization.** Batch reports go in `reports/{State}/` subdirectories. Regional overview and index go in `reports/` root.
- **Don't break the existing single-report flow.** The current UI and /api/generate endpoint must continue working unchanged.
