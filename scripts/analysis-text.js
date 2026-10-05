#!/usr/bin/env node
// Round-trips the written commentary of a quarter's reports through plain text files,
// so an analyst can edit it.
//
//   node scripts/analysis-text.js export <folder>   write one .txt per report
//   node scripts/analysis-text.js apply  <folder>   put edited .txt files back into the reports
//
// Options: --quarter 3 --year 2026 (default: the previous quarter)
//          --url http://localhost:3000 (default: production)
//
// Each file mirrors its report's path: NewYork/Westchester-SingleFamily-Q3-2026.txt holds the
// commentary of reports/NewYork/Westchester-SingleFamily-Q3-2026.html.
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { resolve, dirname, relative } from "path";

const [command, folder, ...rest] = process.argv.slice(2);
const option = name => {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
};
const BASE = (option("url") ?? "https://liveby-market-report-production.up.railway.app").replace(/\/$/, "");

const INSTRUCTIONS = `HOW TO EDIT THESE FILES

Each .txt file is the written analysis page of one report. The file name says which:
  NewYork / NewJersey / Connecticut folders - one file per county report
  Quarterly-County-Overview-...txt          - the Tri-State market commentary

- Edit the wording freely. Leave one blank line between paragraphs.
- Plain text only: no bold, bullets or headings.
- Each analysis has to fit on one page, so keep it close to its current length.
- The figures quoted in the text are not checked against the tables in the report.
  If you change a number here, make sure it still matches the report.
- Do not rename, move or delete files. Files you leave untouched stay as they are.

Send the whole folder back when you are done.
`;

if (!["export", "apply"].includes(command) || !folder) {
  console.error("Usage: node scripts/analysis-text.js <export|apply> <folder> [--quarter N --year YYYY] [--url URL]");
  process.exit(1);
}

async function current() {
  const query = option("quarter") && option("year") ? `?quarter=${option("quarter")}&year=${option("year")}` : "";
  const res = await fetch(`${BASE}/api/analysis-text${query}`);
  if (!res.ok) throw new Error(`${BASE} answered ${res.status}`);
  return res.json();
}

const textFile = report => report.replace(/\.html$/, ".txt");

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(resolve(dir, e.name)) : e.name.endsWith(".txt") && !e.name.startsWith("_") ? [resolve(dir, e.name)] : []);
}

// Compare as the server will store it, so re-wrapped lines alone don't count as an edit.
const normalize = text => text.replace(/\r\n?/g, "\n").split(/\n\s*\n+/).map(p => p.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n\n");

if (command === "export") {
  const { quarter, year, files } = await current();
  if (!files.length) throw new Error(`No Q${quarter} ${year} reports found at ${BASE}.`);
  for (const { report, text } of files) {
    const file = resolve(folder, textFile(report));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, "utf-8");
  }
  writeFileSync(resolve(folder, "_HOW-TO-EDIT.txt"), INSTRUCTIONS, "utf-8");
  console.log(`Wrote ${files.length} Q${quarter} ${year} analysis files to ${folder}`);
} else {
  const { files } = await current();
  const live = new Map(files.map(f => [textFile(f.report), f]));
  let updated = 0, unchanged = 0, problems = 0;

  for (const file of walk(folder)) {
    const name = relative(folder, file).split("\\").join("/");
    const match = live.get(name);
    if (!match) {
      console.error(`  NO MATCHING REPORT  ${name}`);
      problems++;
      continue;
    }
    const text = readFileSync(file, "utf-8");
    if (normalize(text) === normalize(match.text)) {
      unchanged++;
      continue;
    }
    const res = await fetch(`${BASE}/api/analysis-text`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report: match.report, text }),
    });
    if (res.ok) {
      console.log(`  updated  ${name}`);
      updated++;
    } else {
      console.error(`  FAILED   ${name}: ${(await res.json()).error}`);
      problems++;
    }
  }
  console.log(`${updated} updated, ${unchanged} unchanged, ${problems} problems`);
  if (problems) process.exit(1);
}
