#!/usr/bin/env node
/**
 * CLI batch report runner.
 *
 * Usage:
 *   node batch.js --state "New York"
 *   node batch.js --state "New Jersey"
 *   node batch.js --state "New York" --state "New Jersey"
 *   node batch.js --state "New York" --agent-name "Jane Smith" --agent-email "jane@randrealty.com" --agent-website "jane.agent.randcenter.com"
 *   node batch.js --county "Westchester" --state "New York"   # single county test
 */

import { runBatch } from "./src/batchRunner.js";
import { BATCH_NY, BATCH_NJ } from "./src/batchConfig.js";

// --- Parse CLI args ---
const args = process.argv.slice(2);

function getArgs(flag) {
  const values = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && args[i + 1]) values.push(args[i + 1]);
  }
  return values;
}

function getArg(flag) {
  return getArgs(flag)[0] ?? null;
}

const states = getArgs("--state");
const limitCounties = getArgs("--county"); // optional: limit to specific counties for testing
const agent = {
  name:    getArg("--agent-name")    ?? "",
  email:   getArg("--agent-email")   ?? "",
  website: getArg("--agent-website") ?? "",
};

if (states.length === 0) {
  console.error("Error: at least one --state argument is required.");
  console.error("  Usage: node batch.js --state \"New York\" [--state \"New Jersey\"]");
  process.exit(1);
}

// Validate states
const validStates = ["New York", "New Jersey"];
for (const s of states) {
  if (!validStates.includes(s)) {
    console.error(`Error: unknown state "${s}". Valid options: ${validStates.join(", ")}`);
    process.exit(1);
  }
}

// Optional county filter for testing
if (limitCounties.length > 0) {
  const stateMap = { "New York": BATCH_NY, "New Jersey": BATCH_NJ };
  for (const state of states) {
    const batch = stateMap[state];
    if (batch) batch.counties = batch.counties.filter(c => limitCounties.includes(c));
  }
  console.log(`County filter active: ${limitCounties.join(", ")}`);
}

// --- Run ---
const startTime = Date.now();

console.log(`\nLiveBy Batch Report Generator`);
console.log(`States: ${states.join(", ")}`);
if (agent.name) console.log(`Agent: ${agent.name} <${agent.email}>`);
console.log(`Started: ${new Date().toLocaleString()}\n`);

try {
  const results = await runBatch({
    states,
    agent,
    onProgress: ({ current, total, county, state, propertyType }) => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      process.stdout.write(`\r[${current}/${total}] ${county}, ${state} — ${propertyType} (${elapsed}s elapsed)  `);
    },
  });

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n\n${"─".repeat(60)}`);
  console.log(`Completed in ${elapsed}s\n`);

  // Group results by state
  const byState = {};
  for (const r of results) {
    if (!byState[r.state]) byState[r.state] = [];
    byState[r.state].push(r);
  }

  for (const [state, stateResults] of Object.entries(byState)) {
    console.log(`${state}:`);
    for (const r of stateResults) {
      const icon = r.status === "success" ? "✓" : "✗";
      const detail = r.status === "success" ? r.path : `ERROR: ${r.error}`;
      console.log(`  ${icon} ${r.county} — ${r.propertyType}: ${detail}`);
    }
    console.log();
  }

  const succeeded = results.filter(r => r.status === "success").length;
  const failed = results.filter(r => r.status === "error").length;
  console.log(`Total: ${succeeded} succeeded, ${failed} failed`);

  process.exit(failed > 0 ? 1 : 0);
} catch (err) {
  console.error("\nFatal error:", err.message);
  process.exit(1);
}
