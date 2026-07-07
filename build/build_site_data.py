"""
Build all static site data for the interactive climate map from the Berkeley
Earth 0.25deg gridded land+ocean anomaly field.

Outputs (under docs/):
  data/tiles/t_{ty}_{tx}.bin.gz   4deg x 4deg binary tiles (see layout below)
  data/meta.json                  grid + palette metadata for the frontend
  overlay/warming.png             1440x720 RGBA warming map (row 0 = 90N)
  geo/countries.json              simplified Natural Earth country outlines

Tile binary layout (little-endian), tile = 16x16 cells:
  header (16 B): uint32 magic 'CLM1', uint16 startYear, uint16 nYears,
                 uint16 ty, uint16 tx, uint32 reserved
  meta (256 x 6 B, cell idx = (cellY&15)*16 + (cellX&15)):
                 int16 warmingLevel (0.01 C, -32768 = no data)
                 int16 absOffset    (0.01 C; absolute = anomaly + absOffset)
                 uint8 landFlag, uint8 qualityFlag (bit0 = baseline fallback)
  series (256 x nYears x int16): anomaly vs 1850-1900, 0.01 C, -32768 = NaN

Anomalies are rebaselined to 1850-1900 (>=25 valid years required, else
fallback to the mean of the earliest <=51 valid years, flagged).
"Current warming level" = Gaussian-kernel local linear regression
(sigma = 7 yr, ~20-yr effective window) evaluated at the final year.
"""
import gzip
import json
import os
import struct
import sys
import time as _time

import numpy as np
import netCDF4

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NC = os.path.join(os.path.dirname(ROOT), "Global_TAVG_Gridded_0p25deg.nc")
DOCS = os.path.join(ROOT, "docs")

Y0, Y1 = 1850, None          # Y1 = last complete year, found from file
PI0, PI1 = 1850, 1900        # baseline period (inclusive)
MIN_BASE_YEARS = 25
SIGMA = 7.0                  # Gaussian local-linear smoothing, years
NLAT, NLON = 720, 1440
TILE = 16
SENTINEL = -32768


