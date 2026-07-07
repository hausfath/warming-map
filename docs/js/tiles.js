// Binary tile loader. Tiles are 16x16-cell gzipped blobs (see build script
// docstring for the exact layout), decompressed with the browser-native
// DecompressionStream and cached in a small LRU.

const TILE = 16;
const SENTINEL = -32768;
const MAGIC = 0x434c4d31; // "CLM1"
const LRU_MAX = 24;

const cache = new Map(); // "ty_tx" -> Promise<tile>

export function supported() {
  return typeof DecompressionStream !== "undefined";
}

export function cellFromLatLng(lat, lng) {
  const lon = ((lng + 180) % 360 + 360) % 360 - 180;
  const la = Math.min(89.999, Math.max(-89.999, lat));
  return {
    cx: Math.floor((lon + 180) / 0.25),
    cy: Math.floor((la + 90) / 0.25),
  };
}

export function cellBounds(cy, cx) {
  const s = cy * 0.25 - 90, w = cx * 0.25 - 180;
  return [[s, w], [s + 0.25, w + 0.25]];
}

export function cellCenter(cy, cx) {
  return { lat: cy * 0.25 - 90 + 0.125, lon: cx * 0.25 - 180 + 0.125 };
}

async function loadTile(ty, tx) {
  const res = await fetch(`data/tiles/t_${ty}_${tx}.bin.gz`);
  if (!res.ok) throw new Error(`tile ${ty}/${tx}: HTTP ${res.status}`);
  let buf;
  // GitHub Pages may serve .gz with Content-Encoding so the body arrives
  // already inflated; detect by magic and only gunzip when needed.
  const raw = await res.arrayBuffer();
  if (new DataView(raw).getUint32(0, true) === MAGIC) {
    buf = raw;
  } else {
    const ds = new DecompressionStream("gzip");
    buf = await new Response(
      new Blob([raw]).stream().pipeThrough(ds)
    ).arrayBuffer();
  }
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error("bad tile magic");
  const startYear = dv.getUint16(4, true);
  const nYears = dv.getUint16(6, true);
  const nCells = TILE * TILE;
  return {
    startYear,
    nYears,
    meta: new Int16Array(buf, 16, nCells * 3),
    metaBytes: new Uint8Array(buf, 16, nCells * 6),
    series: new Int16Array(buf, 16 + nCells * 6, nCells * nYears),
  };
}

export async function getCell(cy, cx) {
  const ty = cy >> 4, tx = cx >> 4;
  const key = `${ty}_${tx}`;
  let p = cache.get(key);
  if (p) {
    cache.delete(key); // refresh LRU position
  } else {
    p = loadTile(ty, tx).catch((e) => {
      cache.delete(key);
      throw e;
    });
  }
  cache.set(key, p);
  if (cache.size > LRU_MAX) cache.delete(cache.keys().next().value);

  const t = await p;
  const idx = (cy & 15) * TILE + (cx & 15);
  const ny = t.nYears;
  const q = t.series.subarray(idx * ny, (idx + 1) * ny);
  const series = new Array(ny);
  for (let i = 0; i < ny; i++) series[i] = q[i] === SENTINEL ? NaN : q[i] / 100;
  const w = t.meta[idx * 3], a = t.meta[idx * 3 + 1];
  return {
    startYear: t.startYear,
    nYears: ny,
    series,
    warming: w === SENTINEL ? NaN : w / 100,
    absOffset: a === SENTINEL ? NaN : a / 100,
    land: t.metaBytes[idx * 6 + 4] === 1,
    qualityFlag: t.metaBytes[idx * 6 + 5],
  };
}
