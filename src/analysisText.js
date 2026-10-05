// Reads and rewrites the written commentary inside a generated report, so an analyst can
// edit it as plain text without touching the HTML. Both the county report and the
// quarterly overview hold it as <p> elements inside a single .analysis-body div.
const BODY = /(<div class="analysis-body[^"]*">)([\s\S]*?)(<\/div>)/;

const decode = s => s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const encode = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The commentary as plain text, paragraphs separated by a blank line. null if the report has none. */
export function readAnalysis(html) {
  const m = html.match(BODY);
  if (!m) return null;
  const paragraphs = [...m[2].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map(p => decode(p[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return paragraphs.join("\n\n") + "\n";
}

/** The report with its commentary replaced by `text` (paragraphs separated by a blank line). */
export function writeAnalysis(html, text) {
  const paragraphs = String(text).replace(/\r\n?/g, "\n").split(/\n\s*\n+/)
    .map(p => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!paragraphs.length) throw new Error("The analysis text is empty.");
  if (!BODY.test(html)) throw new Error("This report has no analysis section.");
  const body = paragraphs.map(p => `<p>${encode(p)}</p>`).join("\n    ");
  return html.replace(BODY, (_, open, __, close) => `${open}\n    ${body}\n  ${close}`);
}
