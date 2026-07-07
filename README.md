# The Warming Map

An interactive map of 175 years of temperature change, built on the
[Berkeley Earth](https://berkeleyearth.org) 0.25° gridded land + ocean
temperature dataset. Click any grid cell — any city, any stretch of ocean —
to see its annual temperature history since 1850, a ~20-year smoothed trend,
and how much it has warmed relative to the 1850–1900 baseline.

**Live site:** served from `docs/` via GitHub Pages.

## How it works

The 6.8 GB source NetCDF (`Global_TAVG_Gridded_0p25deg.nc`, not in this repo)
is precomputed into ~4,000 small gzipped binary tiles (~173 MB total) by
`build/build_site_data.py`. Each 4°×4° tile holds 256 cells × 176 annual
anomalies quantized to 0.01 °C, plus per-cell warming level, climatology
offset, land flag, and a data-quality flag. The browser fetches one tile per
click and decompresses it with the native `DecompressionStream` — no backend,
no libraries beyond Leaflet.

- **Map layer** — pre-rendered 1440×720 PNG of the current warming level per
  cell (Gaussian local-linear regression, σ = 7 yr, evaluated at 2025,
  relative to 1850–1900), displayed pixelated on a Leaflet EPSG:4326 map.
- **Chart** — hand-rolled SVG; the smoothed curve is computed client-side
  with the same algorithm as the build, so chart and map always agree.
- **Place names** — best-effort reverse geocoding via BigDataCloud's free
  client API; the panel works fully without it.
- **Permalinks** — `#lat,lon` in the URL opens a location directly.
- Cells where fewer than 25 valid years exist in 1850–1900 use a fallback
  baseline (earliest available years) and are flagged with a caveat (†).

## Rebuilding the data

```bash
# needs: numpy, netCDF4, Pillow, geopandas; and the source NetCDF one
# directory above the repo root
python3 build/build_site_data.py
```

Runs in about a minute and regenerates `docs/data/`, `docs/overlay/` and
`docs/geo/`. `build/colors.json` is the single source of truth for the color
scale, shared by the Python PNG renderer and the JS legend.

Note: regenerating the tiles rewrites ~173 MB; to keep repository history
from growing on data updates, squash or amend the data commit when refreshing.

## Data

Berkeley Earth Surface Temperature anomaly field, 0.25° × 0.25° grid,
monthly 1850 – present, land + ocean. Anomalies rebaselined to 1850–1900.
Annual means use complete years only (all 12 months present).
