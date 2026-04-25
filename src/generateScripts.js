import Anthropic from "@anthropic-ai/sdk";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const config = require("../config.json");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || config.anthropicApiKey });

const HOOKS = [
  "Curiosity Gap: Creates a knowledge gap the viewer must close by watching (e.g. 'I quit coffee 60 days ago. Here's what happened to my brain').",
  "Pattern Interrupt: Violates expectations visually or auditorily — starts with an unexpected scene, unusual angle, or jarring statement.",
  "Problem-Agitation: Calls out a specific pain point and magnifies it, making the viewer feel understood while hinting at a solution (e.g. 'Tired of waking up at 3am?').",
  "Contrarian/Hot Take: Challenges accepted wisdom in a way that drives engagement through controversy (e.g. 'Why cardio is making you fatter').",
];

// Each metric gets one angle drawn randomly — different runs produce scripts aimed at different audiences
const FOCUS_ANGLES = [
  "a buyer actively searching for a home in this market",
  "a homeowner deciding whether now is the right time to list",
  "a first-time buyer who has been sitting on the sidelines",
  "a seller who already has their home on the market",
  "someone relocating to the area who doesn't know the local market yet",
  "an investor evaluating this market for a purchase or rental property",
  "a homeowner curious about what their home is worth right now",
  "a buyer who lost out on a home recently and is reconsidering their strategy",
];

function pickAngle() {
  return FOCUS_ANGLES[Math.floor(Math.random() * FOCUS_ANGLES.length)];
}

const METRICS = ["Homes Sold", "New Listings Added", "Median Sale Price", "Median List Price", "Days on Market"];

function fmt$(n) {
  if (n == null) return "N/A";
  return "$" + Math.round(n).toLocaleString("en-US");
}
function fmtN(n) { return n == null ? "N/A" : Math.round(n).toLocaleString("en-US"); }
function fmtPct(n) {
  if (n == null) return null;
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}
function fmtDOM(n) { return n == null ? "N/A" : `${Math.round(n)} days`; }

function buildDataSummary(snapshot) {
  const { area, state, currentLabel, prevMonthLabel, prevYearLabel, metrics, propertySubType } = snapshot;
  const typeLabel = propertySubType === "SingleFamilyResidence" ? "single-family homes"
    : propertySubType === "CondoTownhome" ? "condos and townhomes"
    : propertySubType === "Condominium" ? "condominiums"
    : "townhouses";

  const m = metrics;
  const lines = [
    `Market: ${area}, ${state} | Property type: ${typeLabel}`,
    `Reporting period: ${currentLabel} vs ${prevMonthLabel} (MoM) and ${prevYearLabel} (YoY)`,
    ``,
    `Homes Sold: ${fmtN(m.homesSold.current)} | prev month: ${fmtN(m.homesSold.prevMonth)} (${fmtPct(m.homesSold.pctVsPrevMonth) ?? "N/A"} MoM) | prev year: ${fmtN(m.homesSold.prevYear)} (${fmtPct(m.homesSold.pctVsPrevYear) ?? "N/A"} YoY)`,
    `New Listings: ${fmtN(m.newListings.current)} | prev month: ${fmtN(m.newListings.prevMonth)} (${fmtPct(m.newListings.pctVsPrevMonth) ?? "N/A"} MoM) | prev year: ${fmtN(m.newListings.prevYear)} (${fmtPct(m.newListings.pctVsPrevYear) ?? "N/A"} YoY)`,
    `Median Sale Price: ${fmt$(m.medianSalePrice.current)} | prev month: ${fmt$(m.medianSalePrice.prevMonth)} (${fmtPct(m.medianSalePrice.pctVsPrevMonth) ?? "N/A"} MoM) | prev year: ${fmt$(m.medianSalePrice.prevYear)} (${fmtPct(m.medianSalePrice.pctVsPrevYear) ?? "N/A"} YoY)`,
    `Median List Price: ${fmt$(m.medianListPrice.current)} | prev month: ${fmt$(m.medianListPrice.prevMonth)} (${fmtPct(m.medianListPrice.pctVsPrevMonth) ?? "N/A"} MoM) | prev year: ${fmt$(m.medianListPrice.prevYear)} (${fmtPct(m.medianListPrice.pctVsPrevYear) ?? "N/A"} YoY)`,
    `Days on Market: ${fmtDOM(m.daysOnMarket.current)} | prev month: ${fmtDOM(m.daysOnMarket.prevMonth)} (${fmtPct(m.daysOnMarket.pctVsPrevMonth) ?? "N/A"} MoM) | prev year: ${fmtDOM(m.daysOnMarket.prevYear)} (${fmtPct(m.daysOnMarket.pctVsPrevYear) ?? "N/A"} YoY)`,
  ];
  return lines.join("\n");
}

export async function generateScripts(snapshot, agentName) {
  const dataSummary = buildDataSummary(snapshot);
  const { area, state, currentLabel } = snapshot;

  // Assign a random audience angle to each metric independently — ensures scripts
  // for the same market area differ meaningfully across different agents/runs
  const metricAngles = METRICS.map(metric => ({ metric, angle: pickAngle() }));
  const metricList = metricAngles
    .map((m, i) => `${i + 1}. ${m.metric} — write for: ${m.angle}`)
    .join("\n");

  const prompt = `You are a social media video scriptwriter for a real estate agent. Write 5 short-form video scripts for Meta (Instagram Reels and Facebook Reels), each targeting 45–60 seconds when read aloud at a natural, conversational pace (~130 words per minute, so aim for 100–130 words per script).

Each script covers ONE real estate metric for ${area}, ${state} in ${currentLabel}. Each has a specific target audience — the script's framing, opening, and angle must speak directly to that person's situation:

${metricList}

MARKET DATA:
${dataSummary}

AGENT: ${agentName || "your local real estate agent"}

HOOK FRAMEWORKS (use exactly one per script — choose whichever best fits that metric's story AND the assigned audience):
${HOOKS.map((h, i) => `${i + 1}. ${h}`).join("\n")}

RULES:
- Open with the hook in the very first line — make it impossible to scroll past
- The hook and entire script must feel written FOR the assigned audience — their worries, mindset, and decision they're facing
- Weave in the specific numbers naturally (don't just read a stat list)
- Write in a direct, conversational voice — like talking to a neighbor, not presenting a report
- The agent's name (${agentName || "the agent"}) should appear once, naturally, near the CTA
- End every script with a clear CTA — follow, DM, or comment for more info
- Do NOT include on-screen text instructions, camera directions, or b-roll notes
- Each script should be self-contained — a viewer who only sees one should understand the context

Respond with valid JSON only — no markdown, no code fences. Use this exact structure:
{
  "scripts": [
    {
      "metric": "Homes Sold",
      "audience": "the assigned audience for this script",
      "hook_framework": "name of the hook used",
      "hook_rationale": "one sentence on why this hook fits this metric's data story",
      "script": "the full script text"
    },
    ...
  ]
}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  }, { timeout: 90000 });

  const text = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim();

  return JSON.parse(text);
}
