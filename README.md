# LiveBy Market Report Generator

Generates branded Howard Hanna Rand Realty market reports from live LiveBy API data.
Reports are HTML, designed to print cleanly to PDF from the browser.

## Running

```bash
npm start          # web UI on http://localhost:3000
```

Requires two secrets, supplied as environment variables:

| Variable | Used for |
| --- | --- |
| `LIVEBY_API_KEY` | All market data (`Authorization: Bearer <key>`) |
| `ANTHROPIC_API_KEY` | The AI-written market commentary and video scripts |

They live in Railway's environment variables, not in the repo — `config.json`
intentionally ships with them blank. To run locally against the real keys
without copying them to disk:

```bash
railway run node app.js
```

## Reports

| Report | Endpoint | Output |
| --- | --- | --- |
| Monthly county report | `POST /api/generate` | Sales trends, current market, price-range breakdown |
| Batch (whole state) | `POST /api/batch-generate` | Every county in NY / NJ / CT, both property types |
| Regional overview | `POST /api/regional-overview` | Counties rolled up into 3 regions |
| Quarterly regional overview | `POST /api/quarterly-overview` | 3 regions, quarter vs. same quarter last year |
| Quarterly county overview | `POST /api/quarterly-county-overview` | Same data, one line per county |
| Market snapshot & video scripts | `POST /api/snapshot` | Snapshot plus per-metric video scripts |

The footprint is 21 areas: 8 New York counties, 12 New Jersey counties, and
Western Connecticut (a planning region, addressed by boundary ID rather than
county name — see `src/batchConfig.js`).

### Regional vs. county medians

The regional reports aggregate counties by taking a *median of county medians*,
which weights Sullivan County the same as Westchester. The county report reads
each county's median straight from the API. Counts reconcile exactly between the
two reports; **medians will not**. This is expected.

## Caching

Report runs are expensive in API calls (126 per quarterly report, 420 for a
monthly batch), so `src/cache.js` caches every API response keyed by request URL.

- Closed-period sold data is immutable and cached **permanently** — a given
  quarter is fetched from LiveBy exactly once.
- Active and under-contract snapshots are live data and expire after 1 hour.
- `CACHE_DISABLED=1` bypasses the cache entirely.
- `GET /api/cache` reports size; `DELETE /api/cache` clears it.

## Persistence

`DATA_DIR` points at a Railway volume mounted at `/data` in production, holding
both the cache and generated reports. Without it, Railway's filesystem is
ephemeral and reports are erased on every redeploy. If `DATA_DIR` is unset or
unwritable the app falls back to the repo directory and logs a warning rather
than failing to start.

## Deploying

Pushes to `main` deploy automatically via Railway's GitHub integration.
`railway up` still works for deploying the working directory directly.
