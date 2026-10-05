import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const COVERS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../public/covers");

// A cover is a full-bleed letter page. 10.99in rather than 11in so rounding never
// spills it onto a blank second sheet.
export const COVER_CSS = `
    .cover-page { width: 8.5in; margin: 0 auto; }
    .cover-page img { display: block; width: 100%; }
    @media print {
      .cover-page { height: 10.99in; overflow: hidden; margin: 0; page-break-after: always; }
      .cover-page img { height: 100%; object-fit: cover; }
    }`;

/**
 * Cover page markup for a published document, or "" if no cover image exists.
 * @param {string} name - "NewYork", "NewJersey", "Connecticut" or "TriState"
 */
export function coverPage(name) {
  if (!/^[A-Za-z]+$/.test(name) || !existsSync(resolve(COVERS_DIR, `${name}.jpg`))) return "";
  return `<div class="cover-page"><img src="/covers/${name}.jpg" alt=""></div>`;
}
