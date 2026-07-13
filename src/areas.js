/**
 * Display names for areas the API addresses by boundary ID rather than by county name.
 *
 * Connecticut abolished county government, so LiveBy exposes Western Connecticut as a
 * planning region identified by a 24-char boundary ID. Without a mapping, that raw ID
 * renders as the report title ("69a5effad74f79343900cdcd County") and as the filename.
 *
 * `isCounty: false` also stops the report appending the word "County" to a region that
 * is not one.
 */
const AREA_DISPLAY = {
  "69a5effad74f79343900cdcd": {
    name: "Western Connecticut",
    slug: "Western-Connecticut",
    isCounty: false,
  },
};

/** Plain name, no suffix: "Rockland" / "Western Connecticut". */
export function areaName(area) {
  return AREA_DISPLAY[area]?.name ?? area;
}

/** Heading form: "Rockland County" / "Western Connecticut". */
export function areaHeading(area) {
  const entry = AREA_DISPLAY[area];
  if (!entry) return `${area} County`;
  return entry.isCounty ? `${entry.name} County` : entry.name;
}

/** Filename-safe slug: "Rockland" / "Western-Connecticut". */
export function areaSlug(area) {
  return (AREA_DISPLAY[area]?.slug ?? area).replace(/\s+/g, "-");
}