def log(msg):
    print(f"[{_time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------- annual means
def compute_annual(ds):
    t = ds["time"][:].filled(np.nan)
    yr = np.floor(t + 1e-6).astype(int)
    years = []
    y = Y0
    while np.sum(yr == y) == 12:
        years.append(y)
        y += 1
    ny = len(years)
    log(f"complete years: {years[0]}-{years[-1]} ({ny})")

    annual = np.full((ny, NLAT, NLON), np.nan, dtype=np.float32)
    v = ds["temperature"]
    for i, y in enumerate(years):
        j0 = int(np.searchsorted(yr, y))
        block = v[j0:j0 + 12].filled(np.nan)          # (12, 720, 1440)
        valid = np.isfinite(block).all(axis=0)
        m = block.mean(axis=0)                        # NaN if any month NaN
        annual[i] = np.where(valid, m, np.nan)
        if (i + 1) % 25 == 0:
            log(f"  annual means {y} ({i + 1}/{ny})")
    return np.array(years), annual


# ------------------------------------------------------------------ rebaseline
def rebaseline(years, annual):
    nb = PI1 - PI0 + 1
    base_block = annual[:nb]
    nvalid = np.isfinite(base_block).sum(axis=0)
    base = np.where(nvalid >= MIN_BASE_YEARS,
                    np.nanmean(np.where(np.isfinite(base_block), base_block, np.nan), axis=0),
                    np.nan).astype(np.float32)

    # fallback: mean of earliest <=51 valid years anywhere in the record
    fb_mask = ~np.isfinite(base)
    valid = np.isfinite(annual)
    order = np.cumsum(valid, axis=0)
    sel = valid & (order <= nb)
    s = np.where(sel, np.nan_to_num(annual), 0.0).sum(axis=0)
    n = sel.sum(axis=0)
    fb = np.where(n > 0, s / np.maximum(n, 1), np.nan).astype(np.float32)

    quality = (fb_mask & (n > 0)).astype(np.uint8)    # bit0 = fallback used
    base = np.where(fb_mask, fb, base)
    annual -= base[None, :, :]
    log(f"baseline fallback cells: {int(quality.sum()):,} "
        f"({100 * quality.mean():.1f}%); no-data cells: {int((n == 0).sum()):,}")
    return base, quality


# ---------------------------------------------------- smoothed warming endpoint
def warming_level(years, annual):
    """Gaussian-kernel local linear regression evaluated at the last year,
    vectorized over all cells, NaN-aware. Chunked over latitude for memory."""
    x = years.astype(np.float64)
    x0 = x[-1]
    dx = x - x0
    w0 = np.exp(-0.5 * (dx / SIGMA) ** 2)

    out = np.full((NLAT, NLON), np.nan, dtype=np.float32)
    step = 60
    for r0 in range(0, NLAT, step):
        a = annual[:, r0:r0 + step, :].astype(np.float64)
        valid = np.isfinite(a)
        av = np.where(valid, a, 0.0)
        w = w0[:, None, None] * valid
        S0 = w.sum(axis=0)
        S1 = (w * dx[:, None, None]).sum(axis=0)
        S2 = (w * (dx ** 2)[:, None, None]).sum(axis=0)
        Sy = (w * av).sum(axis=0)
        Sxy = (w * dx[:, None, None] * av).sum(axis=0)
        det = S0 * S2 - S1 * S1
        ok = (S0 > 1e-9) & (np.abs(det) > 1e-9)
        with np.errstate(invalid="ignore", divide="ignore"):
            est = (S2 * Sy - S1 * Sxy) / det
        out[r0:r0 + step] = np.where(ok, est, np.nan).astype(np.float32)
    return out


# ------------------------------------------------------------------- abs offset
def abs_offset(ds, base):
    clim = ds["climatology"][:].filled(np.nan)        # (12, 720, 1440) abs degC
    return (clim.mean(axis=0) + base).astype(np.float32)


# ----------------------------------------------------------------------- tiles
def write_tiles(years, annual, warming, absoff, land, quality):
    tdir = os.path.join(DOCS, "data", "tiles")
    os.makedirs(tdir, exist_ok=True)
    ny = len(years)

    def q(x):
        r = np.clip(np.round(np.nan_to_num(x) * 100.0), -32767, 32767)
        return np.where(np.isfinite(x), r, SENTINEL).astype("<i2")

    warm_q = q(warming)
    # keep absOffset wherever it exists so the toggle works even for
    # cells with sparse series
    abs_q = q(absoff)
    series_q = q(annual)                              # (ny, 720, 1440)
    land_u = (np.nan_to_num(land) >= 0.5).astype(np.uint8)

    ntx, nty = NLON // TILE, NLAT // TILE
    total_bytes = 0
    for ty in range(nty):
        ys, ye = ty * TILE, (ty + 1) * TILE
        for tx in range(ntx):
            xs, xe = tx * TILE, (tx + 1) * TILE
            hdr = struct.pack("<IHHHHI", 0x434C4D31, years[0], ny, ty, tx, 0)
            meta = np.empty((TILE * TILE, 3), dtype="<i2")
            wq = warm_q[ys:ye, xs:xe].reshape(-1)
            aq = abs_q[ys:ye, xs:xe].reshape(-1)
            lf = land_u[ys:ye, xs:xe].reshape(-1)
            qf = quality[ys:ye, xs:xe].reshape(-1)
            meta[:, 0] = wq
            meta[:, 1] = aq
            meta[:, 2] = (lf.astype("<u2") | (qf.astype("<u2") << 8)).view("<i2")
            ser = series_q[:, ys:ye, xs:xe].reshape(ny, -1).T.copy()  # cell-major
            payload = hdr + meta.tobytes() + ser.tobytes()
            path = os.path.join(tdir, f"t_{ty}_{tx}.bin.gz")
            with gzip.open(path, "wb", compresslevel=9) as f:
                f.write(payload)
            total_bytes += os.path.getsize(path)
        if (ty + 1) % 9 == 0:
            log(f"  tiles row {ty + 1}/{nty}, {total_bytes / 1e6:.0f} MB so far")
    log(f"tiles written: {nty * ntx} files, {total_bytes / 1e6:.0f} MB gzipped")


# ------------------------------------------------------------------ PNG overlay
def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def write_png(warming):
    from PIL import Image
    stops = json.load(open(os.path.join(HERE, "colors.json")))["warming_stops"]
    vals = np.array([s["value"] for s in stops])
    cols = np.array([hex_to_rgb(s["hex"]) for s in stops], dtype=np.float64)

    w = warming.astype(np.float64)
    finite = np.isfinite(w)
    wc = np.clip(np.where(finite, w, 0.0), vals[0], vals[-1])
    rgba = np.zeros((NLAT, NLON, 4), dtype=np.uint8)
    for c in range(3):
        rgba[..., c] = np.interp(wc, vals, cols[:, c]).round().astype(np.uint8)
    rgba[..., 3] = np.where(finite, 255, 0)
    rgba = rgba[::-1]                                  # row 0 = 90N
    os.makedirs(os.path.join(DOCS, "overlay"), exist_ok=True)
    img = Image.fromarray(rgba, "RGBA")
    img.save(os.path.join(DOCS, "overlay", "warming.png"), optimize=True)
    log("wrote overlay/warming.png")


# ------------------------------------------------------------------- geography
def write_geo():
    import geopandas as gpd
    out = os.path.join(DOCS, "geo")
    os.makedirs(out, exist_ok=True)
    url50 = ("https://naciscdn.org/naturalearth/50m/cultural/"
             "ne_50m_admin_0_countries.zip")
    try:
        world = gpd.read_file(url50)
        log("loaded Natural Earth 50m countries")
    except Exception as e:
        log(f"50m download failed ({e}); falling back to cached 110m")
        import glob
        shp = glob.glob(os.path.expanduser(
            "~/Library/Caches/regionmask/natural_earth/v5.0.0/"
            "ne_110m_admin_0_countries/*.shp"))[0]
        world = gpd.read_file(shp)
    world = world[["geometry"]]
    world["geometry"] = world["geometry"].simplify(0.05)
    gj = json.loads(world.to_json())
    # quantize coordinates to 2 decimals to shrink the file
    def rnd(coords):
        if isinstance(coords[0], (int, float)):
            return [round(coords[0], 2), round(coords[1], 2)]
        return [rnd(c) for c in coords]
    for f in gj["features"]:
        f["properties"] = {}
        f["geometry"]["coordinates"] = rnd(f["geometry"]["coordinates"])
    path = os.path.join(out, "countries.json")
    json.dump(gj, open(path, "w"), separators=(",", ":"))
    log(f"wrote geo/countries.json ({os.path.getsize(path) / 1e6:.1f} MB)")


# ------------------------------------------------------------------------ meta
def write_meta(years, warming, land):
    area = np.cos(np.deg2rad(np.linspace(-89.875, 89.875, NLAT)))[:, None]
    wt = np.where(np.isfinite(warming), area * np.ones((NLAT, NLON)), 0.0)
    gmean = float(np.nansum(np.where(np.isfinite(warming), warming, 0) * wt) / wt.sum())
    meta = {
        "startYear": int(years[0]),
        "endYear": int(years[-1]),
        "nYears": int(len(years)),
        "baseline": [PI0, PI1],
        "sigmaYears": SIGMA,
        "grid": {"nLat": NLAT, "nLon": NLON, "cellDeg": 0.25, "tileCells": TILE},
        "globalMeanWarming": round(gmean, 3),
        "source": "Berkeley Earth Global_TAVG_Gridded_0p25deg",
        "generated": _time.strftime("%Y-%m-%d"),
    }
    os.makedirs(os.path.join(DOCS, "data"), exist_ok=True)
    json.dump(meta, open(os.path.join(DOCS, "data", "meta.json"), "w"), indent=1)
    log(f"global area-weighted mean warming: {gmean:.3f} C (expect ~1.3-1.5)")


# ------------------------------------------------------------- validation dump
def dump_validation(years, annual, warming, absoff):
    """Save a few reference cells for round-trip / JS parity tests."""
    cells = {
        "berkeley_ca": (37.87, -122.27),
        "london": (51.5, -0.13),
        "nairobi": (-1.29, 36.82),
        "south_pole": (-89.9, 0.1),
        "mid_pacific": (0.1, -160.0),
    }
    out = {"years": years.tolist(), "cells": {}}
    for name, (la, lo) in cells.items():
        cy = int((la + 90) / 0.25)
        cx = int((lo + 180) / 0.25)
        out["cells"][name] = {
            "lat": la, "lon": lo, "cellY": cy, "cellX": cx,
            "tile": [cy // TILE, cx // TILE],
            "idx": (cy % TILE) * TILE + (cx % TILE),
            "series": [None if not np.isfinite(v) else round(float(v), 4)
                       for v in annual[:, cy, cx]],
            "warming": None if not np.isfinite(warming[cy, cx])
                       else round(float(warming[cy, cx]), 4),
            "absOffset": None if not np.isfinite(absoff[cy, cx])
                         else round(float(absoff[cy, cx]), 4),
        }
    json.dump(out, open(os.path.join(HERE, "validation_cells.json"), "w"), indent=1)
    log("wrote build/validation_cells.json")


def main():
    t0 = _time.time()
    log(f"opening {NC}")
    ds = netCDF4.Dataset(NC)
    years, annual = compute_annual(ds)
    base, quality = rebaseline(years, annual)
    warming = warming_level(years, annual)
    absoff = abs_offset(ds, base)
    land = ds["land_mask"][:].filled(0.0)
    ds.close()

    dump_validation(years, annual, warming, absoff)
    write_meta(years, warming, land)
    write_png(warming)
    write_tiles(years, annual, warming, absoff, land, quality)
    write_geo()
    log(f"done in {(_time.time() - t0) / 60:.1f} min")


if __name__ == "__main__":
    main()
